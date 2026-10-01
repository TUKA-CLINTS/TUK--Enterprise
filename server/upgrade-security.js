// One-time upgrade: adds the security & audit tables to an existing database.
// Safe to re-run (CREATE TABLE IF NOT EXISTS everywhere).
// Run with: npm run upgrade:security
const { randomUUID } = require('crypto');
const pool = require('./db');

// Tiny placeholder image so the demo recovery flow works before the admin
// captures their real document (replace it from the Security page).
const PLACEHOLDER_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS recovery_documents (
    id         CHAR(36)      NOT NULL PRIMARY KEY,
    user_id    CHAR(36)      NOT NULL,
    doc_type   VARCHAR(30)   NOT NULL,
    doc_number VARCHAR(100)  NOT NULL DEFAULT '',
    image_data MEDIUMTEXT    NOT NULL,
    created_at BIGINT        NOT NULL DEFAULT 0,
    updated_at BIGINT        NOT NULL DEFAULT 0,
    deleted    TINYINT(1)    NOT NULL DEFAULT 0,
    KEY idx_recdocs_user (user_id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS recovery_requests (
    id                   CHAR(36)     NOT NULL PRIMARY KEY,
    user_id              CHAR(36)     NOT NULL,
    email                VARCHAR(160) NOT NULL DEFAULT '',
    code_hash            VARCHAR(100) NOT NULL DEFAULT '',
    code_expires_at      BIGINT       NOT NULL DEFAULT 0,
    code_attempts        INT          NOT NULL DEFAULT 0,
    status               VARCHAR(30)  NOT NULL DEFAULT 'awaiting_code',
    submitted_doc_type   VARCHAR(30)  NOT NULL DEFAULT '',
    submitted_doc_number VARCHAR(100) NOT NULL DEFAULT '',
    submitted_image      MEDIUMTEXT   NULL,
    registered_doc_id    CHAR(36)     NOT NULL DEFAULT '',
    ip                   VARCHAR(45)  NOT NULL DEFAULT '',
    user_agent           VARCHAR(255) NOT NULL DEFAULT '',
    created_at           BIGINT       NOT NULL DEFAULT 0,
    updated_at           BIGINT       NOT NULL DEFAULT 0,
    completed_at         BIGINT       NOT NULL DEFAULT 0,
    KEY idx_recreq_user (user_id),
    KEY idx_recreq_status (status),
    KEY idx_recreq_created (created_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id         CHAR(36)     NOT NULL PRIMARY KEY,
    user_id    CHAR(36)     NOT NULL DEFAULT '',
    to_email   VARCHAR(160) NOT NULL DEFAULT '',
    type       VARCHAR(40)  NOT NULL DEFAULT '',
    subject    VARCHAR(200) NOT NULL DEFAULT '',
    body       MEDIUMTEXT   NULL,
    status     VARCHAR(20)  NOT NULL DEFAULT 'queued',
    error      VARCHAR(255) NOT NULL DEFAULT '',
    created_at BIGINT       NOT NULL DEFAULT 0,
    KEY idx_notifications_user (user_id),
    KEY idx_notifications_created (created_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS activity_log (
    id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id    CHAR(36)     NULL,
    user_name  VARCHAR(120) NOT NULL DEFAULT '',
    user_email VARCHAR(160) NOT NULL DEFAULT '',
    department VARCHAR(20)  NOT NULL DEFAULT '',
    role       VARCHAR(20)  NOT NULL DEFAULT '',
    action     VARCHAR(60)  NOT NULL DEFAULT '',
    entity     VARCHAR(40)  NOT NULL DEFAULT '',
    entity_id  VARCHAR(36)  NOT NULL DEFAULT '',
    details    TEXT         NULL,
    ip         VARCHAR(45)  NOT NULL DEFAULT '',
    user_agent VARCHAR(255) NOT NULL DEFAULT '',
    created_at BIGINT       NOT NULL DEFAULT 0,
    KEY idx_activity_created (created_at),
    KEY idx_activity_user (user_id),
    KEY idx_activity_action (action)
  ) ENGINE=InnoDB`
];

(async () => {
  console.log('[upgrade] Adding security & audit tables...');
  for (const sql of TABLES) {
    await pool.query(sql);
  }
  console.log('  + recovery_documents, recovery_requests, notifications, activity_log');

  // Give the seeded admin a placeholder National ID so the recovery flow can
  // be demonstrated immediately (doc number: 12345678).
  const [admins] = await pool.query(
    "SELECT id, email FROM users WHERE role = 'admin' AND deleted = 0 AND email = 'admin@tuk.enterprises' LIMIT 1"
  );
  if (admins.length) {
    const [docs] = await pool.query('SELECT id FROM recovery_documents WHERE user_id = ? AND deleted = 0 LIMIT 1', [admins[0].id]);
    if (!docs.length) {
      const ts = Date.now();
      await pool.query(
        'INSERT INTO recovery_documents (id, user_id, doc_type, doc_number, image_data, created_at, updated_at, deleted) VALUES (?,?,?,?,?,?,?,0)',
        [randomUUID(), admins[0].id, 'national_id', '12345678', PLACEHOLDER_IMAGE, ts, ts]
      );
      console.log('  + placeholder National ID (number 12345678) for admin@tuk.enterprises');
      console.log('    -> replace it with a real capture from the Security page');
    } else {
      console.log('  = admin already has recovery documents');
    }
  }

  console.log('[upgrade] Done.');
  await pool.end();
})().catch((err) => {
  console.error('[upgrade] Failed:', err.message);
  process.exit(1);
});
