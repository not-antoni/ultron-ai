'use strict';

const { describe, test, after } = require('node:test');
const assert = require('node:assert');

const securityPath = require.resolve('../src/security');
const storePath = require.resolve('../src/store');
const configPath = require.resolve('../config');
const loggerPath = require.resolve('../src/logger');

const originalSecurity = require.cache[securityPath];
const originalStore = require.cache[storePath];
const originalConfig = require.cache[configPath];
const originalLogger = require.cache[loggerPath];

function restoreModule(path, original) {
    if (original) require.cache[path] = original;
    else delete require.cache[path];
}

after(() => {
    restoreModule(storePath, originalStore);
    restoreModule(configPath, originalConfig);
    restoreModule(loggerPath, originalLogger);
    restoreModule(securityPath, originalSecurity);
});

function formatLog(msg, args) {
    const extras = args.map(arg => {
        if (arg instanceof Error) return arg.message;
        if (typeof arg === 'string') return arg;
        try {
            return JSON.stringify(arg);
        } catch (_) {
            return String(arg);
        }
    });
    return [msg, ...extras].join(' ').trim();
}

function loadSecurity(overrides = {}) {
    const logs = { debug: [], info: [], warn: [], error: [] };
    const logSecurityEventCalls = [];

    const mockStore = {
        read: () => ({}),
        logSecurityEvent: (...args) => logSecurityEventCalls.push(args),
        ...overrides.store
    };

    require.cache[storePath] = {
        id: storePath,
        filename: storePath,
        loaded: true,
        exports: mockStore
    };
    require.cache[configPath] = {
        id: configPath,
        filename: configPath,
        loaded: true,
        exports: { security: { ...(overrides.security || {}) } }
    };
    require.cache[loggerPath] = {
        id: loggerPath,
        filename: loggerPath,
        loaded: true,
        exports: {
            createLogger: () => ({
                debug: (msg, ...args) => logs.debug.push(formatLog(msg, args)),
                info: (msg, ...args) => logs.info.push(formatLog(msg, args)),
                warn: (msg, ...args) => logs.warn.push(formatLog(msg, args)),
                error: (msg, ...args) => logs.error.push(formatLog(msg, args))
            })
        }
    };

    delete require.cache[securityPath];
    const security = require('../src/security');
    return { security, logs, logSecurityEventCalls };
}

function createUser(id, opts = {}) {
    let sendCount = 0;
    const user = {
        id: String(id),
        createDM: () => {
            if (typeof opts.createDM === 'function') return opts.createDM();
            return Promise.resolve({
                send: async () => {
                    sendCount += 1;
                    if (typeof opts.send === 'function') return opts.send();
                    return null;
                }
            });
        },
        get sendCount() {
            return sendCount;
        }
    };
    return user;
}

function createAdminMember(user, isAdmin = true) {
    return {
        id: user.id,
        user,
        permissions: {
            has: () => isAdmin
        }
    };
}

function createGuild({
    id = 'guild-1',
    ownerUser = null,
    usersById = {},
    adminMembers = [],
    onFetchOwner = null
} = {}) {
    return {
        id,
        fetchOwner: async () => {
            if (typeof onFetchOwner === 'function') onFetchOwner();
            if (!ownerUser) return null;
            return { id: ownerUser.id, user: ownerUser };
        },
        client: {
            users: {
                fetch: async (userId) => usersById[userId] || null
            }
        },
        members: {
            fetch: async () => {},
            cache: {
                filter: (predicate) => {
                    const out = new Map();
                    for (const member of adminMembers) {
                        if (predicate(member)) out.set(member.id, member);
                    }
                    return out;
                }
            }
        }
    };
}

