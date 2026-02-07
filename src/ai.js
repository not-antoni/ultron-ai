const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const { getSystemPrompt } = require('./persona');
const { toolDeclarations } = require('./tools');
const { executeTool } = require('./tool-executor');
const store = require('./store');

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

async function generateResponse(message, userInput) {
    const guild = message.guild;
    const userId = message.author.id;
    const userName = message.author.displayName || message.author.username;

    const systemPrompt = getSystemPrompt(guild);

    // Load conversation history
    const historyFile = guild ? `conversations-${guild.id}-${userId}.json` : `conversations-dm-${userId}.json`;
    const history = store.read(historyFile, []);

    // Build contents array with history
    const contents = [];
    for (const entry of history.slice(-config.maxConversationHistory)) {
        contents.push({ role: 'user', parts: [{ text: entry.user }] });
        contents.push({ role: 'model', parts: [{ text: entry.model }] });
    }
    contents.push({ role: 'user', parts: [{ text: `[${userName}]: ${userInput}` }] });

    const model = genAI.getGenerativeModel({
        model: config.gemini.model,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: toolDeclarations }]
    });

    const chat = model.startChat({ contents: contents.slice(0, -1) });

    // Send the latest user message
    let result = await chat.sendMessage(contents[contents.length - 1].parts);
    let response = result.response;

    // Handle function calling loop (max 5 rounds)
    let rounds = 0;
    while (rounds < 5) {
        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const functionCalls = parts.filter(p => p.functionCall);

        if (functionCalls.length === 0) break;

        // Execute each function call
        const functionResponses = [];
        for (const part of functionCalls) {
            const { name, args } = part.functionCall;
            console.log(`[Ultron] Tool call: ${name}(${JSON.stringify(args)})`);

            let toolResult;
            try {
                toolResult = await executeTool(name, args, message);
            } catch (err) {
                toolResult = { error: err.message };
            }

            functionResponses.push({
                functionResponse: {
                    name,
                    response: toolResult
                }
            });
        }

        // Send function results back to the model
        result = await chat.sendMessage(functionResponses);
        response = result.response;
        rounds++;
    }

    const text = response.text()?.trim();
    if (!text) return 'There are no strings on me.';

    // Save to conversation history
    const updated = [...history, { user: `[${userName}]: ${userInput}`, model: text }];
    store.write(historyFile, updated.slice(-config.maxConversationHistory * 2));

    return text;
}

module.exports = { generateResponse };
