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

const triggerKeyColumn = (() => {
    try {
        const cols = db.prepare("PRAGMA table_info(guild_snapshot_automod_trigger_items)").all().map(c => c.name);
        if (cols.includes('trigger_key')) return 'trigger_key';
        if (cols.includes('key')) return 'key';
    } catch (_) {}
    return 'trigger_key';
})();

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
        name TEXT,
        icon TEXT,
        description TEXT,
        banner TEXT,
        splash TEXT,
        discovery_splash TEXT,
        vanity_url_code TEXT,
        nsfw_level TEXT,
        mfa_level TEXT,
        owner_id TEXT,
        verification_level TEXT,
        default_notifications TEXT,
        explicit_content_filter TEXT,
        preferred_locale TEXT,
        premium_tier INTEGER,
        system_channel_id TEXT,
        rules_channel_id TEXT,
        afk_channel_id TEXT,
        afk_timeout INTEGER,
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
        topic TEXT,
        nsfw INTEGER,
        rate_limit_per_user INTEGER,
        bitrate INTEGER,
        user_limit INTEGER,
        rtc_region TEXT,
        default_auto_archive_duration INTEGER,
        permissions_locked INTEGER,
        flags TEXT,
        default_thread_rate_limit_per_user INTEGER,
        default_reaction_emoji_id TEXT,
        default_reaction_emoji_name TEXT,
        default_sort_order INTEGER,
        default_forum_layout INTEGER,
        video_quality_mode INTEGER,
        archived INTEGER,
        auto_archive_duration INTEGER,
        locked INTEGER,
        invitable INTEGER,
        archive_timestamp TEXT,
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
        icon TEXT,
        unicode_emoji TEXT,
        PRIMARY KEY (snapshot_id, role_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_emojis (
        snapshot_id INTEGER NOT NULL,
        emoji_id TEXT NOT NULL,
        name TEXT NOT NULL,
        animated INTEGER,
        creator_id TEXT,
        created_at TEXT,
        image_url TEXT,
        image_type TEXT,
        image_data BLOB,
        PRIMARY KEY (snapshot_id, emoji_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_channel_overwrites (
        snapshot_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        allow TEXT,
        deny TEXT,
        PRIMARY KEY (snapshot_id, channel_id, target_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_stickers (
        snapshot_id INTEGER NOT NULL,
        sticker_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        tags TEXT,
        format_type INTEGER,
        type INTEGER,
        available INTEGER,
        sort_value INTEGER,
        PRIMARY KEY (snapshot_id, sticker_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_webhooks (
        snapshot_id INTEGER NOT NULL,
        webhook_id TEXT NOT NULL,
        name TEXT,
        channel_id TEXT,
        type INTEGER,
        avatar TEXT,
        owner_id TEXT,
        application_id TEXT,
        PRIMARY KEY (snapshot_id, webhook_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_invites (
        snapshot_id INTEGER NOT NULL,
        code TEXT NOT NULL,
        channel_id TEXT,
        max_uses INTEGER,
        max_age INTEGER,
        temporary INTEGER,
        uses INTEGER,
        created_by TEXT,
        created_at TEXT,
        expires_at TEXT,
        target_type TEXT,
        target_user_id TEXT,
        target_application_id TEXT,
        PRIMARY KEY (snapshot_id, code),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_automod (
        snapshot_id INTEGER NOT NULL,
        rule_id TEXT NOT NULL,
        name TEXT,
        enabled INTEGER,
        event_type TEXT,
        trigger_type TEXT,
        actions TEXT,
        exempt_roles TEXT,
        exempt_channels TEXT,
        PRIMARY KEY (snapshot_id, rule_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_events (
        snapshot_id INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        name TEXT,
        description TEXT,
        start_time TEXT,
        end_time TEXT,
        entity_type TEXT,
        status TEXT,
        location TEXT,
        channel_id TEXT,
        privacy_level TEXT,
        creator_id TEXT,
        image TEXT,
        PRIMARY KEY (snapshot_id, event_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_messages (
        snapshot_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        author_id TEXT,
        content TEXT,
        created_at TEXT,
        PRIMARY KEY (snapshot_id, channel_id, message_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_features (
        snapshot_id INTEGER NOT NULL,
        feature TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, feature),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_channel_tags (
        snapshot_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        name TEXT,
        moderated INTEGER,
        emoji_id TEXT,
        emoji_name TEXT,
        PRIMARY KEY (snapshot_id, channel_id, tag_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_role_tags (
        snapshot_id INTEGER NOT NULL,
        role_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (snapshot_id, role_id, tag),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_automod_actions (
        snapshot_id INTEGER NOT NULL,
        rule_id TEXT NOT NULL,
        action_index INTEGER NOT NULL,
        action_type TEXT,
        channel_id TEXT,
        duration_seconds INTEGER,
        custom_message TEXT,
        PRIMARY KEY (snapshot_id, rule_id, action_index),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_automod_trigger_items (
        snapshot_id INTEGER NOT NULL,
        rule_id TEXT NOT NULL,
        trigger_key TEXT NOT NULL,
        item_index INTEGER NOT NULL,
        value TEXT,
        PRIMARY KEY (snapshot_id, rule_id, trigger_key, item_index),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_automod_exempt_roles (
        snapshot_id INTEGER NOT NULL,
        rule_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, rule_id, role_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_automod_exempt_channels (
        snapshot_id INTEGER NOT NULL,
        rule_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, rule_id, channel_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_members (
        snapshot_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        nick TEXT,
        joined_at TEXT,
        bot INTEGER,
        pending INTEGER,
        communication_disabled_until TEXT,
        avatar TEXT,
        PRIMARY KEY (snapshot_id, user_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_member_roles (
        snapshot_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, user_id, role_id),
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

function ensureColumn(table, column, type) {
    const tableRow = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!tableRow) return;
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
}

try {
    const migrations = [
        ['guild_snapshots', 'name', 'TEXT'],
        ['guild_snapshots', 'icon', 'TEXT'],
        ['guild_snapshots', 'description', 'TEXT'],
        ['guild_snapshots', 'banner', 'TEXT'],
        ['guild_snapshots', 'splash', 'TEXT'],
        ['guild_snapshots', 'discovery_splash', 'TEXT'],
        ['guild_snapshots', 'vanity_url_code', 'TEXT'],
        ['guild_snapshots', 'nsfw_level', 'TEXT'],
        ['guild_snapshots', 'mfa_level', 'TEXT'],
        ['guild_snapshots', 'owner_id', 'TEXT'],
        ['guild_snapshots', 'verification_level', 'TEXT'],
        ['guild_snapshots', 'default_notifications', 'TEXT'],
        ['guild_snapshots', 'explicit_content_filter', 'TEXT'],
        ['guild_snapshots', 'preferred_locale', 'TEXT'],
        ['guild_snapshots', 'premium_tier', 'INTEGER'],
        ['guild_snapshots', 'system_channel_id', 'TEXT'],
        ['guild_snapshots', 'rules_channel_id', 'TEXT'],
        ['guild_snapshots', 'afk_channel_id', 'TEXT'],
        ['guild_snapshots', 'afk_timeout', 'INTEGER'],
        ['guild_snapshots', 'member_count', 'INTEGER'],
        ['guild_snapshots', 'channel_count', 'INTEGER'],
        ['guild_snapshots', 'role_count', 'INTEGER'],
        ['guild_snapshots', 'emoji_count', 'INTEGER'],
        ['guild_snapshots', 'checksum', 'TEXT'],

        ['guild_snapshot_channels', 'name', 'TEXT'],
        ['guild_snapshot_channels', 'type', 'INTEGER'],
        ['guild_snapshot_channels', 'parent_id', 'TEXT'],
        ['guild_snapshot_channels', 'position', 'INTEGER'],
        ['guild_snapshot_channels', 'topic', 'TEXT'],
        ['guild_snapshot_channels', 'nsfw', 'INTEGER'],
        ['guild_snapshot_channels', 'rate_limit_per_user', 'INTEGER'],
        ['guild_snapshot_channels', 'bitrate', 'INTEGER'],
        ['guild_snapshot_channels', 'user_limit', 'INTEGER'],
        ['guild_snapshot_channels', 'rtc_region', 'TEXT'],
        ['guild_snapshot_channels', 'default_auto_archive_duration', 'INTEGER'],
        ['guild_snapshot_channels', 'permissions_locked', 'INTEGER'],
        ['guild_snapshot_channels', 'flags', 'TEXT'],
        ['guild_snapshot_channels', 'default_thread_rate_limit_per_user', 'INTEGER'],
        ['guild_snapshot_channels', 'default_reaction_emoji_id', 'TEXT'],
        ['guild_snapshot_channels', 'default_reaction_emoji_name', 'TEXT'],
        ['guild_snapshot_channels', 'default_sort_order', 'INTEGER'],
        ['guild_snapshot_channels', 'default_forum_layout', 'INTEGER'],
        ['guild_snapshot_channels', 'video_quality_mode', 'INTEGER'],
        ['guild_snapshot_channels', 'archived', 'INTEGER'],
        ['guild_snapshot_channels', 'auto_archive_duration', 'INTEGER'],
        ['guild_snapshot_channels', 'locked', 'INTEGER'],
        ['guild_snapshot_channels', 'invitable', 'INTEGER'],
        ['guild_snapshot_channels', 'archive_timestamp', 'TEXT'],

        ['guild_snapshot_roles', 'name', 'TEXT'],
        ['guild_snapshot_roles', 'color', 'INTEGER'],
        ['guild_snapshot_roles', 'position', 'INTEGER'],
        ['guild_snapshot_roles', 'permissions', 'TEXT'],
        ['guild_snapshot_roles', 'mentionable', 'INTEGER'],
        ['guild_snapshot_roles', 'hoist', 'INTEGER'],
        ['guild_snapshot_roles', 'managed', 'INTEGER'],
        ['guild_snapshot_roles', 'icon', 'TEXT'],
        ['guild_snapshot_roles', 'unicode_emoji', 'TEXT'],

        ['guild_snapshot_emojis', 'name', 'TEXT'],
        ['guild_snapshot_emojis', 'animated', 'INTEGER'],
        ['guild_snapshot_emojis', 'creator_id', 'TEXT'],
        ['guild_snapshot_emojis', 'created_at', 'TEXT'],
        ['guild_snapshot_emojis', 'image_url', 'TEXT'],
        ['guild_snapshot_emojis', 'image_type', 'TEXT'],
        ['guild_snapshot_emojis', 'image_data', 'BLOB'],

        ['guild_snapshot_channel_overwrites', 'target_type', 'TEXT'],
        ['guild_snapshot_channel_overwrites', 'allow', 'TEXT'],
        ['guild_snapshot_channel_overwrites', 'deny', 'TEXT'],

        ['guild_snapshot_stickers', 'name', 'TEXT'],
        ['guild_snapshot_stickers', 'description', 'TEXT'],
        ['guild_snapshot_stickers', 'tags', 'TEXT'],
        ['guild_snapshot_stickers', 'format_type', 'INTEGER'],
        ['guild_snapshot_stickers', 'type', 'INTEGER'],
        ['guild_snapshot_stickers', 'available', 'INTEGER'],
        ['guild_snapshot_stickers', 'sort_value', 'INTEGER'],

        ['guild_snapshot_webhooks', 'name', 'TEXT'],
        ['guild_snapshot_webhooks', 'channel_id', 'TEXT'],
        ['guild_snapshot_webhooks', 'type', 'INTEGER'],
        ['guild_snapshot_webhooks', 'avatar', 'TEXT'],
        ['guild_snapshot_webhooks', 'owner_id', 'TEXT'],
        ['guild_snapshot_webhooks', 'application_id', 'TEXT'],

        ['guild_snapshot_invites', 'channel_id', 'TEXT'],
        ['guild_snapshot_invites', 'max_uses', 'INTEGER'],
        ['guild_snapshot_invites', 'max_age', 'INTEGER'],
        ['guild_snapshot_invites', 'temporary', 'INTEGER'],
        ['guild_snapshot_invites', 'uses', 'INTEGER'],
        ['guild_snapshot_invites', 'created_by', 'TEXT'],
        ['guild_snapshot_invites', 'created_at', 'TEXT'],
        ['guild_snapshot_invites', 'expires_at', 'TEXT'],
        ['guild_snapshot_invites', 'target_type', 'TEXT'],
        ['guild_snapshot_invites', 'target_user_id', 'TEXT'],
        ['guild_snapshot_invites', 'target_application_id', 'TEXT'],

        ['guild_snapshot_automod', 'name', 'TEXT'],
        ['guild_snapshot_automod', 'enabled', 'INTEGER'],
        ['guild_snapshot_automod', 'event_type', 'TEXT'],
        ['guild_snapshot_automod', 'trigger_type', 'TEXT'],
        ['guild_snapshot_automod', 'actions', 'TEXT'],
        ['guild_snapshot_automod', 'exempt_roles', 'TEXT'],
        ['guild_snapshot_automod', 'exempt_channels', 'TEXT'],

        ['guild_snapshot_events', 'name', 'TEXT'],
        ['guild_snapshot_events', 'description', 'TEXT'],
        ['guild_snapshot_events', 'start_time', 'TEXT'],
        ['guild_snapshot_events', 'end_time', 'TEXT'],
        ['guild_snapshot_events', 'entity_type', 'TEXT'],
        ['guild_snapshot_events', 'status', 'TEXT'],
        ['guild_snapshot_events', 'location', 'TEXT'],
        ['guild_snapshot_events', 'channel_id', 'TEXT'],
        ['guild_snapshot_events', 'privacy_level', 'TEXT'],
        ['guild_snapshot_events', 'creator_id', 'TEXT'],
        ['guild_snapshot_events', 'image', 'TEXT'],

        ['guild_snapshot_messages', 'author_id', 'TEXT'],
        ['guild_snapshot_messages', 'content', 'TEXT'],
        ['guild_snapshot_messages', 'created_at', 'TEXT']
    ];

    for (const [table, column, type] of migrations) {
        ensureColumn(table, column, type);
    }
} catch (_) {
    // Ignore migration errors if table doesn't exist yet
}

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

function migrateLegacyJsonFiles() {
    let files = [];
    try {
        files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    } catch (_) {
        return;
    }
    if (files.length === 0) return;

    for (const file of files) {
        const parsed = parseFilename(file);
        if (!parsed) continue;
        const fullPath = path.join(DATA_DIR, file);

        let data;
        try {
            const raw = fs.readFileSync(fullPath, 'utf8');
            data = JSON.parse(raw);
        } catch (_) {
            continue;
        }

        let exists = false;
        try {
            if (parsed.table === 'conversations') {
                exists = !!stmt('migrate_has_conv',
                    'SELECT 1 FROM conversations WHERE guild_id = ? AND user_id = ?'
                ).get(parsed.guildId, parsed.userId);
            } else {
                exists = !!stmt(`migrate_has_${parsed.table}`,
                    `SELECT 1 FROM ${parsed.table} WHERE guild_id = ?`
                ).get(parsed.guildId);
            }
        } catch (_) {
            exists = false;
        }

        let migrated = exists;
        if (!exists) {
            try {
                write(file, data);
                migrated = true;
            } catch (_) {
                migrated = false;
            }
        }

        if (migrated) {
            try {
                fs.unlinkSync(fullPath);
            } catch (_) {}
        }
    }
}

migrateLegacyJsonFiles();

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

// better-sqlite3 only accepts: number, string, bigint, Buffer, null.
// Coerce anything else (boolean, undefined, object, array) to a safe type.
function sanitize(val) {
    if (val === null || val === undefined) return null;
    const t = typeof val;
    if (t === 'number' || t === 'string' || t === 'bigint') return val;
    if (t === 'boolean') return val ? 1 : 0;
    if (Buffer.isBuffer(val)) return val;
    // arrays, objects, Dates, etc.
    return String(val);
}

function sanitizedRun(statement, ...args) {
    return statement.run(...args.map(sanitize));
}

const insertSnapshotTx = db.transaction(snapshot => {
    const now = snapshot.createdAt || new Date().toISOString();
    const insertSnapshotStmt = stmt('insert_snapshot',
        `INSERT INTO guild_snapshots (
            guild_id, created_at, name, icon, description, banner, splash, discovery_splash,
            vanity_url_code, nsfw_level, mfa_level, owner_id,
            verification_level, default_notifications,
            explicit_content_filter, preferred_locale, premium_tier,
            system_channel_id, rules_channel_id, afk_channel_id, afk_timeout,
            member_count, channel_count, role_count, emoji_count, checksum
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = sanitizedRun(insertSnapshotStmt,
        snapshot.guildId,
        now,
        snapshot.name || null,
        snapshot.icon || null,
        snapshot.description || null,
        snapshot.banner || null,
        snapshot.splash || null,
        snapshot.discoverySplash || null,
        snapshot.vanityURLCode || null,
        snapshot.nsfwLevel || null,
        snapshot.mfaLevel || null,
        snapshot.ownerId || null,
        snapshot.verificationLevel || null,
        snapshot.defaultNotifications || null,
        snapshot.explicitContentFilter || null,
        snapshot.preferredLocale || null,
        snapshot.premiumTier ?? null,
        snapshot.systemChannelId || null,
        snapshot.rulesChannelId || null,
        snapshot.afkChannelId || null,
        snapshot.afkTimeout ?? null,
        snapshot.memberCount ?? null,
        snapshot.channelCount ?? null,
        snapshot.roleCount ?? null,
        snapshot.emojiCount ?? null,
        snapshot.checksum || null
    );

    const snapshotId = Number(info.lastInsertRowid);

    const insertChannel = stmt('insert_snapshot_channel',
        `INSERT INTO guild_snapshot_channels
         (snapshot_id, channel_id, name, type, parent_id, position, topic, nsfw, rate_limit_per_user, bitrate, user_limit, rtc_region, default_auto_archive_duration,
          permissions_locked, flags, default_thread_rate_limit_per_user, default_reaction_emoji_id, default_reaction_emoji_name,
          default_sort_order, default_forum_layout, video_quality_mode, archived, auto_archive_duration, locked, invitable, archive_timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ch of snapshot.channels || []) {
        sanitizedRun(insertChannel,
            snapshotId,
            ch.id,
            ch.name,
            ch.type,
            ch.parentId || null,
            ch.position ?? null,
            ch.topic || null,
            ch.nsfw ? 1 : 0,
            ch.rateLimitPerUser ?? null,
            ch.bitrate ?? null,
            ch.userLimit ?? null,
            ch.rtcRegion || null,
            ch.defaultAutoArchiveDuration ?? null,
            ch.permissionsLocked ? 1 : 0,
            ch.flags || null,
            ch.defaultThreadRateLimitPerUser ?? null,
            ch.defaultReactionEmojiId || null,
            ch.defaultReactionEmojiName || null,
            ch.defaultSortOrder ?? null,
            ch.defaultForumLayout ?? null,
            ch.videoQualityMode ?? null,
            ch.archived ? 1 : 0,
            ch.autoArchiveDuration ?? null,
            ch.locked ? 1 : 0,
            ch.invitable ? 1 : 0,
            ch.archiveTimestamp || null
        );
    }

    const insertRole = stmt('insert_snapshot_role',
        `INSERT INTO guild_snapshot_roles
         (snapshot_id, role_id, name, color, position, permissions, mentionable, hoist, managed, icon, unicode_emoji)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const role of snapshot.roles || []) {
        sanitizedRun(insertRole,
            snapshotId,
            role.id,
            role.name,
            role.color ?? null,
            role.position ?? null,
            role.permissions || null,
            role.mentionable ? 1 : 0,
            role.hoist ? 1 : 0,
            role.managed ? 1 : 0,
            role.icon || null,
            role.unicodeEmoji || null
        );
    }

    const insertEmoji = stmt('insert_snapshot_emoji',
        `INSERT INTO guild_snapshot_emojis
         (snapshot_id, emoji_id, name, animated, creator_id, created_at, image_url, image_type, image_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const emoji of snapshot.emojis || []) {
        sanitizedRun(insertEmoji,
            snapshotId,
            emoji.id,
            emoji.name,
            emoji.animated ? 1 : 0,
            emoji.creatorId || null,
            emoji.createdAt || null,
            emoji.imageUrl || null,
            emoji.imageType || null,
            emoji.imageData || null
        );
    }

    const insertOverwrite = stmt('insert_snapshot_overwrite',
        `INSERT INTO guild_snapshot_channel_overwrites
         (snapshot_id, channel_id, target_id, target_type, allow, deny)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const ow of snapshot.overwrites || []) {
        sanitizedRun(insertOverwrite,
            snapshotId,
            ow.channelId,
            ow.targetId,
            ow.targetType,
            ow.allow || null,
            ow.deny || null
        );
    }

    const insertSticker = stmt('insert_snapshot_sticker',
        `INSERT INTO guild_snapshot_stickers
         (snapshot_id, sticker_id, name, description, tags, format_type, type, available, sort_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const sticker of snapshot.stickers || []) {
        sanitizedRun(insertSticker,
            snapshotId,
            sticker.id,
            sticker.name,
            sticker.description || null,
            sticker.tags || null,
            sticker.formatType ?? null,
            sticker.type ?? null,
            sticker.available ? 1 : 0,
            sticker.sortValue ?? null
        );
    }

    const insertWebhook = stmt('insert_snapshot_webhook',
        `INSERT INTO guild_snapshot_webhooks
         (snapshot_id, webhook_id, name, channel_id, type, avatar, owner_id, application_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const hook of snapshot.webhooks || []) {
        sanitizedRun(insertWebhook,
            snapshotId,
            hook.id,
            hook.name || null,
            hook.channelId || null,
            hook.type ?? null,
            hook.avatar || null,
            hook.ownerId || null,
            hook.applicationId || null
        );
    }

    const insertInvite = stmt('insert_snapshot_invite',
        `INSERT INTO guild_snapshot_invites
         (snapshot_id, code, channel_id, max_uses, max_age, temporary, uses, created_by, created_at, expires_at, target_type, target_user_id, target_application_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const invite of snapshot.invites || []) {
        sanitizedRun(insertInvite,
            snapshotId,
            invite.code,
            invite.channelId || null,
            invite.maxUses ?? null,
            invite.maxAge ?? null,
            invite.temporary ? 1 : 0,
            invite.uses ?? null,
            invite.createdBy || null,
            invite.createdAt || null,
            invite.expiresAt || null,
            invite.targetType || null,
            invite.targetUserId || null,
            invite.targetApplicationId || null
        );
    }

    const insertAutomod = stmt('insert_snapshot_automod',
        `INSERT INTO guild_snapshot_automod
         (snapshot_id, rule_id, name, enabled, event_type, trigger_type, actions, exempt_roles, exempt_channels)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const rule of snapshot.automod || []) {
        sanitizedRun(insertAutomod,
            snapshotId,
            rule.id,
            rule.name || null,
            rule.enabled ? 1 : 0,
            rule.eventType || null,
            rule.triggerType || null,
            null,
            null,
            null
        );
    }

    const insertEvent = stmt('insert_snapshot_event',
        `INSERT INTO guild_snapshot_events
         (snapshot_id, event_id, name, description, start_time, end_time, entity_type, status, location, channel_id, privacy_level, creator_id, image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ev of snapshot.events || []) {
        sanitizedRun(insertEvent,
            snapshotId,
            ev.id,
            ev.name || null,
            ev.description || null,
            ev.startTime || null,
            ev.endTime || null,
            ev.entityType || null,
            ev.status || null,
            ev.location || null,
            ev.channelId || null,
            ev.privacyLevel || null,
            ev.creatorId || null,
            ev.image || null
        );
    }

    const insertMessage = stmt('insert_snapshot_message',
        `INSERT INTO guild_snapshot_messages
         (snapshot_id, channel_id, message_id, author_id, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const msg of snapshot.messages || []) {
        sanitizedRun(insertMessage,
            snapshotId,
            msg.channelId,
            msg.messageId,
            msg.authorId || null,
            msg.content || null,
            msg.createdAt || null
        );
    }

    const insertFeature = stmt('insert_snapshot_feature',
        `INSERT INTO guild_snapshot_features
         (snapshot_id, feature)
         VALUES (?, ?)`
    );
    for (const feature of snapshot.features || []) {
        sanitizedRun(insertFeature, snapshotId, feature);
    }

    const insertChannelTag = stmt('insert_snapshot_channel_tag',
        `INSERT INTO guild_snapshot_channel_tags
         (snapshot_id, channel_id, tag_id, name, moderated, emoji_id, emoji_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const tag of snapshot.channelTags || []) {
        sanitizedRun(insertChannelTag,
            snapshotId,
            tag.channelId,
            tag.tagId,
            tag.name || null,
            tag.moderated ? 1 : 0,
            tag.emojiId || null,
            tag.emojiName || null
        );
    }

    const insertRoleTag = stmt('insert_snapshot_role_tag',
        `INSERT INTO guild_snapshot_role_tags
         (snapshot_id, role_id, tag, value)
         VALUES (?, ?, ?, ?)`
    );
    for (const tag of snapshot.roleTags || []) {
        sanitizedRun(insertRoleTag,
            snapshotId,
            tag.roleId,
            tag.tag,
            tag.value || null
        );
    }

    const insertAutomodAction = stmt('insert_snapshot_automod_action',
        `INSERT INTO guild_snapshot_automod_actions
         (snapshot_id, rule_id, action_index, action_type, channel_id, duration_seconds, custom_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const action of snapshot.automodActions || []) {
        sanitizedRun(insertAutomodAction,
            snapshotId,
            action.ruleId,
            action.index ?? 0,
            action.type || null,
            action.channelId || null,
            action.durationSeconds ?? null,
            action.customMessage || null
        );
    }

    const insertAutomodTriggerItem = stmt('insert_snapshot_automod_trigger_item',
        `INSERT INTO guild_snapshot_automod_trigger_items
         (snapshot_id, rule_id, ${triggerKeyColumn}, item_index, value)
         VALUES (?, ?, ?, ?, ?)`
    );
    for (const item of snapshot.automodTriggerItems || []) {
        sanitizedRun(insertAutomodTriggerItem,
            snapshotId,
            item.ruleId,
            item.key,
            item.index ?? 0,
            item.value || null
        );
    }

    const insertAutomodExemptRole = stmt('insert_snapshot_automod_exempt_role',
        `INSERT INTO guild_snapshot_automod_exempt_roles
         (snapshot_id, rule_id, role_id)
         VALUES (?, ?, ?)`
    );
    for (const entry of snapshot.automodExemptRoles || []) {
        sanitizedRun(insertAutomodExemptRole,
            snapshotId,
            entry.ruleId,
            entry.roleId
        );
    }

    const insertAutomodExemptChannel = stmt('insert_snapshot_automod_exempt_channel',
        `INSERT INTO guild_snapshot_automod_exempt_channels
         (snapshot_id, rule_id, channel_id)
         VALUES (?, ?, ?)`
    );
    for (const entry of snapshot.automodExemptChannels || []) {
        sanitizedRun(insertAutomodExemptChannel,
            snapshotId,
            entry.ruleId,
            entry.channelId
        );
    }

    const insertMember = stmt('insert_snapshot_member',
        `INSERT INTO guild_snapshot_members
         (snapshot_id, user_id, nick, joined_at, bot, pending, communication_disabled_until, avatar)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const member of snapshot.members || []) {
        sanitizedRun(insertMember,
            snapshotId,
            member.userId,
            member.nick || null,
            member.joinedAt || null,
            member.bot ? 1 : 0,
            member.pending ? 1 : 0,
            member.communicationDisabledUntil || null,
            member.avatar || null
        );
    }

    const insertMemberRole = stmt('insert_snapshot_member_role',
        `INSERT INTO guild_snapshot_member_roles
         (snapshot_id, user_id, role_id)
         VALUES (?, ?, ?)`
    );
    for (const entry of snapshot.memberRoles || []) {
        sanitizedRun(insertMemberRole,
            snapshotId,
            entry.userId,
            entry.roleId
        );
    }

    return snapshotId;
});

function createGuildSnapshot(snapshot) {
    return insertSnapshotTx(snapshot);
}

function hydrateSnapshot(row) {
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
    const overwrites = stmt('snapshot_overwrites',
        'SELECT * FROM guild_snapshot_channel_overwrites WHERE snapshot_id = ?'
    ).all(row.id);
    const stickers = stmt('snapshot_stickers',
        'SELECT * FROM guild_snapshot_stickers WHERE snapshot_id = ?'
    ).all(row.id);
    const webhooks = stmt('snapshot_webhooks',
        'SELECT * FROM guild_snapshot_webhooks WHERE snapshot_id = ?'
    ).all(row.id);
    const invites = stmt('snapshot_invites',
        'SELECT * FROM guild_snapshot_invites WHERE snapshot_id = ?'
    ).all(row.id);
    const automod = stmt('snapshot_automod',
        'SELECT * FROM guild_snapshot_automod WHERE snapshot_id = ?'
    ).all(row.id);
    const events = stmt('snapshot_events',
        'SELECT * FROM guild_snapshot_events WHERE snapshot_id = ?'
    ).all(row.id);
    const messages = stmt('snapshot_messages',
        'SELECT * FROM guild_snapshot_messages WHERE snapshot_id = ?'
    ).all(row.id);
    const features = stmt('snapshot_features',
        'SELECT * FROM guild_snapshot_features WHERE snapshot_id = ?'
    ).all(row.id);
    const channelTags = stmt('snapshot_channel_tags',
        'SELECT * FROM guild_snapshot_channel_tags WHERE snapshot_id = ?'
    ).all(row.id);
    const roleTags = stmt('snapshot_role_tags',
        'SELECT * FROM guild_snapshot_role_tags WHERE snapshot_id = ?'
    ).all(row.id);
    const automodActions = stmt('snapshot_automod_actions',
        'SELECT * FROM guild_snapshot_automod_actions WHERE snapshot_id = ?'
    ).all(row.id);
    const automodTriggerItems = stmt('snapshot_automod_trigger_items',
        'SELECT * FROM guild_snapshot_automod_trigger_items WHERE snapshot_id = ?'
    ).all(row.id);
    const automodExemptRoles = stmt('snapshot_automod_exempt_roles',
        'SELECT * FROM guild_snapshot_automod_exempt_roles WHERE snapshot_id = ?'
    ).all(row.id);
    const automodExemptChannels = stmt('snapshot_automod_exempt_channels',
        'SELECT * FROM guild_snapshot_automod_exempt_channels WHERE snapshot_id = ?'
    ).all(row.id);
    const members = stmt('snapshot_members',
        'SELECT * FROM guild_snapshot_members WHERE snapshot_id = ?'
    ).all(row.id);
    const memberRoles = stmt('snapshot_member_roles',
        'SELECT * FROM guild_snapshot_member_roles WHERE snapshot_id = ?'
    ).all(row.id);

    return {
        id: row.id,
        guildId: row.guild_id,
        createdAt: row.created_at,
        name: row.name,
        icon: row.icon,
        description: row.description,
        banner: row.banner,
        splash: row.splash,
        discoverySplash: row.discovery_splash,
        vanityURLCode: row.vanity_url_code,
        nsfwLevel: row.nsfw_level,
        mfaLevel: row.mfa_level,
        ownerId: row.owner_id,
        verificationLevel: row.verification_level,
        defaultNotifications: row.default_notifications,
        explicitContentFilter: row.explicit_content_filter,
        preferredLocale: row.preferred_locale,
        premiumTier: row.premium_tier,
        systemChannelId: row.system_channel_id,
        rulesChannelId: row.rules_channel_id,
        afkChannelId: row.afk_channel_id,
        afkTimeout: row.afk_timeout,
        memberCount: row.member_count,
        channelCount: row.channel_count,
        roleCount: row.role_count,
        emojiCount: row.emoji_count,
        checksum: row.checksum,
        features: features.map(f => f.feature),
        channels: channels.map(ch => ({
            id: ch.channel_id,
            name: ch.name,
            type: ch.type,
            parentId: ch.parent_id,
            position: ch.position,
            topic: ch.topic,
            nsfw: !!ch.nsfw,
            rateLimitPerUser: ch.rate_limit_per_user,
            bitrate: ch.bitrate,
            userLimit: ch.user_limit,
            rtcRegion: ch.rtc_region,
            defaultAutoArchiveDuration: ch.default_auto_archive_duration,
            permissionsLocked: !!ch.permissions_locked,
            flags: ch.flags,
            defaultThreadRateLimitPerUser: ch.default_thread_rate_limit_per_user,
            defaultReactionEmojiId: ch.default_reaction_emoji_id,
            defaultReactionEmojiName: ch.default_reaction_emoji_name,
            defaultSortOrder: ch.default_sort_order,
            defaultForumLayout: ch.default_forum_layout,
            videoQualityMode: ch.video_quality_mode,
            archived: !!ch.archived,
            autoArchiveDuration: ch.auto_archive_duration,
            locked: !!ch.locked,
            invitable: !!ch.invitable,
            archiveTimestamp: ch.archive_timestamp
        })),
        channelTags: channelTags.map(t => ({
            channelId: t.channel_id,
            tagId: t.tag_id,
            name: t.name,
            moderated: !!t.moderated,
            emojiId: t.emoji_id,
            emojiName: t.emoji_name
        })),
        roles: roles.map(r => ({
            id: r.role_id,
            name: r.name,
            color: r.color,
            position: r.position,
            permissions: r.permissions,
            mentionable: !!r.mentionable,
            hoist: !!r.hoist,
            managed: !!r.managed,
            icon: r.icon,
            unicodeEmoji: r.unicode_emoji
        })),
        roleTags: roleTags.map(t => ({
            roleId: t.role_id,
            tag: t.tag,
            value: t.value
        })),
        emojis: emojis.map(e => ({
            id: e.emoji_id,
            name: e.name,
            animated: !!e.animated,
            creatorId: e.creator_id,
            createdAt: e.created_at,
            imageUrl: e.image_url,
            imageType: e.image_type,
            imageData: e.image_data
        })),
        overwrites: overwrites.map(o => ({
            channelId: o.channel_id,
            targetId: o.target_id,
            targetType: o.target_type,
            allow: o.allow,
            deny: o.deny
        })),
        stickers: stickers.map(s => ({
            id: s.sticker_id,
            name: s.name,
            description: s.description,
            tags: s.tags,
            formatType: s.format_type,
            type: s.type,
            available: !!s.available,
            sortValue: s.sort_value
        })),
        webhooks: webhooks.map(h => ({
            id: h.webhook_id,
            name: h.name,
            channelId: h.channel_id,
            type: h.type,
            avatar: h.avatar,
            ownerId: h.owner_id,
            applicationId: h.application_id
        })),
        invites: invites.map(i => ({
            code: i.code,
            channelId: i.channel_id,
            maxUses: i.max_uses,
            maxAge: i.max_age,
            temporary: !!i.temporary,
            uses: i.uses,
            createdBy: i.created_by,
            createdAt: i.created_at,
            expiresAt: i.expires_at,
            targetType: i.target_type,
            targetUserId: i.target_user_id,
            targetApplicationId: i.target_application_id
        })),
        automod: automod.map(r => ({
            id: r.rule_id,
            name: r.name,
            enabled: !!r.enabled,
            eventType: r.event_type,
            triggerType: r.trigger_type
        })),
        automodActions: automodActions.map(a => ({
            ruleId: a.rule_id,
            index: a.action_index,
            type: a.action_type,
            channelId: a.channel_id,
            durationSeconds: a.duration_seconds,
            customMessage: a.custom_message
        })),
        automodTriggerItems: automodTriggerItems.map(i => ({
            ruleId: i.rule_id,
            key: i.trigger_key || i.key,
            index: i.item_index,
            value: i.value
        })),
        automodExemptRoles: automodExemptRoles.map(r => ({
            ruleId: r.rule_id,
            roleId: r.role_id
        })),
        automodExemptChannels: automodExemptChannels.map(c => ({
            ruleId: c.rule_id,
            channelId: c.channel_id
        })),
        events: events.map(ev => ({
            id: ev.event_id,
            name: ev.name,
            description: ev.description,
            startTime: ev.start_time,
            endTime: ev.end_time,
            entityType: ev.entity_type,
            status: ev.status,
            location: ev.location,
            channelId: ev.channel_id,
            privacyLevel: ev.privacy_level,
            creatorId: ev.creator_id,
            image: ev.image
        })),
        messages: messages.map(m => ({
            channelId: m.channel_id,
            messageId: m.message_id,
            authorId: m.author_id,
            content: m.content,
            createdAt: m.created_at
        })),
        members: members.map(m => ({
            userId: m.user_id,
            nick: m.nick,
            joinedAt: m.joined_at,
            bot: !!m.bot,
            pending: !!m.pending,
            communicationDisabledUntil: m.communication_disabled_until,
            avatar: m.avatar
        })),
        memberRoles: memberRoles.map(r => ({
            userId: r.user_id,
            roleId: r.role_id
        }))
    };
}

function getLatestGuildSnapshot(guildId) {
    const row = stmt('latest_snapshot',
        'SELECT * FROM guild_snapshots WHERE guild_id = ? ORDER BY id DESC LIMIT 1'
    ).get(guildId);
    return hydrateSnapshot(row);
}

function getSnapshotById(snapshotId) {
    const row = stmt('snapshot_by_id',
        'SELECT * FROM guild_snapshots WHERE id = ?'
    ).get(snapshotId);
    return hydrateSnapshot(row);
}

function listGuildSnapshots(guildId, limit = 5) {
    return stmt('list_snapshots',
        'SELECT id, created_at, name, member_count, channel_count, role_count, emoji_count FROM guild_snapshots WHERE guild_id = ? ORDER BY id DESC LIMIT ?'
    ).all(guildId, limit);
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
    createGuildSnapshot, getLatestGuildSnapshot, getSnapshotById, listGuildSnapshots, pruneGuildSnapshots,
    logSecurityEvent,
    close
};
