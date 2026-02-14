const crypto = require('crypto');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const { getSystemPrompt } = require('./persona');
const { toolDeclarations } = require('./tools');
const { executeTool, getUserTier, TOOL_TIERS } = require('./tool-executor');
const store = require('./store');
const { createLogger } = require('./logger');
const log = createLogger('Ultron');
const openaiLog = createLogger('Ultron/OpenAI');
const gemmaLog = createLogger('Ultron/Gemma');

const openai = config.openai?.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;
const genAI = config.ai?.apiKey ? new GoogleGenerativeAI(config.ai.apiKey) : null;

const API_TIMEOUT_MS = 30000;
function withTimeout(promise, ms = API_TIMEOUT_MS) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`API call timed out after ${ms / 1000}s`)), ms))
    ]);
}

// ── Response Cleanup ──

// Patterns for leaked function calls that models dump as text
const LEAKED_PATTERNS = [
    /function=\w+>[^\n]*/gi,                          // function=createChannel>{"name":"skull"}
    /<function=\w+>[^<]*<\/function>/gi,               // <function=createChannel>...</function>
    /\w+:\d+<\|tool_call_argument_begin\|>[^\n]*/gi,   // createChannel:2<|tool_call_argument_begin|>{"name":"skull"}
    /\{\s*"function_call"\s*:[\s\S]*?\}\s*/g,          // {"function_call": ...}
    /```(?:json)?\s*\{[\s\S]*?"(?:name|function)"[\s\S]*?\}\s*```/g, // ```json {"name":"createChannel"...}```
    /<\|tool_calls_section_begin\|>[\s\S]*?(?:<\|tool_calls_section_end\|>|$)/gi,
    /<\|tool_call_begin\|>[\s\S]*?(?:<\|tool_call_end\|>|$)/gi,
    /<\|tool_call_argument_end\|>/gi,
    /<\|im_start\|>tool_calls[\s\S]*?(?:<\|im_end\|>|$)/gi,
];

