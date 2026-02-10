const crypto = require('crypto');
const { AuditLogEvent, PermissionFlagsBits, ChannelType, OverwriteType } = require('discord.js');
const config = require('../config');
const store = require('./store');
const { createLogger } = require('./logger');

const log = createLogger('Security');

// ── Tunables ──

const securityCfg = config.security || {};

const SNAPSHOT_INTERVAL_MS = securityCfg.snapshotIntervalMs ?? (5 * 60 * 1000);
const SNAPSHOT_RETENTION = securityCfg.snapshotRetention ?? 10;
const SNAPSHOT_INCLUDE_MEMBERS = securityCfg.snapshotIncludeMembers ?? true;
const ALERT_COOLDOWN_MS = securityCfg.alertCooldownMs ?? (5 * 60 * 1000);
const AUDIT_LOG_WINDOW_MS = securityCfg.auditLogWindowMs ?? 45000;

const RAID_JOIN_WINDOW_MS = securityCfg.raidJoinWindowMs ?? (2 * 60 * 1000);
const RAID_JOIN_THRESHOLD = securityCfg.raidJoinThreshold ?? 6;

const EVENT_WINDOW_MS = securityCfg.eventWindowMs ?? (60 * 1000);
const CHANNEL_DELETE_THRESHOLD = securityCfg.channelDeleteThreshold ?? 3;
const CHANNEL_CREATE_THRESHOLD = securityCfg.channelCreateThreshold ?? 6;
const CHANNEL_RENAME_THRESHOLD = securityCfg.channelRenameThreshold ?? 5;
const ROLE_DELETE_THRESHOLD = securityCfg.roleDeleteThreshold ?? 3;
const ROLE_CREATE_THRESHOLD = securityCfg.roleCreateThreshold ?? 4;
const ROLE_RENAME_THRESHOLD = securityCfg.roleRenameThreshold ?? 5;
const ROLE_PERM_CHANGE_THRESHOLD = securityCfg.rolePermChangeThreshold ?? 3;
const EMOJI_DELETE_THRESHOLD = securityCfg.emojiDeleteThreshold ?? 5;
const EMOJI_CREATE_THRESHOLD = securityCfg.emojiCreateThreshold ?? 8;
const EMOJI_RENAME_THRESHOLD = securityCfg.emojiRenameThreshold ?? 5;
const BAN_THRESHOLD = securityCfg.banThreshold ?? 3;

// Snapshot diff thresholds (for passive scans)
const DIFF_THRESHOLDS = {
    channelDelete: { min: 3, ratio: 0.25, absolute: 8 },
    channelCreate: { min: 5, ratio: 0.25, absolute: 10 },
    channelRename: { min: 5, ratio: 0.3, absolute: 10 },
    roleDelete: { min: 3, ratio: 0.25, absolute: 6 },
    roleCreate: { min: 4, ratio: 0.25, absolute: 8 },
    rolePerm: { min: 3, ratio: 0.25, absolute: 6 },
    roleRename: { min: 5, ratio: 0.3, absolute: 10 },
    emojiDelete: { min: 5, ratio: 0.5, absolute: 10 },
    emojiCreate: { min: 8, ratio: 0.5, absolute: 15 },
    emojiRename: { min: 5, ratio: 0.5, absolute: 10 }
};

// ── In-Memory State ──

const snapshotCache = new Map();
const baselineReady = new Set();
const alertCooldowns = new Map();

const joinEvents = new Map();
const channelDeleteEvents = new Map();
const channelCreateEvents = new Map();
const channelRenameEvents = new Map();
const roleDeleteEvents = new Map();
const roleCreateEvents = new Map();
const roleRenameEvents = new Map();
const rolePermEvents = new Map();
const emojiDeleteEvents = new Map();
const emojiCreateEvents = new Map();
const emojiRenameEvents = new Map();
const banEvents = new Map();

function pushEvent(map, guildId, windowMs) {
    const now = Date.now();
    const list = map.get(guildId) || [];
    list.push(now);
    while (list.length && list[0] < now - windowMs) list.shift();
    map.set(guildId, list);
    return list.length;
}

function shouldAlert(guildId, type) {
    const key = `${guildId}:${type}`;
    const now = Date.now();
    const last = alertCooldowns.get(key);
    if (last && now - last < ALERT_COOLDOWN_MS) return false;
    alertCooldowns.set(key, now);
    return true;
}

function isTrustedExecutor(guild, executorId) {
    if (!executorId) return true;
    if (executorId === guild.client.user?.id) return true;
    if (executorId === guild.ownerId) return true;
    if (securityCfg.trustedBotIds?.includes?.(executorId)) return true;
    try {
        const guildCfg = store.read(`guild-${guild.id}.json`, {});
        const admins = guildCfg.botAdmins || [];
        if (admins.includes(executorId)) return true;
    } catch (_) {}
    return false;
}

function pickSnapshotMessages(snapshot, channelId, channelName, limit = 2) {
    if (!snapshot?.messages) return [];
    const candidates = snapshot.messages.filter(m => m.content);
    const exact = candidates.filter(m => m.channelId === channelId);
    if (exact.length > 0) {
        return exact.slice(0, limit);
    }
    if (channelName && snapshot.channels) {
        const match = snapshot.channels.find(ch => ch.name?.toLowerCase() === channelName.toLowerCase());
        if (match) {
            return candidates.filter(m => m.channelId === match.id).slice(0, limit);
        }
    }
    return [];
}

