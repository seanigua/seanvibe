require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, 'leads.sqlite');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

// Columns added after initial schema — applied via ALTER TABLE on existing DBs.
// SQLite has no ADD COLUMN IF NOT EXISTS, so each migration is wrapped in
// try/catch; the "duplicate column name" error is silently swallowed.
const COLUMN_MIGRATIONS = [
  'ALTER TABLE leads ADD COLUMN raw_bio             TEXT',
  'ALTER TABLE leads ADD COLUMN github_followers   INTEGER DEFAULT 0',
  'ALTER TABLE leads ADD COLUMN github_bio         TEXT',
  'ALTER TABLE leads ADD COLUMN github_enriched_at DATETIME',
  'ALTER TABLE leads ADD COLUMN linkedin_headline  TEXT',
  'ALTER TABLE leads ADD COLUMN linkedin_summary   TEXT',
];

function applyMigrations(db) {
  for (const sql of COLUMN_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err) {
      // "duplicate column name" is expected on re-runs — anything else re-throws
      if (!err.message.includes('duplicate column name')) throw err;
    }
  }
}

function initDb() {
  const isNew = !fs.existsSync(DB_PATH);
  const db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  applyMigrations(db);

  if (isNew) {
    console.log('Database created and schema applied:', DB_PATH);
  } else {
    console.log('Database schema verified:', DB_PATH);
  }

  return db;
}

module.exports = { initDb, DB_PATH };

if (require.main === module) {
  initDb();
  process.exit(0);
}
