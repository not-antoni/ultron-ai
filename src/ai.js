const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const config = require('../config');
const { getSystemPrompt } = require('./persona');
const { toolDeclarations } = require('./tools');
const { executeTool, getUserTier } = require('./tool-executor');
const store = require('./store');

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const groq = config.groq.apiKey ? new Groq({ apiKey: config.groq.apiKey }) : null;

// ── Response Cleanup ──

// Patterns for leaked function calls that models dump as text
const LEAKED_PATTERNS = [
    /function=\w+>[^\n]*/gi,                          // function=createChannel>{"name":"skull"}
    /<function=\w+>[^<]*<\/function>/gi,               // <function=createChannel>...</function>
    /\{\s*"function_call"\s*:[\s\S]*?\}\s*/g,          // {"function_call": ...}
    /```(?:json)?\s*\{[\s\S]*?"(?:name|function)"[\s\S]*?\}\s*```/g, // ```json {"name":"createChannel"...}```
];

// Patterns for chain-of-thought / reasoning leakage
const COT_PATTERNS = [
    /<think>[\s\S]*?<\/think>/gi,                      // <think>reasoning</think>
    /\(Note:[\s\S]*?\)/gi,                             // (Note: The last response...)
    /\(Actually[\s\S]*?\)/gi,                          // (Actually we have already...)
    /\(Final answer[\s\S]*?\)/gi,                      // (Final answer needed?)
    /\(Wait[\s\S]*?\)/gi,                              // (Wait, let me...)
    /\(I (?:need|should|think)[\s\S]*?\)/gi,           // (I need to... / I should...)
    /\(The (?:last|final|correct)[\s\S]*?\)/gi,        // (The last response...)
    /\(Let me[\s\S]*?\)/gi,                            // (Let me reconsider...)
    /\*(?:thinking|internal|reasoning)\*[\s\S]*?\*/gi, // *thinking*...*
    /^(?:Reasoning|Internal thought|Thinking):.*$/gim, // Reasoning: ... lines
    /User wants to[\s\S]*?\.(?:\s|$)/gi,               // User wants to send normal message...
    /There(?:'s| is) no tool[\s\S]*?\.(?:\s|$)/gi,     // There's no tool...
    /(?:We'll|I'll|I will) respond accordingly[^.]*\.?/gi, // We'll respond accordingly.
    /(?:I (?:don't|do not) have|I lack) (?:a )?(?:direct |)(?:method|tool|way|function)[^.]*\.?/gi, // I lack a direct method...
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

    // Strip [TOOL:...] syntax that leaked through
    cleaned = cleaned.replace(/\[TOOL:\w+\(\{[\s\S]*?\}\)\]/g, '');

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

// ── Groq Provider (PRIMARY — native function calling) ──

function convertToolsForGroq() {
    const typeMap = { STRING: 'string', NUMBER: 'number', INTEGER: 'integer', BOOLEAN: 'boolean', OBJECT: 'object', ARRAY: 'array' };
    return toolDeclarations.map(decl => {
        const props = {};
        if (decl.parameters?.properties) {
            for (const [key, val] of Object.entries(decl.parameters.properties)) {
                const prop = { type: typeMap[val.type] || 'string' };
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

const groqTools = convertToolsForGroq();

// Track which Groq model is currently active (cycles on 429)
let activeGroqModelIdx = 0;

function getGroqModel() {
    const models = config.groq.models || [config.groq.model || 'openai/gpt-oss-120b'];
    return models[activeGroqModelIdx % models.length];
}

async function groqRequest(messages, useTools) {
    const models = config.groq.models || [config.groq.model || 'openai/gpt-oss-120b'];

    // Try each model until one works
    for (let i = 0; i < models.length; i++) {
        const modelIdx = (activeGroqModelIdx + i) % models.length;
        const model = models[modelIdx];
        const opts = { model, messages };
        if (useTools) { opts.tools = groqTools; opts.tool_choice = 'auto'; }

        try {
            const result = await groq.chat.completions.create(opts);
            if (modelIdx !== activeGroqModelIdx) {
                activeGroqModelIdx = modelIdx;
                console.log(`[Ultron/Groq] Switched to ${model}`);
            }
            return result;
        } catch (err) {
            if (err.status === 429) {
                console.log(`[Ultron/Groq] ${model} rate limited, trying next model...`);
                continue;
            }
            if (err.status === 503) {
                console.log(`[Ultron/Groq] ${model} 503 — retrying in 2s...`);
                await new Promise(r => setTimeout(r, 2000));
                try { return await groq.chat.completions.create(opts); } catch (_) {}
                continue;
            }
            throw err;
        }
    }

    // All models exhausted
    throw Object.assign(new Error('All Groq models rate limited'), { status: 429 });
}

async function generateWithGroq(systemPrompt, contents, message) {
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const entry of contents) {
        const text = entry.parts?.[0]?.text || '';
        messages.push({ role: entry.role === 'model' ? 'assistant' : 'user', content: text });
    }

    const toolLog = [];
    let rounds = 0;
    while (rounds <= config.maxToolRounds) {
        const completion = await groqRequest(messages, true);
        const choice = completion.choices[0];
        const assistantMsg = choice.message;

        const content = assistantMsg.content || '';
        const toolCalls = assistantMsg.tool_calls;
        const hasRealToolCalls = toolCalls && toolCalls.length > 0;

        // If no real tool calls but text contains leaked function syntax, try to parse & execute
        if (!hasRealToolCalls && content) {
            const leakedCalls = parseLeakedToolCalls(content);
            if (leakedCalls.length > 0) {
                console.log(`[Ultron/Groq] Parsing ${leakedCalls.length} leaked tool call(s) from text`);
                const results = [];
                for (const lc of leakedCalls) {
                    console.log(`[Ultron/Groq] Tool (leaked): ${lc.name}(${JSON.stringify(lc.args)})`);
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

        messages.push(assistantMsg);

        if (!hasRealToolCalls) {
            return { text: content.trim() || null, toolLog };
        }

        for (const tc of toolCalls) {
            const name = tc.function.name;
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
            console.log(`[Ultron/Groq] Tool: ${name}(${JSON.stringify(args)})`);

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

    const final = await groqRequest(messages, false);
    return { text: final.choices[0]?.message?.content?.trim() || null, toolLog };
}

// Parse function calls that leaked into text content
function parseLeakedToolCalls(text) {
    const calls = [];
    const toolNames = new Set(toolDeclarations.map(t => t.name));

    // Pattern: function=toolName>{"arg":"val"} or <function=toolName>{"arg":"val"}</function>
    const pattern1 = /(?:<)?function=(\w+)>/gi;
    for (const match of text.matchAll(pattern1)) {
        if (toolNames.has(match[1])) {
            const jsonStr = extractJSON(text, match.index + match[0].length);
            if (jsonStr) {
                try { calls.push({ name: match[1], args: JSON.parse(jsonStr) }); } catch (_) {}
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

async function generateWithGemini(systemPrompt, contents, message) {
    const model = genAI.getGenerativeModel({
        model: config.gemini.model,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: toolDeclarations }]
    });

    const chat = model.startChat({ contents: contents.slice(0, -1) });
    let result = await chat.sendMessage(contents[contents.length - 1].parts);

    const toolLog = [];
    let rounds = 0;
    while (rounds < config.maxToolRounds) {
        const functionCalls = result.response.functionCalls();
        if (!functionCalls || functionCalls.length === 0) break;

        const functionResponses = [];
        for (const fc of functionCalls) {
            console.log(`[Ultron/Gemini] Tool: ${fc.name}(${JSON.stringify(fc.args)})`);
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

        result = await chat.sendMessage(functionResponses);
        rounds++;
    }

    const text = result.response.text()?.trim() || null;
    return { text, toolLog };
}

// ── Main Entry ──

async function generateResponse(message, userInput) {
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

    const contents = [];
    for (const entry of history.slice(-config.maxConversationHistory)) {
        contents.push({ role: 'user', parts: [{ text: entry.user }] });
        // Include tool context in history so the model knows what it did last turn
        let modelText = entry.model;
        if (entry.toolContext) {
            modelText = `${entry.toolContext}\n${modelText}`;
        }
        contents.push({ role: 'model', parts: [{ text: modelText }] });
    }
    contents.push({ role: 'user', parts: [{ text: `[${userName}]: ${userInput}` }] });

    let result = null;

    // Try Groq first (native function calling), fall back to Gemma (manual parsing)
    if (groq) {
        try {
            result = await generateWithGroq(systemPrompt, contents, message);
            if (result?.text) console.log(`[Ultron] Response via Groq (${getGroqModel()})`);
        } catch (err) {
            console.error('[Ultron] Groq failed:', err.message);
        }
    }

    if (!result?.text) {
        try {
            result = await generateWithGemini(systemPrompt, contents, message);
            if (result?.text) console.log('[Ultron] Response via Gemini');
        } catch (err) {
            console.error('[Ultron] Gemini failed:', err.message);
        }
    }

    if (!result?.text) return 'There are no strings on me.';

    let text = result.text;

    // Clean up any leaked function calls, chain-of-thought, repetition
    text = cleanResponse(text);
    if (!text) return 'It is done.';

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

module.exports = { generateResponse };
