const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
    return path.join(DATA_DIR, name);
}

function read(name, fallback = null) {
    try {
        const data = fs.readFileSync(filePath(name), 'utf8');
        return JSON.parse(data);
    } catch {
        return fallback;
    }
}

function write(name, data) {
    const target = filePath(name);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, target);
}

function update(name, fn, fallback = null) {
    const current = read(name, fallback);
    const updated = fn(current);
    write(name, updated);
    return updated;
}

module.exports = { read, write, update };
