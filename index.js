const { Client, GatewayIntentBits, Partials, REST, Routes, Events } = require('discord.js');
const express = require('express');
const config = require('./config');
const { commands } = require('./src/commands');
const { handleReady, handleMessageCreate, handleInteraction } = require('./src/handlers');

// ── Discord Client ──

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions
    ],
    allowedMentions: { parse: ['users'], repliedUser: false },
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ── Events ──

client.once(Events.ClientReady, async () => {
    await handleReady(client);

    // Deploy slash commands globally + per-guild (guild = instant, global = persistent)
    try {
        const rest = new REST().setToken(config.discord.token);
        const body = commands.map(c => c.toJSON());

        // Register globally (takes up to 1h to propagate)
        await rest.put(Routes.applicationCommands(client.user.id), { body });

        // Also register per-guild for instant visibility
        const guildIds = client.guilds.cache.map(g => g.id);
        for (const guildId of guildIds) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body }
            ).catch(err => console.warn(`[Commands] Failed for guild ${guildId}:`, err.message));
        }

        console.log(`Deployed ${commands.length} commands to ${guildIds.length} guilds + global.`);
    } catch (err) {
        console.error('Failed to deploy slash commands:', err.message);
    }
});

// Also register commands when joining a new guild
client.on(Events.GuildCreate, async guild => {
    try {
        const rest = new REST().setToken(config.discord.token);
        const body = commands.map(c => c.toJSON());
        await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body });
        console.log(`[Commands] Registered for new guild: ${guild.name}`);
    } catch (err) {
        console.warn(`[Commands] Failed for new guild ${guild.name}:`, err.message);
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

// ── Health Server ──

const app = express();
app.get('/', (_req, res) => res.send('Ultron is operational.'));
app.get('/health', (_req, res) => res.json({ status: 'online', uptime: process.uptime() }));
app.listen(config.server.port, () => {
    console.log(`Health server on port ${config.server.port}`);
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
