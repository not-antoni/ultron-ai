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

    // Deploy slash commands
    try {
        const rest = new REST().setToken(config.discord.token);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log(`Deployed ${commands.length} slash commands.`);
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
