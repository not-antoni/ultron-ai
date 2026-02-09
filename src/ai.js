const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const config = require('../config');
const { getSystemPrompt } = require('./persona');
const { toolDeclarations } = require('./tools');
const { executeTool, getUserTier, TOOL_TIERS } = require('./tool-executor');
const store = require('./store');
const { createLogger } = require('./logger');
const log = createLogger('Ultron');
const groqLog = createLogger('Ultron/Groq');
const geminiLog = createLogger('Ultron/Gemini');

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const groq = config.groq.apiKey ? new Groq({ apiKey: config.groq.apiKey }) : null;

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
    channel: /\b(?:channel|thread|archive|slow\s?mode|lock|unlock|nsfw|voice\s?limit|clone\s?channel|move\s?channel|forum|post|stage|bitrate|region)\b/i,
    role: /\b(?:role|assign|give\s+role|remove\s+role)\b/i,
    moderation: /\b(?:kick|ban|unban|timeout|mute|unmute|nick(?:name)?|voice|disconnect|deafen)\b/i,
    message: /\b(?:message|send|purge|pin|unpin|embed|reply|react|poll|dm|direct\s+message)\b/i,
    guild: /\b(?:server\s+(?:name|icon|banner|setting)|verification|afk|notification|rename\s+server)\b/i,
    permission: /\b(?:perm(?:ission)?|overwrite|allow|deny)\b/i,
    document: /\b(?:document|doc|rule|guide|faq|note)\b/i,
    memory: /\b(?:memory|remember|forget|recall|memorize)\b/i,
    config: /\b(?:emoji|emote|sticker|webhook|invite|event|schedule|automod|welcome|goodbye|autorole|reaction\s?role)\b/i,
};

