'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');

const securityPath = require.resolve('../src/security');
const storePath = require.resolve('../src/store');
const configPath = require.resolve('../config');

const originalSecurity = require.cache[securityPath];
const originalStore = require.cache[storePath];
const originalConfig = require.cache[configPath];

const mockStore = {
    read: () => ({}),
    getLatestGuildSnapshot: () => null,
    createGuildSnapshot: () => 1,
    pruneGuildSnapshots: () => 0,
    getSnapshotById: () => null,
    listGuildSnapshots: () => [],
    logSecurityEvent: () => {}
};

describe('Security Snapshot Normalization', () => {
    let normalizeSnapshot;

    before(() => {
        require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: mockStore };
        require.cache[configPath] = {
            id: configPath,
            filename: configPath,
            loaded: true,
            exports: { security: {} }
        };
        delete require.cache[securityPath];
        ({ _internal: { normalizeSnapshot } } = require('../src/security'));
    });

    after(() => {
        if (originalStore) require.cache[storePath] = originalStore;
        else delete require.cache[storePath];

        if (originalConfig) require.cache[configPath] = originalConfig;
        else delete require.cache[configPath];

        if (originalSecurity) require.cache[securityPath] = originalSecurity;
        else delete require.cache[securityPath];
    });

    test('coerces unsupported values and drops invalid rows', () => {
        const input = {
            guildId: 12345,
            createdAt: new Date('2026-02-15T00:00:00.000Z'),
            name: { nested: true },
            channelCount: '999',
            roleCount: 'oops',
            emojiCount: Symbol('bad'),
            features: ['A', null, { x: 1 }, 'A'],
            channels: [
                { id: 'c1', name: 'general', type: '0', nsfw: 'true', archiveTimestamp: new Date('2026-02-10T00:00:00.000Z') },
                { id: null, name: 'broken', type: 0 }
            ],
            emojis: [
                { id: 'e1', name: 'smile', imageData: new Uint8Array([1, 2, 3]), animated: 'false' },
                { id: '', name: 'invalid' }
            ],
            messages: [
                { channelId: 'c1', messageId: 'm1', content: { body: 'hello' } },
                { channelId: 'c1', messageId: '', content: 'bad' }
            ],
            memberRoles: [
                { userId: 'u1', roleId: 'r1' },
                { userId: '', roleId: 'r2' }
            ]
        };

        const { snapshot, dropped, droppedTotal } = normalizeSnapshot(input);

        assert.strictEqual(snapshot.guildId, '12345');
        assert.strictEqual(snapshot.createdAt, '2026-02-15T00:00:00.000Z');
        assert.strictEqual(snapshot.name, '{"nested":true}');
        assert.strictEqual(snapshot.channelCount, 1);
        assert.strictEqual(snapshot.roleCount, 0);
        assert.strictEqual(snapshot.emojiCount, 1);
        assert.deepStrictEqual(snapshot.features, ['A', '{"x":1}']);
        assert.strictEqual(snapshot.channels.length, 1);
        assert.strictEqual(snapshot.channels[0].nsfw, true);
        assert.strictEqual(snapshot.channels[0].archiveTimestamp, '2026-02-10T00:00:00.000Z');
        assert.strictEqual(snapshot.emojis.length, 1);
        assert(Buffer.isBuffer(snapshot.emojis[0].imageData));
        assert.strictEqual(snapshot.messages.length, 1);
        assert.strictEqual(snapshot.messages[0].content, '{"body":"hello"}');
        assert.strictEqual(snapshot.memberRoles.length, 1);

        assert.strictEqual(dropped.channels, 1);
        assert.strictEqual(dropped.emojis, 1);
        assert.strictEqual(dropped.messages, 1);
        assert.strictEqual(dropped.memberRoles, 1);
        assert(droppedTotal >= 4);
    });
});