async function ensureCriticalChannels(guild, reason, snapshot = null) {
    const results = [];
    const me = guild.members.me || guild.members.cache.get(guild.client.user.id);
    if (!me || !me.permissions.has(PermissionFlagsBits.ManageChannels)) return results;

    try {
        if (guild.channels.cache.size === 0) await guild.channels.fetch().catch(() => {});
    } catch (_) {}

    const ensureChannel = async (name, type) => {
        const existing = guild.channels.cache.find(ch =>
            ch.type === type && ch.name?.toLowerCase() === name.toLowerCase()
        );
        if (existing) return existing;

        try {
            return await guild.channels.create({
                name,
                type,
                reason: `Ultron security: ${reason}`
            });
        } catch (_) {
            if (type !== ChannelType.GuildText) {
                return await guild.channels.create({
                    name,
                    type: ChannelType.GuildText,
                    reason: `Ultron security: ${reason}`
                }).catch(() => null);
            }
            return null;
        }
    };

    const latestSnapshot = snapshot || store.getLatestGuildSnapshot(guild.id);

    if (securityCfg.restoreRulesChannel) {
        const rulesName = securityCfg.rulesChannelName || 'rules';
        const rulesChannel = await ensureChannel(rulesName, ChannelType.GuildText);
        if (rulesChannel) {
            const storedMessages = pickSnapshotMessages(latestSnapshot, rulesChannel.id, rulesName, 2);
            if (storedMessages.length > 0) {
                for (const msg of storedMessages) {
                    await rulesChannel.send(msg.content).catch(() => {});
                }
            } else if (securityCfg.rulesMessage) {
                await rulesChannel.send(securityCfg.rulesMessage).catch(() => {});
            }
            if (me.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await guild.setRulesChannel(rulesChannel).catch(() => {});
            }
            results.push(`Rules channel ensured: #${rulesChannel.name}`);
        }
    }

    if (securityCfg.restoreAnnouncementsChannel) {
        const annName = securityCfg.announcementsChannelName || 'announcements';
        const annChannel = await ensureChannel(annName, ChannelType.GuildAnnouncement);
        if (annChannel) {
            const storedMessages = pickSnapshotMessages(latestSnapshot, annChannel.id, annName, 2);
            if (storedMessages.length > 0) {
                for (const msg of storedMessages) {
                    await annChannel.send(msg.content).catch(() => {});
                }
            } else if (securityCfg.announcementsMessage) {
                await annChannel.send(securityCfg.announcementsMessage).catch(() => {});
            }
            if (securityCfg.setSystemChannelToAnnouncements && me.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await guild.setSystemChannel(annChannel).catch(() => {});
            }
            results.push(`Announcements channel ensured: #${annChannel.name}`);
        }
    }

    return results;
}

async function fetchLatestAuditEntry(guild, type) {
    try {
        const me = guild.members.me || guild.members.cache.get(guild.client.user.id);
        if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
        const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
        const entries = logs?.entries;
        if (!entries) return null;
        const now = Date.now();
        for (const [, entry] of entries) {
            if (!entry?.executor) continue;
            if (now - entry.createdTimestamp > AUDIT_LOG_WINDOW_MS) continue;
            return entry;
        }
        return null;
    } catch (_) {
        return null;
    }
}

// ── Snapshot Build + Diff ──

