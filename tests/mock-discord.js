'use strict';

const { Collection, ChannelType, PermissionsBitField } = require('discord.js');

// ── Mock Role ──

function createMockRole(guild, id, name, position = 0, opts = {}) {
    const role = {
        id, name, position,
        hexColor: opts.color || '#000000',
        editable: opts.editable !== undefined ? opts.editable : true,
        mentionable: opts.mentionable || false,
        members: { size: 0 },
        guild,
        async delete() { guild.roles.cache.delete(this.id); },
        async edit(updates) {
            if (updates.name) this.name = updates.name;
            if (updates.color) this.hexColor = updates.color;
            if (updates.mentionable !== undefined) this.mentionable = updates.mentionable;
        }
    };
    return role;
}

// ── Mock Message ──

function createMockMsg(id, authorUsername, content, channel, guild) {
    return {
        id,
        content,
        author: { id: `author-${id}`, username: authorUsername },
        createdAt: new Date(),
        attachments: new Collection(),
        embeds: [],
        reactions: { cache: new Collection() },
        async pin() {},
        async unpin() {},
        async reply() {},
        async react() {},
        async edit(newContent) { this.content = newContent; }
    };
}

// ── Mock Channel ──

function createMockChannel(guild, id, name, type = ChannelType.GuildText) {
    const messages = new Collection();
    const channel = {
        id, name, type,
        position: 0,
        guild,

        isTextBased() { return [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(this.type); },
        isVoiceBased() { return [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(this.type); },
        isThread() { return this.type === ChannelType.PublicThread || this.type === ChannelType.PrivateThread; },

        messages: {
            cache: messages,
            async fetch(opts) {
                if (typeof opts === 'string') {
                    return messages.get(opts) || null;
                }
                return messages;
            }
        },

        permissionOverwrites: {
            cache: new Collection(),
            async edit() {},
            async delete() {}
        },

        threads: {
            async create(opts) {
                const threadName = typeof opts === 'string' ? opts : (opts.name || opts.message?.content?.slice(0, 20) || 'thread');
                const thread = createMockChannel(guild, `thread-${Date.now()}`, threadName, ChannelType.PublicThread);
                thread.parent = channel;
                thread.messageCount = 0;
                thread.archived = false;
                thread.send = async () => {};
                guild.channels.cache.set(thread.id, thread);
                return thread;
            },
            async fetchActive() {
                const threads = guild.channels.cache.filter(c => c.isThread() && c.parent === channel);
                return { threads };
            }
        },

        _archived: false,
        members: {
            async add() {}
        },
        async setArchived(val) { this._archived = val; },
        async send() { return { id: `sent-${Date.now()}` }; },
        async delete() { guild.channels.cache.delete(this.id); },
        async setName(n) { this.name = n; },
        async setTopic() {},
        async setParent() {},
        async setRateLimitPerUser() {},
        async setNSFW() {},
        async setUserLimit() {},
        async setBitrate(b) { channel.bitrate = b; },
        async setRTCRegion(r) { channel.rtcRegion = r; },
        stageInstance: null,
        async clone(opts) {
            const cloned = createMockChannel(guild, `clone-${Date.now()}`, opts?.name || this.name + '-clone', this.type);
            guild.channels.cache.set(cloned.id, cloned);
            return cloned;
        },
        async bulkDelete() { return new Collection(); },
        async createInvite(opts) {
            return { code: 'TESTCODE', url: 'https://discord.gg/TESTCODE', maxUses: opts?.maxUses || 0 };
        },
        async createWebhook(opts) {
            return { id: `wh-${Date.now()}`, name: opts.name, url: 'https://discord.com/api/webhooks/test/token' };
        }
    };
    return channel;
}

// ── Mock Member ──

function createMockMember(guild, id, username, permFlags = []) {
    const permSet = new Set(permFlags.map(f => PermissionsBitField.Flags[f]).filter(Boolean));
    const member = {
        id,
        displayName: username,
        user: { id, username, globalName: username },
        guild,
        joinedAt: new Date(),
        permissions: { has(flag) { return permSet.has(flag); } },
        kickable: true,
        bannable: true,
        moderatable: true,
        manageable: true,
        presence: null,
        roles: {
            cache: new Collection(),
            async add(role) { this.cache.set(role.id, role); },
            async remove(role) { this.cache.delete(role.id); }
        },
        voice: {
            channel: null,
            async setChannel(ch) { this.channel = ch; },
            async disconnect() { this.channel = null; },
            async setMute(mute) { this.serverMute = mute; },
            async setDeaf(deaf) { this.serverDeaf = deaf; }
        },
        async kick() {},
        async ban() {},
        async timeout() {},
        async setNickname(nick) { this.displayName = nick || this.user.username; },
        async send() {}
    };
    return member;
}

// ── Mock Guild ──

function createMockGuild(id = '123456789', name = 'Test Guild') {
    const guild = {
        id, name,
        ownerId: '999999999',
        memberCount: 100,
        createdAt: new Date('2020-01-01'),
        premiumTier: 2,
        premiumSubscriptionCount: 15,

        channels: {
            cache: new Collection(),
            async create(opts) {
                const ch = createMockChannel(guild, `ch-${Date.now()}`, opts.name, opts.type || ChannelType.GuildText);
                guild.channels.cache.set(ch.id, ch);
                return ch;
            },
            async fetchActiveThreads() {
                const threads = guild.channels.cache.filter(c => c.isThread());
                return { threads };
            }
        },

        roles: {
            cache: new Collection(),
            everyone: null,
            async create(opts) {
                const role = createMockRole(guild, `role-${Date.now()}`, opts.name, 0, opts);
                guild.roles.cache.set(role.id, role);
                return role;
            }
        },

        members: {
            cache: new Collection(),
            me: null,
            async fetch(query) {
                if (typeof query === 'string') {
                    return guild.members.cache.get(query) || null;
                }
                if (query && query.query) {
                    const q = query.query.toLowerCase();
                    return guild.members.cache.filter(m =>
                        m.user.username.toLowerCase().includes(q) ||
                        m.displayName.toLowerCase().includes(q) ||
                        (m.user.globalName && m.user.globalName.toLowerCase().includes(q))
                    );
                }
                return guild.members.cache;
            },
            async unban() {}
        },

        emojis: {
            cache: new Collection(),
            async create(opts) {
                const emoji = { id: `emoji-${Date.now()}`, name: opts.name, animated: false, available: true, async delete() { guild.emojis.cache.delete(this.id); } };
                guild.emojis.cache.set(emoji.id, emoji);
                return emoji;
            }
        },

        bans: {
            async fetch() { return guild._bans; }
        },

        invites: {
            async fetch() { return guild._invites; }
        },

        scheduledEvents: {
            cache: new Collection(),
            async fetch() { return this.cache; },
            async create(opts) {
                const event = {
                    id: `event-${Date.now()}`, name: opts.name, description: opts.description,
                    scheduledStartTime: opts.scheduledStartTime, status: 1,
                    async edit(updates) { Object.assign(this, updates); },
                    async delete() { guild.scheduledEvents.cache.delete(this.id); }
                };
                this.cache.set(event.id, event);
                return event;
            }
        },

        autoModerationRules: {
            cache: new Collection(),
            async fetch() { return this.cache; },
            async create(opts) {
                const rule = {
                    id: `rule-${Date.now()}`, name: opts.name, enabled: true, triggerType: opts.triggerType,
                    async delete() { guild.autoModerationRules.cache.delete(this.id); }
                };
                this.cache.set(rule.id, rule);
                return rule;
            }
        },

        // Internal collections for bans/invites/webhooks
        _bans: new Collection(),
        _invites: new Collection(),
        _webhooks: new Collection(),
        _auditEntries: [],

        async setName(n) { this.name = n; },
        async setIcon() {},
        async setVerificationLevel() {},
        async setSystemChannel() {},
        async setRulesChannel() {},
        async setAFKChannel() {},
        async setAFKTimeout() {},
        async setDefaultMessageNotifications() {},
        async setBanner() {},

        async fetchOwner() {
            return guild.members.cache.get(guild.ownerId) || createMockMember(guild, guild.ownerId, 'Owner');
        },
        stickers: {
            cache: new Collection(),
            async create(opts) {
                const sticker = {
                    id: `sticker-${Date.now()}`, name: opts.name, tags: opts.tags,
                    format: 1, description: opts.description || '',
                    async delete() { guild.stickers.cache.delete(this.id); }
                };
                guild.stickers.cache.set(sticker.id, sticker);
                return sticker;
            }
        },

        stageInstances: {
            async create(channel, opts) {
                const instance = { topic: opts.topic, channel };
                channel.stageInstance = instance;
                return instance;
            }
        },

        async fetchAuditLogs(opts) {
            const entries = new Collection();
            if (guild._auditEntries) {
                let filtered = [...guild._auditEntries];
                if (opts?.type !== undefined) filtered = filtered.filter(e => e._type === opts.type);
                const limit = opts?.limit || 10;
                filtered.slice(0, limit).forEach(e => entries.set(e.id, e));
            }
            return { entries };
        },
        async fetchWebhooks() { return guild._webhooks; }
    };

    // Create @everyone role
    const everyoneRole = createMockRole(guild, id, '@everyone', 0);
    guild.roles.cache.set(id, everyoneRole);
    guild.roles.everyone = everyoneRole;

    return guild;
}

// ── Factory: Complete Test Environment ──

function createMockEnvironment() {
    const guild = createMockGuild();

    // Channels
    const general = createMockChannel(guild, '111111111', 'general', ChannelType.GuildText);
    const announcements = createMockChannel(guild, '222222222', 'announcements', ChannelType.GuildText);
    const voice = createMockChannel(guild, '333333333', 'voice-chat', ChannelType.GuildVoice);
    const category = createMockChannel(guild, '444444444', 'Text Channels', ChannelType.GuildCategory);
    const forum = createMockChannel(guild, '555555550', 'forum-chat', ChannelType.GuildForum);
    const stage = createMockChannel(guild, '555555551', 'stage-talk', ChannelType.GuildStageVoice);
    guild.channels.cache.set('111111111', general);
    guild.channels.cache.set('222222222', announcements);
    guild.channels.cache.set('333333333', voice);
    guild.channels.cache.set('444444444', category);
    guild.channels.cache.set('555555550', forum);
    guild.channels.cache.set('555555551', stage);

    // Roles
    const adminRole = createMockRole(guild, '555555555', 'Admin', 10);
    const modRole = createMockRole(guild, '666666666', 'Moderator', 5);
    const memberRole = createMockRole(guild, '777777777', 'Member', 1);
    guild.roles.cache.set('555555555', adminRole);
    guild.roles.cache.set('666666666', modRole);
    guild.roles.cache.set('777777777', memberRole);

    // Members
    const owner = createMockMember(guild, '999999999', 'Owner', ['Administrator']);
    const admin = createMockMember(guild, '888888888', 'AdminUser', ['Administrator']);
    const mod = createMockMember(guild, '700000000', 'ModUser', ['KickMembers', 'BanMembers']);
    const user = createMockMember(guild, '600000000', 'RegularUser', []);
    const bot = createMockMember(guild, '100000000', 'Ultron', ['Administrator']);
    guild.members.cache.set('999999999', owner);
    guild.members.cache.set('888888888', admin);
    guild.members.cache.set('700000000', mod);
    guild.members.cache.set('600000000', user);
    guild.members.cache.set('100000000', bot);
    guild.members.me = bot;

    // Seed some messages in general
    const msg1 = createMockMsg('msg-001', 'Owner', 'Hello world', general, guild);
    const msg2 = createMockMsg('msg-002', 'Ultron', 'I am online.', general, guild);
    msg2.author.id = '100000000'; // bot's message
    const msg3 = createMockMsg('msg-003', 'RegularUser', 'Test message', general, guild);
    general.messages.cache.set('msg-001', msg1);
    general.messages.cache.set('msg-002', msg2);
    general.messages.cache.set('msg-003', msg3);

    return {
        guild,
        channels: { general, announcements, voice, category, forum, stage },
        roles: { adminRole, modRole, memberRole },
        members: { owner, admin, mod, user, bot }
    };
}

// Helper: create a message object for executeTool
function createMessage(env, member) {
    return {
        guild: env.guild,
        channel: env.channels.general,
        member: member,
        author: member.user
    };
}

module.exports = { createMockEnvironment, createMessage, createMockGuild, createMockChannel, createMockMember, createMockRole, createMockMsg };
