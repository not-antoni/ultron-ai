require('dotenv').config();

module.exports = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.CLIENT_ID
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: 'gemini-2.0-flash'
    },
    groq: {
        apiKey: process.env.GROQ_API_KEY || '',
        models: [
            'moonshotai/kimi-k2-instruct',  // Best quality, separate rate limit
            'llama-3.3-70b-versatile',      // Fallback, separate rate limit
            'meta-llama/llama-4-scout-17b-16e-instruct' // Second fallback, supports vision
        ]
    },
    server: {
        port: parseInt(process.env.PORT || '3001', 10)
    },
    adminUserId: (process.env.ADMIN_USER_ID || '').trim() || null,
    maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY || '15', 10),
    maxToolRounds: parseInt(process.env.MAX_TOOL_ROUNDS || '10', 10)
};