function computeChecksum(snapshot) {
    const lines = [];
    lines.push([
        'g',
        snapshot.name || '',
        snapshot.description || '',
        snapshot.banner || '',
        snapshot.splash || '',
        snapshot.discoverySplash || '',
        snapshot.vanityURLCode || '',
        snapshot.nsfwLevel || '',
        snapshot.mfaLevel || '',
        snapshot.ownerId || '',
        snapshot.verificationLevel || '',
        snapshot.defaultNotifications || '',
        snapshot.explicitContentFilter || '',
        snapshot.preferredLocale || '',
        snapshot.premiumTier ?? '',
        snapshot.systemChannelId || '',
        snapshot.rulesChannelId || '',
        snapshot.afkChannelId || '',
        snapshot.afkTimeout ?? ''
    ].join('|'));

    const features = [...(snapshot.features || [])].sort();
    for (const feat of features) {
        lines.push(['f', feat].join('|'));
    }

    const channels = [...(snapshot.channels || [])].sort((a, b) => a.id.localeCompare(b.id));
    const roles = [...(snapshot.roles || [])].sort((a, b) => a.id.localeCompare(b.id));
    const emojis = [...(snapshot.emojis || [])].sort((a, b) => a.id.localeCompare(b.id));

    for (const ch of channels) {
        lines.push([
            'c', ch.id, ch.name, ch.type, ch.parentId || '',
            ch.position ?? '', ch.topic || '', ch.nsfw ? 1 : 0, ch.rateLimitPerUser ?? '',
            ch.bitrate ?? '', ch.userLimit ?? '', ch.rtcRegion || '', ch.defaultAutoArchiveDuration ?? '',
            ch.permissionsLocked ? 1 : 0, ch.flags || '', ch.defaultThreadRateLimitPerUser ?? '',
            ch.defaultReactionEmojiId || '', ch.defaultReactionEmojiName || '',
            ch.defaultSortOrder ?? '', ch.defaultForumLayout ?? '', ch.videoQualityMode ?? '',
            ch.archived ? 1 : 0, ch.autoArchiveDuration ?? '', ch.locked ? 1 : 0,
            ch.invitable ? 1 : 0, ch.archiveTimestamp || ''
        ].join('|'));
    }
    if (snapshot.channelTags) {
        const tags = [...snapshot.channelTags].sort((a, b) => {
            const keyA = `${a.channelId}:${a.tagId}`;
            const keyB = `${b.channelId}:${b.tagId}`;
            return keyA.localeCompare(keyB);
        });
        for (const tag of tags) {
            lines.push(['ct', tag.channelId, tag.tagId, tag.name || '', tag.moderated ? 1 : 0, tag.emojiId || '', tag.emojiName || ''].join('|'));
        }
    }
    for (const role of roles) {
        lines.push([
            'r', role.id, role.name, role.color ?? '', role.position ?? '',
            role.permissions || '', role.mentionable ? 1 : 0, role.hoist ? 1 : 0, role.managed ? 1 : 0,
            role.icon || '', role.unicodeEmoji || ''
        ].join('|'));
    }
    if (snapshot.roleTags) {
        const tags = [...snapshot.roleTags].sort((a, b) => {
            const keyA = `${a.roleId}:${a.tag}:${a.value || ''}`;
            const keyB = `${b.roleId}:${b.tag}:${b.value || ''}`;
            return keyA.localeCompare(keyB);
        });
        for (const tag of tags) {
            lines.push(['rt', tag.roleId, tag.tag || '', tag.value || ''].join('|'));
        }
    }
    for (const emoji of emojis) {
        lines.push(['e', emoji.id, emoji.name, emoji.animated ? 1 : 0, emoji.creatorId || '', emoji.createdAt || ''].join('|'));
    }

    if (snapshot.overwrites) {
        const overwrites = [...snapshot.overwrites].sort((a, b) => {
            const keyA = `${a.channelId}:${a.targetId}`;
            const keyB = `${b.channelId}:${b.targetId}`;
            return keyA.localeCompare(keyB);
        });
        for (const ow of overwrites) {
            lines.push([
                'o', ow.channelId, ow.targetId, ow.targetType || '',
                ow.allow || '', ow.deny || ''
            ].join('|'));
        }
    }

    if (snapshot.stickers) {
        const stickers = [...snapshot.stickers].sort((a, b) => a.id.localeCompare(b.id));
        for (const st of stickers) {
            lines.push(['s', st.id, st.name || '', st.description || '', st.tags || '', st.formatType ?? '', st.type ?? '', st.available ? 1 : 0, st.sortValue ?? ''].join('|'));
        }
    }

    if (snapshot.webhooks) {
        const webhooks = [...snapshot.webhooks].sort((a, b) => a.id.localeCompare(b.id));
        for (const wh of webhooks) {
            lines.push(['w', wh.id, wh.name || '', wh.channelId || '', wh.type ?? '', wh.avatar || '', wh.ownerId || '', wh.applicationId || ''].join('|'));
        }
    }

    if (snapshot.invites) {
        const invites = [...snapshot.invites].sort((a, b) => a.code.localeCompare(b.code));
        for (const inv of invites) {
            lines.push(['i', inv.code, inv.channelId || '', inv.maxUses ?? '', inv.maxAge ?? '', inv.temporary ? 1 : 0, inv.uses ?? '', inv.createdAt || '', inv.expiresAt || '', inv.targetType || '', inv.targetUserId || '', inv.targetApplicationId || ''].join('|'));
        }
    }

    if (snapshot.automod) {
        const automod = [...snapshot.automod].sort((a, b) => a.id.localeCompare(b.id));
        for (const rule of automod) {
            lines.push(['a', rule.id, rule.name || '', rule.enabled ? 1 : 0, rule.eventType || '', rule.triggerType || ''].join('|'));
        }
    }
    if (snapshot.automodActions) {
        const actions = [...snapshot.automodActions].sort((a, b) => {
            const keyA = `${a.ruleId}:${a.index ?? 0}`;
            const keyB = `${b.ruleId}:${b.index ?? 0}`;
            return keyA.localeCompare(keyB);
        });
        for (const act of actions) {
            lines.push(['aa', act.ruleId, act.index ?? '', act.type || '', act.channelId || '', act.durationSeconds ?? '', act.customMessage || ''].join('|'));
        }
    }
    if (snapshot.automodTriggerItems) {
        const items = [...snapshot.automodTriggerItems].sort((a, b) => {
            const keyA = `${a.ruleId}:${a.key}:${a.index ?? 0}:${a.value || ''}`;
            const keyB = `${b.ruleId}:${b.key}:${b.index ?? 0}:${b.value || ''}`;
            return keyA.localeCompare(keyB);
        });
        for (const item of items) {
            lines.push(['at', item.ruleId, item.key || '', item.index ?? '', item.value || ''].join('|'));
        }
    }
    if (snapshot.automodExemptRoles) {
        const roles = [...snapshot.automodExemptRoles].sort((a, b) => `${a.ruleId}:${a.roleId}`.localeCompare(`${b.ruleId}:${b.roleId}`));
        for (const entry of roles) {
            lines.push(['ar', entry.ruleId, entry.roleId].join('|'));
        }
    }
    if (snapshot.automodExemptChannels) {
        const channels = [...snapshot.automodExemptChannels].sort((a, b) => `${a.ruleId}:${a.channelId}`.localeCompare(`${b.ruleId}:${b.channelId}`));
        for (const entry of channels) {
            lines.push(['ac', entry.ruleId, entry.channelId].join('|'));
        }
    }

    if (snapshot.events) {
        const events = [...snapshot.events].sort((a, b) => a.id.localeCompare(b.id));
        for (const ev of events) {
            lines.push(['e2', ev.id, ev.name || '', ev.startTime || '', ev.endTime || '', ev.entityType || '', ev.status || '', ev.channelId || '', ev.privacyLevel || '', ev.creatorId || '', ev.image || ''].join('|'));
        }
    }

    if (snapshot.members) {
        const members = [...snapshot.members].sort((a, b) => a.userId.localeCompare(b.userId));
        for (const m of members) {
            lines.push(['m', m.userId, m.nick || '', m.joinedAt || '', m.bot ? 1 : 0, m.pending ? 1 : 0, m.communicationDisabledUntil || '', m.avatar || ''].join('|'));
        }
    }
    if (snapshot.memberRoles) {
        const roles = [...snapshot.memberRoles].sort((a, b) => `${a.userId}:${a.roleId}`.localeCompare(`${b.userId}:${b.roleId}`));
        for (const mr of roles) {
            lines.push(['mr', mr.userId, mr.roleId].join('|'));
        }
    }

    return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

async function buildSnapshot(guild) {
    try {
        if (guild.channels.cache.size === 0) await guild.channels.fetch().catch(() => {});
        if (guild.roles.cache.size === 0) await guild.roles.fetch().catch(() => {});
        if (guild.emojis.cache.size === 0) await guild.emojis.fetch().catch(() => {});
        if (guild.stickers?.cache?.size === 0) await guild.stickers.fetch().catch(() => {});
        if (SNAPSHOT_INCLUDE_MEMBERS) await guild.members.fetch().catch(() => {});
    } catch (_) {}

    let vanityURLCode = guild.vanityURLCode || null;
    if (!vanityURLCode && guild.features?.includes?.('VANITY_URL') &&
        guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        try {
            const vanity = await guild.fetchVanityData();
            vanityURLCode = vanity?.code || null;
        } catch (_) {}
    }

    const channelTags = [];
    const channels = guild.channels.cache.map(ch => {
        if (Array.isArray(ch.availableTags)) {
            for (const tag of ch.availableTags) {
                channelTags.push({
                    channelId: ch.id,
                    tagId: tag.id,
                    name: tag.name || null,
                    moderated: !!tag.moderated,
                    emojiId: tag.emoji?.id || null,
                    emojiName: tag.emoji?.name || null
                });
            }
        }

        const threadMeta = ch.threadMetadata || null;
        const defaultReaction = ch.defaultReactionEmoji || null;

        return {
            id: ch.id,
            name: ch.name,
            type: ch.type,
            parentId: ch.parentId || null,
            position: ch.position ?? null,
            topic: ch.topic || null,
            nsfw: !!ch.nsfw,
            rateLimitPerUser: ch.rateLimitPerUser ?? null,
            bitrate: ch.bitrate ?? null,
            userLimit: ch.userLimit ?? null,
            rtcRegion: ch.rtcRegion || null,
            defaultAutoArchiveDuration: ch.defaultAutoArchiveDuration ?? null,
            permissionsLocked: ch.permissionsLocked ?? null,
            flags: ch.flags?.bitfield?.toString?.() || null,
            defaultThreadRateLimitPerUser: ch.defaultThreadRateLimitPerUser ?? null,
            defaultReactionEmojiId: defaultReaction?.id || null,
            defaultReactionEmojiName: defaultReaction?.name || null,
            defaultSortOrder: ch.defaultSortOrder ?? null,
            defaultForumLayout: ch.defaultForumLayout ?? null,
            videoQualityMode: ch.videoQualityMode ?? null,
            archived: threadMeta?.archived ?? null,
            autoArchiveDuration: threadMeta?.autoArchiveDuration ?? null,
            locked: threadMeta?.locked ?? null,
            invitable: threadMeta?.invitable ?? null,
            archiveTimestamp: threadMeta?.archiveTimestamp || null
        };
    });

    const roleTags = [];
    const roles = guild.roles.cache.map(role => {
        const tags = role.tags;
        if (tags) {
            const entries = [
                ['botId', tags.botId],
                ['integrationId', tags.integrationId],
                ['premiumSubscriberRole', tags.premiumSubscriberRole],
                ['subscriptionListingId', tags.subscriptionListingId],
                ['availableForPurchase', tags.availableForPurchase],
                ['guildConnections', tags.guildConnections]
            ];
            for (const [tag, value] of entries) {
                if (value !== null && value !== undefined) {
                    roleTags.push({ roleId: role.id, tag, value: String(value) });
                }
            }
        }

        return {
            id: role.id,
            name: role.name,
            color: role.color ?? null,
            position: role.position ?? null,
            permissions: role.permissions?.bitfield?.toString?.() || null,
            mentionable: !!role.mentionable,
            hoist: !!role.hoist,
            managed: !!role.managed,
            icon: role.icon || null,
            unicodeEmoji: role.unicodeEmoji || null
        };
    });

    const emojis = guild.emojis.cache.map(emoji => ({
        id: emoji.id,
        name: emoji.name,
        animated: !!emoji.animated,
        creatorId: emoji.author?.id || null,
        createdAt: emoji.createdTimestamp ? new Date(emoji.createdTimestamp).toISOString() : null
    }));

    const overwrites = [];
    for (const [, channel] of guild.channels.cache) {
        const perms = channel.permissionOverwrites?.cache;
        if (!perms) continue;
        for (const [, overwrite] of perms) {
            overwrites.push({
                channelId: channel.id,
                targetId: overwrite.id,
                targetType: overwrite.type === OverwriteType.Member ? 'member' : 'role',
                allow: overwrite.allow?.bitfield?.toString?.() || null,
                deny: overwrite.deny?.bitfield?.toString?.() || null
            });
        }
    }

    const stickers = [];
    if (guild.stickers?.cache) {
        for (const [, sticker] of guild.stickers.cache) {
            stickers.push({
                id: sticker.id,
                name: sticker.name,
                description: sticker.description || null,
                tags: sticker.tags || null,
                formatType: sticker.formatType,
                type: sticker.type ?? null,
                available: sticker.available ?? null,
                sortValue: sticker.sortValue ?? null
            });
        }
    }

    let webhooks = [];
    if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageWebhooks)) {
        try {
            const hooks = await guild.fetchWebhooks();
            webhooks = hooks.map(h => ({
                id: h.id,
                name: h.name,
                channelId: h.channelId || null,
                type: h.type ?? null,
                avatar: h.avatar || null,
                ownerId: h.owner?.id || null,
                applicationId: h.applicationId || null
            }));
        } catch (_) {}
    }

    let invites = [];
    if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        try {
            const fetched = await guild.invites.fetch();
            invites = fetched.map(inv => ({
                code: inv.code,
                channelId: inv.channel?.id || null,
                maxUses: inv.maxUses ?? null,
                maxAge: inv.maxAge ?? null,
                temporary: !!inv.temporary,
                uses: inv.uses ?? null,
                createdBy: inv.inviter?.id || null,
                createdAt: inv.createdTimestamp ? new Date(inv.createdTimestamp).toISOString() : null,
                expiresAt: inv.expiresTimestamp ? new Date(inv.expiresTimestamp).toISOString() : null,
                targetType: inv.targetType ? String(inv.targetType) : null,
                targetUserId: inv.targetUser?.id || null,
                targetApplicationId: inv.targetApplication?.id || null
            }));
        } catch (_) {}
    }

    let automod = [];
    let automodActions = [];
    let automodTriggerItems = [];
    let automodExemptRoles = [];
    let automodExemptChannels = [];
    if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        try {
            const rules = await guild.autoModerationRules.fetch();
            automod = rules.map(rule => ({
                id: rule.id,
                name: rule.name,
                enabled: !!rule.enabled,
                eventType: String(rule.eventType),
                triggerType: String(rule.triggerType)
            }));

            for (const [, rule] of rules) {
                const triggerMeta = rule.triggerMetadata || {};
                for (const [key, value] of Object.entries(triggerMeta)) {
                    if (Array.isArray(value)) {
                        value.forEach((item, idx) => {
                            if (item === undefined || item === null) return;
                            automodTriggerItems.push({
                                ruleId: rule.id,
                                key,
                                index: idx,
                                value: String(item)
                            });
                        });
                    } else if (value !== undefined && value !== null) {
                        automodTriggerItems.push({
                            ruleId: rule.id,
                            key,
                            index: 0,
                            value: String(value)
                        });
                    }
                }

                const actions = Array.isArray(rule.actions) ? rule.actions : [];
                actions.forEach((action, idx) => {
                    const meta = action.metadata || {};
                    automodActions.push({
                        ruleId: rule.id,
                        index: idx,
                        type: action.type ? String(action.type) : null,
                        channelId: meta.channelId || null,
                        durationSeconds: meta.durationSeconds ?? null,
                        customMessage: meta.customMessage || null
                    });
                });

                for (const role of rule.exemptRoles || []) {
                    const roleId = role?.id || role;
                    if (roleId) automodExemptRoles.push({ ruleId: rule.id, roleId });
                }
                for (const channel of rule.exemptChannels || []) {
                    const channelId = channel?.id || channel;
                    if (channelId) automodExemptChannels.push({ ruleId: rule.id, channelId });
                }
            }
        } catch (_) {}
    }

    let events = [];
    try {
        const fetchedEvents = await guild.scheduledEvents.fetch();
        events = fetchedEvents.map(ev => ({
            id: ev.id,
            name: ev.name,
            description: ev.description || null,
            startTime: ev.scheduledStartTimestamp ? new Date(ev.scheduledStartTimestamp).toISOString() : null,
            endTime: ev.scheduledEndTimestamp ? new Date(ev.scheduledEndTimestamp).toISOString() : null,
            entityType: String(ev.entityType),
            status: String(ev.status),
            location: ev.entityMetadata?.location || null,
            channelId: ev.channelId || null,
            privacyLevel: ev.privacyLevel ? String(ev.privacyLevel) : null,
            creatorId: ev.creatorId || ev.creator?.id || null,
            image: ev.image || null
        }));
    } catch (_) {}

    const messages = [];
    const captureChannelIds = new Set();
    if (guild.rulesChannelId) captureChannelIds.add(guild.rulesChannelId);
    const annName = (securityCfg.announcementsChannelName || 'announcements').toLowerCase();
    for (const [, channel] of guild.channels.cache) {
        if (channel.name?.toLowerCase() === annName) captureChannelIds.add(channel.id);
    }
    if (guild.systemChannelId) captureChannelIds.add(guild.systemChannelId);

    for (const channelId of captureChannelIds) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased?.()) continue;
        try {
            const fetched = await channel.messages.fetch({ limit: 5 });
            let added = 0;
            for (const [, msg] of fetched) {
                if (!msg.content) continue;
                messages.push({
                    channelId,
                    messageId: msg.id,
                    authorId: msg.author?.id || null,
                    content: msg.content.slice(0, 2000),
                    createdAt: msg.createdTimestamp ? new Date(msg.createdTimestamp).toISOString() : null
                });
                added += 1;
                if (added >= 3) break;
            }
        } catch (_) {}
    }

    const members = [];
    const memberRoles = [];
    if (SNAPSHOT_INCLUDE_MEMBERS) {
        try {
            for (const [, member] of guild.members.cache) {
                members.push({
                    userId: member.id,
                    nick: member.nickname || null,
                    joinedAt: member.joinedTimestamp ? new Date(member.joinedTimestamp).toISOString() : null,
                    bot: !!member.user?.bot,
                    pending: !!member.pending,
                    communicationDisabledUntil: member.communicationDisabledUntilTimestamp
                        ? new Date(member.communicationDisabledUntilTimestamp).toISOString()
                        : null,
                    avatar: member.avatar || null
                });

                for (const [, role] of member.roles.cache) {
                    if (!role?.id) continue;
                    if (role.id === guild.id) continue;
                    memberRoles.push({ userId: member.id, roleId: role.id });
                }
            }
        } catch (_) {}
    }

    const snapshot = {
        guildId: guild.id,
        createdAt: new Date().toISOString(),
        name: guild.name,
        icon: guild.iconURL() || null,
        description: guild.description || null,
        banner: guild.banner || null,
        splash: guild.splash || null,
        discoverySplash: guild.discoverySplash || null,
        vanityURLCode,
        nsfwLevel: guild.nsfwLevel ? String(guild.nsfwLevel) : null,
        mfaLevel: guild.mfaLevel ? String(guild.mfaLevel) : null,
        ownerId: guild.ownerId || null,
        verificationLevel: String(guild.verificationLevel),
        defaultNotifications: String(guild.defaultMessageNotifications),
        explicitContentFilter: String(guild.explicitContentFilter),
        preferredLocale: guild.preferredLocale || null,
        premiumTier: guild.premiumTier ?? null,
        systemChannelId: guild.systemChannelId || null,
        rulesChannelId: guild.rulesChannelId || null,
        afkChannelId: guild.afkChannelId || null,
        afkTimeout: guild.afkTimeout ?? null,
        memberCount: guild.memberCount ?? null,
        channelCount: channels.length,
        roleCount: roles.length,
        emojiCount: emojis.length,
        features: Array.isArray(guild.features) ? [...guild.features] : [],
        channels,
        channelTags,
        roles,
        roleTags,
        emojis,
        overwrites,
        stickers,
        webhooks,
        invites,
        automod,
        automodActions,
        automodTriggerItems,
        automodExemptRoles,
        automodExemptChannels,
        events,
        messages,
        members,
        memberRoles
    };
    snapshot.checksum = computeChecksum(snapshot);
    return snapshot;
}

