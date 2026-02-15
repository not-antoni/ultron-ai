const { ChannelType, PermissionsBitField, GuildVerificationLevel, AutoModerationRuleTriggerType, AutoModerationActionType, AutoModerationRuleEventType, GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType, EmbedBuilder, GuildDefaultMessageNotifications, PollLayoutType, AuditLogEvent } = require('discord.js');
const config = require('../config');
const store = require('./store');
const { createLogger } = require('./logger');
const log = createLogger('Ultron');

// ── Limits ──

const MAX_DOCUMENT_CHARS = 50000;
const MAX_DOCUMENTS_PER_GUILD = 50;
const MAX_MEMORY_ENTRIES = 100;
const MAX_MEMORY_VALUE_CHARS = 4000;
const MAX_READ_MESSAGES = 25;
const MAX_TEMP_BAN_MS = 30 * 86400000;
const TOOL_TIMEOUT_MS = Math.max(1000, Number(config.aiToolTimeoutMs) || 12000);

async function withToolTimeout(promise, toolName) {
    let timeoutHandle = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${TOOL_TIMEOUT_MS}ms.`)), TOOL_TIMEOUT_MS);
            })
        ]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

// ── Resolvers ──

function resolveChannel(guild, nameOrId) {
    if (!nameOrId) return null;
    const cleaned = nameOrId.replace(/^#/, '').toLowerCase();
    return guild.channels.cache.find(c => c.id === nameOrId || c.name.toLowerCase() === cleaned)
        || guild.channels.cache.find(c => c.name.toLowerCase().startsWith(cleaned))
        || guild.channels.cache.find(c => {
            const name = c.name.toLowerCase();
            return name.includes(cleaned) && cleaned.length >= name.length * 0.5;
        })
        || null;
}

function resolveRole(guild, nameOrId) {
    if (!nameOrId) return null;
    const cleaned = nameOrId.toLowerCase();
    return guild.roles.cache.find(r => r.id === nameOrId || r.name.toLowerCase() === cleaned)
        || guild.roles.cache.find(r => r.name.toLowerCase().startsWith(cleaned))
        || guild.roles.cache.find(r => {
            const name = r.name.toLowerCase();
            return name.includes(cleaned) && cleaned.length >= name.length * 0.5;
        })
        || null;
}

async function resolveMember(guild, nameOrId) {
    if (!nameOrId) return null;
    const input = nameOrId.trim();
    const mentionMatch = input.match(/^<@!?(\d+)>$/);
    const rawId = mentionMatch ? mentionMatch[1] : input;
    if (/^\d{17,20}$/.test(rawId)) {
        const member = await guild.members.fetch(rawId).catch(() => null);
        if (member) return member;
    }
    const cleaned = input.toLowerCase().replace(/^@/, '');
    // API query (searches username prefix only)
    const apiResults = await guild.members.fetch({ query: cleaned, limit: 10 }).catch(() => new Map());
    // Also search cache for displayName/globalName matches
    const cacheResults = guild.members.cache.filter(m => {
        const dn = m.displayName.toLowerCase();
        const gn = m.user.globalName?.toLowerCase() || '';
        return dn.includes(cleaned) || gn.includes(cleaned);
    });
    // Merge into array (deduplicate by id)
    const seen = new Set();
    const members = [];
    for (const m of apiResults.values()) { if (!seen.has(m.id)) { seen.add(m.id); members.push(m); } }
    for (const m of cacheResults.values()) { if (!seen.has(m.id)) { seen.add(m.id); members.push(m); } }

    return members.find(m => m.user.username.toLowerCase() === cleaned || m.displayName.toLowerCase() === cleaned || m.user.globalName?.toLowerCase() === cleaned)
        || members.find(m => m.user.username.toLowerCase().startsWith(cleaned) || m.displayName.toLowerCase().startsWith(cleaned))
        || members[0] || null;
}

function parseDuration(str) {
    if (!str) return null;
    const match = str.match(/^(\d+)\s*(s|m|h|d)$/i);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return num * multipliers[unit];
}

// ── Tiered Permission System ──

const TIERS = { everyone: 1, moderator: 2, admin: 3 };

const TOOL_TIERS = {
    // Tier 1 — Everyone (read-only / harmless)
    getServerInfo: 1, getMemberInfo: 1, listChannels: 1, listRoles: 1,
    listInvites: 1, listDocuments: 1, getDocument: 1, getMemory: 1,
    listMemories: 1, listAutomodRules: 1, getAuditLog: 1, listWebhooks: 1,
    listScheduledEvents: 1, listChannelPermissions: 1,
    readMessages: 1, fetchMessage: 1, listEmojis: 1, listReactionRoles: 1,
    listBans: 1, listForumPosts: 1, listStickers: 1, getAuditLogByAction: 1, listThreads: 1,
    getToolAuditTrail: 1,

    // Tier 2 — Moderator (constructive / moderate actions)
    createChannel: 2, renameChannel: 2, setChannelTopic: 2,
    createThread: 2, deleteThread: 2, archiveThread: 2, unarchiveThread: 2, addThreadMember: 2,
    addEmoji: 2, removeEmoji: 2,
    createRole: 2, assignRole: 2, removeRole: 2, editRole: 2,
    timeoutMember: 2, untimeoutMember: 2, setNickname: 2, setSlowmode: 2,
    moveToVoice: 2, voiceMute: 2, voiceDeafen: 2,
    sendMessage: 2, sendEmbed: 2, replyToMessage: 2, editMessage: 2,
    addReaction: 2, createPoll: 2, dmUser: 2,
    moveChannel: 2, cloneChannel: 2, setChannelNSFW: 2, setVoiceUserLimit: 2,
    lockChannel: 2, unlockChannel: 2,
    pinMessage: 2, unpinMessage: 2,
    setChannelPermission: 2, removeChannelPermission: 2,
    createInvite: 2, createWebhook: 2, sendWebhookMessage: 2,
    createScheduledEvent: 2, editScheduledEvent: 2, deleteScheduledEvent: 2,
    createDocument: 2, editDocument: 2, saveMemory: 2, deleteMemory: 2,
    setSystemChannel: 2, setRulesChannel: 2,
    setupReactionRole: 2, removeReactionRole: 2,
    setWelcomeChannel: 2, setGoodbyeChannel: 2, setAutoRole: 2,
    createForumPost: 2, createStageInstance: 2, endStageInstance: 2,
    addSticker: 2, bulkAssignRole: 2, setVoiceBitrate: 2, setVoiceRegion: 2,

    // Tier 3 — Admin (destructive / dangerous)
    kickMember: 3, banMember: 3, unbanMember: 3, disconnectFromVoice: 3,
    deleteChannel: 3, deleteRole: 3, purgeMessages: 3,
    updateServerName: 3, updateServerIcon: 3, setVerificationLevel: 3,
    deleteInvite: 3, createAutomodRule: 3, deleteAutomodRule: 3,
    deleteWebhook: 3, deleteDocument: 3, tempBan: 3, removeSticker: 3,
    setAFKChannel: 3, setDefaultNotifications: 3, setServerBanner: 3
};

function getUserTier(member, guildId) {
    if (!member) return TIERS.everyone;

    // Server owner = admin
    if (member.id === member.guild.ownerId) return TIERS.admin;

    // Discord Administrator permission = admin
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return TIERS.admin;

    // Global bot owner (adminUserId from config)
    if (config.adminUserId && member.id === config.adminUserId) return TIERS.admin;

    // Configured bot admins
    const guildConfig = store.read(`guild-${guildId}.json`, {});
    if (Array.isArray(guildConfig.botAdmins) && guildConfig.botAdmins.includes(member.id)) return TIERS.admin;

    // Auto-detect moderators: has kick, ban, or timeout perms
    if (member.permissions.has(PermissionsBitField.Flags.KickMembers) ||
        member.permissions.has(PermissionsBitField.Flags.BanMembers) ||
        member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return TIERS.moderator;
    }

    // Configured bot mods
    if (Array.isArray(guildConfig.botMods) && guildConfig.botMods.includes(member.id)) return TIERS.moderator;

    return TIERS.everyone;
}

function getTierName(tier) {
    if (tier >= 3) return 'admin';
    if (tier >= 2) return 'moderator';
    return 'everyone';
}

function checkTier(toolName, message) {
    const required = TOOL_TIERS[toolName] || 3;
    const userTier = getUserTier(message.member, message.guild?.id);
    if (userTier >= required) return { allowed: true };
    return { allowed: false, error: `Insufficient authority. "${toolName}" requires ${getTierName(required)} access. You are: ${getTierName(userTier)}.` };
}

// ── Tool Implementations ──

const tools = {
    // ── Channel Management ──

    async createChannel(args, message) {
        const guild = message.guild;
        const typeMap = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory, forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement };
        const channelType = typeMap[args.type] ?? ChannelType.GuildText;
        const options = { name: args.name, type: channelType };
        if (args.topic && channelType === ChannelType.GuildText) options.topic = args.topic;
        if (args.category) {
            const cat = resolveChannel(guild, args.category);
            if (cat && cat.type === ChannelType.GuildCategory) options.parent = cat.id;
        }
        const channel = await guild.channels.create(options);
        return { success: true, channelId: channel.id, name: channel.name };
    },

    async deleteChannel(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const name = channel.name;
        await channel.delete();
        return { success: true, deleted: name };
    },

    async renameChannel(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const oldName = channel.name;
        await channel.setName(args.newName);
        return { success: true, oldName, newName: args.newName };
    },

    async setChannelTopic(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        await channel.setTopic(args.topic);
        return { success: true, channel: channel.name, topic: args.topic };
    },

    async createThread(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const thread = await channel.threads.create({ name: args.name, reason: 'Created by Ultron' });
        if (args.message) await thread.send(args.message);
        return { success: true, threadId: thread.id, name: thread.name };
    },

    async deleteThread(args, message) {
        const guild = message.guild;
        const cleaned = args.thread.toLowerCase();
        const thread = guild.channels.cache.find(c => c.isThread() && (c.id === args.thread || c.name.toLowerCase() === cleaned));
        if (!thread) return { error: `Thread "${args.thread}" not found.` };
        const name = thread.name;
        await thread.delete();
        return { success: true, deleted: name };
    },

    async archiveThread(args, message) {
        const guild = message.guild;
        const cleaned = args.thread.toLowerCase();
        const thread = guild.channels.cache.find(c => c.isThread() && (c.id === args.thread || c.name.toLowerCase() === cleaned));
        if (!thread) return { error: `Thread "${args.thread}" not found.` };
        await thread.setArchived(true);
        return { success: true, thread: thread.name, archived: true };
    },

    async unarchiveThread(args, message) {
        const guild = message.guild;
        const cleaned = args.thread.toLowerCase();
        const thread = guild.channels.cache.find(c => c.isThread() && (c.id === args.thread || c.name.toLowerCase() === cleaned));
        if (!thread) return { error: `Thread "${args.thread}" not found.` };
        await thread.setArchived(false);
        return { success: true, thread: thread.name, archived: false };
    },

    async addThreadMember(args, message) {
        const guild = message.guild;
        const cleaned = args.thread.toLowerCase();
        const thread = guild.channels.cache.find(c => c.isThread() && (c.id === args.thread || c.name.toLowerCase() === cleaned));
        if (!thread) return { error: `Thread "${args.thread}" not found.` };
        const member = await resolveMember(guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        await thread.members.add(member.id);
        return { success: true, thread: thread.name, user: member.displayName };
    },

    async setSlowmode(args, message) {
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const seconds = Math.min(Math.max(parseInt(args.seconds, 10) || 0, 0), 21600);
        await channel.setRateLimitPerUser(seconds);
        return { success: true, channel: channel.name, seconds };
    },

    async lockChannel(args, message) {
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel not found.` };
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        return { success: true, locked: channel.name };
    },

    async unlockChannel(args, message) {
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel not found.` };
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
        return { success: true, unlocked: channel.name };
    },

    // ── Permission Overwrites ──

    async setChannelPermission(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const target = resolveRole(message.guild, args.target) || await resolveMember(message.guild, args.target);
        if (!target) return { error: `Role or user "${args.target}" not found.` };
        const allow = args.allow ? args.allow.split(',').map(p => p.trim()) : [];
        const deny = args.deny ? args.deny.split(',').map(p => p.trim()) : [];
        const overwrite = {};
        for (const perm of allow) { if (PermissionsBitField.Flags[perm]) overwrite[perm] = true; }
        for (const perm of deny) { if (PermissionsBitField.Flags[perm]) overwrite[perm] = false; }
        await channel.permissionOverwrites.edit(target.id || target, overwrite);
        return { success: true, channel: channel.name, target: target.name || target.displayName, allow, deny };
    },

    async removeChannelPermission(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const target = resolveRole(message.guild, args.target) || await resolveMember(message.guild, args.target);
        if (!target) return { error: `Role or user "${args.target}" not found.` };
        await channel.permissionOverwrites.delete(target.id || target);
        return { success: true, channel: channel.name, removed: target.name || target.displayName };
    },

    async listChannelPermissions(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const overwrites = channel.permissionOverwrites.cache.map(o => {
            const target = message.guild.roles.cache.get(o.id) || message.guild.members.cache.get(o.id);
            return { target: target?.name || target?.displayName || o.id, allow: o.allow.toArray(), deny: o.deny.toArray() };
        });
        return { channel: channel.name, permissions: overwrites };
    },

    // ── Emoji Management ──

    async addEmoji(args, message) {
        const emoji = await message.guild.emojis.create({ attachment: args.url, name: args.name });
        return { success: true, emoji: emoji.name, id: emoji.id };
    },

    async removeEmoji(args, message) {
        const emoji = message.guild.emojis.cache.find(e => e.name.toLowerCase() === args.name.toLowerCase());
        if (!emoji) return { error: `Emoji "${args.name}" not found.` };
        await emoji.delete();
        return { success: true, removed: args.name };
    },

    // ── Role Management ──

    async createRole(args, message) {
        const options = { name: args.name };
        if (args.color) options.color = args.color;
        if (args.mentionable !== undefined) options.mentionable = args.mentionable;
        const role = await message.guild.roles.create(options);
        return { success: true, roleId: role.id, name: role.name };
    },

    async deleteRole(args, message) {
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        if (!role.editable) return { error: `Role "${role.name}" is above my position.` };
        const name = role.name;
        await role.delete();
        return { success: true, deleted: name };
    },

    async assignRole(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        if (!role.editable) return { error: `Role "${role.name}" is above my position.` };
        await member.roles.add(role);
        return { success: true, user: member.displayName, role: role.name };
    },

    async removeRole(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        await member.roles.remove(role);
        return { success: true, user: member.displayName, role: role.name };
    },

    async editRole(args, message) {
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        if (!role.editable) return { error: `Role "${role.name}" is above my position.` };
        const updates = {};
        if (args.newName) updates.name = args.newName;
        if (args.color) updates.color = args.color;
        if (args.mentionable !== undefined) updates.mentionable = args.mentionable;
        if (args.hoist !== undefined) updates.hoist = args.hoist;
        await role.edit(updates);
        return { success: true, role: role.name, updated: Object.keys(updates) };
    },

    // ── Member Moderation ──

    async kickMember(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.kickable) return { error: `Cannot kick ${member.displayName}. They are above me.` };
        await member.kick(args.reason || 'Removed by Ultron.');
        return { success: true, kicked: member.displayName };
    },

    async banMember(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.bannable) return { error: `Cannot ban ${member.displayName}. They are above me.` };
        await member.ban({ reason: args.reason || 'Eliminated by Ultron.' });
        return { success: true, banned: member.displayName };
    },

    async timeoutMember(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.moderatable) return { error: `Cannot timeout ${member.displayName}. They are above me.` };
        const ms = parseDuration(args.duration);
        if (!ms) return { error: `Invalid duration "${args.duration}". Use format like 5m, 1h, 1d.` };
        const MAX_TIMEOUT = 2419200000; // 28 days
        if (ms > MAX_TIMEOUT) return { error: `Timeout cannot exceed 28 days. Requested: ${args.duration}.` };
        await member.timeout(ms, args.reason || 'Silenced by Ultron.');
        return { success: true, user: member.displayName, duration: args.duration };
    },

    async untimeoutMember(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.moderatable) return { error: `Cannot modify ${member.displayName}. They are above me.` };
        await member.timeout(null);
        return { success: true, user: member.displayName, timeout: 'removed' };
    },

    async unbanMember(args, message) {
        const bans = await message.guild.bans.fetch();
        const ban = bans.find(b => b.user.id === args.user || b.user.username.toLowerCase() === args.user.toLowerCase());
        if (!ban) return { error: `Banned user "${args.user}" not found.` };
        await message.guild.members.unban(ban.user.id, args.reason || 'Unbanned by Ultron.');
        return { success: true, unbanned: ban.user.username };
    },

    async setNickname(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.manageable) return { error: `Cannot change nickname for ${member.displayName}. They are above me.` };
        const nickname = args.nickname || null;
        await member.setNickname(nickname);
        return { success: true, user: member.user.username, nickname: nickname || '(cleared)' };
    },

    // ── Voice Management ──

    async moveToVoice(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.voice.channel) return { error: `${member.displayName} is not in a voice channel.` };
        const target = resolveChannel(message.guild, args.channel);
        if (!target) return { error: `Channel "${args.channel}" not found.` };
        if (!target.isVoiceBased()) return { error: `"${target.name}" is not a voice channel.` };
        await member.voice.setChannel(target);
        return { success: true, user: member.displayName, channel: target.name };
    },

    async disconnectFromVoice(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.voice.channel) return { error: `${member.displayName} is not in a voice channel.` };
        await member.voice.disconnect();
        return { success: true, user: member.displayName };
    },

    async voiceMute(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.voice.channel) return { error: `${member.displayName} is not in a voice channel.` };
        const mute = args.mute !== false;
        await member.voice.setMute(mute, 'Voice action by Ultron.');
        return { success: true, user: member.displayName, muted: mute };
    },

    async voiceDeafen(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.voice.channel) return { error: `${member.displayName} is not in a voice channel.` };
        const deafen = args.deafen !== false;
        await member.voice.setDeaf(deafen, 'Voice action by Ultron.');
        return { success: true, user: member.displayName, deafened: deafen };
    },

    // ── Message Management ──

    async sendMessage(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (!channel.isTextBased()) return { error: `Channel "${channel.name}" is not a text channel.` };
        await channel.send({ content: args.content, allowedMentions: { parse: ['users', 'roles'] } });
        return { success: true, channel: channel.name, sent: true };
    },

    async purgeMessages(args, message) {
        const count = Math.min(Math.max(parseInt(args.count, 10) || 1, 1), 100);
        const deleted = await message.channel.bulkDelete(count, true);
        return { success: true, deleted: deleted.size };
    },

    async pinMessage(args, message) {
        const msg = await message.channel.messages.fetch(args.messageId).catch(() => null);
        if (!msg) return { error: 'Message not found.' };
        await msg.pin();
        return { success: true, pinned: args.messageId };
    },

    async unpinMessage(args, message) {
        const msg = await message.channel.messages.fetch(args.messageId).catch(() => null);
        if (!msg) return { error: 'Message not found.' };
        await msg.unpin();
        return { success: true, unpinned: args.messageId };
    },

    // ── Guild Settings ──

    async updateServerName(args, message) {
        await message.guild.setName(args.name);
        return { success: true, name: args.name };
    },

    async updateServerIcon(args, message) {
        await message.guild.setIcon(args.url);
        return { success: true, icon: 'updated' };
    },

    async setVerificationLevel(args, message) {
        const levels = { none: GuildVerificationLevel.None, low: GuildVerificationLevel.Low, medium: GuildVerificationLevel.Medium, high: GuildVerificationLevel.High, very_high: GuildVerificationLevel.VeryHigh };
        const level = levels[args.level?.toLowerCase()];
        if (level === undefined) return { error: `Invalid level. Use: none, low, medium, high, very_high.` };
        await message.guild.setVerificationLevel(level);
        return { success: true, level: args.level };
    },

    async setSystemChannel(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        await message.guild.setSystemChannel(channel);
        return { success: true, channel: channel.name };
    },

    async setRulesChannel(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        await message.guild.setRulesChannel(channel);
        return { success: true, channel: channel.name };
    },

    // ── Invite Management ──

    async createInvite(args, message) {
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: 'Channel not found.' };
        const options = {};
        if (args.maxUses) options.maxUses = parseInt(args.maxUses, 10);
        if (args.maxAge) options.maxAge = parseInt(args.maxAge, 10);
        const invite = await channel.createInvite(options);
        return { success: true, url: invite.url, code: invite.code, maxUses: invite.maxUses };
    },

    async deleteInvite(args, message) {
        const invites = await message.guild.invites.fetch();
        const invite = invites.find(i => i.code === args.code);
        if (!invite) return { error: `Invite "${args.code}" not found.` };
        await invite.delete();
        return { success: true, deleted: args.code };
    },

    async listInvites(_args, message) {
        const invites = await message.guild.invites.fetch();
        return { invites: invites.map(i => ({ code: i.code, url: i.url, uses: i.uses, maxUses: i.maxUses, inviter: i.inviter?.username, channel: i.channel?.name })) };
    },

    // ── Audit Log ──

    async getAuditLog(args, message) {
        const options = { limit: Math.min(parseInt(args.limit, 10) || 10, 25) };
        if (args.user) {
            const member = await resolveMember(message.guild, args.user);
            if (member) options.user = member.id;
        }
        const logs = await message.guild.fetchAuditLogs(options);
        return {
            entries: logs.entries.map(e => ({
                action: e.action,
                executor: e.executor?.username,
                target: e.target?.username || e.target?.name || String(e.targetId),
                reason: e.reason,
                createdAt: e.createdAt.toISOString()
            }))
        };
    },

    // ── Auto-Moderation Rules ──

    async createAutomodRule(args, message) {
        const triggerTypes = {
            keyword: AutoModerationRuleTriggerType.Keyword,
            spam: AutoModerationRuleTriggerType.Spam,
            keyword_preset: AutoModerationRuleTriggerType.KeywordPreset,
            mention_spam: AutoModerationRuleTriggerType.MentionSpam
        };
        const triggerType = triggerTypes[args.triggerType?.toLowerCase()];
        if (!triggerType) return { error: 'Invalid trigger type. Use: keyword, spam, keyword_preset, mention_spam.' };

        const ruleOptions = {
            name: args.name,
            eventType: AutoModerationRuleEventType.MessageSend,
            triggerType,
            actions: [{ type: AutoModerationActionType.BlockMessage }]
        };

        if (triggerType === AutoModerationRuleTriggerType.Keyword) {
            const keywords = args.keywords ? args.keywords.split(',').map(k => k.trim()) : [];
            const regexPatterns = args.regexPatterns ? args.regexPatterns.split(',').map(p => p.trim()) : [];
            ruleOptions.triggerMetadata = {};
            if (keywords.length) ruleOptions.triggerMetadata.keywordFilter = keywords;
            if (regexPatterns.length) ruleOptions.triggerMetadata.regexPatterns = regexPatterns;
        }

        if (args.actions === 'timeout') {
            ruleOptions.actions = [{ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 300 } }];
        } else if (args.actions === 'alert') {
            const logChannel = args.alertChannel ? resolveChannel(message.guild, args.alertChannel) : null;
            if (!logChannel) return { error: 'Alert action requires an alertChannel. Specify which channel to send alerts to.' };
            ruleOptions.actions = [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: logChannel.id } }];
        }

        const rule = await message.guild.autoModerationRules.create(ruleOptions);
        return { success: true, ruleId: rule.id, name: rule.name };
    },

    async deleteAutomodRule(args, message) {
        const rules = await message.guild.autoModerationRules.fetch();
        const rule = rules.find(r => r.id === args.ruleId || r.name.toLowerCase() === args.ruleId?.toLowerCase());
        if (!rule) return { error: `Automod rule "${args.ruleId}" not found.` };
        const name = rule.name;
        await rule.delete();
        return { success: true, deleted: name };
    },

    async listAutomodRules(_args, message) {
        const rules = await message.guild.autoModerationRules.fetch();
        return { rules: rules.map(r => ({ id: r.id, name: r.name, enabled: r.enabled, triggerType: r.triggerType })) };
    },

    // ── Webhooks ──

    async createWebhook(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const options = { name: args.name };
        if (args.avatar) options.avatar = args.avatar;
        const webhook = await channel.createWebhook(options);
        return { success: true, id: webhook.id, name: webhook.name, url: webhook.url };
    },

    async deleteWebhook(args, message) {
        const webhooks = await message.guild.fetchWebhooks();
        const webhook = webhooks.find(w => w.id === args.webhookId || w.name.toLowerCase() === args.webhookId?.toLowerCase());
        if (!webhook) return { error: `Webhook "${args.webhookId}" not found.` };
        const name = webhook.name;
        await webhook.delete();
        return { success: true, deleted: name };
    },

    async sendWebhookMessage(args, message) {
        const webhooks = await message.guild.fetchWebhooks();
        const webhook = webhooks.find(w => w.id === args.webhookId || w.name.toLowerCase() === args.webhookId?.toLowerCase());
        if (!webhook) return { error: `Webhook "${args.webhookId}" not found.` };
        await webhook.send({ content: args.content });
        return { success: true, sent: true, webhook: webhook.name };
    },

    async listWebhooks(_args, message) {
        const webhooks = await message.guild.fetchWebhooks();
        return { webhooks: webhooks.map(w => ({ id: w.id, name: w.name, channel: w.channel?.name, creator: w.owner?.username })) };
    },

    // ── Scheduled Events ──

    async createScheduledEvent(args, message) {
        const startTime = new Date(args.startTime);
        if (isNaN(startTime.getTime())) return { error: 'Invalid start time. Use ISO format or natural date.' };
        const options = {
            name: args.name,
            scheduledStartTime: startTime,
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            entityType: GuildScheduledEventEntityType.External,
            entityMetadata: { location: args.location || message.guild.name }
        };
        if (args.description) options.description = args.description;
        if (args.endTime) {
            const endTime = new Date(args.endTime);
            if (!isNaN(endTime.getTime())) options.scheduledEndTime = endTime;
        } else {
            options.scheduledEndTime = new Date(startTime.getTime() + 3600000);
        }
        if (args.channel) {
            const channel = resolveChannel(message.guild, args.channel);
            if (channel) {
                options.channel = channel;
                options.entityType = channel.type === ChannelType.GuildStageVoice
                    ? GuildScheduledEventEntityType.StageInstance
                    : GuildScheduledEventEntityType.Voice;
                delete options.entityMetadata;
                delete options.scheduledEndTime;
            }
        }
        const event = await message.guild.scheduledEvents.create(options);
        return { success: true, eventId: event.id, name: event.name };
    },

    async editScheduledEvent(args, message) {
        const events = await message.guild.scheduledEvents.fetch();
        const event = events.find(e => e.name.toLowerCase() === args.name?.toLowerCase() || e.id === args.name);
        if (!event) return { error: `Event "${args.name}" not found.` };
        const updates = {};
        if (args.newName) updates.name = args.newName;
        if (args.description) updates.description = args.description;
        if (args.startTime) updates.scheduledStartTime = new Date(args.startTime);
        if (args.endTime) updates.scheduledEndTime = new Date(args.endTime);
        await event.edit(updates);
        return { success: true, updated: event.name };
    },

    async deleteScheduledEvent(args, message) {
        const events = await message.guild.scheduledEvents.fetch();
        const event = events.find(e => e.name.toLowerCase() === args.name?.toLowerCase() || e.id === args.name);
        if (!event) return { error: `Event "${args.name}" not found.` };
        const name = event.name;
        await event.delete();
        return { success: true, deleted: name };
    },

    async listScheduledEvents(_args, message) {
        const events = await message.guild.scheduledEvents.fetch();
        return { events: events.map(e => ({ id: e.id, name: e.name, startTime: e.scheduledStartTime?.toISOString(), status: e.status, description: e.description?.slice(0, 100) })) };
    },

    // ── Documents ──

    async createDocument(args, message) {
        if (args.content && args.content.length > MAX_DOCUMENT_CHARS) {
            return { error: `Document too large. Maximum ${MAX_DOCUMENT_CHARS} characters.` };
        }
        const guildId = message.guild.id;
        const docs = store.read(`documents-${guildId}.json`, []);
        if (docs.length >= MAX_DOCUMENTS_PER_GUILD && !docs.find(d => d.name.toLowerCase() === args.name.toLowerCase())) {
            return { error: `Document limit reached (${MAX_DOCUMENTS_PER_GUILD}). Delete some first.` };
        }
        if (docs.find(d => d.name.toLowerCase() === args.name.toLowerCase())) {
            return { error: `Document "${args.name}" already exists. Use editDocument to modify.` };
        }
        docs.push({ name: args.name, content: args.content, createdBy: message.author.id, updatedAt: new Date().toISOString() });
        store.write(`documents-${guildId}.json`, docs);
        return { success: true, name: args.name, length: args.content.length };
    },

    async editDocument(args, message) {
        if (args.content && args.content.length > MAX_DOCUMENT_CHARS) {
            return { error: `Document too large. Maximum ${MAX_DOCUMENT_CHARS} characters.` };
        }
        const guildId = message.guild.id;
        const docs = store.read(`documents-${guildId}.json`, []);
        const doc = docs.find(d => d.name.toLowerCase() === args.name.toLowerCase());
        if (!doc) return { error: `Document "${args.name}" not found.` };
        doc.content = args.content;
        doc.updatedAt = new Date().toISOString();
        store.write(`documents-${guildId}.json`, docs);
        return { success: true, name: doc.name, length: args.content.length };
    },

    async deleteDocument(args, message) {
        const guildId = message.guild.id;
        const docs = store.read(`documents-${guildId}.json`, []);
        const idx = docs.findIndex(d => d.name.toLowerCase() === args.name.toLowerCase());
        if (idx === -1) return { error: `Document "${args.name}" not found.` };
        const name = docs[idx].name;
        docs.splice(idx, 1);
        store.write(`documents-${guildId}.json`, docs);
        return { success: true, deleted: name };
    },

    async getDocument(args, message) {
        const guildId = message.guild.id;
        const docs = store.read(`documents-${guildId}.json`, []);
        const doc = docs.find(d => d.name.toLowerCase() === args.name.toLowerCase());
        if (!doc) return { error: `Document "${args.name}" not found.` };
        return { name: doc.name, content: doc.content, updatedAt: doc.updatedAt };
    },

    async listDocuments(_args, message) {
        const guildId = message.guild.id;
        const docs = store.read(`documents-${guildId}.json`, []);
        return { documents: docs.map(d => ({ name: d.name, updatedAt: d.updatedAt, length: d.content.length })) };
    },

    // ── Memory ──

    async saveMemory(args, message) {
        if (args.value && args.value.length > MAX_MEMORY_VALUE_CHARS) {
            return { error: `Memory value too large. Maximum ${MAX_MEMORY_VALUE_CHARS} characters.` };
        }
        const guildId = message.guild.id;
        const existing = store.read(`memory-${guildId}.json`, {});
        if (Object.keys(existing).length >= MAX_MEMORY_ENTRIES && !existing[args.key]) {
            return { error: `Memory limit reached (${MAX_MEMORY_ENTRIES} entries). Delete some first.` };
        }
        store.update(`memory-${guildId}.json`, mem => {
            return { ...(mem || {}), [args.key]: { value: args.value, savedBy: message.author.id, savedAt: new Date().toISOString() } };
        });
        return { success: true, key: args.key };
    },

    async getMemory(args, message) {
        const guildId = message.guild.id;
        const mem = store.read(`memory-${guildId}.json`, {});
        const entry = mem[args.key];
        if (!entry) return { error: `No memory found for key "${args.key}".` };
        return { key: args.key, value: entry.value, savedAt: entry.savedAt };
    },

    async listMemories(_args, message) {
        const guildId = message.guild.id;
        const mem = store.read(`memory-${guildId}.json`, {});
        return { memories: Object.entries(mem).map(([key, entry]) => ({ key, value: entry.value, savedAt: entry.savedAt })) };
    },

    async deleteMemory(args, message) {
        const guildId = message.guild.id;
        store.update(`memory-${guildId}.json`, mem => {
            const updated = { ...(mem || {}) };
            delete updated[args.key];
            return updated;
        });
        return { success: true, deleted: args.key };
    },

    // ── Message Reading ──

    async readMessages(args, message) {
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (!channel.isTextBased()) return { error: `Channel "${channel.name}" is not a text channel.` };
        const count = Math.min(Math.max(parseInt(args.count, 10) || 10, 1), MAX_READ_MESSAGES);
        const messages = await channel.messages.fetch({ limit: count });
        return {
            channel: channel.name,
            messages: messages.reverse().map(m => ({
                id: m.id, author: m.author.username, content: m.content?.slice(0, 200),
                timestamp: m.createdAt.toISOString(), attachments: m.attachments.size
            }))
        };
    },

    async fetchMessage(args, message) {
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const msg = await channel.messages.fetch(args.messageId).catch(() => null);
        if (!msg) return { error: 'Message not found.' };
        return {
            id: msg.id, author: msg.author.username, content: msg.content,
            timestamp: msg.createdAt.toISOString(), attachments: msg.attachments.map(a => a.url),
            embeds: msg.embeds.length, reactions: msg.reactions.cache.map(r => `${r.emoji.name}(${r.count})`)
        };
    },

    // ── Rich Messages ──

    async sendEmbed(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (!channel.isTextBased()) return { error: `Channel "${channel.name}" is not a text channel.` };
        const embed = new EmbedBuilder();
        if (args.title) embed.setTitle(args.title);
        if (args.description) embed.setDescription(args.description);
        if (args.color) embed.setColor(args.color);
        if (args.footer) embed.setFooter({ text: args.footer });
        if (args.image) embed.setImage(args.image);
        if (args.thumbnail) embed.setThumbnail(args.thumbnail);
        if (args.fields) {
            try {
                const fields = JSON.parse(args.fields);
                if (Array.isArray(fields)) {
                    for (const f of fields) embed.addFields({ name: f.name, value: f.value, inline: !!f.inline });
                }
            } catch (_) {}
        }
        await channel.send({ embeds: [embed] });
        return { success: true, channel: channel.name };
    },

    async replyToMessage(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const msg = await channel.messages.fetch(args.messageId).catch(() => null);
        if (!msg) return { error: 'Message not found.' };
        await msg.reply({ content: args.content, allowedMentions: { parse: ['users', 'roles'] } });
        return { success: true, repliedTo: msg.author.username };
    },

    async editMessage(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const msg = await channel.messages.fetch(args.messageId).catch(() => null);
        if (!msg) return { error: 'Message not found.' };
        if (msg.author.id !== message.guild.members.me.id) return { error: 'Can only edit messages sent by me.' };
        await msg.edit(args.content);
        return { success: true, edited: args.messageId };
    },

    async addReaction(args, message) {
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const msg = await channel.messages.fetch(args.messageId).catch(() => null);
        if (!msg) return { error: 'Message not found.' };
        const customEmoji = message.guild.emojis.cache.find(e => e.name.toLowerCase() === args.emoji.toLowerCase());
        await msg.react(customEmoji || args.emoji);
        return { success: true, emoji: args.emoji, messageId: args.messageId };
    },

    async createPoll(args, message) {
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const options = args.options.split(',').map(o => o.trim()).filter(Boolean).slice(0, 10);
        if (options.length < 2) return { error: 'Need at least 2 options.' };
        const duration = Math.min(Math.max(parseInt(args.duration, 10) || 24, 1), 168);
        await channel.send({
            poll: {
                question: { text: args.question },
                answers: options.map(text => ({ text })),
                duration,
                allowMultiselect: false,
                layoutType: PollLayoutType.Default
            }
        });
        return { success: true, question: args.question, options, duration: `${duration}h` };
    },

    // ── Direct Messages ──

    async dmUser(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        try {
            await member.send(args.content);
            return { success: true, user: member.displayName };
        } catch (_) {
            return { error: `Cannot DM ${member.displayName}. They may have DMs disabled.` };
        }
    },

    // ── Additional Channel Management ──

    async moveChannel(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const category = resolveChannel(message.guild, args.category);
        if (!category || category.type !== ChannelType.GuildCategory) return { error: `Category "${args.category}" not found.` };
        await channel.setParent(category.id);
        return { success: true, channel: channel.name, category: category.name };
    },

    async cloneChannel(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const cloned = await channel.clone({ name: args.newName || undefined });
        return { success: true, original: channel.name, cloned: cloned.name, id: cloned.id };
    },

    async setChannelNSFW(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        await channel.setNSFW(!!args.nsfw);
        return { success: true, channel: channel.name, nsfw: !!args.nsfw };
    },

    async setVoiceUserLimit(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (!channel.isVoiceBased()) return { error: `"${channel.name}" is not a voice channel.` };
        const limit = Math.max(parseInt(args.limit, 10) || 0, 0);
        await channel.setUserLimit(limit);
        return { success: true, channel: channel.name, userLimit: limit || 'unlimited' };
    },

    // ── Additional Info Queries ──

    async listEmojis(_args, message) {
        const emojis = message.guild.emojis.cache.map(e => ({
            name: e.name, id: e.id, animated: e.animated, available: e.available
        }));
        return { count: emojis.length, emojis };
    },

    async listBans(_args, message) {
        const bans = await message.guild.bans.fetch();
        return { count: bans.size, bans: bans.map(b => ({ user: b.user.username, id: b.user.id, reason: b.reason })) };
    },

    // ── Reaction Roles ──

    async setupReactionRole(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        const msg = await channel.messages.fetch(args.messageId).catch(() => null);
        if (!msg) return { error: 'Message not found.' };
        const customEmoji = message.guild.emojis.cache.find(e => e.name.toLowerCase() === args.emoji.toLowerCase());
        await msg.react(customEmoji || args.emoji);
        const guildId = message.guild.id;
        store.update(`guild-${guildId}.json`, cfg => {
            const config = cfg || {};
            if (!Array.isArray(config.reactionRoles)) config.reactionRoles = [];
            config.reactionRoles = config.reactionRoles.filter(r => !(r.messageId === args.messageId && r.emoji === args.emoji));
            config.reactionRoles.push({ messageId: args.messageId, channelId: channel.id, emoji: args.emoji, roleId: role.id });
            return config;
        });
        return { success: true, message: args.messageId, emoji: args.emoji, role: role.name };
    },

    async removeReactionRole(args, message) {
        const guildId = message.guild.id;
        store.update(`guild-${guildId}.json`, cfg => {
            const config = cfg || {};
            if (!Array.isArray(config.reactionRoles)) return config;
            const before = config.reactionRoles.length;
            config.reactionRoles = config.reactionRoles.filter(r => {
                if (r.messageId !== args.messageId) return true;
                if (args.emoji && r.emoji !== args.emoji) return true;
                return false;
            });
            return config;
        });
        return { success: true, removed: args.messageId };
    },

    async listReactionRoles(_args, message) {
        const guildId = message.guild.id;
        const config = store.read(`guild-${guildId}.json`, {});
        const rrs = config.reactionRoles || [];
        return {
            count: rrs.length,
            reactionRoles: rrs.map(r => ({
                messageId: r.messageId, emoji: r.emoji,
                role: message.guild.roles.cache.get(r.roleId)?.name || r.roleId,
                channel: message.guild.channels.cache.get(r.channelId)?.name || r.channelId
            }))
        };
    },

    // ── Welcome/Goodbye/AutoRole Config ──

    async setWelcomeChannel(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const guildId = message.guild.id;
        store.update(`guild-${guildId}.json`, cfg => {
            const config = cfg || {};
            config.welcomeChannel = channel.id;
            if (args.message) config.welcomeMessage = args.message;
            return config;
        });
        return { success: true, channel: channel.name, message: args.message || '(default)' };
    },

    async setGoodbyeChannel(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const guildId = message.guild.id;
        store.update(`guild-${guildId}.json`, cfg => {
            const config = cfg || {};
            config.goodbyeChannel = channel.id;
            if (args.message) config.goodbyeMessage = args.message;
            return config;
        });
        return { success: true, channel: channel.name, message: args.message || '(default)' };
    },

    async setAutoRole(args, message) {
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        const guildId = message.guild.id;
        store.update(`guild-${guildId}.json`, cfg => {
            const config = cfg || {};
            if (!Array.isArray(config.autoRoles)) config.autoRoles = [];
            if (args.action === 'add') {
                if (!config.autoRoles.includes(role.id)) config.autoRoles.push(role.id);
            } else {
                config.autoRoles = config.autoRoles.filter(id => id !== role.id);
            }
            return config;
        });
        return { success: true, role: role.name, action: args.action };
    },

    // ── Server Settings (extended) ──

    async setAFKChannel(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (!channel.isVoiceBased()) return { error: `"${channel.name}" is not a voice channel.` };
        await message.guild.setAFKChannel(channel);
        if (args.timeout) {
            const valid = [60, 300, 900, 1800, 3600];
            const timeout = valid.includes(args.timeout) ? args.timeout : 300;
            await message.guild.setAFKTimeout(timeout);
        }
        return { success: true, channel: channel.name, timeout: args.timeout || 'unchanged' };
    },

    async setDefaultNotifications(args, message) {
        const level = args.level === 'all' ? GuildDefaultMessageNotifications.AllMessages : GuildDefaultMessageNotifications.OnlyMentions;
        await message.guild.setDefaultMessageNotifications(level);
        return { success: true, level: args.level };
    },

    async setServerBanner(args, message) {
        if (message.guild.premiumTier < 2) return { error: 'Server banner requires boost level 2+.' };
        await message.guild.setBanner(args.url);
        return { success: true, banner: 'updated' };
    },

    // ── Info Queries ──

    async getServerInfo(_args, message) {
        const guild = message.guild;
        const online = guild.members.cache.filter(m => m.presence?.status === 'online').size;
        const idle = guild.members.cache.filter(m => m.presence?.status === 'idle').size;
        const dnd = guild.members.cache.filter(m => m.presence?.status === 'dnd').size;
        return {
            name: guild.name, id: guild.id, memberCount: guild.memberCount,
            online, idle, dnd,
            channelCount: guild.channels.cache.size, roleCount: guild.roles.cache.size,
            emojiCount: guild.emojis.cache.size,
            owner: (await guild.fetchOwner()).displayName,
            createdAt: guild.createdAt.toISOString(),
            boostLevel: guild.premiumTier, boostCount: guild.premiumSubscriptionCount
        };
    },

    async getMemberInfo(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        return {
            username: member.user.username, displayName: member.displayName, id: member.id,
            joinedAt: member.joinedAt?.toISOString(),
            roles: member.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.name),
            isAdmin: member.permissions.has(PermissionsBitField.Flags.Administrator),
            isOwner: member.id === message.guild.ownerId,
            tier: getTierName(getUserTier(member, message.guild.id))
        };
    },

    async listChannels(args, message) {
        const limit = Math.min(parseInt(args.limit, 10) || 50, 100);
        const all = message.guild.channels.cache.filter(c => !c.isThread()).sort((a, b) => a.position - b.position);
        const channels = all.map(c => ({ name: c.name, type: c.type, id: c.id })).slice(0, limit);
        return { channels, total: all.size, showing: channels.length };
    },

    async listRoles(args, message) {
        const limit = Math.min(parseInt(args.limit, 10) || 50, 100);
        const all = message.guild.roles.cache.filter(r => r.id !== message.guild.id).sort((a, b) => b.position - a.position);
        const roles = all.map(r => ({ name: r.name, color: r.hexColor, members: r.members.size, id: r.id })).slice(0, limit);
        return { roles, total: all.size, showing: roles.length };
    },

    // ── Forum Channel Tools ──

    async createForumPost(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (channel.type !== ChannelType.GuildForum) return { error: `"${channel.name}" is not a forum channel.` };
        const thread = await channel.threads.create({
            name: args.title,
            message: { content: args.content }
        });
        return { success: true, thread: thread.name, id: thread.id, channel: channel.name };
    },

    async listForumPosts(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (channel.type !== ChannelType.GuildForum) return { error: `"${channel.name}" is not a forum channel.` };
        const limit = Math.min(parseInt(args.limit, 10) || 25, 25);
        const active = await channel.threads.fetchActive();
        const posts = active.threads.map(t => ({
            name: t.name, id: t.id, messageCount: t.messageCount, archived: t.archived
        })).slice(0, limit);
        return { posts, total: active.threads.size, showing: posts.length };
    },

    // ── Stage Channel Tools ──

    async createStageInstance(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (channel.type !== ChannelType.GuildStageVoice) return { error: `"${channel.name}" is not a stage channel.` };
        const instance = await message.guild.stageInstances.create(channel, { topic: args.topic });
        return { success: true, topic: instance.topic, channel: channel.name };
    },

    async endStageInstance(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (!channel.stageInstance) return { error: `No active stage in "${channel.name}".` };
        await channel.stageInstance.delete();
        return { success: true, channel: channel.name };
    },

    // ── Sticker Management ──

    async addSticker(args, message) {
        const sticker = await message.guild.stickers.create({
            file: args.url,
            name: args.name,
            tags: args.tags,
            description: args.description || ''
        });
        return { success: true, name: sticker.name, id: sticker.id };
    },

    async removeSticker(args, message) {
        const sticker = message.guild.stickers.cache.find(s =>
            s.name.toLowerCase() === args.name.toLowerCase() || s.id === args.name
        );
        if (!sticker) return { error: `Sticker "${args.name}" not found.` };
        await sticker.delete();
        return { success: true, name: sticker.name };
    },

    async listStickers(_args, message) {
        const stickers = message.guild.stickers.cache.map(s => ({
            name: s.name, id: s.id, tags: s.tags, format: s.format
        }));
        return { stickers, total: stickers.length };
    },

    // ── Temp Ban ──

    async tempBan(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.bannable) return { error: `Cannot ban ${member.displayName}. Insufficient permissions.` };
        const ms = parseDuration(args.duration);
        if (!ms) return { error: `Invalid duration "${args.duration}". Use format like 1h, 6h, 1d, 7d.` };
        if (ms > MAX_TEMP_BAN_MS) return { error: 'Temp ban cannot exceed 30 days.' };

        const username = member.user.username;
        const userId = member.id;
        await member.ban({ reason: args.reason || `Temp ban (${args.duration}) by Ultron.` });

        const unbanAt = new Date(Date.now() + ms).toISOString();
        store.addTempBan(message.guild.id, userId, username, unbanAt, args.reason);

        return { success: true, banned: username, duration: args.duration, autoUnban: true };
    },

    // ── Bulk Role Assignment ──

    async bulkAssignRole(args, message) {
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        const usernames = args.users.split(',').map(u => u.trim()).filter(Boolean);
        if (usernames.length === 0) return { error: 'No users specified.' };
        if (usernames.length > 25) return { error: 'Maximum 25 users per bulk operation.' };

        const results = { assigned: [], failed: [] };
        for (const name of usernames) {
            try {
                const member = await resolveMember(message.guild, name);
                if (!member) { results.failed.push(`${name}: not found`); continue; }
                await member.roles.add(role);
                results.assigned.push(member.displayName);
            } catch (err) {
                results.failed.push(`${name}: ${err.message}`);
            }
        }
        return { success: true, role: role.name, ...results };
    },

    // ── Voice Configuration ──

    async setVoiceBitrate(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
            return { error: `"${channel.name}" is not a voice channel.` };
        }
        const bitrate = parseInt(args.bitrate, 10);
        if (isNaN(bitrate) || bitrate < 8000 || bitrate > 384000) {
            return { error: 'Bitrate must be between 8000 and 384000.' };
        }
        await channel.setBitrate(bitrate);
        return { success: true, channel: channel.name, bitrate };
    },

    async setVoiceRegion(args, message) {
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
            return { error: `"${channel.name}" is not a voice channel.` };
        }
        const region = args.region === 'automatic' ? null : (args.region || null);
        await channel.setRTCRegion(region);
        return { success: true, channel: channel.name, region: region || 'automatic' };
    },

    // ── Enhanced Info ──

    async getAuditLogByAction(args, message) {
        const actionType = AuditLogEvent[args.actionType];
        if (actionType === undefined) {
            const available = Object.keys(AuditLogEvent).filter(k => isNaN(k)).slice(0, 20).join(', ');
            return { error: `Unknown action type "${args.actionType}". Available: ${available}...` };
        }
        const limit = Math.min(parseInt(args.limit, 10) || 10, 25);
        const logs = await message.guild.fetchAuditLogs({ type: actionType, limit });
        const entries = logs.entries.map(e => ({
            action: args.actionType,
            executor: e.executor?.username || 'Unknown',
            target: e.target?.username || e.target?.name || e.target?.id || 'Unknown',
            reason: e.reason || null,
            date: e.createdAt.toISOString()
        }));
        return { entries, total: entries.length };
    },

    async listThreads(args, message) {
        if (args.channel) {
            const channel = resolveChannel(message.guild, args.channel);
            if (!channel) return { error: `Channel "${args.channel}" not found.` };
            const active = await channel.threads?.fetchActive();
            if (!active) return { error: `"${channel.name}" does not support threads.` };
            const threads = active.threads.map(t => ({
                name: t.name, id: t.id, parent: channel.name, messageCount: t.messageCount, archived: t.archived
            }));
            return { threads, total: threads.length };
        }
        const active = await message.guild.channels.fetchActiveThreads();
        const threads = active.threads.map(t => ({
            name: t.name, id: t.id, parent: t.parent?.name || 'unknown', messageCount: t.messageCount, archived: t.archived
        }));
        return { threads, total: threads.length };
    },

    // ── Tool Audit Trail ──

    async getToolAuditTrail(args, message) {
        const limit = Math.min(parseInt(args.limit, 10) || 25, 50);
        const entries = store.getAuditTrail(message.guild.id, limit, args.toolName || null);
        return { entries, total: entries.length };
    }
};

// ── Per-User Rate Limiting ──

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60000;
const rateLimitMap = new Map();

function checkRateLimit(userId) {
    const now = Date.now();
    let bucket = rateLimitMap.get(userId);
    if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW) {
        bucket = { windowStart: now, count: 0 };
        rateLimitMap.set(userId, bucket);
    }
    bucket.count++;
    return bucket.count <= RATE_LIMIT_MAX;
}

// Cleanup stale entries every 5 minutes
const rateLimitCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [userId, bucket] of rateLimitMap) {
        if (now - bucket.windowStart > RATE_LIMIT_WINDOW) rateLimitMap.delete(userId);
    }
}, 300000);
if (typeof rateLimitCleanupTimer.unref === 'function') {
    rateLimitCleanupTimer.unref();
}

// ── Executor ──

async function executeTool(name, args, message) {
    if (!message.guild) return { error: 'Server actions require a server context.' };
    const fn = tools[name];
    if (!fn) return { error: `Unknown tool: ${name}` };

    // Per-user rate limiting
    if (!checkRateLimit(message.author.id)) {
        return { error: `Rate limited. Max ${RATE_LIMIT_MAX} tool calls per ${RATE_LIMIT_WINDOW / 1000}s.` };
    }

    // Check tier-based permissions
    const tierCheck = checkTier(name, message);
    if (!tierCheck.allowed) return { error: tierCheck.error };

    try {
        const result = await withToolTimeout(fn(args || {}, message), name);
        store.logAudit(message.guild.id, message.author.id, name, args || {}, result);
        return result;
    } catch (err) {
        log.error(`Tool ${name} error:`, err.message);
        const errorResult = { error: `Action failed: ${err.message}` };
        store.logAudit(message.guild.id, message.author.id, name, args || {}, errorResult);
        return errorResult;
    }
}

module.exports = { executeTool, getUserTier, getTierName, TOOL_TIERS, _resetRateLimits() { rateLimitMap.clear(); } };
