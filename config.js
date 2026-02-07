require('dotenv').config();

module.exports = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.CLIENT_ID
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: 'gemini-2.5-flash'
    },
    server: {
        port: parseInt(process.env.PORT || '3001', 10)
    },
    adminUserId: (process.env.ADMIN_USER_ID || '').trim() || null,
    maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY || '5', 10)
};