function indexById(list, key = 'id') {
    const map = new Map();
    for (const item of list) map.set(item[key], item);
    return map;
}

function diffSnapshots(prev, next) {
    const diff = {
        channelDeleted: [],
        channelCreated: [],
        channelRenamed: [],
        roleDeleted: [],
        roleCreated: [],
        roleRenamed: [],
        rolePermChanged: [],
        emojiDeleted: [],
        emojiCreated: [],
        emojiRenamed: []
    };

    const prevChannels = indexById(prev.channels || []);
    const nextChannels = indexById(next.channels || []);
    for (const [id, oldCh] of prevChannels) {
        const newer = nextChannels.get(id);
        if (!newer) diff.channelDeleted.push(oldCh);
        else if (oldCh.name !== newer.name) diff.channelRenamed.push({ id, from: oldCh.name, to: newer.name });
    }
    for (const [id, newCh] of nextChannels) {
        if (!prevChannels.has(id)) diff.channelCreated.push(newCh);
    }

    const prevRoles = indexById(prev.roles || [], 'id');
    const nextRoles = indexById(next.roles || [], 'id');
    for (const [id, oldRole] of prevRoles) {
        const newer = nextRoles.get(id);
        if (!newer) diff.roleDeleted.push(oldRole);
        else {
            if (oldRole.name !== newer.name) diff.roleRenamed.push({ id, from: oldRole.name, to: newer.name });
            if ((oldRole.permissions || '') !== (newer.permissions || '')) diff.rolePermChanged.push({ id, from: oldRole.permissions, to: newer.permissions });
        }
    }
    for (const [id, newRole] of nextRoles) {
        if (!prevRoles.has(id)) diff.roleCreated.push(newRole);
    }

    const prevEmojis = indexById(prev.emojis || [], 'id');
    const nextEmojis = indexById(next.emojis || [], 'id');
    for (const [id, oldEmoji] of prevEmojis) {
        const newer = nextEmojis.get(id);
        if (!newer) diff.emojiDeleted.push(oldEmoji);
        else if (oldEmoji.name !== newer.name) diff.emojiRenamed.push({ id, from: oldEmoji.name, to: newer.name });
    }
    for (const [id, newEmoji] of nextEmojis) {
        if (!prevEmojis.has(id)) diff.emojiCreated.push(newEmoji);
    }

    return diff;
}

