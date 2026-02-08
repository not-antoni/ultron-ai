const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'ultron.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

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
    CREATE TABLE IF NOT EXISTS audit_trail (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        args TEXT,
        result TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit_trail(guild_id, timestamp);
    CREATE TABLE IF NOT EXISTS temp_bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        unban_at TEXT NOT NULL,
        reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_temp_bans_unban ON temp_bans(unban_at);
`);

// ── Filename → table/key mapping ──

function parseFilename(name) {
    let match;

    // guild-{guildId}.json
    match = name.match(/^guild-(\d+)\.json$/);
    if (match) return { table: 'guild_config', guildId: match[1] };

    // conversations-dm-{userId}.json
    match = name.match(/^conversations-dm-(\d+)\.json$/);
    if (match) return { table: 'conversations', guildId: 'DM', userId: match[1] };

    // conversations-{guildId}-{userId}.json  (both are snowflakes: 17-20 digits)
    match = name.match(/^conversations-(\d{17,20})-(\d{17,20})\.json$/);
    if (match) return { table: 'conversations', guildId: match[1], userId: match[2] };

    // filters-{guildId}.json
    match = name.match(/^filters-(\d+)\.json$/);
    if (match) return { table: 'filters', guildId: match[1] };

    // documents-{guildId}.json
    match = name.match(/^documents-(\d+)\.json$/);
    if (match) return { table: 'documents', guildId: match[1] };

    // memory-{guildId}.json
    match = name.match(/^memory-(\d+)\.json$/);
    if (match) return { table: 'memory', guildId: match[1] };

    return null;
}

// ── Prepared statements (cached) ──

const stmts = {};
function stmt(key, sql) {
    if (!stmts[key]) stmts[key] = db.prepare(sql);
    return stmts[key];
}

// ── Core API (unchanged signatures) ──

function read(name, fallback = null) {
    const p = parseFilename(name);
    if (!p) return fallback;

    try {
        let row;
        if (p.table === 'conversations') {
            row = stmt('read_conv',
                'SELECT history FROM conversations WHERE guild_id = ? AND user_id = ?'
            ).get(p.guildId, p.userId);
            return row ? JSON.parse(row.history) : fallback;
        }
        row = stmt(`read_${p.table}`,
            `SELECT data FROM ${p.table} WHERE guild_id = ?`
        ).get(p.guildId);
        return row ? JSON.parse(row.data) : fallback;
    } catch {
        return fallback;
    }
}

function write(name, data) {
    const p = parseFilename(name);
    if (!p) return;

    const json = JSON.stringify(data);
    const now = new Date().toISOString();

    if (p.table === 'conversations') {
        stmt('write_conv',
            `INSERT INTO conversations (guild_id, user_id, history, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(guild_id, user_id) DO UPDATE SET history = excluded.history, updated_at = excluded.updated_at`
        ).run(p.guildId, p.userId, json, now);
        return;
    }

    stmt(`write_${p.table}`,
        `INSERT INTO ${p.table} (guild_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    ).run(p.guildId, json, now);
}

const updateTx = db.transaction((name, fn, fallback) => {
    const current = read(name, fallback);
    const updated = fn(current);
    write(name, updated);
    return updated;
});

function update(name, fn, fallback = null) {
    return updateTx(name, fn, fallback);
}

// ── Extended API (new for SQLite) ──

function cleanupConversations(maxAgeDays) {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const result = stmt('cleanup_conv',
        'DELETE FROM conversations WHERE updated_at < ?'
    ).run(cutoff);
    return result.changes;
}

function logAudit(guildId, userId, toolName, args, result) {
    try {
        stmt('log_audit',
            'INSERT INTO audit_trail (guild_id, user_id, tool_name, args, result, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(guildId, userId, toolName, JSON.stringify(args), JSON.stringify(result), new Date().toISOString());
    } catch (_) {}
}

function getAuditTrail(guildId, limit = 25, toolName = null) {
    let rows;
    if (toolName) {
        rows = stmt('audit_by_tool',
            'SELECT * FROM audit_trail WHERE guild_id = ? AND tool_name = ? ORDER BY id DESC LIMIT ?'
        ).all(guildId, toolName, limit);
    } else {
        rows = stmt('audit_all',
            'SELECT * FROM audit_trail WHERE guild_id = ? ORDER BY id DESC LIMIT ?'
        ).all(guildId, limit);
    }
    return rows.map(r => ({
        id: r.id, userId: r.user_id, tool: r.tool_name,
        args: JSON.parse(r.args || '{}'), result: JSON.parse(r.result || '{}'),
        timestamp: r.timestamp
    }));
}

// ── Temp Ban Helpers ──

function addTempBan(guildId, userId, username, unbanAt, reason) {
    stmt('add_temp_ban',
        'INSERT INTO temp_bans (guild_id, user_id, username, unban_at, reason) VALUES (?, ?, ?, ?, ?)'
    ).run(guildId, userId, username, unbanAt, reason || null);
}

function getExpiredTempBans() {
    return stmt('get_expired_bans',
        'SELECT * FROM temp_bans WHERE unban_at <= ?'
    ).all(new Date().toISOString());
}

function removeTempBan(id) {
    stmt('remove_temp_ban', 'DELETE FROM temp_bans WHERE id = ?').run(id);
}

function close() {
    db.close();
}

module.exports = { read, write, update, cleanupConversations, logAudit, getAuditTrail, addTempBan, getExpiredTempBans, removeTempBan, close };
