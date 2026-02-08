const { Client, GatewayIntentBits, Partials, REST, Routes, Events } = require('discord.js');
const express = require('express');
const config = require('./config');
const { init: initLogger, createLogger } = require('./src/logger');
initLogger(config.logging);
const log = createLogger('Ultron');
const store = require('./src/store');
const { commands } = require('./src/commands');
const {
    handleReady, handleMessageCreate, handleInteraction,
    handleMemberJoin, handleMemberLeave,
    handleReactionAdd, handleReactionRemove
} = require('./src/handlers');

// ── Discord Client ──

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates
    ],
    allowedMentions: { parse: ['users'], repliedUser: false },
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ── Events ──

client.once(Events.ClientReady, async () => {
    await handleReady(client);

    // Deploy slash commands globally only (shows on bot profile)
    try {
        const rest = new REST().setToken(config.discord.token);
        const body = commands.map(c => c.toJSON());

        // Register globally — shows on bot profile, works everywhere
        await rest.put(Routes.applicationCommands(client.user.id), { body });

        // Clear any old per-guild duplicates
        const guildIds = client.guilds.cache.map(g => g.id);
        for (const guildId of guildIds) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: [] }
            ).catch(() => {});
        }

        log.info(`Deployed ${commands.length} commands globally, cleared guild duplicates.`);
    } catch (err) {
        log.error('Failed to deploy slash commands:', err.message);
    }
});

client.on(Events.MessageCreate, async message => {
    try {
        await handleMessageCreate(message, client);
    } catch (error) {
        log.error('Unhandled message error:', error);
    }
});

client.on(Events.MessageUpdate, async (_old, newMessage) => {
    try {
        if (newMessage.partial) await newMessage.fetch();
        await handleMessageCreate(newMessage, client);
    } catch (error) {
        log.error('Message update error:', error);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    try {
        await handleInteraction(interaction);
    } catch (error) {
        log.error('Unhandled interaction error:', error);
    }
});

client.on(Events.GuildMemberAdd, async member => {
    try {
        await handleMemberJoin(member);
    } catch (error) {
        log.error('Member join error:', error);
    }
});

client.on(Events.GuildMemberRemove, async member => {
    try {
        await handleMemberLeave(member);
    } catch (error) {
        log.error('Member leave error:', error);
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
        await handleReactionAdd(reaction, user);
    } catch (error) {
        log.error('Reaction add error:', error);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
        await handleReactionRemove(reaction, user);
    } catch (error) {
        log.error('Reaction remove error:', error);
    }
});

// ── Health Server ──

const app = express();
app.get('/', (_req, res) => res.send('Ultron is operational.'));
app.get('/health', (_req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        servers: client.guilds.cache.size,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        ping: client.ws.ping
    });
});
app.get('/metrics', (_req, res) => {
    const mem = process.memoryUsage();
    const guilds = client.guilds.cache;
    res.json({
        uptime: process.uptime(),
        guilds: guilds.size,
        users: guilds.reduce((sum, g) => sum + g.memberCount, 0),
        channels: guilds.reduce((sum, g) => sum + g.channels.cache.size, 0),
        roles: guilds.reduce((sum, g) => sum + g.roles.cache.size, 0),
        emojis: guilds.reduce((sum, g) => sum + g.emojis.cache.size, 0),
        memory: {
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
            rssMB: Math.round(mem.rss / 1024 / 1024),
            externalMB: Math.round(mem.external / 1024 / 1024)
        },
        wsPing: client.ws.ping,
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid
    });
});
app.listen(config.server.port, () => {
    log.info(`Health server on port ${config.server.port}`);
});

// ── Conversation Cleanup Scheduler ──

const CONVERSATION_MAX_AGE_DAYS = 30;

function cleanupOldConversations() {
    try {
        const pruned = store.cleanupConversations(CONVERSATION_MAX_AGE_DAYS);
        if (pruned > 0) log.info(`Pruned ${pruned} old conversation(s)`);
    } catch (err) {
        log.error('Conversation cleanup error:', err.message);
    }
}

// Run cleanup daily + 60s after startup
setInterval(cleanupOldConversations, 24 * 60 * 60 * 1000);
setTimeout(cleanupOldConversations, 60000);

// ── Temp Ban Unban Scheduler ──

async function processExpiredTempBans() {
    try {
        const expired = store.getExpiredTempBans();
        for (const ban of expired) {
            try {
                const guild = client.guilds.cache.get(ban.guild_id);
                if (guild) {
                    await guild.members.unban(ban.user_id, 'Temp ban expired — Ultron auto-unban.');
                    log.info(`Auto-unbanned ${ban.username || ban.user_id} in ${guild.name}`);
                }
            } catch (err) {
                log.error(`Auto-unban failed for ${ban.user_id}:`, err.message);
            }
            store.removeTempBan(ban.id);
        }
    } catch (err) {
        log.error('Temp ban scheduler error:', err.message);
    }
}

// Check for expired temp bans every 60s + 30s after startup
setInterval(processExpiredTempBans, 60000);
setTimeout(processExpiredTempBans, 30000);

// ── Graceful Shutdown ──

function shutdown(signal) {
    log.info(`${signal} received. Shutting down gracefully...`);
    client.destroy();
    try { store.close(); } catch (_) {}
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
    log.error('Unhandled rejection:', err);
});

// ── Login ──

if (!config.discord.token) {
    log.error('DISCORD_TOKEN is required.');
    process.exit(1);
}

if (!config.gemini.apiKey) {
    log.error('GEMINI_API_KEY is required.');
    process.exit(1);
}

client.login(config.discord.token);