function exceedsThreshold(count, total, { min, ratio, absolute }) {
    if (count >= absolute) return true;
    if (total <= 0) return false;
    return count >= min && (count / total) >= ratio;
}

function evaluateDiff(diff, prev) {
    const triggers = [];
    const channelTotal = prev.channelCount || (prev.channels ? prev.channels.length : 0);
    const roleTotal = prev.roleCount || (prev.roles ? prev.roles.length : 0);
    const emojiTotal = prev.emojiCount || (prev.emojis ? prev.emojis.length : 0);

    if (exceedsThreshold(diff.channelDeleted.length, channelTotal, DIFF_THRESHOLDS.channelDelete)) {
        triggers.push({
            type: 'channel-delete',
            severity: 'critical',
            summary: `${diff.channelDeleted.length} channel(s) deleted`,
            details: `Detected via snapshot diff. Previous count: ${channelTotal}.`
        });
    }
    if (exceedsThreshold(diff.channelCreated.length, channelTotal, DIFF_THRESHOLDS.channelCreate)) {
        triggers.push({
            type: 'channel-create',
            severity: 'high',
            summary: `${diff.channelCreated.length} channel(s) created`,
            details: `Detected via snapshot diff. Previous count: ${channelTotal}.`
        });
    }
    if (exceedsThreshold(diff.channelRenamed.length, channelTotal, DIFF_THRESHOLDS.channelRename)) {
        triggers.push({
            type: 'channel-rename',
            severity: 'high',
            summary: `${diff.channelRenamed.length} channel(s) renamed`,
            details: `Detected via snapshot diff. Previous count: ${channelTotal}.`
        });
    }

    if (exceedsThreshold(diff.roleDeleted.length, roleTotal, DIFF_THRESHOLDS.roleDelete)) {
        triggers.push({
            type: 'role-delete',
            severity: 'critical',
            summary: `${diff.roleDeleted.length} role(s) deleted`,
            details: `Detected via snapshot diff. Previous count: ${roleTotal}.`
        });
    }
    if (exceedsThreshold(diff.roleCreated.length, roleTotal, DIFF_THRESHOLDS.roleCreate)) {
        triggers.push({
            type: 'role-create',
            severity: 'high',
            summary: `${diff.roleCreated.length} role(s) created`,
            details: `Detected via snapshot diff. Previous count: ${roleTotal}.`
        });
    }
    if (exceedsThreshold(diff.roleRenamed.length, roleTotal, DIFF_THRESHOLDS.roleRename)) {
        triggers.push({
            type: 'role-rename',
            severity: 'high',
            summary: `${diff.roleRenamed.length} role(s) renamed`,
            details: `Detected via snapshot diff. Previous count: ${roleTotal}.`
        });
    }
    if (exceedsThreshold(diff.rolePermChanged.length, roleTotal, DIFF_THRESHOLDS.rolePerm)) {
        triggers.push({
            type: 'role-permissions',
            severity: 'critical',
            summary: `${diff.rolePermChanged.length} role permission change(s)`,
            details: `Detected via snapshot diff. Previous count: ${roleTotal}.`
        });
    }

    if (exceedsThreshold(diff.emojiDeleted.length, emojiTotal, DIFF_THRESHOLDS.emojiDelete)) {
        triggers.push({
            type: 'emoji-delete',
            severity: 'medium',
            summary: `${diff.emojiDeleted.length} emoji(s) deleted`,
            details: `Detected via snapshot diff. Previous count: ${emojiTotal}.`
        });
    }
    if (exceedsThreshold(diff.emojiCreated.length, emojiTotal, DIFF_THRESHOLDS.emojiCreate)) {
        triggers.push({
            type: 'emoji-create',
            severity: 'medium',
            summary: `${diff.emojiCreated.length} emoji(s) created`,
            details: `Detected via snapshot diff. Previous count: ${emojiTotal}.`
        });
    }
    if (exceedsThreshold(diff.emojiRenamed.length, emojiTotal, DIFF_THRESHOLDS.emojiRename)) {
        triggers.push({
            type: 'emoji-rename',
            severity: 'medium',
            summary: `${diff.emojiRenamed.length} emoji(s) renamed`,
            details: `Detected via snapshot diff. Previous count: ${emojiTotal}.`
        });
    }

    return triggers;
}

