const { REST, Routes } = require('discord.js');
const config = require('../config');
const { commands } = require('./commands');

const rest = new REST().setToken(config.discord.token);

(async () => {
    try {
        console.log(`Deploying ${commands.length} slash commands...`);
        await rest.put(
            Routes.applicationCommands(config.discord.clientId),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log('Slash commands deployed.');
    } catch (error) {
        console.error('Failed to deploy commands:', error);
    }
})();
