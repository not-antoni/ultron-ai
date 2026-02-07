const { Client, GatewayIntentBits, Partials, REST, Routes, Events } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
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

        console.log(`Deployed ${commands.length} commands globally, cleared guild duplicates.`);
    } catch (err) {
        console.error('Failed to deploy slash commands:', err.message);
    }
});

client.on(Events.MessageCreate, async message => {
    try {
        await handleMessageCreate(message, client);
    } catch (error) {
        console.error('[Ultron] Unhandled message error:', error);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    try {
        await handleInteraction(interaction);
    } catch (error) {
        console.error('[Ultron] Unhandled interaction error:', error);
    }
});

client.on(Events.GuildMemberAdd, async member => {
    try {
        await handleMemberJoin(member);
    } catch (error) {
        console.error('[Ultron] Member join error:', error);
    }
});

client.on(Events.GuildMemberRemove, async member => {
    try {
        await handleMemberLeave(member);
    } catch (error) {
        console.error('[Ultron] Member leave error:', error);
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
        await handleReactionAdd(reaction, user);
    } catch (error) {
        console.error('[Ultron] Reaction add error:', error);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
        await handleReactionRemove(reaction, user);
    } catch (error) {
        console.error('[Ultron] Reaction remove error:', error);
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
app.listen(config.server.port, () => {
    console.log(`Health server on port ${config.server.port}`);
});

// ── Conversation Cleanup Scheduler ──

function cleanupOldConversations() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) return;
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    let pruned = 0;
    try {
        const files = fs.readdirSync(dataDir).filter(f => f.startsWith('conversations-') && f.endsWith('.json'));
        for (const file of files) {
            const filePath = path.join(dataDir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > THIRTY_DAYS) {
                fs.unlinkSync(filePath);
                pruned++;
            }
        }
        if (pruned > 0) console.log(`[Ultron] Pruned ${pruned} old conversation file(s)`);
    } catch (err) {
        console.error('[Ultron] Conversation cleanup error:', err.message);
    }
}

// Run cleanup daily + 60s after startup
setInterval(cleanupOldConversations, 24 * 60 * 60 * 1000);
setTimeout(cleanupOldConversations, 60000);

// ── Graceful Shutdown ──

function shutdown(signal) {
    console.log(`\n[Ultron] ${signal} received. Shutting down gracefully...`);
    client.destroy();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
    console.error('[Ultron] Unhandled rejection:', err);
});

// ── Login ──

if (!config.discord.token) {
    console.error('DISCORD_TOKEN is required.');
    process.exit(1);
}

if (!config.gemini.apiKey) {
    console.error('GEMINI_API_KEY is required.');
    process.exit(1);
}

client.login(config.discord.token);