// ── Alerts ──

async function fetchAuditActor(guild, type) {
    const entry = await fetchLatestAuditEntry(guild, type);
    if (!entry || !entry.executor) return null;
    return `${entry.executor.tag} (${entry.executor.id})`;
}

async function maybeAutoMitigate(guild, auditType, severity, entry = null) {
    if (!securityCfg.autoKickBots && !securityCfg.autoBanBots) return null;
    const auditEntry = entry || await fetchLatestAuditEntry(guild, auditType);
    if (!auditEntry || !auditEntry.executor || !auditEntry.executor.bot) return null;

    const executorId = auditEntry.executor.id;
    if (isTrustedExecutor(guild, executorId)) return null;

    const me = guild.members.me || guild.members.cache.get(guild.client.user.id);
    if (!me) return null;

    const targetMember = await guild.members.fetch(executorId).catch(() => null);
    if (!targetMember) return null;

    let action = null;
    if (securityCfg.autoBanBots && me.permissions.has(PermissionFlagsBits.BanMembers)) {
        await targetMember.ban({ reason: `Ultron security: ${severity} event detected` }).catch(() => null);
        action = `Auto-banned ${auditEntry.executor.tag} (${executorId}).`;
    } else if (securityCfg.autoKickBots && me.permissions.has(PermissionFlagsBits.KickMembers)) {
        await targetMember.kick(`Ultron security: ${severity} event detected`).catch(() => null);
        action = `Auto-kicked ${auditEntry.executor.tag} (${executorId}).`;
    }

    if (action) {
        store.logSecurityEvent(guild.id, 'auto-mitigation', 'info', action, `Audit type: ${auditType}`);
    }
    return action;
}

async function maybeAutoMitigateBotJoin(member, severity) {
    if (!member?.user?.bot) return null;
    if (isTrustedExecutor(member.guild, member.id)) return null;

    const guild = member.guild;
    const me = guild.members.me || guild.members.cache.get(guild.client.user.id);
    if (!me) return null;

    let action = null;
    if (securityCfg.autoBanBots && me.permissions.has(PermissionFlagsBits.BanMembers)) {
        await member.ban({ reason: `Ultron security: ${severity} join surge` }).catch(() => null);
        action = `Auto-banned ${member.user.tag} (${member.id}).`;
    } else if (securityCfg.autoKickBots && me.permissions.has(PermissionFlagsBits.KickMembers)) {
        await member.kick(`Ultron security: ${severity} join surge`).catch(() => null);
        action = `Auto-kicked ${member.user.tag} (${member.id}).`;
    }

    if (action) {
        store.logSecurityEvent(guild.id, 'auto-mitigation', 'info', action, 'Triggered by join surge.');
    }
    return action;
}

