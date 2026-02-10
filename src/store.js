const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'ultron.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

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

    CREATE TABLE IF NOT EXISTS guild_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        member_count INTEGER,
        channel_count INTEGER,
        role_count INTEGER,
        emoji_count INTEGER,
        checksum TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_guild ON guild_snapshots(guild_id, created_at);

    CREATE TABLE IF NOT EXISTS guild_snapshot_channels (
        snapshot_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type INTEGER NOT NULL,
        parent_id TEXT,
        position INTEGER,
        nsfw INTEGER,
        rate_limit_per_user INTEGER,
        bitrate INTEGER,
        user_limit INTEGER,
        PRIMARY KEY (snapshot_id, channel_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_roles (
        snapshot_id INTEGER NOT NULL,
        role_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color INTEGER,
        position INTEGER,
        permissions TEXT,
        mentionable INTEGER,
        hoist INTEGER,
        managed INTEGER,
        PRIMARY KEY (snapshot_id, role_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_emojis (
        snapshot_id INTEGER NOT NULL,
        emoji_id TEXT NOT NULL,
        name TEXT NOT NULL,
        animated INTEGER,
        PRIMARY KEY (snapshot_id, emoji_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_security_events_guild ON security_events(guild_id, created_at);
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

// ── Guild Snapshot Helpers ──

const insertSnapshotTx = db.transaction(snapshot => {
    const now = snapshot.createdAt || new Date().toISOString();
    const info = stmt('insert_snapshot',
        `INSERT INTO guild_snapshots (guild_id, created_at, member_count, channel_count, role_count, emoji_count, checksum)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
        snapshot.guildId,
        now,
        snapshot.memberCount ?? null,
        snapshot.channelCount ?? null,
        snapshot.roleCount ?? null,
        snapshot.emojiCount ?? null,
        snapshot.checksum || null
    );

    const snapshotId = Number(info.lastInsertRowid);

    const insertChannel = stmt('insert_snapshot_channel',
        `INSERT INTO guild_snapshot_channels
         (snapshot_id, channel_id, name, type, parent_id, position, nsfw, rate_limit_per_user, bitrate, user_limit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ch of snapshot.channels || []) {
        insertChannel.run(
            snapshotId,
            ch.id,
            ch.name,
            ch.type,
            ch.parentId || null,
            ch.position ?? null,
            ch.nsfw ? 1 : 0,
            ch.rateLimitPerUser ?? null,
            ch.bitrate ?? null,
            ch.userLimit ?? null
        );
    }

    const insertRole = stmt('insert_snapshot_role',
        `INSERT INTO guild_snapshot_roles
         (snapshot_id, role_id, name, color, position, permissions, mentionable, hoist, managed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const role of snapshot.roles || []) {
        insertRole.run(
            snapshotId,
            role.id,
            role.name,
            role.color ?? null,
            role.position ?? null,
            role.permissions || null,
            role.mentionable ? 1 : 0,
            role.hoist ? 1 : 0,
            role.managed ? 1 : 0
        );
    }

    const insertEmoji = stmt('insert_snapshot_emoji',
        `INSERT INTO guild_snapshot_emojis
         (snapshot_id, emoji_id, name, animated)
         VALUES (?, ?, ?, ?)`
    );
    for (const emoji of snapshot.emojis || []) {
        insertEmoji.run(
            snapshotId,
            emoji.id,
            emoji.name,
            emoji.animated ? 1 : 0
        );
    }

    return snapshotId;
});

function createGuildSnapshot(snapshot) {
    return insertSnapshotTx(snapshot);
}

function getLatestGuildSnapshot(guildId) {
    const row = stmt('latest_snapshot',
        'SELECT * FROM guild_snapshots WHERE guild_id = ? ORDER BY id DESC LIMIT 1'
    ).get(guildId);
    if (!row) return null;

    const channels = stmt('snapshot_channels',
        'SELECT * FROM guild_snapshot_channels WHERE snapshot_id = ?'
    ).all(row.id);
    const roles = stmt('snapshot_roles',
        'SELECT * FROM guild_snapshot_roles WHERE snapshot_id = ?'
    ).all(row.id);
    const emojis = stmt('snapshot_emojis',
        'SELECT * FROM guild_snapshot_emojis WHERE snapshot_id = ?'
    ).all(row.id);

    return {
        id: row.id,
        guildId: row.guild_id,
        createdAt: row.created_at,
        memberCount: row.member_count,
        channelCount: row.channel_count,
        roleCount: row.role_count,
        emojiCount: row.emoji_count,
        checksum: row.checksum,
        channels: channels.map(ch => ({
            id: ch.channel_id,
            name: ch.name,
            type: ch.type,
            parentId: ch.parent_id,
            position: ch.position,
            nsfw: !!ch.nsfw,
            rateLimitPerUser: ch.rate_limit_per_user,
            bitrate: ch.bitrate,
            userLimit: ch.user_limit
        })),
        roles: roles.map(r => ({
            id: r.role_id,
            name: r.name,
            color: r.color,
            position: r.position,
            permissions: r.permissions,
            mentionable: !!r.mentionable,
            hoist: !!r.hoist,
            managed: !!r.managed
        })),
        emojis: emojis.map(e => ({
            id: e.emoji_id,
            name: e.name,
            animated: !!e.animated
        }))
    };
}

function pruneGuildSnapshots(guildId, keep = 10) {
    if (keep <= 0) return 0;
    const threshold = stmt('snapshot_prune_threshold',
        'SELECT id FROM guild_snapshots WHERE guild_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?'
    ).get(guildId, keep - 1);
    if (!threshold) return 0;
    const result = stmt('snapshot_prune',
        'DELETE FROM guild_snapshots WHERE guild_id = ? AND id < ?'
    ).run(guildId, threshold.id);
    return result.changes;
}

// ── Security Events ──

function logSecurityEvent(guildId, type, severity, summary, details) {
    try {
        stmt('log_security_event',
            'INSERT INTO security_events (guild_id, type, severity, summary, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(guildId, type, severity, summary, details || null, new Date().toISOString());
    } catch (_) {}
}

function close() {
    db.close();
}

module.exports = {
    read, write, update, cleanupConversations,
    logAudit, getAuditTrail,
    addTempBan, getExpiredTempBans, removeTempBan,
    createGuildSnapshot, getLatestGuildSnapshot, pruneGuildSnapshots,
    logSecurityEvent,
    close
};