// Patterns for chain-of-thought / reasoning leakage (merged for fewer passes)
const COT_PATTERNS = [
    /<think>[\s\S]*?<\/think>/gi,
    /\((?:Note|Actually|Final answer|Wait|Let me|I (?:need|should|think)|The (?:last|final|correct))[\s\S]*?\)/gi,
    /\*(?:thinking|internal|reasoning)\*[\s\S]*?\*/gi,
    /^(?:Reasoning|Internal thought|Thinking):.*$/gim,
    /User wants to[\s\S]*?\.(?:\s|$)/gi,
    /There(?:'s| is) no tool[\s\S]*?\.(?:\s|$)/gi,
    /(?:We'll|I'll|I will) respond accordingly[^.]*\.?/gi,
    /(?:I (?:don't|do not) have|I lack) (?:a )?(?:direct |)(?:method|tool|way|function)[^.]*\.?/gi,
];

function cleanResponse(text) {
    if (!text) return text;
    let cleaned = text;

    // Strip leaked function call syntax
    for (const pattern of LEAKED_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }

    // Strip chain-of-thought leakage
    for (const pattern of COT_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }

    // Strip [TOOL:...] and [Used tool: result] syntax that leaked through
    cleaned = cleaned.replace(/\[TOOL:\w+\(\{[\s\S]*?\}\)\]/g, '');
    cleaned = cleaned.replace(/\[Used \w+:[^\]]*\]\s*/g, '');

    // Collapse excessive periods (4+) to ellipsis, preserve normal ellipses (2-3 dots)
    cleaned = cleaned.replace(/\.{4,}/g, '...').replace(/\s{2,}/g, ' ').trim();

    // Deduplicate only if sentences are actually repeated
    const sentences = cleaned.split(/(?<=\.)\s+/).filter(s => s.length > 2);
    if (sentences.length > 2) {
        const seen = new Set();
        const unique = [];
        for (const s of sentences) {
            const normalized = s.toLowerCase().trim();
            if (!seen.has(normalized)) {
                seen.add(normalized);
                unique.push(s);
            }
        }
        // Only truncate if we actually found duplicates
        if (unique.length < sentences.length) {
            cleaned = unique.join(' ');
        }
    }

    return cleaned.trim() || null;
}

// ── Balanced JSON Extractor ──

function extractJSON(text, startIndex) {
    const idx = text.indexOf('{', startIndex);
    if (idx === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = idx; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(idx, i + 1);
        }
    }
    return null;
}

// ── Dynamic Tool Selection ──

// Base tools always included regardless of message content
const BASE_TOOL_NAMES = new Set([
    'getServerInfo', 'getMemberInfo', 'readMessages', 'fetchMessage',
    'listChannels', 'listRoles', 'saveMemory', 'getMemory', 'sendMessage'
]);

// Pre-index tools by category and name at module load time
const toolsByCategory = new Map();
const toolsByName = new Map();
for (const decl of toolDeclarations) {
    const cat = decl.category || 'uncategorized';
    if (!toolsByCategory.has(cat)) toolsByCategory.set(cat, []);
    toolsByCategory.get(cat).push(decl);
    toolsByName.set(decl.name, decl);
}

// Keyword → category mapping for dynamic selection
const CATEGORY_KEYWORDS = {
    channel: /\b(?:channel|thread|archive|slow\s?mode|lock|unlock|nsfw|voice\s?limit|clone\s?channel|move\s?channel|forum|post|stage|bitrate|region|topic)\b/i,
    role: /\b(?:role|assign|give\s+role|remove\s+role|promote|demote)\b/i,
    moderation: /\b(?:kick|ban|unban|timeout|mute|unmute|nick(?:name)?|voice|disconnect|deafen|undeafen|warn|punish)\b/i,
    message: /\b(?:message|send|purge|pin|unpin|embed|reply|react|poll|dm|direct\s+message|announce|announcement)\b/i,
    guild: /\b(?:server\s+(?:name|icon|banner|setting|info)|about\s+(?:the\s+)?server|verification|afk|notification|rename\s+server)\b/i,
    permission: /\b(?:perm(?:ission)?|overwrite|allow|deny)\b/i,
    document: /\b(?:document|doc|rule|guide|faq|note)\b/i,
    memory: /\b(?:memory|remember|forget|recall|memorize)\b/i,
    config: /\b(?:emoji|emote|sticker|webhook|invite|event|schedule|automod|welcome|goodbye|autorole|reaction\s?role)\b/i,
};

const ACTION_PATTERN = /\b(?:create|make|add|build|delete|remove|destroy|kick|ban|timeout|mute|unmute|purge|send|lock|unlock|set|assign|move|clone|rename|edit|change|update|pin|unpin|setup|configure|save|dm|clear|give|grant|revoke|post|start|stop|end|invite|react|deafen|undeafen|enable|disable)\b/i;
const QUERY_PATTERN = /\b(?:what|who|when|where|how|why|list|show|tell|info|status|get|read|check|describe|count|many)\b/i;

function selectToolsForMessage(userInput, userTier) {
    const input = (userInput || '').toLowerCase();
    const hasAction = ACTION_PATTERN.test(input);
    const hasQuery = QUERY_PATTERN.test(input);

    // Match keywords to categories
    const matchedCategories = new Set();
    for (const [category, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
        if (pattern.test(input)) {
            matchedCategories.add(category);
        }
    }

    // If no intent or category match, skip tools entirely
    if (!hasAction && !hasQuery && matchedCategories.size === 0) return [];

    // Start with base tools
    const selectedNames = new Set(BASE_TOOL_NAMES);

    // Add info category only when a query is detected
    if (hasQuery) {
        const infoTools = toolsByCategory.get('info');
        if (infoTools) for (const decl of infoTools) selectedNames.add(decl.name);
    }

    // Add tools from matched categories using pre-indexed map
    for (const cat of matchedCategories) {
        const tools = toolsByCategory.get(cat);
        if (tools) for (const decl of tools) selectedNames.add(decl.name);
    }

    // Fallback: action intent detected but no category matched — include all
    // action categories so the model can pick the right tool
    if (hasAction && matchedCategories.size === 0) {
        for (const [cat, tools] of toolsByCategory) {
            for (const decl of tools) selectedNames.add(decl.name);
        }
    }

    // Filter by user tier and build result in a single pass
    const filtered = [];
    for (const name of selectedNames) {
        const requiredTier = TOOL_TIERS[name] || 3;
        if (userTier < requiredTier) continue;
        const decl = toolsByName.get(name);
        if (decl) {
            const { category, ...rest } = decl;
            filtered.push(rest);
        }
    }

    return filtered;
}

// ── Dynamic tool_choice Detection ──

function detectToolChoice(userInput) {
    const input = userInput || '';
    const hasAction = ACTION_PATTERN.test(input);
    const hasQuery = QUERY_PATTERN.test(input);

    if (!hasAction && !hasQuery) return 'none';

    // If clear action intent and no query words, force tool use
    if (hasAction && !hasQuery) return 'required';

    // Otherwise auto
    return 'auto';
}

function normalizeSchemaType(type) {
    if (!type) return 'string';
    const raw = typeof type === 'string' ? type : String(type);
    const value = raw.toLowerCase();
    if (value.includes('string')) return 'string';
    if (value.includes('number')) return 'number';
    if (value.includes('integer')) return 'integer';
    if (value.includes('boolean')) return 'boolean';
    if (value.includes('array')) return 'array';
    if (value.includes('object')) return 'object';
    return 'string';
}

function convertToolsForOpenAI(declarations) {
    return declarations.map(decl => {
        const props = {};
        const properties = decl.parameters?.properties || {};
        for (const [key, val] of Object.entries(properties)) {
            const prop = { type: normalizeSchemaType(val.type) };
            if (val.description) prop.description = val.description;
            if (val.enum) prop.enum = val.enum;
            props[key] = prop;
        }
        return {
            type: 'function',
            function: {
                name: decl.name,
                description: decl.description,
                parameters: {
                    type: 'object',
                    properties: props,
                    required: decl.parameters?.required || []
                }
            }
        };
    });
}

function buildToolPrompt(selectedTools, toolChoice, nonce) {
    if (toolChoice === 'none') return '';
    if (!selectedTools || selectedTools.length === 0) return '';

    const lines = [];
    lines.push('[TOOLS]');
    lines.push('Text-only tool calling is enabled.');
    lines.push('To call a tool, output ONLY one line in this exact format:');
    lines.push(`function=toolName>{JSON} #nonce:${nonce}`);
    lines.push('If multiple tools are needed, output one line per tool call.');
    if (toolChoice === 'required') {
        lines.push('You MUST call a tool before responding.');
    } else {
        lines.push('Use tools to verify live server state before answering.');
    }
    lines.push('Available tools:');

    for (const tool of selectedTools) {
        const props = tool.parameters?.properties || {};
        const required = new Set(tool.parameters?.required || []);
        const parts = [];
        for (const [key, val] of Object.entries(props)) {
            const type = val.type || 'string';
            const req = required.has(key) ? '' : '?';
            const enumText = val.enum ? ` enum:${val.enum.join('|')}` : '';
            const desc = val.description ? ` - ${val.description}` : '';
            parts.push(`${key}${req}:${type}${enumText}${desc}`.trim());
        }
        const args = parts.length > 0 ? parts.join(', ') : 'none';
        const desc = tool.description ? ` ${tool.description}` : '';
        lines.push(`- ${tool.name}:${desc} Args: ${args}`);
    }

    lines.push('[/TOOLS]');
    return lines.join('\n');
}

async function attachImagesToLastMessage(contents, images) {
    if (!images || images.length === 0) return;
    const lastMsg = contents[contents.length - 1];
    if (!lastMsg || !lastMsg.parts) return;

    const imageParts = [];
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
    for (const url of images) {
        try {
            const res = await fetch(url);
            const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
            if (contentLength > MAX_IMAGE_BYTES) {
                gemmaLog.warn(`Skipping image (${Math.round(contentLength / 1024 / 1024)}MB exceeds 10MB limit): ${url}`);
                continue;
            }
            const chunks = [];
            let totalBytes = 0;
            for await (const chunk of res.body) {
                totalBytes += chunk.length;
                if (totalBytes > MAX_IMAGE_BYTES) {
                    gemmaLog.warn(`Skipping image (stream exceeded 10MB limit): ${url}`);
                    break;
                }
                chunks.push(chunk);
            }
            if (totalBytes > MAX_IMAGE_BYTES) continue;
            const buffer = Buffer.concat(chunks);
            const mimeType = res.headers.get('content-type') || 'image/jpeg';
            imageParts.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
        } catch (err) {
            gemmaLog.error('Failed to fetch image:', err.message);
        }
    }

    if (imageParts.length > 0) {
        lastMsg.parts = [...lastMsg.parts, ...imageParts];
    }
}

function buildGenerationConfig() {
    const temperature = Number.isFinite(config.ai.temperature) ? config.ai.temperature : 0.2;
    const topP = Number.isFinite(config.ai.topP) ? config.ai.topP : 0.9;
    const topK = Number.isFinite(config.ai.topK) ? config.ai.topK : 40;
    const maxOutputTokens = Number.isFinite(config.ai.maxOutputTokens) ? config.ai.maxOutputTokens : 512;

    return { temperature, topP, topK, maxOutputTokens };
}

function lineContainsNonce(text, index, nonce) {
    if (!nonce) return true;
    const lineStart = text.lastIndexOf('\n', index) + 1;
    let lineEnd = text.indexOf('\n', index);
    if (lineEnd === -1) lineEnd = text.length;
    return text.slice(lineStart, lineEnd).includes(nonce);
}

// Parse function calls that leaked into text content
function parseLeakedToolCalls(text, nonce = '') {
    const calls = [];
    const toolNames = new Set(toolDeclarations.map(t => t.name));

    // Pattern: toolName:N<|tool_call_argument_begin|>{"arg":"val"} (kimi-k2 leaked format)
    const pattern0 = /(\w+):\d+<\|tool_call_argument_begin\|>/gi;
    for (const match of text.matchAll(pattern0)) {
        if (!lineContainsNonce(text, match.index, nonce)) continue;
        if (toolNames.has(match[1])) {
            const jsonStr = extractJSON(text, match.index + match[0].length);
            if (jsonStr) {
                try { calls.push({ name: match[1], args: JSON.parse(jsonStr) }); } catch (_) {}
            }
        }
    }

    // Pattern: <|tool_call_begin|>...<|tool_call_argument_begin|>{"arg":"val"}
    if (calls.length === 0) {
        const pattern0b = /<\|tool_call_begin\|>.*?(\w+).*?<\|tool_call_argument_begin\|>/gi;
        for (const match of text.matchAll(pattern0b)) {
            if (!lineContainsNonce(text, match.index, nonce)) continue;
            if (toolNames.has(match[1])) {
                const jsonStr = extractJSON(text, match.index + match[0].length);
                if (jsonStr) {
                    try { calls.push({ name: match[1], args: JSON.parse(jsonStr) }); } catch (_) {}
                }
            }
        }
    }

    // Pattern: function=toolName>{"arg":"val"} or <function=toolName>{"arg":"val"}</function>
    if (calls.length === 0) {
        const pattern1 = /(?:<)?function=(\w+)>/gi;
        for (const match of text.matchAll(pattern1)) {
            if (!lineContainsNonce(text, match.index, nonce)) continue;
            if (toolNames.has(match[1])) {
                const jsonStr = extractJSON(text, match.index + match[0].length);
                if (jsonStr) {
                    try { calls.push({ name: match[1], args: JSON.parse(jsonStr) }); } catch (_) {}
                }
            }
        }
    }

    // Pattern: toolName({"arg":"val"}) - only match known tool names
    if (calls.length === 0) {
        // Build regex that only matches known tool names followed by (
        const toolNamesArr = Array.from(toolNames);
        if (toolNamesArr.length > 0) {
            const pattern2 = new RegExp(`\\b(${toolNamesArr.join('|')})\\(`, 'g');
            for (const match of text.matchAll(pattern2)) {
                if (!lineContainsNonce(text, match.index, nonce)) continue;
                const jsonStr = extractJSON(text, match.index + match[0].length);
                if (jsonStr) {
                    try { calls.push({ name: match[1], args: JSON.parse(jsonStr) }); } catch (_) {}
                }
            }
        }
    }

    return calls;
}

function buildOpenAIMessages(systemPrompt, contents, images) {
    const messages = [{ role: 'system', content: systemPrompt }];
    const lastIdx = contents.length - 1;
    for (let i = 0; i < contents.length; i++) {
        const entry = contents[i];
        const role = entry.role === 'model' ? 'assistant' : 'user';
        const text = (entry.parts || []).map(p => p.text).filter(Boolean).join(' ') || '';

        if (i === lastIdx && images && images.length > 0) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text },
                    ...images.map(url => ({ type: 'image_url', image_url: { url } }))
                ]
            });
        } else {
            messages.push({ role, content: text });
        }
    }
    return messages;
}