function selectToolsForMessage(userInput, userTier) {
    const input = userInput.toLowerCase();

    // Start with base tools
    const selectedNames = new Set(BASE_TOOL_NAMES);

    // Add info category always (lightweight read-only tools)
    const infoTools = toolsByCategory.get('info');
    if (infoTools) for (const decl of infoTools) selectedNames.add(decl.name);

    // Match keywords to categories
    const matchedCategories = new Set();
    for (const [category, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
        if (pattern.test(input)) {
            matchedCategories.add(category);
        }
    }

    // If no specific categories matched, include common action categories
    if (matchedCategories.size === 0) {
        matchedCategories.add('channel');
        matchedCategories.add('role');
        matchedCategories.add('message');
        matchedCategories.add('moderation');
    }

    // Add tools from matched categories using pre-indexed map
    for (const cat of matchedCategories) {
        const tools = toolsByCategory.get(cat);
        if (tools) for (const decl of tools) selectedNames.add(decl.name);
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

const ACTION_PATTERN = /\b(?:create|make|add|build|delete|remove|destroy|kick|ban|timeout|mute|purge|send|lock|unlock|set|assign|move|clone|rename|edit|change|update|pin|unpin|setup|configure|save|dm|clear)\b/i;
const QUERY_PATTERN = /\b(?:what|who|when|where|how|why|list|show|tell|info|status|get|read|check|describe|count|many)\b/i;

function detectToolChoice(userInput) {
    const hasAction = ACTION_PATTERN.test(userInput);
    const hasQuery = QUERY_PATTERN.test(userInput);

    // If clear action intent and no query words, force tool use
    if (hasAction && !hasQuery) return 'required';

    // Otherwise auto
    return 'auto';
}

// ── Groq Provider (PRIMARY — native function calling) ──

function convertToolsForGroq(declarations) {
    return declarations.map(decl => {
        const props = {};
        if (decl.parameters?.properties) {
            for (const [key, val] of Object.entries(decl.parameters.properties)) {
                const prop = { type: val.type || 'string' };
                if (val.description) prop.description = val.description;
                if (val.enum) prop.enum = val.enum;
                props[key] = prop;
            }
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

// Track which Groq model is currently active (cycles on 429)
let activeGroqModelIdx = 0;
let groqResetTimer = null;

// Track which Gemini model is currently active (cycles on 429)
let activeGeminiModelIdx = 0;

function getGroqModel() {
    const models = config.groq.models || [config.groq.model || 'llama-3.3-70b-versatile'];
    return models[activeGroqModelIdx % models.length];
}

async function groqRequest(messages, tools, toolChoice) {
    const models = config.groq.models || [config.groq.model || 'llama-3.3-70b-versatile'];

    // Try each model until one works
    for (let i = 0; i < models.length; i++) {
        const modelIdx = (activeGroqModelIdx + i) % models.length;
        const model = models[modelIdx];
        const opts = { model, messages };
        if (tools && tools.length > 0) {
            opts.tools = tools;
            opts.tool_choice = toolChoice || 'auto';
        }

        try {
            const result = await withTimeout(groq.chat.completions.create(opts));
            if (modelIdx !== activeGroqModelIdx) {
                activeGroqModelIdx = modelIdx;
                groqLog.info(`Switched to ${model}`);
            }
            return result;
        } catch (err) {
            if (err.status === 429) {
                groqLog.warn(`${model} rate limited, trying next model...`);
                // Set a timer to reset back to preferred model after 60s
                if (groqResetTimer) clearTimeout(groqResetTimer);
                groqResetTimer = setTimeout(() => {
                    activeGroqModelIdx = 0;
                    groqResetTimer = null;
                    groqLog.info('Reset to preferred model');
                }, 60000);
                continue;
            }
            if (err.status === 400 || err.status === 413) {
                groqLog.warn(`${model} ${err.status} (${err.message?.slice(0, 80)}), trying next model...`);
                continue;
            }
            if (err.status === 503) {
                groqLog.warn(`${model} 503 — retrying in 2s...`);
                await new Promise(r => setTimeout(r, 2000));
                try { return await withTimeout(groq.chat.completions.create(opts)); } catch (_) {}
                continue;
            }
            throw err;
        }
    }

    // All models exhausted
    throw Object.assign(new Error('All Groq models rate limited'), { status: 429 });
}

async function generateWithGroq(systemPrompt, contents, message, userTier, userInput) {
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const entry of contents) {
        const text = entry.parts?.[0]?.text || '';
        messages.push({ role: entry.role === 'model' ? 'assistant' : 'user', content: text });
    }

    // Dynamic tool selection + tool_choice
    const selectedTools = selectToolsForMessage(userInput, userTier);
    const groqTools = convertToolsForGroq(selectedTools);
    const toolChoice = detectToolChoice(userInput);

    groqLog.info(`${selectedTools.length}/${toolDeclarations.length} tools, choice=${toolChoice}`);

    const toolLog = [];
    let rounds = 0;
    let leakedRounds = 0;
    while (rounds <= config.maxToolRounds) {
        // After first round, always use 'auto' (the model is responding to tool results)
        const currentChoice = rounds === 0 ? toolChoice : 'auto';
        const completion = await groqRequest(messages, groqTools, currentChoice);
        const choice = completion.choices[0];
        const assistantMsg = choice.message;

        const content = assistantMsg.content || '';
        const toolCalls = assistantMsg.tool_calls;
        const hasRealToolCalls = toolCalls && toolCalls.length > 0;

        // If no real tool calls but text contains leaked function syntax, try to parse & execute
        if (!hasRealToolCalls && content) {
            const leakedCalls = parseLeakedToolCalls(content);
            if (leakedCalls.length > 0) {
                leakedRounds++;
                groqLog.warn(`Parsing ${leakedCalls.length} leaked tool call(s) (round ${leakedRounds})`);

                // After 2 consecutive leaked rounds, fall back to Gemini
                if (leakedRounds >= 2) {
                    groqLog.warn('Too many leaked rounds, falling back to Gemini');
                    // Still execute the leaked calls before falling back
                    for (const lc of leakedCalls) {
                        try {
                            const toolResult = await executeTool(lc.name, lc.args, message);
                            toolLog.push({ tool: lc.name, args: lc.args, result: toolResult });
                        } catch (err) {
                            toolLog.push({ tool: lc.name, args: lc.args, result: { error: err.message } });
                        }
                    }
                    return { text: null, toolLog, fallbackToGemini: true };
                }

                const results = [];
                for (const lc of leakedCalls) {
                    groqLog.info(`Tool (leaked): ${lc.name}(${JSON.stringify(lc.args)})`);
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
                messages.push(assistantMsg);
                messages.push({ role: 'user', content: `[SYSTEM] The tools were executed. Results:\n${resultSummary}\n\nGive a short in-character response (1-2 sentences, no function calls).` });
                rounds++;
                continue;
            }
        }

        // Reset leaked counter on successful real tool calls
        if (hasRealToolCalls) leakedRounds = 0;

        messages.push(assistantMsg);

        if (!hasRealToolCalls) {
            return { text: content.trim() || null, toolLog };
        }

        for (const tc of toolCalls) {
            const name = tc.function.name;
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
            groqLog.info(`Tool: ${name}(${JSON.stringify(args)})`);

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

    const final = await groqRequest(messages, null, null);
    return { text: final.choices[0]?.message?.content?.trim() || null, toolLog };
}

// ── Groq Vision (llama-4-scout, no tools) ──

async function generateWithGroqVision(systemPrompt, contents, images) {
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const entry of contents.slice(0, -1)) {
        const text = entry.parts?.[0]?.text || '';
        messages.push({ role: entry.role === 'model' ? 'assistant' : 'user', content: text });
    }

    // Last message with images in OpenAI vision format
    const lastEntry = contents[contents.length - 1];
    const userText = lastEntry.parts?.[0]?.text || '';
    const userContent = [
        { type: 'text', text: userText },
        ...images.map(url => ({ type: 'image_url', image_url: { url } }))
    ];
    messages.push({ role: 'user', content: userContent });

    const visionModel = 'meta-llama/llama-4-scout-17b-16e-instruct';
    try {
        const completion = await withTimeout(groq.chat.completions.create({
            model: visionModel,
            messages
        }));
        const text = completion.choices[0]?.message?.content?.trim() || null;
        log.info(`Vision response via Groq (${visionModel})`);
        return { text, toolLog: [] };
    } catch (err) {
        groqLog.error('Vision failed:', err.message);
        throw err;
    }
}

// Parse function calls that leaked into text content
function parseLeakedToolCalls(text) {
    const calls = [];
    const toolNames = new Set(toolDeclarations.map(t => t.name));

    // Pattern: toolName:N<|tool_call_argument_begin|>{"arg":"val"} (kimi-k2 leaked format)
    const pattern0 = /(\w+):\d+<\|tool_call_argument_begin\|>/gi;
    for (const match of text.matchAll(pattern0)) {
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
            if (toolNames.has(match[1])) {
                const jsonStr = extractJSON(text, match.index + match[0].length);
                if (jsonStr) {
                    try { calls.push({ name: match[1], args: JSON.parse(jsonStr) }); } catch (_) {}
                }
            }
        }
    }

    // Pattern: toolName({"arg":"val"})
    if (calls.length === 0) {
        const pattern2 = /\b(\w+)\(/g;
        for (const match of text.matchAll(pattern2)) {
            if (toolNames.has(match[1])) {
                const jsonStr = extractJSON(text, match.index + match[0].length);
                if (jsonStr) {
                    try { calls.push({ name: match[1], args: JSON.parse(jsonStr) }); } catch (_) {}
                }
            }
        }
    }

    return calls;
}

// ── Gemini Provider (FALLBACK — native function calling) ──

async function generateWithGemini(systemPrompt, contents, message, images = [], userTier = 3, userInput = '') {
    const models = config.gemini.models || [config.gemini.model || 'gemini-2.0-flash'];

    // Dynamic tool selection for Gemini too
    const selectedTools = selectToolsForMessage(userInput, userTier);
    const toolChoice = detectToolChoice(userInput);

    // If images present, add inlineData parts to the last user message
    if (images.length > 0) {
        const lastMsg = contents[contents.length - 1];
        const imageParts = [];
        const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
        for (const url of images) {
            try {
                const res = await fetch(url);
                const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
                if (contentLength > MAX_IMAGE_BYTES) {
                    geminiLog.warn(`Skipping image (${Math.round(contentLength / 1024 / 1024)}MB exceeds 10MB limit): ${url}`);
                    continue;
                }
                const chunks = [];
                let totalBytes = 0;
                for await (const chunk of res.body) {
                    totalBytes += chunk.length;
                    if (totalBytes > MAX_IMAGE_BYTES) {
                        geminiLog.warn(`Skipping image (stream exceeded 10MB limit): ${url}`);
                        break;
                    }
                    chunks.push(chunk);
                }
                if (totalBytes > MAX_IMAGE_BYTES) continue;
                const buffer = Buffer.concat(chunks);
                const mimeType = res.headers.get('content-type') || 'image/jpeg';
                imageParts.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
            } catch (err) {
                geminiLog.error('Failed to fetch image:', err.message);
            }
        }
        if (imageParts.length > 0) {
            lastMsg.parts = [...lastMsg.parts, ...imageParts];
        }
    }

    // Try each model until one works
    for (let i = 0; i < models.length; i++) {
        const modelIdx = (activeGeminiModelIdx + i) % models.length;
        const modelName = models[modelIdx];
        try {
            const modelConfig = {
                model: modelName,
                systemInstruction: systemPrompt,
                tools: [{ functionDeclarations: selectedTools }]
            };

            // Set tool config for Gemini based on detected choice
            if (toolChoice === 'required') {
                modelConfig.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
            }

            const model = genAI.getGenerativeModel(modelConfig);

            const chat = model.startChat({ contents: contents.slice(0, -1) });
            let result = await withTimeout(chat.sendMessage(contents[contents.length - 1].parts));

            const toolLog = [];
            let rounds = 0;
            while (rounds < config.maxToolRounds) {
                const functionCalls = result.response.functionCalls();
                if (!functionCalls || functionCalls.length === 0) break;

                const functionResponses = [];
                for (const fc of functionCalls) {
                    geminiLog.info(`Tool: ${fc.name}(${JSON.stringify(fc.args)})`);
                    let toolResult;
                    try {
                        toolResult = await executeTool(fc.name, fc.args, message);
                    } catch (err) {
                        toolResult = { error: err.message };
                    }
                    toolLog.push({ tool: fc.name, args: fc.args, result: toolResult });
                    functionResponses.push({
                        functionResponse: { name: fc.name, response: toolResult }
                    });
                }

                result = await withTimeout(chat.sendMessage(functionResponses));
                rounds++;
            }

            if (modelIdx !== activeGeminiModelIdx) {
                activeGeminiModelIdx = modelIdx;
                geminiLog.info(`Switched to ${modelName}`);
            }

            const text = result.response.text()?.trim() || null;
            return { text, toolLog };
        } catch (err) {
            if (err.status === 429 || err.message?.includes('429') || err.message?.includes('Resource has been exhausted')) {
                const delay = Math.min(1000 * Math.pow(2, i), 16000);
                geminiLog.warn(`${modelName} rate limited, waiting ${delay}ms before next model...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }

    throw Object.assign(new Error('All Gemini models rate limited'), { status: 429 });
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
    const hasImages = images.length > 0;

    // Try Groq first (native function calling), fall back to Gemini
    if (groq) {
        try {
            if (hasImages) {
                // Vision: use llama-4-scout directly, no tools
                result = await generateWithGroqVision(systemPrompt, contents, images);
            } else {
                result = await generateWithGroq(systemPrompt, contents, message, userTier, userInput);
            }
            if (result?.text) log.info(`Response via Groq (${hasImages ? 'vision' : getGroqModel()})`);
        } catch (err) {
            log.error('Groq failed:', err.message);
            if (hasImages) log.info('Vision request — falling back to Gemini');
        }
    }

    // Gemini fallback — either Groq failed or leaked too many times
    if (!result?.text || result?.fallbackToGemini) {
        const existingToolLog = result?.toolLog || [];
        try {
            result = await generateWithGemini(systemPrompt, contents, message, images, userTier, userInput);
            if (result?.text) log.info('Response via Gemini');
            // Merge tool logs from leaked Groq calls + Gemini calls
            result.toolLog = [...existingToolLog, ...(result.toolLog || [])];
        } catch (err) {
            log.error('Gemini failed:', err.message);
            // Preserve any tool log from Groq leaked calls
            if (!result) result = { text: null, toolLog: existingToolLog };
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
