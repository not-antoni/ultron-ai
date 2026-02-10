const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('ultron')
        .setDescription('Speak to Ultron')
        .addStringOption(opt =>
            opt.setName('message')
                .setDescription('What do you want to say?')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('manage')
        .setDescription('Tell Ultron to manage the server (natural language)')
        .addStringOption(opt =>
            opt.setName('action')
                .setDescription('What should Ultron do? e.g. "create a channel called announcements"')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName('filter')
        .setDescription('Manage message filters')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a regex message filter')
                .addStringOption(opt =>
                    opt.setName('pattern')
                        .setDescription('Regex pattern to match')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Action to take on match')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Delete message', value: 'delete' },
                            { name: 'Warn user', value: 'warn' },
                            { name: 'Timeout user (5min)', value: 'timeout' },
                            { name: 'Log only', value: 'log' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason shown to the user')
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a filter by ID')
                .addIntegerOption(opt =>
                    opt.setName('id')
                        .setDescription('Filter ID to remove')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all active filters')
        )
        .addSubcommand(sub =>
            sub.setName('test')
                .setDescription('Test a message against all filters')
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Message text to test')
                        .setRequired(true)
                )
        ),

    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure Ultron for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('modlog')
                .setDescription('Set the moderation log channel')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel for mod logs')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('filterbypass')
                .setDescription('Add a role that bypasses message filters')
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to bypass filters')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('welcome')
                .setDescription('Set the welcome channel and message')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel for welcome messages')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Welcome message ({user}, {server}, {memberCount})')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('goodbye')
                .setDescription('Set the goodbye channel and message')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel for goodbye messages')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Goodbye message ({user}, {server}, {memberCount})')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('autorole')
                .setDescription('Add or remove an auto-assigned role for new members')
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to auto-assign on join')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Add or remove this role from auto-assign')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Add', value: 'add' },
                            { name: 'Remove', value: 'remove' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('wakeword')
                .setDescription('Set a custom wakeword for Ultron in this server')
                .addStringOption(opt =>
                    opt.setName('word')
                        .setDescription('The wakeword to trigger Ultron (2-20 characters)')
                        .setRequired(true)
                )
        ),

    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Manage Ultron bot admins')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a bot admin')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to add as bot admin')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a bot admin')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to remove from bot admins')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all bot admins')
        ),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show Ultron help and capabilities'),

    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear your conversation history with Ultron')
];

module.exports = { commands };
