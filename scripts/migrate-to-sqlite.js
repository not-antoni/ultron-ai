#!/usr/bin/env node

/**
 * Migrate JSON file storage → SQLite database.
 * Reads all .json files from data/, inserts into ultron.db,
 * and renames processed files to .json.migrated.
 *
 * Safe to run multiple times (idempotent via UPSERT).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
    console.log('No data/ directory found. Nothing to migrate.');
    process.exit(0);
}

// Import store to ensure DB + tables are created
const store = require('../src/store');

const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
if (files.length === 0) {
    console.log('No JSON files found in data/. Nothing to migrate.');
    process.exit(0);
}

const counts = { guild_config: 0, conversations: 0, filters: 0, documents: 0, memory: 0, skipped: 0 };

for (const file of files) {
    const filePath = path.join(DATA_DIR, file);

    // Determine entity type from filename
    let type = null;
    if (file.startsWith('guild-')) type = 'guild_config';
    else if (file.startsWith('conversations-')) type = 'conversations';
    else if (file.startsWith('filters-')) type = 'filters';
    else if (file.startsWith('documents-')) type = 'documents';
    else if (file.startsWith('memory-')) type = 'memory';

    if (!type) {
        counts.skipped++;
        continue;
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        JSON.parse(raw); // Validate JSON before migrating

        // Use store.write which handles the filename → table mapping
        // We read the raw data and pass it through store.write
        const data = JSON.parse(raw);
        store.write(file, data);

        // Rename to .migrated
        fs.renameSync(filePath, filePath + '.migrated');
        counts[type]++;
        console.log(`  ✓ ${file}`);
    } catch (err) {
        console.error(`  ✗ ${file}: ${err.message}`);
        counts.skipped++;
    }
}

console.log('\nMigration complete:');
console.log(`  Guild configs:  ${counts.guild_config}`);
console.log(`  Conversations:  ${counts.conversations}`);
console.log(`  Filters:        ${counts.filters}`);
console.log(`  Documents:      ${counts.documents}`);
console.log(`  Memories:       ${counts.memory}`);
if (counts.skipped > 0) console.log(`  Skipped:        ${counts.skipped}`);

store.close();
