require('dotenv').config();

module.exports = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.CLIENT_ID
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: 'gemini-2.0-flash',
        models: [
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite'
        ]
    },
    groq: {
        apiKey: process.env.GROQ_API_KEY || '',
        models: [
            'llama-3.3-70b-versatile',      // Primary — reliable tool calling
            'moonshotai/kimi-k2-instruct',  // Fallback — better quality but leaks tool syntax
            'meta-llama/llama-4-scout-17b-16e-instruct' // Third — vision capable
        ]
    },
    server: {
        port: parseInt(process.env.PORT || '3001', 10)
    },
    adminUserId: (process.env.ADMIN_USER_ID || '').trim() || null,
    maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY || '15', 10),
    maxToolRounds: parseInt(process.env.MAX_TOOL_ROUNDS || '10', 10),
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || null
    }
};
