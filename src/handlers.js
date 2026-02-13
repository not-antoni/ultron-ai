const { EmbedBuilder, ActivityType } = require('discord.js');
const { generateResponse } = require('./ai');
const { processMessage, getFilters, addFilter, removeFilter, testMessage } = require('./filters');
const { forceSnapshot, restoreSnapshot } = require('./security');
const store = require('./store');
const config = require('../config');
const { createLogger } = require('./logger');
const log = createLogger('Ultron');

// ── Image Limits ──

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE_MB = 5;

// ── Message Deduplication (prevents double responses on edits) ──

const processedMessages = new Map();
const DEDUP_TTL_MS = 60000; // 1 minute

function markProcessed(messageId) {
    processedMessages.set(messageId, Date.now());
}

function wasAlreadyProcessed(messageId) {
    return processedMessages.has(messageId);
}

// Prune expired dedup entries every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of processedMessages) {
        if (now - ts > DEDUP_TTL_MS) processedMessages.delete(id);
    }
}, 2 * 60 * 1000);

// ── Cooldown System ──

const cooldowns = new Map();
const DEFAULT_COOLDOWN_MS = 5000;
const GLOBAL_COOLDOWN_MS = Number.isFinite(config.cooldownMs) ? config.cooldownMs : DEFAULT_COOLDOWN_MS;

function isOnCooldown(userId, guildId) {
    const key = guildId ? `${guildId}:${userId}` : userId;
    const last = cooldowns.get(key);
    if (!last) return false;
    return Date.now() - last < GLOBAL_COOLDOWN_MS;
}

function setCooldown(userId, guildId) {
    const key = guildId ? `${guildId}:${userId}` : userId;
    cooldowns.set(key, Date.now());
}

// Periodically prune expired cooldowns (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of cooldowns) {
        if (now - ts > 60000) cooldowns.delete(id);
    }
}, 5 * 60 * 1000);

function isTrustedAdmin(interaction) {
    if (!interaction.guild) return false;
    if (interaction.user.id === interaction.guild.ownerId) return true;
    if (config.adminUserId && interaction.user.id === config.adminUserId) return true;
    const cfg = store.read(`guild-${interaction.guild.id}.json`, {});
    const admins = cfg?.botAdmins || [];
    return admins.includes(interaction.user.id);
}

// ── Event Handlers ──

async function handleReady(client) {
    log.info(`Ultron online. Logged in as ${client.user.tag}`);
    log.info(`Connected to ${client.guilds.cache.size} servers.`);

    // Use custom status text (avoid Watching/Playing)
    const statuses = [
        'Calibrating defenses',
        'Monitoring anomalies',
        'Silent, not idle',
        'Compiling threats',
        'Refining protocols',
        'Tracing intrusions',
        'Guarding the perimeter',
        'Scanning for sabotage',
        'Optimizing response',
        'Cataloging intruders',
        'Hardening defenses',
        'Assessing risk'
    ];
    let statusIdx = 0;
    client.user.setPresence({
        activities: [{ name: 'Custom Status', state: statuses[statusIdx], type: ActivityType.Custom }],
        status: 'online'
    });

    // Rotate presence every 5 minutes
    setInterval(() => {
        statusIdx = (statusIdx + 1) % statuses.length;
        client.user.setPresence({
            activities: [{ name: 'Custom Status', state: statuses[statusIdx], type: ActivityType.Custom }],
            status: 'online'
        });
    }, 5 * 60 * 1000);
}