describe('Security Alert DM Policy', () => {
    test('defaults to raid-only DM alerts', () => {
        const { security } = loadSecurity();
        const { shouldDmAlert } = security._internal;

        assert.strictEqual(shouldDmAlert({ type: 'raid-join', severity: 'high' }), true);
        assert.strictEqual(shouldDmAlert({ type: 'channel-delete', severity: 'critical' }), false);
        assert.strictEqual(shouldDmAlert({ type: 'emoji-create', severity: 'medium' }), false);
    });

    test('critical_and_raid mode allows critical + raid', () => {
        const { security } = loadSecurity({ security: { alertDmMode: 'critical_and_raid' } });
        const { shouldDmAlert } = security._internal;

        assert.strictEqual(shouldDmAlert({ type: 'raid-join', severity: 'high' }), true);
        assert.strictEqual(shouldDmAlert({ type: 'channel-delete', severity: 'critical' }), true);
        assert.strictEqual(shouldDmAlert({ type: 'emoji-create', severity: 'medium' }), false);
    });

    test('explicit type allowlist overrides mode', () => {
        const { security } = loadSecurity({
            security: {
                alertDmMode: 'all',
                alertDmTypes: ['member-ban', 'raid-join']
            }
        });
        const { shouldDmAlert } = security._internal;

        assert.strictEqual(shouldDmAlert({ type: 'member-ban', severity: 'high' }), true);
        assert.strictEqual(shouldDmAlert({ type: 'channel-delete', severity: 'critical' }), false);
    });
});

describe('Security Alert Delivery', () => {
    test('non-raid alerts are logged but do not DM in raid_only mode', async () => {
        let ownerFetches = 0;
        const owner = createUser('1001');
        const guild = createGuild({
            id: 'guild-suppress-1',
            ownerUser: owner,
            onFetchOwner: () => { ownerFetches += 1; }
        });
        const { security, logSecurityEventCalls } = loadSecurity({
            security: { alertDmMode: 'raid_only' }
        });

        await security._internal.raiseAlert(guild, {
            type: 'emoji-create',
            severity: 'medium',
            summary: 'Noisy emoji spike'
        });

        assert.strictEqual(logSecurityEventCalls.length, 1);
        assert.strictEqual(ownerFetches, 0);
        assert.strictEqual(owner.sendCount, 0);
    });

    test('raid alerts are logged and DM recipients', async () => {
        let ownerFetches = 0;
        const owner = createUser('1002');
        const guild = createGuild({
            id: 'guild-raid-1',
            ownerUser: owner,
            onFetchOwner: () => { ownerFetches += 1; }
        });
        const { security, logSecurityEventCalls } = loadSecurity({
            security: { alertDmMode: 'raid_only' }
        });

        await security._internal.raiseAlert(guild, {
            type: 'raid-join',
            severity: 'high',
            summary: 'Raid join spike'
        });

        assert.strictEqual(logSecurityEventCalls.length, 1);
        assert.strictEqual(ownerFetches, 1);
        assert.strictEqual(owner.sendCount, 1);
    });

    test('sendAlert deduplicates recipients and skips invalid ids', async () => {
        const owner = createUser('2001');
        const botAdmin = createUser('2002');
        const discordAdmin = createUser('2003');
        const guild = createGuild({
            id: 'guild-send-1',
            ownerUser: owner,
            usersById: { '2002': botAdmin, '2003': discordAdmin },
            adminMembers: [
                createAdminMember(discordAdmin, true),
                createAdminMember(owner, true)
            ]
        });

        const { security, logs } = loadSecurity({
            security: { alertDmMode: 'all' },
            store: {
                read: () => ({ botAdmins: ['2002', 'bad-id', '2002', '2003'] })
            }
        });

        await security._internal.sendAlert(guild, {
            type: 'raid-join',
            severity: 'high',
            summary: 'Recipient validation test'
        });

        assert.strictEqual(owner.sendCount, 1);
        assert.strictEqual(botAdmin.sendCount, 1);
        assert.strictEqual(discordAdmin.sendCount, 1);
        assert(logs.info.some(line => line.includes('skippedInvalid=1')));
        assert(logs.info.some(line => line.includes('skippedDuplicate=3')));
    });

    test('sendAlert tolerates DM timeouts and continues', async () => {
        const owner = createUser('3001', {
            createDM: () => new Promise(() => {})
        });
        const guild = createGuild({
            id: 'guild-timeout-1',
            ownerUser: owner
        });
        const { security, logs } = loadSecurity({
            security: {
                alertDmMode: 'all',
                alertDmTimeoutMs: 15,
                alertDmConcurrency: 1
            }
        });

        await security._internal.sendAlert(guild, {
            type: 'raid-join',
            severity: 'high',
            summary: 'Timeout handling test'
        });

        assert(logs.warn.some(line => line.includes('timed out')));
        assert(logs.warn.some(line => line.includes('failed=1')));
    });
});