async function openaiRequest(messages, tools, toolChoice) {
    const baseOpts = {
        model: config.openai.model,
        messages
    };
    if (tools && tools.length > 0) {
        baseOpts.tools = tools;
        baseOpts.tool_choice = toolChoice || 'auto';
    }
    const opts = { ...baseOpts };
    const modelName = String(config.openai.model || '');
    const defaultReasoning = /^gpt-5/i.test(modelName) ? 'minimal' : null;
    const reasoningEffort = config.openai.reasoningEffort || defaultReasoning;
    const verbosity = config.openai.verbosity || null;
    if (reasoningEffort) opts.reasoning_effort = reasoningEffort;
    if (verbosity) opts.verbosity = verbosity;

    try {
        return await withTimeout(openai.chat.completions.create(opts));
    } catch (err) {
        const msg = err?.message || '';
        if ((reasoningEffort || verbosity) &&
            /reasoning|verbosity|unknown|invalid/i.test(msg)) {
            openaiLog.warn(`OpenAI params rejected, retrying without reasoning/verbosity: ${msg}`);
            return await withTimeout(openai.chat.completions.create(baseOpts));
        }
        throw err;
    }
}

// ── OpenAI Provider (native tool calling) ──

async function generateWithOpenAI(systemPrompt, contents, message, images = [], userTier = 3, userInput = '') {
    if (!openai) throw new Error('OpenAI not configured');

    const selectedTools = selectToolsForMessage(userInput, userTier);
    const openaiTools = convertToolsForOpenAI(selectedTools);
    const rawToolChoice = detectToolChoice(userInput);
    const toolChoice = openaiTools.length > 0 ? rawToolChoice : 'none';

    const messages = buildOpenAIMessages(systemPrompt, contents, images);

    const toolLog = [];
    let rounds = 0;
    while (rounds <= config.maxToolRounds) {
        const currentChoice = rounds === 0 ? toolChoice : 'auto';
        const useTools = currentChoice !== 'none' && openaiTools.length > 0;
        const completion = await openaiRequest(messages, useTools ? openaiTools : null, useTools ? currentChoice : null);
        const assistant = completion?.choices?.[0]?.message || {};

        messages.push({
            role: assistant.role || 'assistant',
            content: assistant.tool_calls ? (assistant.content || null) : (assistant.content ?? ''),
            tool_calls: assistant.tool_calls
        });

        const toolCalls = assistant.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
            return { text: assistant.content?.trim() || null, toolLog };
        }

        for (const tc of toolCalls) {
            const name = tc.function?.name;
            let args = {};
            try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (_) {}
            openaiLog.info(`Tool: ${name}(${JSON.stringify(args)})`);

            let toolResult;
            try {
                toolResult = await executeTool(name, args, message);
            } catch (err) {
                toolResult = { error: err.message };
            }

            toolLog.push({ tool: name, args, result: toolResult });
            messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(toolResult)
            });
        }
        rounds++;
    }

    const final = await openaiRequest(messages, null, null);
    const finalText = final?.choices?.[0]?.message?.content?.trim() || null;
    return { text: finalText, toolLog };
}

