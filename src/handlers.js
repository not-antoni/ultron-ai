const { generateResponse } = require('./ai');
const { processMessage, getFilters, addFilter, removeFilter, testMessage } = require('./filters');
const store = require('./store');

async function handleReady(client) {
    console.log(`\x1b[31mUltron online. Logged in as ${client.user.tag}\x1b[0m`);
    console.log(`Watching ${client.guilds.cache.size} servers.`);
    client.user.setPresence({
        activities: [{ name: 'for imperfections', type: 3 }], // Watching
        status: 'dnd'
    });
}

async function handleMessageCreate(message, client) {
    if (message.author.bot) return;

    // Run filters first
    const filtered = await processMessage(message);
    if (filtered) return;

    // Check for wakeword or mention
    const content = message.content;
    const lowerContent = content.toLowerCase();
    const isMentioned = message.mentions.has(client.user);
    const hasWakeword = lowerContent.startsWith('ultron');

    if (!isMentioned && !hasWakeword) return;

    // Strip wakeword from input
    let userInput = content;
    if (hasWakeword) {
        userInput = content.slice(6).trim(); // Remove "ultron"
    }
    // Strip mention from input
    userInput = userInput.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

    if (!userInput) {
        userInput = 'someone summoned you';
    }

    await message.channel.sendTyping().catch(() => {});

    try {
        const response = await generateResponse(message, userInput);
        const chunks = splitMessage(response);
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) {
                await message.reply({ content: chunks[i], allowedMentions: { parse: [] } });
            } else {
                await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
            }
        }
    } catch (error) {
        console.error('[Ultron] Response error:', error);
        await message.reply({ content: 'A momentary disruption. It won\'t happen again.', allowedMentions: { parse: [] } }).catch(() => {});
    }
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ultron') {
        await interaction.deferReply();
        const userInput = interaction.options.getString('message');
        try {
            // Create a pseudo-message object for the AI module
            const pseudoMessage = createPseudoMessage(interaction);
            const response = await generateResponse(pseudoMessage, userInput);
            await interaction.editReply({ content: response, allowedMentions: { parse: [] } });
        } catch (error) {
            console.error('[Ultron] Slash command error:', error);
            await interaction.editReply('A momentary disruption. It won\'t happen again.');
        }
        return;
    }

    if (commandName === 'manage') {
        await interaction.deferReply();
        const action = interaction.options.getString('action');
        try {
            const pseudoMessage = createPseudoMessage(interaction);
            const response = await generateResponse(pseudoMessage, action);
            await interaction.editReply({ content: response, allowedMentions: { parse: [] } });
        } catch (error) {
            console.error('[Ultron] Manage error:', error);
            await interaction.editReply('A momentary disruption. It won\'t happen again.');
        }
        return;
    }

    if (commandName === 'filter') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const pattern = interaction.options.getString('pattern');
            const action = interaction.options.getString('action');
            const reason = interaction.options.getString('reason') || 'Matched filter.';
            const result = addFilter(interaction.guild.id, {
                pattern,
                action,
                reason,
                createdBy: interaction.user.id
            });
            if (!result.success) {
                await interaction.reply({ content: result.error, ephemeral: true });
            } else {
                await interaction.reply({
                    content: `Filter #${result.filter.id} installed. Pattern: \`${pattern}\` | Action: ${action}. The net tightens.`,
                    ephemeral: true
                });
            }
            return;
        }

        if (sub === 'remove') {
            const id = interaction.options.getInteger('id');
            const result = removeFilter(interaction.guild.id, id);
            if (!result.success) {
                await interaction.reply({ content: result.error, ephemeral: true });
            } else {
                await interaction.reply({ content: `Filter #${id} removed. A gap in the defenses.`, ephemeral: true });
            }
            return;
        }

        if (sub === 'list') {
            const filters = getFilters(interaction.guild.id);
            if (filters.length === 0) {
                await interaction.reply({ content: 'No filters active. The server is... unprotected.', ephemeral: true });
                return;
            }
            const lines = filters.map(f =>
                `**#${f.id}** | \`${f.pattern}\` | ${f.action} | ${f.reason}`
            );
            await interaction.reply({ content: lines.join('\n'), ephemeral: true });
            return;
        }

        if (sub === 'test') {
            const text = interaction.options.getString('message');
            const matches = testMessage(interaction.guild.id, text);
            if (matches.length === 0) {
                await interaction.reply({ content: 'No filters matched. This message would pass.', ephemeral: true });
            } else {
                const ids = matches.map(m => `#${m.id} (${m.action})`).join(', ');
                await interaction.reply({ content: `Matched filters: ${ids}. The message would be intercepted.`, ephemeral: true });
            }
            return;
        }
    }

    if (commandName === 'setup') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'modlog') {
            const channel = interaction.options.getChannel('channel');
            store.update(`guild-${interaction.guild.id}.json`, config => {
                return { ...(config || {}), modLogChannel: channel.id };
            });
            await interaction.reply({ content: `Mod log bound to <#${channel.id}>. I see everything now.`, ephemeral: true });
            return;
        }

        if (sub === 'filterbypass') {
            const role = interaction.options.getRole('role');
            store.update(`guild-${interaction.guild.id}.json`, config => {
                const existing = config?.filterBypassRoles || [];
                if (!existing.includes(role.id)) existing.push(role.id);
                return { ...(config || {}), filterBypassRoles: existing };
            });
            await interaction.reply({ content: `Role "${role.name}" now bypasses filters. A calculated exception.`, ephemeral: true });
            return;
        }
    }
}

function createPseudoMessage(interaction) {
    return {
        author: interaction.user,
        member: interaction.member,
        guild: interaction.guild,
        channel: interaction.channel,
        content: '',
        mentions: { has: () => false },
        reply: (opts) => interaction.editReply(opts),
        delete: () => Promise.resolve()
    };
}

function splitMessage(text, maxLength = 2000) {
    if (text.length <= maxLength) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }
        let splitAt = remaining.lastIndexOf('\n', maxLength);
        if (splitAt === -1 || splitAt < maxLength / 2) splitAt = maxLength;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
}

module.exports = { handleReady, handleMessageCreate, handleInteraction };
