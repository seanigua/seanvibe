require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, 'leads.sqlite');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

function initDb() {
  const isNew = !fs.existsSync(DB_PATH);
  const db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

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