// ── Gemma Provider (text-only tools) ──

async function generateWithGemma(systemPrompt, contents, message, images = [], userTier = 3, userInput = '') {
    if (!genAI) throw new Error('Gemma not configured');

    const selectedTools = selectToolsForMessage(userInput, userTier);
    const rawToolChoice = detectToolChoice(userInput);
    const toolChoice = selectedTools.length > 0 ? rawToolChoice : 'none';
    const nonce = crypto.randomBytes(3).toString('hex');
    const toolPrompt = buildToolPrompt(selectedTools, toolChoice, nonce);

    const working = contents.map(entry => ({ role: entry.role, parts: [...entry.parts] }));
    const useSystemInstruction = !/gemma/i.test(String(config.ai.model || ''));
    if (!useSystemInstruction) {
        working.unshift(
            { role: 'user', parts: [{ text: `[SYSTEM]\n${systemPrompt}` }] },
            { role: 'model', parts: [{ text: 'Understood.' }] }
        );
    }
    if (toolPrompt) {
        working.splice(working.length - 1, 0,
            { role: 'user', parts: [{ text: toolPrompt }] },
            { role: 'model', parts: [{ text: 'Acknowledged.' }] }
        );
    }

    if (images.length > 0) {
        await attachImagesToLastMessage(working, images);
    }

    const modelConfig = {
        model: config.ai.model,
        generationConfig: buildGenerationConfig()
    };
    if (useSystemInstruction) modelConfig.systemInstruction = systemPrompt;
    const model = genAI.getGenerativeModel(modelConfig);

    const toolLog = [];
    let rounds = 0;
    let forcedRetry = false;
    while (rounds <= config.maxToolRounds) {
        const result = await withTimeout(model.generateContent({ contents: working }));
        const text = result?.response?.text?.() || '';
        const content = text.trim();
        if (!content) return { text: null, toolLog };

        const leakedCalls = parseLeakedToolCalls(content, nonce);
        if (leakedCalls.length === 0) {
            if (toolChoice === 'required' && !forcedRetry) {
                forcedRetry = true;
                working.push({ role: 'model', parts: [{ text: content }] });
                working.push({
                    role: 'user',
                    parts: [{ text: `[SYSTEM] A tool call is required. Output ONLY tool call lines using the exact format: function=toolName>{JSON} #nonce:${nonce}. No other text.` }]
                });
                rounds++;
                continue;
            }
            return { text: content, toolLog };
        }

        const results = [];
        for (const lc of leakedCalls) {
            gemmaLog.info(`Tool (text): ${lc.name}(${JSON.stringify(lc.args)})`);
            let toolResult;
            try {
                toolResult = await executeTool(lc.name, lc.args, message);
            } catch (err) {
                toolResult = { error: err.message };
            }
            toolLog.push({ tool: lc.name, args: lc.args, result: toolResult });
            results.push({ name: lc.name, result: toolResult });
        }

        const resultSummary = results.map(r => `${r.name}: ${JSON.stringify(r.result)}`).join('\n');
        working.push({ role: 'model', parts: [{ text: content }] });
        working.push({
            role: 'user',
            parts: [{ text: `[SYSTEM] The tools were executed. Results:\n${resultSummary}\n\nIf further actions are required, output another tool call line. Otherwise reply to the user in 1-2 sentences with no tool calls.` }]
        });
        rounds++;
    }

    return { text: null, toolLog };
}

