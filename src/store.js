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
        name TEXT,
        icon TEXT,
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
        PRIMARY KEY (snapshot_id, sticker_id),
        FOREIGN KEY(snapshot_id) REFERENCES guild_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_snapshot_webhooks (
        snapshot_id INTEGER NOT NULL,
        webhook_id TEXT NOT NULL,
        name TEXT,
        channel_id TEXT,
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

        ['guild_snapshot_roles', 'name', 'TEXT'],
        ['guild_snapshot_roles', 'color', 'INTEGER'],
        ['guild_snapshot_roles', 'position', 'INTEGER'],
        ['guild_snapshot_roles', 'permissions', 'TEXT'],
        ['guild_snapshot_roles', 'mentionable', 'INTEGER'],
        ['guild_snapshot_roles', 'hoist', 'INTEGER'],
        ['guild_snapshot_roles', 'managed', 'INTEGER'],

        ['guild_snapshot_emojis', 'name', 'TEXT'],
        ['guild_snapshot_emojis', 'animated', 'INTEGER'],

        ['guild_snapshot_channel_overwrites', 'target_type', 'TEXT'],
        ['guild_snapshot_channel_overwrites', 'allow', 'TEXT'],
        ['guild_snapshot_channel_overwrites', 'deny', 'TEXT'],

        ['guild_snapshot_stickers', 'name', 'TEXT'],
        ['guild_snapshot_stickers', 'description', 'TEXT'],
        ['guild_snapshot_stickers', 'tags', 'TEXT'],
        ['guild_snapshot_stickers', 'format_type', 'INTEGER'],

        ['guild_snapshot_webhooks', 'name', 'TEXT'],
        ['guild_snapshot_webhooks', 'channel_id', 'TEXT'],

        ['guild_snapshot_invites', 'channel_id', 'TEXT'],
        ['guild_snapshot_invites', 'max_uses', 'INTEGER'],
        ['guild_snapshot_invites', 'max_age', 'INTEGER'],
        ['guild_snapshot_invites', 'temporary', 'INTEGER'],
        ['guild_snapshot_invites', 'uses', 'INTEGER'],
        ['guild_snapshot_invites', 'created_by', 'TEXT'],

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
        `INSERT INTO guild_snapshots (
            guild_id, created_at, name, icon, verification_level, default_notifications,
            explicit_content_filter, preferred_locale, premium_tier,
            system_channel_id, rules_channel_id, afk_channel_id, afk_timeout,
            member_count, channel_count, role_count, emoji_count, checksum
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        snapshot.guildId,
        now,
        snapshot.name || null,
        snapshot.icon || null,
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
         (snapshot_id, channel_id, name, type, parent_id, position, topic, nsfw, rate_limit_per_user, bitrate, user_limit, rtc_region, default_auto_archive_duration)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ch of snapshot.channels || []) {
        insertChannel.run(
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
            ch.defaultAutoArchiveDuration ?? null
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

    const insertOverwrite = stmt('insert_snapshot_overwrite',
        `INSERT INTO guild_snapshot_channel_overwrites
         (snapshot_id, channel_id, target_id, target_type, allow, deny)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const ow of snapshot.overwrites || []) {
        insertOverwrite.run(
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
         (snapshot_id, sticker_id, name, description, tags, format_type)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const sticker of snapshot.stickers || []) {
        insertSticker.run(
            snapshotId,
            sticker.id,
            sticker.name,
            sticker.description || null,
            sticker.tags || null,
            sticker.formatType ?? null
        );
    }

    const insertWebhook = stmt('insert_snapshot_webhook',
        `INSERT INTO guild_snapshot_webhooks
         (snapshot_id, webhook_id, name, channel_id)
         VALUES (?, ?, ?, ?)`
    );
    for (const hook of snapshot.webhooks || []) {
        insertWebhook.run(
            snapshotId,
            hook.id,
            hook.name || null,
            hook.channelId || null
        );
    }

    const insertInvite = stmt('insert_snapshot_invite',
        `INSERT INTO guild_snapshot_invites
         (snapshot_id, code, channel_id, max_uses, max_age, temporary, uses, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const invite of snapshot.invites || []) {
        insertInvite.run(
            snapshotId,
            invite.code,
            invite.channelId || null,
            invite.maxUses ?? null,
            invite.maxAge ?? null,
            invite.temporary ? 1 : 0,
            invite.uses ?? null,
            invite.createdBy || null
        );
    }

    const insertAutomod = stmt('insert_snapshot_automod',
        `INSERT INTO guild_snapshot_automod
         (snapshot_id, rule_id, name, enabled, event_type, trigger_type, actions, exempt_roles, exempt_channels)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const rule of snapshot.automod || []) {
        insertAutomod.run(
            snapshotId,
            rule.id,
            rule.name || null,
            rule.enabled ? 1 : 0,
            rule.eventType || null,
            rule.triggerType || null,
            rule.actions || null,
            rule.exemptRoles || null,
            rule.exemptChannels || null
        );
    }

    const insertEvent = stmt('insert_snapshot_event',
        `INSERT INTO guild_snapshot_events
         (snapshot_id, event_id, name, description, start_time, end_time, entity_type, status, location, channel_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ev of snapshot.events || []) {
        insertEvent.run(
            snapshotId,
            ev.id,
            ev.name || null,
            ev.description || null,
            ev.startTime || null,
            ev.endTime || null,
            ev.entityType || null,
            ev.status || null,
            ev.location || null,
            ev.channelId || null
        );
    }

    const insertMessage = stmt('insert_snapshot_message',
        `INSERT INTO guild_snapshot_messages
         (snapshot_id, channel_id, message_id, author_id, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const msg of snapshot.messages || []) {
        insertMessage.run(
            snapshotId,
            msg.channelId,
            msg.messageId,
            msg.authorId || null,
            msg.content || null,
            msg.createdAt || null
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

    return {
        id: row.id,
        guildId: row.guild_id,
        createdAt: row.created_at,
        name: row.name,
        icon: row.icon,
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
            defaultAutoArchiveDuration: ch.default_auto_archive_duration
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
            formatType: s.format_type
        })),
        webhooks: webhooks.map(h => ({
            id: h.webhook_id,
            name: h.name,
            channelId: h.channel_id
        })),
        invites: invites.map(i => ({
            code: i.code,
            channelId: i.channel_id,
            maxUses: i.max_uses,
            maxAge: i.max_age,
            temporary: !!i.temporary,
            uses: i.uses,
            createdBy: i.created_by
        })),
        automod: automod.map(r => ({
            id: r.rule_id,
            name: r.name,
            enabled: !!r.enabled,
            eventType: r.event_type,
            triggerType: r.trigger_type,
            actions: r.actions,
            exemptRoles: r.exempt_roles,
            exemptChannels: r.exempt_channels
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
            channelId: ev.channel_id
        })),
        messages: messages.map(m => ({
            channelId: m.channel_id,
            messageId: m.message_id,
            authorId: m.author_id,
            content: m.content,
            createdAt: m.created_at
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
