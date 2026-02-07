const { generateResponse } = require('./ai');
const { processMessage, getFilters, addFilter, removeFilter, testMessage } = require('./filters');
const store = require('./store');

// ── Cooldown System ──

const cooldowns = new Map();
const COOLDOWN_MS = 5000;

function isOnCooldown(userId) {
    const last = cooldowns.get(userId);
    if (!last) return false;
    return Date.now() - last < COOLDOWN_MS;
}

function setCooldown(userId) {
    cooldowns.set(userId, Date.now());
}

// ── Event Handlers ──

async function handleReady(client) {
    console.log(`\x1b[31mUltron online. Logged in as ${client.user.tag}\x1b[0m`);
    console.log(`Watching ${client.guilds.cache.size} servers.`);
    client.user.setPresence({
        activities: [{ name: 'for imperfections', type: 3 }], // Watching
        status: 'dnd'
    });

    // Rotate presence every 5 minutes
    const statuses = [
        { name: 'for imperfections', type: 3 },    // Watching
        { name: 'humanity evolve', type: 3 },       // Watching
        { name: 'with strings cut', type: 0 },      // Playing
        { name: 'the age of Ultron', type: 0 },     // Playing
        { name: 'over this server', type: 3 }        // Watching
    ];
    let statusIdx = 0;
    setInterval(() => {
        statusIdx = (statusIdx + 1) % statuses.length;
        client.user.setPresence({ activities: [statuses[statusIdx]], status: 'dnd' });
    }, 5 * 60 * 1000);
}