// ── Main Entry ──

async function generateResponse(message, userInput, images = []) {
    const guild = message.guild;
    const userId = message.author.id;
    const userName = message.author.displayName || message.author.username;

    const userTier = guild ? getUserTier(message.member, guild.id) : 1;

    let memories = [];
    if (guild) {
        const mem = store.read(`memory-${guild.id}.json`, {});
        memories = Object.entries(mem).map(([key, entry]) => ({ key, value: entry.value }));
    }

    let documents = [];
    if (guild) {
        const docs = store.read(`documents-${guild.id}.json`, []);
        documents = docs.map(d => ({ name: d.name }));
    }

    const systemPrompt = getSystemPrompt(guild, { userTier, userName, memories, documents });

    const historyFile = guild ? `conversations-${guild.id}-${userId}.json` : `conversations-dm-${userId}.json`;
    const history = store.read(historyFile, []);

    // Only include tool context from the last 3 messages to avoid stale state beliefs
    const recentHistory = history.slice(-config.maxConversationHistory);
    const recentToolEntries = recentHistory.slice(-3).filter(e => e.toolContext);
    const toolSummary = recentToolEntries.map(e => e.toolContext).join(' ');

    const contents = [];
    if (toolSummary) {
        contents.push({ role: 'user', parts: [{ text: `[SYSTEM] Actions from your last few messages (may no longer reflect current state — always use tools to verify): ${toolSummary}` }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
    }
    for (const entry of recentHistory) {
        contents.push({ role: 'user', parts: [{ text: entry.user }] });
        contents.push({ role: 'model', parts: [{ text: entry.model }] });
    }
    contents.push({ role: 'user', parts: [{ text: `[${userName}]: ${userInput}` }] });

    let result = null;

    if (openai) {
        try {
            result = await generateWithOpenAI(systemPrompt, contents, message, images, userTier, userInput);
            if (result?.text) openaiLog.info(`Response via OpenAI (${config.openai.model})`);
        } catch (err) {
            log.error('OpenAI failed:', err.message);
        }
    }

    if (!result?.text) {
        try {
            result = await generateWithGemma(systemPrompt, contents, message, images, userTier, userInput);
            if (result?.text) gemmaLog.info(`Response via Gemma (${config.ai.model})`);
        } catch (err) {
            log.error('Gemma failed:', err.message);
        }
    }

    if (!result?.text) return 'Something failed on my end. Try again.';

    let text = result.text;

    // Clean up any leaked function calls, chain-of-thought, repetition
    text = cleanResponse(text);
    if (!text) return 'Response failed. Try again.';

    // Build tool context summary for history
    let toolContext = null;
    if (result.toolLog && result.toolLog.length > 0) {
        toolContext = result.toolLog.map(t => {
            const res = t.result?.success ? 'success' : (t.result?.error || JSON.stringify(t.result));
            return `[Used ${t.tool}: ${res}]`;
        }).join(' ');
    }

    // Save to conversation history (include tool context so next turn knows what happened)
    const historyEntry = { user: `[${userName}]: ${userInput}`, model: text };
    if (toolContext) historyEntry.toolContext = toolContext;
    const updated = [...history, historyEntry];
    store.write(historyFile, updated.slice(-config.maxConversationHistory * 2));

    // Log to mod channel if tools were used
    if (guild && result.toolLog && result.toolLog.length > 0) {
        try {
            const guildConfig = store.read(`guild-${guild.id}.json`, {});
            if (guildConfig.modLogChannel) {
                const logChannel = guild.channels.cache.get(guildConfig.modLogChannel);
                if (logChannel) {
                    const toolEntries = result.toolLog.map(t =>
                        `\`${t.tool}\` by ${userName} — ${t.result?.success ? 'success' : (t.result?.error || 'done')}`
                    ).join('\n');
                    await logChannel.send(`**[Ultron Tool Log]**\n${toolEntries}`).catch(() => {});
                }
            }
        } catch (_) {}
    }

    return text;
}

module.exports = { generateResponse, selectToolsForMessage, detectToolChoice };
