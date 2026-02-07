'use strict';

// In-memory store that replaces src/store.js via require.cache injection
class MockStore {
    constructor() {
        this.data = new Map();
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

    clear() {
        this.data.clear();
    }
}

module.exports = new MockStore();
