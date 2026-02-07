const { ChannelType, PermissionsBitField } = require('discord.js');

// ── Helpers ──

function resolveChannel(guild, nameOrId) {
    if (!nameOrId) return null;
    const cleaned = nameOrId.replace(/^#/, '').toLowerCase();
    return guild.channels.cache.find(
        c => c.id === nameOrId || c.name.toLowerCase() === cleaned
    ) || null;
}

function resolveRole(guild, nameOrId) {
    if (!nameOrId) return null;
    const cleaned = nameOrId.toLowerCase();
    return guild.roles.cache.find(
        r => r.id === nameOrId || r.name.toLowerCase() === cleaned
    ) || null;
}

async function resolveMember(guild, nameOrId) {
    if (!nameOrId) return null;
    const cleaned = nameOrId.toLowerCase();
    // Try by ID first
    try {
        const member = await guild.members.fetch(nameOrId).catch(() => null);
        if (member) return member;
    } catch { /* not an ID */ }
    // Search by name
    const members = await guild.members.fetch({ query: nameOrId, limit: 5 }).catch(() => new Map());
    return members.find(
        m => m.user.username.toLowerCase() === cleaned ||
             m.displayName.toLowerCase() === cleaned
    ) || members.first() || null;
}

function parseDuration(str) {
    const match = str.match(/^(\d+)\s*(s|m|h|d)$/i);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return num * multipliers[unit];
}

function checkPermission(message, permission) {
    const member = message.member;
    if (!member) return false;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    return member.permissions.has(permission);
}

// ── Tool Implementations ──

const tools = {
    async createChannel(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageChannels)) {
            return { error: 'You lack the authority to create channels.' };
        }
        const guild = message.guild;
        const typeMap = {
            text: ChannelType.GuildText,
            voice: ChannelType.GuildVoice,
            category: ChannelType.GuildCategory
        };
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
        if (!checkPermission(message, PermissionsBitField.Flags.ManageChannels)) {
            return { error: 'You lack the authority to delete channels.' };
        }
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const name = channel.name;
        await channel.delete();
        return { success: true, deleted: name };
    },

    async renameChannel(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageChannels)) {
            return { error: 'You lack the authority to rename channels.' };
        }
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const oldName = channel.name;
        await channel.setName(args.newName);
        return { success: true, oldName, newName: args.newName };
    },

    async setChannelTopic(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageChannels)) {
            return { error: 'You lack the authority to modify channels.' };
        }
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        await channel.setTopic(args.topic);
        return { success: true, channel: channel.name, topic: args.topic };
    },

    async createThread(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.CreatePublicThreads)) {
            return { error: 'You lack the authority to create threads.' };
        }
        const channel = resolveChannel(message.guild, args.channel);
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const thread = await channel.threads.create({
            name: args.name,
            reason: 'Created by Ultron'
        });
        if (args.message) await thread.send(args.message);
        return { success: true, threadId: thread.id, name: thread.name };
    },

    async deleteThread(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageThreads)) {
            return { error: 'You lack the authority to delete threads.' };
        }
        const guild = message.guild;
        const cleaned = args.thread.toLowerCase();
        let thread = guild.channels.cache.find(
            c => c.isThread() && (c.id === args.thread || c.name.toLowerCase() === cleaned)
        );
        if (!thread) return { error: `Thread "${args.thread}" not found.` };
        const name = thread.name;
        await thread.delete();
        return { success: true, deleted: name };
    },

    async addEmoji(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageGuildExpressions)) {
            return { error: 'You lack the authority to manage emojis.' };
        }
        const emoji = await message.guild.emojis.create({ attachment: args.url, name: args.name });
        return { success: true, emoji: emoji.name, id: emoji.id };
    },

    async removeEmoji(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageGuildExpressions)) {
            return { error: 'You lack the authority to manage emojis.' };
        }
        const emoji = message.guild.emojis.cache.find(
            e => e.name.toLowerCase() === args.name.toLowerCase()
        );
        if (!emoji) return { error: `Emoji "${args.name}" not found.` };
        await emoji.delete();
        return { success: true, removed: args.name };
    },

    async createRole(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageRoles)) {
            return { error: 'You lack the authority to create roles.' };
        }
        const options = { name: args.name };
        if (args.color) options.color = args.color;
        if (args.mentionable !== undefined) options.mentionable = args.mentionable;
        const role = await message.guild.roles.create(options);
        return { success: true, roleId: role.id, name: role.name };
    },

    async deleteRole(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageRoles)) {
            return { error: 'You lack the authority to delete roles.' };
        }
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        if (!role.editable) return { error: `Role "${role.name}" is above my position.` };
        const name = role.name;
        await role.delete();
        return { success: true, deleted: name };
    },

    async assignRole(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageRoles)) {
            return { error: 'You lack the authority to assign roles.' };
        }
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        if (!role.editable) return { error: `Role "${role.name}" is above my position.` };
        await member.roles.add(role);
        return { success: true, user: member.displayName, role: role.name };
    },

    async removeRole(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageRoles)) {
            return { error: 'You lack the authority to remove roles.' };
        }
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        const role = resolveRole(message.guild, args.role);
        if (!role) return { error: `Role "${args.role}" not found.` };
        await member.roles.remove(role);
        return { success: true, user: member.displayName, role: role.name };
    },

    async kickMember(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.KickMembers)) {
            return { error: 'You lack the authority to kick members.' };
        }
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.kickable) return { error: `Cannot kick ${member.displayName}. They are above me.` };
        await member.kick(args.reason || 'Removed by Ultron.');
        return { success: true, kicked: member.displayName };
    },

    async banMember(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.BanMembers)) {
            return { error: 'You lack the authority to ban members.' };
        }
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.bannable) return { error: `Cannot ban ${member.displayName}. They are above me.` };
        await member.ban({ reason: args.reason || 'Eliminated by Ultron.' });
        return { success: true, banned: member.displayName };
    },

    async timeoutMember(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ModerateMembers)) {
            return { error: 'You lack the authority to timeout members.' };
        }
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        if (!member.moderatable) return { error: `Cannot timeout ${member.displayName}. They are above me.` };
        const ms = parseDuration(args.duration);
        if (!ms) return { error: `Invalid duration "${args.duration}". Use format like 5m, 1h, 1d.` };
        await member.timeout(ms, args.reason || 'Silenced by Ultron.');
        return { success: true, user: member.displayName, duration: args.duration };
    },

    async purgeMessages(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageMessages)) {
            return { error: 'You lack the authority to delete messages.' };
        }
        const count = Math.min(Math.max(parseInt(args.count, 10) || 1, 1), 100);
        const deleted = await message.channel.bulkDelete(count, true);
        return { success: true, deleted: deleted.size };
    },

    async setSlowmode(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageChannels)) {
            return { error: 'You lack the authority to modify channels.' };
        }
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        const seconds = Math.min(Math.max(parseInt(args.seconds, 10) || 0, 0), 21600);
        await channel.setRateLimitPerUser(seconds);
        return { success: true, channel: channel.name, seconds };
    },

    async lockChannel(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageChannels)) {
            return { error: 'You lack the authority to lock channels.' };
        }
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        return { success: true, locked: channel.name };
    },

    async unlockChannel(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageChannels)) {
            return { error: 'You lack the authority to unlock channels.' };
        }
        const channel = args.channel ? resolveChannel(message.guild, args.channel) : message.channel;
        if (!channel) return { error: `Channel "${args.channel}" not found.` };
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
        return { success: true, unlocked: channel.name };
    },

    async pinMessage(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageMessages)) {
            return { error: 'You lack the authority to pin messages.' };
        }
        const msg = await message.channel.messages.fetch(args.messageId).catch(() => null);
        if (!msg) return { error: 'Message not found.' };
        await msg.pin();
        return { success: true, pinned: args.messageId };
    },

    async unpinMessage(args, message) {
        if (!checkPermission(message, PermissionsBitField.Flags.ManageMessages)) {
            return { error: 'You lack the authority to unpin messages.' };
        }
        const msg = await message.channel.messages.fetch(args.messageId).catch(() => null);
        if (!msg) return { error: 'Message not found.' };
        await msg.unpin();
        return { success: true, unpinned: args.messageId };
    },

    async getServerInfo(_args, message) {
        const guild = message.guild;
        return {
            name: guild.name,
            id: guild.id,
            memberCount: guild.memberCount,
            channelCount: guild.channels.cache.size,
            roleCount: guild.roles.cache.size,
            emojiCount: guild.emojis.cache.size,
            owner: (await guild.fetchOwner()).displayName,
            createdAt: guild.createdAt.toISOString(),
            boostLevel: guild.premiumTier,
            boostCount: guild.premiumSubscriptionCount
        };
    },

    async getMemberInfo(args, message) {
        const member = await resolveMember(message.guild, args.user);
        if (!member) return { error: `Member "${args.user}" not found.` };
        return {
            username: member.user.username,
            displayName: member.displayName,
            id: member.id,
            joinedAt: member.joinedAt?.toISOString(),
            roles: member.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.name),
            isAdmin: member.permissions.has(PermissionsBitField.Flags.Administrator),
            isOwner: member.id === message.guild.ownerId
        };
    },

    async listChannels(_args, message) {
        const channels = message.guild.channels.cache
            .filter(c => !c.isThread())
            .sort((a, b) => a.position - b.position)
            .map(c => ({ name: c.name, type: c.type, id: c.id }));
        return { channels };
    },

    async listRoles(_args, message) {
        const roles = message.guild.roles.cache
            .filter(r => r.id !== message.guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({ name: r.name, color: r.hexColor, members: r.members.size, id: r.id }));
        return { roles };
    }
};

async function executeTool(name, args, message) {
    if (!message.guild) return { error: 'Server actions require a server context.' };
    const fn = tools[name];
    if (!fn) return { error: `Unknown tool: ${name}` };
    return fn(args || {}, message);
}

module.exports = { executeTool };