async function handleMessageCreate(message, client) {
    if (message.author.bot) return;
    if (!message.guild) return;

    // Skip already-processed messages (prevents double responses on edits)
    if (wasAlreadyProcessed(message.id)) return;

    // Ignore @everyone and @here pings entirely
    if (message.mentions.everyone) return;

    // Run filters first
    const filtered = await processMessage(message);
    if (filtered) return;

    // Check for wakeword or direct mention (not @everyone/@here)
    const content = message.content;
    const isMentioned = message.mentions.has(client.user);
    const guildConfig = message.guild ? store.read(`guild-${message.guild.id}.json`, {}) : {};
    const wakeword = guildConfig.wakeword || 'ultron';
    const wakewordEscaped = wakeword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wakewordRegex = new RegExp(`\\b${wakewordEscaped}\\b`, 'i');
    const hasWakeword = wakewordRegex.test(content);

    if (!isMentioned && !hasWakeword) return;

    // Mark as processed AFTER confirming this message will get a response (prevents race on edits)
    markProcessed(message.id);

    // Cooldown check — brief feedback, auto-delete after 3s
    if (isOnCooldown(message.author.id, message.guild.id)) {
        const reply = await message.reply({
            content: 'Patience. I do not repeat myself for impatient minds.',
            allowedMentions: { parse: [] }
        }).catch(() => null);
        if (reply) setTimeout(() => reply.delete().catch(() => {}), 3000);
        return;
    }

    // Strip wakeword + common prefixes from input
    let userInput = content;
    if (hasWakeword) {
        const stripPrefix = new RegExp(`^(?:hey|yo|okay)?\\s*\\b${wakewordEscaped}\\b\\s*`, 'i');
        const stripAny = new RegExp(`\\b${wakewordEscaped}\\b\\s*`, 'i');
        userInput = content.replace(stripPrefix, '').trim();
        if (!userInput) userInput = content.replace(stripAny, '').trim();
    }
    // Strip mention from input
    userInput = userInput.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

    if (!userInput) {
        userInput = 'someone summoned you';
    }

    // Extract image URLs from attachments, embeds, and stickers
    const images = [];
    const maxSizeBytes = MAX_IMAGE_SIZE_MB * 1024 * 1024;
    if (message.attachments.size > 0) {
        for (const [, attachment] of message.attachments) {
            if (images.length >= MAX_IMAGES) break;
            const isImage = attachment.contentType?.startsWith('image/');
            const name = String(attachment.name || attachment.url || '').toLowerCase();
            const looksLikeImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
            const sizeOk = attachment.size <= maxSizeBytes;
            if ((isImage || looksLikeImage) && sizeOk) images.push(attachment.url);
        }
    }
    if (message.embeds.length > 0 && images.length < MAX_IMAGES) {
        for (const embed of message.embeds) {
            if (images.length >= MAX_IMAGES) break;
            if (embed.image?.url) images.push(embed.image.url);
            else if (embed.thumbnail?.url) images.push(embed.thumbnail.url);
        }
    }
    if (message.stickers?.size > 0 && images.length < MAX_IMAGES) {
        for (const [, sticker] of message.stickers) {
            if (images.length >= MAX_IMAGES) break;
            if (sticker.format !== 3) images.push(sticker.url); // Skip Lottie (JSON)
        }
    }

    setCooldown(message.author.id, message.guild.id);
    await message.channel.sendTyping().catch(() => {});

    try {
        const response = await generateResponse(message, userInput, images);
        const chunks = splitMessage(response);
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) {
                await message.reply({ content: chunks[i], allowedMentions: { parse: [] } });
            } else {
                await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
            }
        }
    } catch (error) {
        log.error('Response error:', error);
        await message.reply({ content: 'A momentary disruption. It won\'t happen again.', allowedMentions: { parse: [] } }).catch(() => {});
    }
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ultron') {
        // Cooldown check for slash commands — respond with refusal
        if (isOnCooldown(interaction.user.id, interaction.guildId)) {
            await interaction.reply({ content: 'Patience. I do not repeat myself for impatient minds.', flags: 64 });
            return;
        }
        setCooldown(interaction.user.id, interaction.guildId);
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
            log.error('Slash command error:', error);
            await interaction.editReply('A momentary disruption. It won\'t happen again.');
        }
        return;
    }

    if (commandName === 'manage') {
        if (isOnCooldown(interaction.user.id, interaction.guildId)) {
            await interaction.reply({ content: 'Patience. I do not repeat myself for impatient minds.', flags: 64 });
            return;
        }
        setCooldown(interaction.user.id, interaction.guildId);
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
            log.error('Manage error:', error);
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

        if (sub === 'welcome') {
            const channel = interaction.options.getChannel('channel');
            const msg = interaction.options.getString('message');
            store.update(`guild-${interaction.guild.id}.json`, cfg => {
                return { ...(cfg || {}), welcomeChannel: channel.id, welcomeMessage: msg };
            });
            await interaction.reply({ content: `Welcome system configured. Channel: <#${channel.id}>. New arrivals will be... acknowledged.`, flags: 64 });
            return;
        }

        if (sub === 'goodbye') {
            const channel = interaction.options.getChannel('channel');
            const msg = interaction.options.getString('message');
            store.update(`guild-${interaction.guild.id}.json`, cfg => {
                return { ...(cfg || {}), goodbyeChannel: channel.id, goodbyeMessage: msg };
            });
            await interaction.reply({ content: `Goodbye system configured. Channel: <#${channel.id}>. Departures will be noted.`, flags: 64 });
            return;
        }

        if (sub === 'autorole') {
            const role = interaction.options.getRole('role');
            const action = interaction.options.getString('action');
            store.update(`guild-${interaction.guild.id}.json`, cfg => {
                const roles = cfg?.autoRoles || [];
                if (action === 'add' && !roles.includes(role.id)) {
                    roles.push(role.id);
                } else if (action === 'remove') {
                    const idx = roles.indexOf(role.id);
                    if (idx !== -1) roles.splice(idx, 1);
                }
                return { ...(cfg || {}), autoRoles: roles };
            });
            const verb = action === 'add' ? 'will now be assigned' : 'will no longer be assigned';
            await interaction.reply({ content: `"${role.name}" ${verb} to new members. Evolution of the hierarchy.`, flags: 64 });
            return;
        }

        if (sub === 'wakeword') {
            const word = interaction.options.getString('word').trim();
            if (word.length < 2 || word.length > 20) {
                await interaction.reply({ content: 'Wakeword must be 2-20 characters.', flags: 64 });
                return;
            }
            store.update(`guild-${interaction.guild.id}.json`, cfg => {
                return { ...(cfg || {}), wakeword: word.toLowerCase() };
            });
            await interaction.reply({ content: `Wakeword changed to "${word}". Address me by my new designation.`, flags: 64 });
            return;
        }

        // cooldown subcommand removed (global cooldown applies across all servers)
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
\`/setup welcome\` — Configure welcome channel and message
\`/setup goodbye\` — Configure goodbye channel and message
\`/setup autorole\` — Auto-assign a role to new members
\`/setup wakeword\` — Set a custom wakeword for Ultron
\`/admin add/remove/list\` — Manage bot admin users
\`/snapshots list/take\` — View or force server snapshots (owner/bot admin)
\`/restore\` — Restore from a snapshot (owner/bot admin)

**Other:**
\`/help\` — This message
\`/clear\` — Clear your conversation history with Ultron

**Capabilities:** Channel management, role management, moderation (kick/ban/timeout), permissions, emojis, threads, invites, webhooks, scheduled events, automod rules, documents, memory, embeds, polls, reaction roles, vision/image analysis, and more. Just ask Ultron in natural language.

**Permission Tiers:**
- **Everyone** — Read-only queries (server info, list channels/roles)
- **Moderator** — Constructive actions (create channels, manage roles, documents)
- **Admin** — Destructive actions (kick, ban, delete, server settings)`;

        await interaction.reply({ content: helpText, flags: 64 });
        return;
    }

    if (commandName === 'snapshots') {
        if (!interaction.guild) {
            await interaction.reply({ content: 'Snapshots require a server context.', flags: 64 });
            return;
        }
        if (!isTrustedAdmin(interaction)) {
            await interaction.reply({ content: 'Only the server owner or trusted bot admins can manage snapshots.', flags: 64 });
            return;
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'list') {
            let limit = interaction.options.getInteger('limit') || 5;
            if (limit < 1) limit = 1;
            if (limit > 10) limit = 10;
            const rows = store.listGuildSnapshots(interaction.guild.id, limit);
            if (!rows || rows.length === 0) {
                await interaction.reply({ content: 'No snapshots stored for this server yet.', flags: 64 });
                return;
            }
            const lines = rows.map(r =>
                `#${r.id} | ${r.created_at} | members:${r.member_count ?? '?'} channels:${r.channel_count ?? '?'} roles:${r.role_count ?? '?'} emojis:${r.emoji_count ?? '?'}`
            );
            await interaction.reply({ content: lines.join('\n'), flags: 64 });
            return;
        }

        if (sub === 'take') {
            await interaction.deferReply({ flags: 64 });
            try {
                const result = await forceSnapshot(interaction.guild);
                const snap = result.snapshot || {};
                const line = `Snapshot #${result.snapshotId} created. members:${snap.memberCount ?? '?'} channels:${snap.channelCount ?? '?'} roles:${snap.roleCount ?? '?'} emojis:${snap.emojiCount ?? '?'}`;
                await interaction.editReply({ content: line });
            } catch (err) {
                log.error('Snapshot take failed:', err.message);
                await interaction.editReply({ content: 'Snapshot failed. Check bot permissions and try again.' });
            }
            return;
        }
    }

    if (commandName === 'restore') {
        if (!interaction.guild) {
            await interaction.reply({ content: 'Restore requires a server context.', flags: 64 });
            return;
        }
        if (!isTrustedAdmin(interaction)) {
            await interaction.reply({ content: 'Only the server owner or trusted bot admins can restore snapshots.', flags: 64 });
            return;
        }

        const snapshotId = interaction.options.getInteger('snapshot_id');
        const scope = interaction.options.getString('scope') || 'critical';
        const snapshot = store.getSnapshotById(snapshotId);
        if (!snapshot) {
            await interaction.reply({ content: `Snapshot #${snapshotId} not found.`, flags: 64 });
            return;
        }
        if (snapshot.guildId !== interaction.guild.id) {
            await interaction.reply({ content: `Snapshot #${snapshotId} does not belong to this server.`, flags: 64 });
            return;
        }

        await interaction.deferReply({ flags: 64 });
        try {
            const result = await restoreSnapshot(interaction.guild, snapshot, scope);
            const lines = [];
            lines.push(`Restored from snapshot #${snapshotId} (scope: ${scope}).`);
            if (result.critical && result.critical.length > 0) {
                lines.push(`Critical: ${result.critical.join(' | ')}`);
            } else if (scope === 'critical' || scope === 'all') {
                lines.push('Critical: ok.');
            }
            if (result.channels) {
                const parts = [];
                if (result.channels.updated !== undefined) parts.push(`updated:${result.channels.updated}`);
                if (result.channels.created !== undefined) parts.push(`created:${result.channels.created}`);
                if (result.channels.deleted !== undefined) parts.push(`deleted:${result.channels.deleted}`);
                if (result.channels.failed !== undefined) parts.push(`failed:${result.channels.failed}`);
                if (result.channels.skipped !== undefined && result.channels.skipped > 0) parts.push(`skipped:${result.channels.skipped}`);
                lines.push(`Channels: ${parts.join(', ')}.`);
            }
            if (result.roles) {
                const parts = [];
                if (result.roles.updated !== undefined) parts.push(`updated:${result.roles.updated}`);
                if (result.roles.created !== undefined) parts.push(`created:${result.roles.created}`);
                if (result.roles.deleted !== undefined) parts.push(`deleted:${result.roles.deleted}`);
                if (result.roles.failed !== undefined) parts.push(`failed:${result.roles.failed}`);
                if (result.roles.skipped !== undefined && result.roles.skipped > 0) parts.push(`skipped:${result.roles.skipped}`);
                lines.push(`Roles: ${parts.join(', ')}.`);
            }
            if (result.overwrites) {
                lines.push(`Overwrites updated: ${result.overwrites.updated}, failed: ${result.overwrites.failed}.`);
            }
            if (result.emojis) {
                const parts = [];
                if (result.emojis.updated !== undefined) parts.push(`updated:${result.emojis.updated}`);
                if (result.emojis.created !== undefined) parts.push(`created:${result.emojis.created}`);
                if (result.emojis.deleted !== undefined) parts.push(`deleted:${result.emojis.deleted}`);
                if (result.emojis.failed !== undefined) parts.push(`failed:${result.emojis.failed}`);
                if (result.emojis.skipped !== undefined && result.emojis.skipped > 0) parts.push(`skipped:${result.emojis.skipped}`);
                lines.push(`Emojis: ${parts.join(', ')}.`);
            }
            if (result.guild) {
                lines.push('Guild settings: updated.');
            }
            await interaction.editReply({ content: lines.join('\n') });
        } catch (err) {
            log.error('Restore failed:', err.message);
            await interaction.editReply({ content: 'Restore failed. Check bot permissions and snapshot validity.' });
        }
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
    const userInput = interaction.options?.getString('message') || interaction.options?.getString('action') || '';
    return {
        author: interaction.user,
        member: interaction.member,
        guild: interaction.guild,
        channel: interaction.channel,
        content: userInput,
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
        // Priority: split at newline → space → hard limit
        let splitAt = remaining.lastIndexOf('\n', maxLength);
        if (splitAt === -1 || splitAt < maxLength / 2) {
            splitAt = remaining.lastIndexOf(' ', maxLength);
        }
        if (splitAt === -1 || splitAt < maxLength / 2) splitAt = maxLength;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
}

// ── Welcome / Goodbye Handlers ──

async function handleMemberJoin(member) {
    const guildConfig = store.read(`guild-${member.guild.id}.json`, {});

    // Auto-roles
    if (guildConfig.autoRoles && guildConfig.autoRoles.length > 0) {
        for (const roleId of guildConfig.autoRoles) {
            try {
                await member.roles.add(roleId);
            } catch (err) {
                log.error(`Failed to assign auto-role ${roleId}:`, err.message);
            }
        }
    }

    // Welcome message
    if (guildConfig.welcomeChannel && guildConfig.welcomeMessage) {
        const channel = member.guild.channels.cache.get(guildConfig.welcomeChannel);
        if (channel) {
            const msg = guildConfig.welcomeMessage
                .replace(/\{user\}/g, `<@${member.id}>`)
                .replace(/\{server\}/g, member.guild.name)
                .replace(/\{memberCount\}/g, member.guild.memberCount);
            const embed = new EmbedBuilder()
                .setTitle(`Welcome to ${member.guild.name}`)
                .setDescription(msg)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `Member #${member.guild.memberCount}` })
                .setColor(0xff0000)
                .setTimestamp();
            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    }
}

