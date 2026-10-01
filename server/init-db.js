// Creates the `tukent` database and all tables by executing schema.sql.
// Run with: npm run init-db
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'UTF8MB4_UNICODE_CI',
    multipleStatements: true
  });
  try {
    await conn.query(sql);
    console.log('[init-db] Database "tukent" and all tables are ready.');
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('[init-db] Failed:', err.message);
  process.exit(1);
});
