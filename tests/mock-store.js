'use strict';

// In-memory store that replaces src/store.js via require.cache injection
class MockStore {
    constructor() {
        this.data = new Map();
        this.auditLog = [];
    }

    read(filename, fallback = null) {
        if (this.data.has(filename)) {
            return JSON.parse(JSON.stringify(this.data.get(filename)));
        }
        return fallback;
    }

    write(filename, data) {
        this.data.set(filename, JSON.parse(JSON.stringify(data)));
    }

    update(filename, fn, fallback = null) {
        const current = this.read(filename, fallback);
        const updated = fn(current);
        this.write(filename, updated);
        return updated;
    }

    cleanupConversations() { return 0; }

    logAudit(guildId, userId, toolName, args, result) {
        this.auditLog.push({ guildId, userId, toolName, args, result, timestamp: new Date().toISOString() });
    }

    getAuditTrail(guildId, limit = 25, toolName = null) {
        let entries = this.auditLog.filter(e => e.guildId === guildId);
        if (toolName) entries = entries.filter(e => e.toolName === toolName);
        return entries.slice(-limit).reverse();
    }

    addTempBan(guildId, userId, username, unbanAt, reason) {
        if (!this._tempBans) this._tempBans = [];
        this._tempBans.push({ id: this._tempBans.length + 1, guild_id: guildId, user_id: userId, username, unban_at: unbanAt, reason });
    }

    getExpiredTempBans() {
        if (!this._tempBans) return [];
        const now = new Date().toISOString();
        return this._tempBans.filter(b => b.unban_at <= now);
    }

    removeTempBan(id) {
        if (!this._tempBans) return;
        this._tempBans = this._tempBans.filter(b => b.id !== id);
    }

    close() {}

    clear() {
        this.data.clear();
        this.auditLog = [];
        this._tempBans = [];
    }
}

module.exports = new MockStore();
