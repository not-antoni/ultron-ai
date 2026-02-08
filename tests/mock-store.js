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

    close() {}

    clear() {
        this.data.clear();
        this.auditLog = [];
    }
}

module.exports = new MockStore();