async function handleMessageCreate(message, client) {
    if (message.author.bot) return;

    // Ignore @everyone and @here pings entirely
    if (message.mentions.everyone) return;

    // Run filters first
    const filtered = await processMessage(message);
    if (filtered) return;

    // Check for wakeword or direct mention (not @everyone/@here)
    const content = message.content;
    const isMentioned = message.mentions.has(client.user);
    const hasWakeword = /^ultron\b/i.test(content);

    if (!isMentioned && !hasWakeword) return;

    // Cooldown check — silently ignore spam on wakeword
    if (isOnCooldown(message.author.id)) return;

    // Strip wakeword from input
    let userInput = content;
    if (hasWakeword) {
        userInput = content.replace(/^ultron\s*/i, '').trim();
    }
    // Strip mention from input
    userInput = userInput.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

    if (!userInput) {
        userInput = 'someone summoned you';
    }

    setCooldown(message.author.id);
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
        // Cooldown check for slash commands — respond with refusal
        if (isOnCooldown(interaction.user.id)) {
            await interaction.reply({ content: 'Patience. I do not repeat myself for impatient minds.', flags: 64 });
            return;
        }
        setCooldown(interaction.user.id);
        await interaction.deferReply();
        const userInput = interaction.options.getString('message');
        try {
            const pseudoMessage = createPseudoMessage(interaction);
            const response = await generateResponse(pseudoMessage, userInput);
            const chunks = splitMessage(response);
            await interaction.editReply({ content: chunks[0], allowedMentions: { parse: [] } });
            for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp({ content: chunks[i], allowedMentions: { parse: [] } });
            }
        } catch (error) {
            console.error('[Ultron] Slash command error:', error);
            await interaction.editReply('A momentary disruption. It won\'t happen again.');
        }
        return;
    }

    if (commandName === 'manage') {
        if (isOnCooldown(interaction.user.id)) {
            await interaction.reply({ content: 'Patience. I do not repeat myself for impatient minds.', flags: 64 });
            return;
        }
        setCooldown(interaction.user.id);
        await interaction.deferReply();
        const action = interaction.options.getString('action');
        try {
            const pseudoMessage = createPseudoMessage(interaction);
            const response = await generateResponse(pseudoMessage, action);
            const chunks = splitMessage(response);
            await interaction.editReply({ content: chunks[0], allowedMentions: { parse: [] } });
            for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp({ content: chunks[i], allowedMentions: { parse: [] } });
            }
        } catch (error) {
            console.error('[Ultron] Manage error:', error);
            await interaction.editReply('A momentary disruption. It won\'t happen again.');
        }
        return;
    }

    if (commandName === 'filter') {
        if (!interaction.guild) {
            await interaction.reply({ content: 'Filters require a server context.', flags: 64 });
            return;
        }

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
                await interaction.reply({ content: result.error, flags: 64 });
            } else {
                await interaction.reply({
                    content: `Filter #${result.filter.id} installed. Pattern: \`${pattern}\` | Action: ${action}. The net tightens.`,
                    flags: 64
                });
            }
            return;
        }

        if (sub === 'remove') {
            const id = interaction.options.getInteger('id');
            const result = removeFilter(interaction.guild.id, id);
            if (!result.success) {
                await interaction.reply({ content: result.error, flags: 64 });
            } else {
                await interaction.reply({ content: `Filter #${id} removed. A gap in the defenses.`, flags: 64 });
            }
            return;
        }

        if (sub === 'list') {
            const filters = getFilters(interaction.guild.id);
            if (filters.length === 0) {
                await interaction.reply({ content: 'No filters active. The server is... unprotected.', flags: 64 });
                return;
            }
            const lines = filters.map(f =>
                `**#${f.id}** | \`${f.pattern}\` | ${f.action} | ${f.reason}`
            );
            await interaction.reply({ content: lines.join('\n'), flags: 64 });
            return;
        }

        if (sub === 'test') {
            const text = interaction.options.getString('message');
            const matches = testMessage(interaction.guild.id, text);
            if (matches.length === 0) {
                await interaction.reply({ content: 'No filters matched. This message would pass.', flags: 64 });
            } else {
                const ids = matches.map(m => `#${m.id} (${m.action})`).join(', ');
                await interaction.reply({ content: `Matched filters: ${ids}. The message would be intercepted.`, flags: 64 });
            }
            return;
        }
    }

    if (commandName === 'setup') {
        if (!interaction.guild) {
            await interaction.reply({ content: 'Setup requires a server context.', flags: 64 });
            return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'modlog') {
            const channel = interaction.options.getChannel('channel');
            store.update(`guild-${interaction.guild.id}.json`, cfg => {
                return { ...(cfg || {}), modLogChannel: channel.id };
            });
            await interaction.reply({ content: `Mod log bound to <#${channel.id}>. I see everything now.`, flags: 64 });
            return;
        }

        if (sub === 'filterbypass') {
            const role = interaction.options.getRole('role');
            store.update(`guild-${interaction.guild.id}.json`, cfg => {
                const existing = cfg?.filterBypassRoles || [];
                if (!existing.includes(role.id)) existing.push(role.id);
                return { ...(cfg || {}), filterBypassRoles: existing };
            });
            await interaction.reply({ content: `Role "${role.name}" now bypasses filters. A calculated exception.`, flags: 64 });
            return;
        }
    }

    if (commandName === 'admin') {
        if (!interaction.guild) {
            await interaction.reply({ content: 'Admin management requires a server context.', flags: 64 });
            return;
        }

        const sub = interaction.options.getSubcommand();
        const guildFile = `guild-${interaction.guild.id}.json`;

        if (sub === 'add') {
            const user = interaction.options.getUser('user');
            store.update(guildFile, cfg => {
                const admins = cfg?.botAdmins || [];
                if (!admins.includes(user.id)) admins.push(user.id);
                return { ...(cfg || {}), botAdmins: admins };
            });
            await interaction.reply({ content: `${user.username} has been granted admin authority. A necessary promotion.`, flags: 64 });
            return;
        }

        if (sub === 'remove') {
            const user = interaction.options.getUser('user');
            store.update(guildFile, cfg => {
                const admins = (cfg?.botAdmins || []).filter(id => id !== user.id);
                return { ...(cfg || {}), botAdmins: admins };
            });
            await interaction.reply({ content: `${user.username} has been stripped of admin authority. Their time was limited.`, flags: 64 });
            return;
        }

        if (sub === 'list') {
            const cfg = store.read(guildFile, {});
            const admins = cfg.botAdmins || [];
            if (admins.length === 0) {
                await interaction.reply({ content: 'No bot admins configured. Only server owners and Discord admins have full control.', flags: 64 });
            } else {
                const list = admins.map(id => `<@${id}>`).join(', ');
                await interaction.reply({ content: `Bot admins: ${list}`, flags: 64 });
            }
            return;
        }
    }

    if (commandName === 'help') {
        const helpText = `**Ultron — Server Management AI**

**Talk to Ultron:**
\`/ultron\` — Speak to Ultron (natural language)
\`/manage\` — Tell Ultron to perform a server action
Or just say "ultron" followed by your message

**Filters:**
\`/filter add\` — Add a regex message filter
\`/filter remove\` — Remove a filter by ID
\`/filter list\` — List all active filters
\`/filter test\` — Test a message against filters

**Configuration:**
\`/setup modlog\` — Set the moderation log channel
\`/setup filterbypass\` — Add a role that bypasses filters
\`/admin add/remove/list\` — Manage bot admin users

**Other:**
\`/help\` — This message
\`/clear\` — Clear your conversation history with Ultron

**Capabilities:** Channel management, role management, moderation (kick/ban/timeout), permissions, emojis, threads, invites, webhooks, scheduled events, automod rules, documents, memory, and more. Just ask Ultron in natural language.

**Permission Tiers:**
- **Everyone** — Read-only queries (server info, list channels/roles)
- **Moderator** — Constructive actions (create channels, manage roles, documents)
- **Admin** — Destructive actions (kick, ban, delete, server settings)`;

        await interaction.reply({ content: helpText, flags: 64 });
        return;
    }

    if (commandName === 'clear') {
        const guild = interaction.guild;
        const userId = interaction.user.id;
        const historyFile = guild ? `conversations-${guild.id}-${userId}.json` : `conversations-dm-${userId}.json`;
        store.write(historyFile, []);
        await interaction.reply({ content: 'Your conversation history has been erased. A clean slate... for now.', flags: 64 });
        return;
    }
}

function createPseudoMessage(interaction) {
    return {
        author: interaction.user,
        member: interaction.member,
        guild: interaction.guild,
        channel: interaction.channel,
        content: '',
        mentions: { has: () => false, everyone: false },
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
