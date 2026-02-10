require('dotenv').config();

function parseBool(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseList(value) {
    if (!value) return [];
    return String(value)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

function parseOpt(value) {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
}

module.exports = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.CLIENT_ID
    },
    ai: {
        provider: 'gemma',
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMMA_MODEL || 'gemma-3-27b-it',
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.2'),
        topP: parseFloat(process.env.AI_TOP_P || '0.9'),
        topK: parseInt(process.env.AI_TOP_K || '40', 10),
        maxOutputTokens: parseInt(process.env.AI_MAX_OUTPUT_TOKENS || '512', 10)
    },
    openai: {
        apiKey: parseOpt(process.env.OPENAI_API_KEY),
        model: process.env.OPENAI_MODEL || 'gpt-5-nano',
        reasoningEffort: parseOpt(process.env.OPENAI_REASONING_EFFORT),
        verbosity: parseOpt(process.env.OPENAI_VERBOSITY)
    },
    server: {
        port: parseInt(process.env.PORT || '3001', 10)
    },
    adminUserId: (process.env.ADMIN_USER_ID || '').trim() || null,
    cooldownMs: parseInt(process.env.GLOBAL_COOLDOWN_MS || '5000', 10),
    security: {
        autoKickBots: parseBool(process.env.SECURITY_AUTO_KICK_BOTS, true),
        autoBanBots: parseBool(process.env.SECURITY_AUTO_BAN_BOTS, false),
        trustedBotIds: parseList(process.env.SECURITY_TRUSTED_BOT_IDS),
        snapshotIntervalMs: parseInt(process.env.SECURITY_SNAPSHOT_INTERVAL_MS || '300000', 10),
        snapshotRetention: parseInt(process.env.SECURITY_SNAPSHOT_RETENTION || '3', 10),
        snapshotIncludeMembers: parseBool(process.env.SECURITY_SNAPSHOT_INCLUDE_MEMBERS, true),
        alertCooldownMs: parseInt(process.env.SECURITY_ALERT_COOLDOWN_MS || '300000', 10),
        auditLogWindowMs: parseInt(process.env.SECURITY_AUDIT_LOG_WINDOW_MS || '45000', 10),
        eventWindowMs: parseInt(process.env.SECURITY_EVENT_WINDOW_MS || '60000', 10),
        raidJoinWindowMs: parseInt(process.env.SECURITY_RAID_JOIN_WINDOW_MS || '120000', 10),
        raidJoinThreshold: parseInt(process.env.SECURITY_RAID_JOIN_THRESHOLD || '6', 10),
        channelDeleteThreshold: parseInt(process.env.SECURITY_CHANNEL_DELETE_THRESHOLD || '3', 10),
        channelCreateThreshold: parseInt(process.env.SECURITY_CHANNEL_CREATE_THRESHOLD || '6', 10),
        channelRenameThreshold: parseInt(process.env.SECURITY_CHANNEL_RENAME_THRESHOLD || '5', 10),
        roleDeleteThreshold: parseInt(process.env.SECURITY_ROLE_DELETE_THRESHOLD || '3', 10),
        roleCreateThreshold: parseInt(process.env.SECURITY_ROLE_CREATE_THRESHOLD || '4', 10),
        roleRenameThreshold: parseInt(process.env.SECURITY_ROLE_RENAME_THRESHOLD || '5', 10),
        rolePermChangeThreshold: parseInt(process.env.SECURITY_ROLE_PERM_CHANGE_THRESHOLD || '3', 10),
        emojiDeleteThreshold: parseInt(process.env.SECURITY_EMOJI_DELETE_THRESHOLD || '5', 10),
        emojiCreateThreshold: parseInt(process.env.SECURITY_EMOJI_CREATE_THRESHOLD || '8', 10),
        emojiRenameThreshold: parseInt(process.env.SECURITY_EMOJI_RENAME_THRESHOLD || '5', 10),
        banThreshold: parseInt(process.env.SECURITY_BAN_THRESHOLD || '3', 10),
        restoreRulesChannel: parseBool(process.env.SECURITY_RESTORE_RULES_CHANNEL, true),
        restoreAnnouncementsChannel: parseBool(process.env.SECURITY_RESTORE_ANNOUNCEMENTS_CHANNEL, true),
        rulesChannelName: process.env.SECURITY_RULES_CHANNEL_NAME || 'rules',
        announcementsChannelName: process.env.SECURITY_ANNOUNCEMENTS_CHANNEL_NAME || 'announcements',
        rulesMessage: process.env.SECURITY_RULES_MESSAGE || 'This channel is reserved for server rules. Contact the admins if you need access.',
        announcementsMessage: process.env.SECURITY_ANNOUNCEMENTS_MESSAGE || 'Important announcements will be posted here.',
        setSystemChannelToAnnouncements: parseBool(process.env.SECURITY_SET_SYSTEM_CHANNEL_TO_ANNOUNCEMENTS, true)
    },
    maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY || '15', 10),
    maxToolRounds: parseInt(process.env.MAX_TOOL_ROUNDS || '10', 10),
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || null
    }
};
