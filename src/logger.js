const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_NAMES = ['DEBUG', 'INFO ', 'WARN ', 'ERROR'];

let currentLevel = LEVELS.info;
let logStream = null;

function init(opts = {}) {
    currentLevel = LEVELS[opts.level] ?? LEVELS.info;
    if (opts.file) {
        const dir = path.dirname(opts.file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        logStream = fs.createWriteStream(opts.file, { flags: 'a' });
    }
}

function format(level, prefix, msg, args) {
    const ts = new Date().toISOString();
    const lvl = LEVEL_NAMES[level];
    const pfx = prefix ? `[${prefix}] ` : '';
    const extra = args.map(a =>
        a instanceof Error ? (a.stack || a.message) : (typeof a === 'string' ? a : JSON.stringify(a))
    ).join(' ');
    return `${ts} ${lvl} ${pfx}${msg}${extra ? ' ' + extra : ''}`;
}

function log(level, prefix, msg, ...args) {
    if (level < currentLevel) return;
    const line = format(level, prefix, msg, args);
    if (level >= LEVELS.error) console.error(line);
    else if (level >= LEVELS.warn) console.warn(line);
    else console.log(line);
    if (logStream) logStream.write(line + '\n');
}

function createLogger(prefix) {
    return {
        debug: (msg, ...args) => log(LEVELS.debug, prefix, msg, ...args),
        info: (msg, ...args) => log(LEVELS.info, prefix, msg, ...args),
        warn: (msg, ...args) => log(LEVELS.warn, prefix, msg, ...args),
        error: (msg, ...args) => log(LEVELS.error, prefix, msg, ...args)
    };
}

module.exports = { init, createLogger, LEVELS };
