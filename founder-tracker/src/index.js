require('dotenv').config();
const cron = require('node-cron');
const { initDb } = require('../db/init');

const db = initDb();

// Weekly digest: every Monday at 08:00
cron.schedule('0 8 * * 1', async () => {
  const { buildDigest } = require('./digest/weekly');
  await buildDigest(db);
});

console.log('Founder tracker running. Weekly digest scheduled for Mondays 08:00.');
