/* Sends this machine's database to a freshly deployed backend's one-time
   import endpoint (see migrate.js).

   Usage (from backend/):
     node scripts/export-to-server.js https://your-app.up.railway.app <MIGRATION_TOKEN>

   Reads PICKLE_DB_PATH if set, otherwise backend/data.sqlite. Sessions and
   pending sign-ups are left behind on purpose — people log in again. */
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const [target, token] = process.argv.slice(2);
if (!target || !token) {
  console.error('Usage: node scripts/export-to-server.js <server-url> <migration-token>');
  process.exit(1);
}

const dbPath = process.env.PICKLE_DB_PATH || path.join(__dirname, '..', 'data.sqlite');
const db = new DatabaseSync(dbPath, { readOnly: true });
const payload = {};
for (const table of ['players', 'events', 'chats', 'history', 'config']) {
  payload[table] = db.prepare(`SELECT * FROM ${table}`).all().map(row => ({ ...row }));
}
db.close();

(async () => {
  const res = await fetch(`${target.replace(/\/+$/, '')}/api/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Migration-Token': token },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Import failed (${res.status}):`, body.error || body);
    process.exit(1);
  }
  console.log('Imported:', body.imported);
})().catch(e => { console.error(e.message); process.exit(1); });
