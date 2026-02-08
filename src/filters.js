const { PermissionsBitField } = require('discord.js');
const store = require('./store');
const { createLogger } = require('./logger');
const log = createLogger('Filter');

const MAX_PATTERN_LENGTH = 200;
const FILTER_TIMEOUT_MS = 5 * 60 * 1000;

// ── Regex Cache ──

const regexCache = new Map();

function getCachedRegex(pattern) {
    let cached = regexCache.get(pattern);
    if (cached) return cached;
    try {
        cached = new RegExp(pattern, 'i');
        regexCache.set(pattern, cached);
        return cached;
    } catch {
        return null;
    }
}

function invalidateRegexCache(pattern) {
    if (pattern) regexCache.delete(pattern);
    else regexCache.clear();
}

// ── Core Functions ──

function getFilters(guildId) {
    return store.read(`filters-${guildId}.json`, []);
}

function saveFilters(guildId, filters) {
    store.write(`filters-${guildId}.json`, filters);
}

function isRegexSafe(pattern) {
    if (pattern.length > MAX_PATTERN_LENGTH) return false;
    // Reject nested quantifiers (common ReDoS patterns)
    if (/(\+|\*)\s*\)?\s*(\+|\*|\{)/.test(pattern)) return false;
    try {
        const regex = new RegExp(pattern, 'i');
        const start = Date.now();
        regex.test('a'.repeat(100));
        return Date.now() - start < 50;
    } catch {
        return false;
    }
}

function addFilter(guildId, { pattern, action, reason, createdBy, bypassRoles }) {
    const filters = getFilters(guildId);
    // Validate regex
    try {
        new RegExp(pattern, 'i');
    } catch {
        return { success: false, error: 'Invalid regex pattern.' };
    }
    if (!isRegexSafe(pattern)) {
        return { success: false, error: 'Pattern rejected — too complex or potentially dangerous regex.' };
    }
    const id = filters.length > 0 ? Math.max(...filters.map(f => f.id)) + 1 : 1;
    const filter = {
        id,
        pattern,
        action: action || 'delete',
        reason: reason || 'Matched filter.',
        createdBy: createdBy || null,
        bypassRoles: bypassRoles || [],
        createdAt: new Date().toISOString()
    };
    filters.push(filter);
    saveFilters(guildId, filters);
    invalidateRegexCache(null); // Clear cache on filter change
    return { success: true, filter };
}

function removeFilter(guildId, filterId) {
    const filters = getFilters(guildId);
    const idx = filters.findIndex(f => f.id === filterId);
    if (idx === -1) return { success: false, error: 'Filter not found.' };
    const removed = filters.splice(idx, 1)[0];
    saveFilters(guildId, filters);
    invalidateRegexCache(removed.pattern);
    return { success: true, removed };
}

function testMessage(guildId, content) {
    const filters = getFilters(guildId);
    const matches = [];
    for (const filter of filters) {
        const regex = getCachedRegex(filter.pattern);
        if (regex && regex.test(content)) {
            matches.push(filter);
        }
    }
    return matches;
}

async function processMessage(message) {
    if (!message.guild) return false;
    if (message.author.bot) return false;

    // Admins bypass all filters
    if (message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return false;

    const filters = getFilters(message.guild.id);
    if (filters.length === 0) return false;

    const content = message.content;
    const memberRoles = message.member?.roles.cache.map(r => r.id) || [];

    // Read guild config once (used for bypass roles and modlog)
    const guildCfg = store.read(`guild-${message.guild.id}.json`, {});
    const bypassRoles = guildCfg.filterBypassRoles || [];
    if (bypassRoles.some(id => memberRoles.includes(id))) return false;

    for (const filter of filters) {
        // Check bypass roles
        if (filter.bypassRoles?.some(id => memberRoles.includes(id))) continue;

        const regex = getCachedRegex(filter.pattern);
        if (!regex || !regex.test(content)) continue;

        // Match found — execute action
        log.info(`Match: "${filter.pattern}" in guild ${message.guild.id} by ${message.author.username}`);

        switch (filter.action) {
            case 'delete':
                await message.delete().catch(() => {});
                try {
                    const dm = await message.author.createDM();
                    await dm.send(`Your message was removed in **${message.guild.name}**. Reason: ${filter.reason}`).catch(() => {});
                } catch { /* DMs closed */ }
                break;

            case 'warn':
                await message.reply({
                    content: `${message.author}, your message triggered a filter. ${filter.reason}`,
                    allowedMentions: { users: [message.author.id] }
                }).catch(() => {});
                break;

            case 'timeout': {
                if (message.member?.moderatable) {
                    await message.member.timeout(FILTER_TIMEOUT_MS, filter.reason).catch(() => {});
                }
                await message.delete().catch(() => {});
                break;
            }

            case 'log': {
                if (guildCfg.modLogChannel) {
                    const logChannel = message.guild.channels.cache.get(guildCfg.modLogChannel);
                    if (logChannel) {
                        await logChannel.send(
                            `**Filter Match** | Pattern: \`${filter.pattern}\` | User: ${message.author.tag} | Channel: <#${message.channel.id}>\nContent: ||${content.slice(0, 200)}||`
                        ).catch(() => {});
                    }
                }
                break;
            }
        }

        // Log to mod channel if configured (for all action types except 'log' which already does it)
        if (filter.action !== 'log' && guildCfg.modLogChannel) {
            const logChannel = message.guild.channels.cache.get(guildCfg.modLogChannel);
            if (logChannel) {
                await logChannel.send(
                    `**Filter Action: ${filter.action}** | Pattern: \`${filter.pattern}\` | User: ${message.author.tag} | Channel: <#${message.channel.id}>`
                ).catch(() => {});
            }
        }

        return true; // Stop after first match
    }

    return false;
}

module.exports = { getFilters, addFilter, removeFilter, testMessage, processMessage };