async function sendAlert(guild, payload) {
    const guildConfig = store.read(`guild-${guild.id}.json`, {});

    const header = `**[Ultron Security Alert]**`;
    const body = `**Type:** ${payload.type}\n**Severity:** ${payload.severity}\n**Summary:** ${payload.summary}${payload.details ? `\n**Details:** ${payload.details}` : ''}\n**Time:** ${new Date().toISOString()}`;
    const content = `${header}\n${body}`;

    const recipients = new Map();
    const owner = await guild.fetchOwner().catch(() => null);
    if (owner?.user) recipients.set(owner.id, owner.user);

    const botAdmins = guildConfig.botAdmins || [];
    for (const id of botAdmins) {
        if (recipients.has(id)) continue;
        const user = await guild.client.users.fetch(id).catch(() => null);
        if (user) recipients.set(id, user);
    }

    try {
        await guild.members.fetch().catch(() => {});
        const admins = guild.members.cache.filter(m =>
            !m.user.bot && m.permissions.has(PermissionFlagsBits.Administrator)
        );
        let added = 0;
        for (const [, member] of admins) {
            if (recipients.has(member.id)) continue;
            recipients.set(member.id, member.user);
            added += 1;
            if (added >= 10) break;
        }
    } catch (_) {}

    const sendTasks = [];
    for (const [, user] of recipients) {
        sendTasks.push(
            user.createDM()
                .then(dm => dm.send(content))
                .catch(() => {})
        );
    }
    await Promise.allSettled(sendTasks);
}

async function raiseAlert(guild, payload) {
    if (!shouldAlert(guild.id, payload.type)) return;
    let restoreNotes = '';
    if (payload.type.startsWith('channel-')) {
        const restored = await ensureCriticalChannels(guild, payload.type);
        if (restored.length > 0) restoreNotes = ` ${restored.join(' | ')}`;
    }
    store.logSecurityEvent(guild.id, payload.type, payload.severity, payload.summary, payload.details || null);
    const details = payload.details ? `${payload.details}${restoreNotes}` : (restoreNotes.trim() || null);
    await sendAlert(guild, { ...payload, details });
}

// ── Passive Snapshot Scan ──

async function runSnapshotScan(guild) {
    const previous = snapshotCache.get(guild.id) || store.getLatestGuildSnapshot(guild.id);
    const current = await buildSnapshot(guild);

    // Always persist first baseline snapshot
    if (!baselineReady.has(guild.id)) {
        if (previous && previous.checksum !== current.checksum) {
            const diff = diffSnapshots(previous, current);
            const triggers = evaluateDiff(diff, previous);
            for (const trigger of triggers) {
                await raiseAlert(guild, {
                    ...trigger,
                    details: `${trigger.details} Detected since last baseline (bot was offline).`
                });
            }
        }
        store.createGuildSnapshot(current);
        store.pruneGuildSnapshots(guild.id, SNAPSHOT_RETENTION);
        snapshotCache.set(guild.id, current);
        baselineReady.add(guild.id);
        return;
    }

    // Skip if unchanged
    if (previous && previous.checksum === current.checksum) return;

    // Persist new snapshot
    store.createGuildSnapshot(current);
    store.pruneGuildSnapshots(guild.id, SNAPSHOT_RETENTION);

    if (previous) {
        const diff = diffSnapshots(previous, current);
        const triggers = evaluateDiff(diff, previous);
        for (const trigger of triggers) {
            await raiseAlert(guild, trigger);
        }
    }

    snapshotCache.set(guild.id, current);
}

function startSecurityMonitor(client) {
    let scanRunning = false;
    const runScan = async () => {
        if (scanRunning) return;
        scanRunning = true;
        try {
            for (const [, guild] of client.guilds.cache) {
                try {
                    await runSnapshotScan(guild);
                } catch (err) {
                    log.warn(`Snapshot scan failed for ${guild.id}: ${err.message}`);
                }
            }
        } finally {
            scanRunning = false;
        }
    };

    setInterval(() => {
        runScan().catch(err => log.warn(`Snapshot scan loop failed: ${err.message}`));
    }, SNAPSHOT_INTERVAL_MS);

    // Initial baseline after startup
    runScan().catch(err => log.warn(`Initial snapshot scan failed: ${err.message}`));
}

// ── Event Handlers ──

async function handleMemberJoin(member) {
    const count = pushEvent(joinEvents, member.guild.id, RAID_JOIN_WINDOW_MS);
    if (count >= RAID_JOIN_THRESHOLD) {
        const mitigation = await maybeAutoMitigateBotJoin(member, 'high');
        const details = mitigation
            ? `Join spike detected. ${mitigation}`
            : 'Join spike detected. Consider enabling verification or lockdown.';
        await raiseAlert(member.guild, {
            type: 'raid-join',
            severity: 'high',
            summary: `${count} joins in ${Math.round(RAID_JOIN_WINDOW_MS / 60000)} minute(s)`,
            details
        });
    }
}

async function handleChannelCreate(channel) {
    const guild = channel.guild;
    const count = pushEvent(channelCreateEvents, guild.id, EVENT_WINDOW_MS);
    if (count >= CHANNEL_CREATE_THRESHOLD) {
        const entry = await fetchLatestAuditEntry(guild, AuditLogEvent.ChannelCreate);
        const actor = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : null;
        const mitigation = await maybeAutoMitigate(guild, AuditLogEvent.ChannelCreate, 'high', entry);
        const details = [actor ? `Last executor: ${actor}` : 'Check audit logs for executor.', mitigation]
            .filter(Boolean)
            .join(' ');
        await raiseAlert(guild, {
            type: 'channel-create',
            severity: 'high',
            summary: `${count} channels created in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
            details
        });
    }
}

async function handleChannelDelete(channel) {
    const guild = channel.guild;
    const count = pushEvent(channelDeleteEvents, guild.id, EVENT_WINDOW_MS);
    if (count >= CHANNEL_DELETE_THRESHOLD) {
        const entry = await fetchLatestAuditEntry(guild, AuditLogEvent.ChannelDelete);
        const actor = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : null;
        const mitigation = await maybeAutoMitigate(guild, AuditLogEvent.ChannelDelete, 'critical', entry);
        const details = [actor ? `Last executor: ${actor}` : 'Check audit logs for executor.', mitigation]
            .filter(Boolean)
            .join(' ');
        await raiseAlert(guild, {
            type: 'channel-delete',
            severity: 'critical',
            summary: `${count} channels deleted in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
            details
        });
    }
}

