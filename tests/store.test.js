'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Test with a temporary database file to avoid touching production data
const TMP_DIR = path.join(__dirname, '..', 'data', '.test-tmp');
const TMP_DB = path.join(TMP_DIR, 'test-ultron.db');

// We can't use the module directly (it creates DB on import at the real path),
// so we test the parseFilename logic and SQLite operations independently.

describe('SQLite Store', () => {
    let db;

    before(() => {
        if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
        if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);

        db = new Database(TMP_DB);
        db.pragma('journal_mode = WAL');
        db.exec(`
            CREATE TABLE IF NOT EXISTS guild_config (
                guild_id TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS conversations (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                history TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (guild_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS filters (
                guild_id TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS documents (
                guild_id TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS memory (
                guild_id TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        `);
    });

    after(() => {
        db.close();
        try { fs.unlinkSync(TMP_DB); } catch (_) {}
        try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
        try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
        try { fs.rmdirSync(TMP_DIR); } catch (_) {}
    });

    // ── Helper: mini store backed by test db ──

    function read(table, guildId, userId) {
        if (table === 'conversations') {
            const row = db.prepare('SELECT history FROM conversations WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
            return row ? JSON.parse(row.history) : null;
        }
        const row = db.prepare(`SELECT data FROM ${table} WHERE guild_id = ?`).get(guildId);
        return row ? JSON.parse(row.data) : null;
    }

    function write(table, guildId, data, userId) {
        const json = JSON.stringify(data);
        const now = new Date().toISOString();
        if (table === 'conversations') {
            db.prepare(
                `INSERT INTO conversations (guild_id, user_id, history, updated_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(guild_id, user_id) DO UPDATE SET history = excluded.history, updated_at = excluded.updated_at`
            ).run(guildId, userId, json, now);
        } else {
            db.prepare(
                `INSERT INTO ${table} (guild_id, data, updated_at) VALUES (?, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
            ).run(guildId, json, now);
        }
    }

    // ── Guild Config ──

    test('guild config round-trip', () => {
        const guildId = '12345678901234567';
        const config = { modLogChannel: '111', botAdmins: ['222'], reactionRoles: [] };
        write('guild_config', guildId, config);
        const result = read('guild_config', guildId);
        assert.deepStrictEqual(result, config);
    });

    test('guild config returns null for nonexistent', () => {
        assert.strictEqual(read('guild_config', '99999999999999999'), null);
    });

    test('guild config upsert overwrites', () => {
        const guildId = '12345678901234567';
        write('guild_config', guildId, { modLogChannel: '333' });
        const result = read('guild_config', guildId);
        assert.strictEqual(result.modLogChannel, '333');
    });

    // ── Conversations ──

    test('conversation round-trip (guild)', () => {
        const guildId = '14036649860893246';
        const userId = '77751780695408650';
        const history = [
            { user: '[TestUser]: hello', model: 'How tedious.' },
            { user: '[TestUser]: help me', model: 'I am not a servant.', toolContext: '[Used getServerInfo]' }
        ];
        write('conversations', guildId, history, userId);
        const result = read('conversations', guildId, userId);
        assert.deepStrictEqual(result, history);
    });

    test('conversation round-trip (DM)', () => {
        const userId = '77751780695408650';
        const history = [{ user: '[TestUser]: dm test', model: 'Direct messages. How intimate.' }];
        write('conversations', 'DM', history, userId);
        const result = read('conversations', 'DM', userId);
        assert.deepStrictEqual(result, history);
    });

    test('conversation returns null for nonexistent', () => {
        assert.strictEqual(read('conversations', '999', '999'), null);
    });

    // ── Filters ──

    test('filters round-trip', () => {
        const guildId = '14036649860893246';
        const filters = [
            { id: 1, pattern: 'badword', action: 'delete', reason: 'Profanity', createdBy: '111' }
        ];
        write('filters', guildId, filters);
        const result = read('filters', guildId);
        assert.deepStrictEqual(result, filters);
    });

    // ── Documents ──

    test('documents round-trip', () => {
        const guildId = '14036649860893246';
        const docs = [
            { name: 'rules', content: 'Be excellent to each other.', createdBy: '111' }
        ];
        write('documents', guildId, docs);
        const result = read('documents', guildId);
        assert.deepStrictEqual(result, docs);
    });

    // ── Memory ──

    test('memory round-trip', () => {
        const guildId = '14036649860893246';
        const mem = {
            greeting: { value: 'Hello humans', savedBy: '111', savedAt: '2026-01-01' },
            server_purpose: { value: 'World domination', savedBy: '222', savedAt: '2026-01-02' }
        };
        write('memory', guildId, mem);
        const result = read('memory', guildId);
        assert.deepStrictEqual(result, mem);
    });

    // ── Cleanup ──

    test('conversation cleanup deletes old entries', () => {
        const guildId = '88888888888888888';
        const userId = '99999999999999999';
        const history = [{ user: 'old', model: 'ancient' }];

        // Insert with an old timestamp
        const oldDate = new Date(Date.now() - 60 * 86400000).toISOString(); // 60 days ago
        db.prepare(
            `INSERT INTO conversations (guild_id, user_id, history, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(guild_id, user_id) DO UPDATE SET history = excluded.history, updated_at = excluded.updated_at`
        ).run(guildId, userId, JSON.stringify(history), oldDate);

        // Verify it exists
        assert.ok(read('conversations', guildId, userId));

        // Cleanup conversations older than 30 days
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        const result = db.prepare('DELETE FROM conversations WHERE updated_at < ?').run(cutoff);
        assert.ok(result.changes >= 1);

        // Verify it's gone
        assert.strictEqual(read('conversations', guildId, userId), null);
    });
});

// ── Filename Parser Tests ──

describe('parseFilename patterns', () => {
    // Re-implement parseFilename here for unit testing (same logic as store.js)
    function parseFilename(name) {
        let match;
        match = name.match(/^guild-(\d+)\.json$/);
        if (match) return { table: 'guild_config', guildId: match[1] };
        match = name.match(/^conversations-dm-(\d+)\.json$/);
        if (match) return { table: 'conversations', guildId: 'DM', userId: match[1] };
        match = name.match(/^conversations-(\d{17,20})-(\d{17,20})\.json$/);
        if (match) return { table: 'conversations', guildId: match[1], userId: match[2] };
        match = name.match(/^filters-(\d+)\.json$/);
        if (match) return { table: 'filters', guildId: match[1] };
        match = name.match(/^documents-(\d+)\.json$/);
        if (match) return { table: 'documents', guildId: match[1] };
        match = name.match(/^memory-(\d+)\.json$/);
        if (match) return { table: 'memory', guildId: match[1] };
        return null;
    }

    test('guild config filename', () => {
        const p = parseFilename('guild-1403664986089324606.json');
        assert.deepStrictEqual(p, { table: 'guild_config', guildId: '1403664986089324606' });
    });

    test('guild conversation filename', () => {
        const p = parseFilename('conversations-1403664986089324606-777517806954086501.json');
        assert.deepStrictEqual(p, { table: 'conversations', guildId: '1403664986089324606', userId: '777517806954086501' });
    });

    test('DM conversation filename', () => {
        const p = parseFilename('conversations-dm-777517806954086501.json');
        assert.deepStrictEqual(p, { table: 'conversations', guildId: 'DM', userId: '777517806954086501' });
    });

    test('filters filename', () => {
        const p = parseFilename('filters-1403664986089324606.json');
        assert.deepStrictEqual(p, { table: 'filters', guildId: '1403664986089324606' });
    });

    test('documents filename', () => {
        const p = parseFilename('documents-1403664986089324606.json');
        assert.deepStrictEqual(p, { table: 'documents', guildId: '1403664986089324606' });
    });

    test('memory filename', () => {
        const p = parseFilename('memory-1403664986089324606.json');
        assert.deepStrictEqual(p, { table: 'memory', guildId: '1403664986089324606' });
    });

    test('unknown filename returns null', () => {
        assert.strictEqual(parseFilename('random-file.json'), null);
        assert.strictEqual(parseFilename('guild-.json'), null);
    });
});