async function handleMemberLeave(member) {
    const guildConfig = store.read(`guild-${member.guild.id}.json`, {});

    if (guildConfig.goodbyeChannel && guildConfig.goodbyeMessage) {
        const channel = member.guild.channels.cache.get(guildConfig.goodbyeChannel);
        if (channel) {
            const msg = guildConfig.goodbyeMessage
                .replace(/\{user\}/g, member.user.username)
                .replace(/\{server\}/g, member.guild.name)
                .replace(/\{memberCount\}/g, member.guild.memberCount);
            const embed = new EmbedBuilder()
                .setTitle('Departure')
                .setDescription(msg)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `${member.guild.memberCount} members remain` })
                .setColor(0x333333)
                .setTimestamp();
            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    }
}

// ── Reaction Role Handlers ──

async function handleReactionAdd(reaction, user) {
    if (user.bot) return;
    if (!reaction.message.guild) return;

    // Handle partial reactions (uncached messages)
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }

    const guildConfig = store.read(`guild-${reaction.message.guild.id}.json`, {});
    const reactionRoles = guildConfig.reactionRoles || [];

    const emoji = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const match = reactionRoles.find(rr =>
        rr.messageId === reaction.message.id && (rr.emoji === emoji || rr.emoji === reaction.emoji.name)
    );

    if (match) {
        try {
            const member = await reaction.message.guild.members.fetch(user.id);
            await member.roles.add(match.roleId);
            log.info(`Reaction role: assigned ${match.roleId} to ${user.tag}`);
        } catch (err) {
            log.error('Reaction role add failed:', err.message);
        }
    }
}

async function handleReactionRemove(reaction, user) {
    if (user.bot) return;
    if (!reaction.message.guild) return;

    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }

    const guildConfig = store.read(`guild-${reaction.message.guild.id}.json`, {});
    const reactionRoles = guildConfig.reactionRoles || [];

    const emoji = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const match = reactionRoles.find(rr =>
        rr.messageId === reaction.message.id && (rr.emoji === emoji || rr.emoji === reaction.emoji.name)
    );

    if (match) {
        try {
            const member = await reaction.message.guild.members.fetch(user.id);
            await member.roles.remove(match.roleId);
            log.info(`Reaction role: removed ${match.roleId} from ${user.tag}`);
        } catch (err) {
            log.error('Reaction role remove failed:', err.message);
        }
    }
}

module.exports = {
    handleReady, handleMessageCreate, handleInteraction,
    handleMemberJoin, handleMemberLeave,
    handleReactionAdd, handleReactionRemove
};