async function handleChannelUpdate(oldChannel, newChannel) {
    if (oldChannel?.name === newChannel?.name) return;
    const guild = newChannel.guild;
    const count = pushEvent(channelRenameEvents, guild.id, EVENT_WINDOW_MS);
    if (count >= CHANNEL_RENAME_THRESHOLD) {
        const entry = await fetchLatestAuditEntry(guild, AuditLogEvent.ChannelUpdate);
        const actor = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : null;
        const mitigation = await maybeAutoMitigate(guild, AuditLogEvent.ChannelUpdate, 'high', entry);
        const details = [actor ? `Last executor: ${actor}` : 'Check audit logs for executor.', mitigation]
            .filter(Boolean)
            .join(' ');
        await raiseAlert(guild, {
            type: 'channel-rename',
            severity: 'high',
            summary: `${count} channel renames in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
            details
        });
    }
}

async function handleRoleCreate(role) {
    const guild = role.guild;
    const count = pushEvent(roleCreateEvents, guild.id, EVENT_WINDOW_MS);
    if (count >= ROLE_CREATE_THRESHOLD) {
        const entry = await fetchLatestAuditEntry(guild, AuditLogEvent.RoleCreate);
        const actor = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : null;
        const mitigation = await maybeAutoMitigate(guild, AuditLogEvent.RoleCreate, 'high', entry);
        const details = [actor ? `Last executor: ${actor}` : 'Check audit logs for executor.', mitigation]
            .filter(Boolean)
            .join(' ');
        await raiseAlert(guild, {
            type: 'role-create',
            severity: 'high',
            summary: `${count} roles created in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
            details
        });
    }
}

async function handleRoleDelete(role) {
    const guild = role.guild;
    const count = pushEvent(roleDeleteEvents, guild.id, EVENT_WINDOW_MS);
    if (count >= ROLE_DELETE_THRESHOLD) {
        const entry = await fetchLatestAuditEntry(guild, AuditLogEvent.RoleDelete);
        const actor = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : null;
        const mitigation = await maybeAutoMitigate(guild, AuditLogEvent.RoleDelete, 'critical', entry);
        const details = [actor ? `Last executor: ${actor}` : 'Check audit logs for executor.', mitigation]
            .filter(Boolean)
            .join(' ');
        await raiseAlert(guild, {
            type: 'role-delete',
            severity: 'critical',
            summary: `${count} roles deleted in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
            details
        });
    }
}

async function handleRoleUpdate(oldRole, newRole) {
    const guild = newRole.guild;
    if (oldRole?.name !== newRole?.name) {
        const count = pushEvent(roleRenameEvents, guild.id, EVENT_WINDOW_MS);
        if (count >= ROLE_RENAME_THRESHOLD) {
            const entry = await fetchLatestAuditEntry(guild, AuditLogEvent.RoleUpdate);
            const actor = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : null;
            const mitigation = await maybeAutoMitigate(guild, AuditLogEvent.RoleUpdate, 'high', entry);
            const details = [actor ? `Last executor: ${actor}` : 'Check audit logs for executor.', mitigation]
                .filter(Boolean)
                .join(' ');
            await raiseAlert(guild, {
                type: 'role-rename',
                severity: 'high',
                summary: `${count} role renames in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
                details
            });
        }
    }
    const oldPerms = oldRole?.permissions?.bitfield?.toString?.() || oldRole?.permissions?.toString?.() || '';
    const newPerms = newRole?.permissions?.bitfield?.toString?.() || newRole?.permissions?.toString?.() || '';
    if (oldPerms !== newPerms) {
        const count = pushEvent(rolePermEvents, guild.id, EVENT_WINDOW_MS);
        if (count >= ROLE_PERM_CHANGE_THRESHOLD) {
            const entry = await fetchLatestAuditEntry(guild, AuditLogEvent.RoleUpdate);
            const actor = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : null;
            const mitigation = await maybeAutoMitigate(guild, AuditLogEvent.RoleUpdate, 'critical', entry);
            const details = [actor ? `Last executor: ${actor}` : 'Check audit logs for executor.', mitigation]
                .filter(Boolean)
                .join(' ');
            await raiseAlert(guild, {
                type: 'role-permissions',
                severity: 'critical',
                summary: `${count} role permission changes in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
                details
            });
        }
    }
}

async function handleEmojiCreate(emoji) {
    const guild = emoji.guild;
    const count = pushEvent(emojiCreateEvents, guild.id, EVENT_WINDOW_MS);
    if (count >= EMOJI_CREATE_THRESHOLD) {
        const actor = await fetchAuditActor(guild, AuditLogEvent.EmojiCreate);
        await raiseAlert(guild, {
            type: 'emoji-create',
            severity: 'medium',
            summary: `${count} emojis created in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
            details: actor ? `Last executor: ${actor}` : 'Check audit logs for executor.'
        });
    }
}

async function handleEmojiDelete(emoji) {
    const guild = emoji.guild;
    const count = pushEvent(emojiDeleteEvents, guild.id, EVENT_WINDOW_MS);
    if (count >= EMOJI_DELETE_THRESHOLD) {
        const actor = await fetchAuditActor(guild, AuditLogEvent.EmojiDelete);
        await raiseAlert(guild, {
            type: 'emoji-delete',
            severity: 'medium',
            summary: `${count} emojis deleted in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
            details: actor ? `Last executor: ${actor}` : 'Check audit logs for executor.'
        });
    }
}

async function handleEmojiUpdate(oldEmoji, newEmoji) {
    if (oldEmoji?.name === newEmoji?.name) return;
    const guild = newEmoji.guild;
    const count = pushEvent(emojiRenameEvents, guild.id, EVENT_WINDOW_MS);
    if (count >= EMOJI_RENAME_THRESHOLD) {
        const actor = await fetchAuditActor(guild, AuditLogEvent.EmojiUpdate);
        await raiseAlert(guild, {
            type: 'emoji-rename',
            severity: 'medium',
            summary: `${count} emoji renames in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
            details: actor ? `Last executor: ${actor}` : 'Check audit logs for executor.'
        });
    }
}

async function handleGuildBanAdd(ban) {
    const guild = ban.guild;
    const count = pushEvent(banEvents, guild.id, EVENT_WINDOW_MS);
    if (count >= BAN_THRESHOLD) {
        const entry = await fetchLatestAuditEntry(guild, AuditLogEvent.MemberBanAdd);
        const actor = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : null;
        const mitigation = await maybeAutoMitigate(guild, AuditLogEvent.MemberBanAdd, 'high', entry);
        const details = [actor ? `Last executor: ${actor}` : 'Check audit logs for executor.', mitigation]
            .filter(Boolean)
            .join(' ');
        await raiseAlert(guild, {
            type: 'member-ban',
            severity: 'high',
            summary: `${count} bans in ${Math.round(EVENT_WINDOW_MS / 1000)}s`,
            details
        });
    }
}

module.exports = {
    startSecurityMonitor,
    handleMemberJoin,
    handleChannelCreate,
    handleChannelDelete,
    handleChannelUpdate,
    handleRoleCreate,
    handleRoleDelete,
    handleRoleUpdate,
    handleEmojiCreate,
    handleEmojiDelete,
    handleEmojiUpdate,
    handleGuildBanAdd
};
