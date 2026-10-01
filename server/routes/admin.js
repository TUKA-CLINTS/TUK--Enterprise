// Admin panel data: audit trail, notifications and recovery-request review.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { notify, wrap } = require('../mailer');
const { logActivity } = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

function safeLimit(value, fallback = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(500, Math.floor(n));
}

// ---- audit trail --------------------------------------------------------------
router.get('/activity', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, user_id, user_name, user_email, department, role, action, entity, entity_id, details, ip, user_agent, created_at FROM activity_log ORDER BY id DESC LIMIT ?',
      [safeLimit(req.query.limit)]
    );
    res.json({ entries: rows });
  } catch (err) { next(err); }
});

// ---- notifications -------------------------------------------------------------
router.get('/notifications', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, user_id, to_email, type, subject, body, status, error, created_at FROM notifications ORDER BY created_at DESC LIMIT ?',
      [safeLimit(req.query.limit)]
    );
    res.json({ notifications: rows });
  } catch (err) { next(err); }
});

// ---- recovery requests ----------------------------------------------------------
router.get('/recovery-requests', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.email, r.status, r.submitted_doc_type, r.submitted_doc_number, r.submitted_image,
              r.registered_doc_id, r.code_attempts, r.ip, r.user_agent, r.created_at, r.updated_at, r.completed_at,
              u.name AS user_name, u.id AS user_id,
              d.doc_number AS registered_doc_number, d.image_data AS registered_image
       FROM recovery_requests r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN recovery_documents d ON d.id = r.registered_doc_id
       ORDER BY r.created_at DESC
       LIMIT 200`
    );
    res.json({ requests: rows });
  } catch (err) { next(err); }
});

router.put('/recovery-requests/:id/approve', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM recovery_requests WHERE id = ? LIMIT 1', [req.params.id]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'Request not found.' });
    if (r.status !== 'needs_review') return res.status(400).json({ error: 'Only requests waiting for review can be approved.' });
    await pool.query("UPDATE recovery_requests SET status = 'approved', updated_at = ? WHERE id = ?", [Date.now(), r.id]);
    await notify({
      userId: r.user_id, to: r.email, type: 'recovery_approved', subject: 'Your TUK@ recovery was approved',
      html: wrap('Recovery approved', '<p>An administrator approved your account recovery. Open the recovery page (from the sign-in screen) and set a new password.</p>')
    });
    logActivity(req, { action: 'recovery.admin_approved', entity: 'recovery_requests', entityId: r.id, details: { email: r.email } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/recovery-requests/:id/deny', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM recovery_requests WHERE id = ? LIMIT 1', [req.params.id]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'Request not found.' });
    if (['completed', 'denied', 'expired'].includes(r.status)) return res.status(400).json({ error: 'This request is already closed.' });
    await pool.query("UPDATE recovery_requests SET status = 'denied', updated_at = ? WHERE id = ?", [Date.now(), r.id]);
    await notify({
      userId: r.user_id, to: r.email, type: 'recovery_denied', subject: 'Your TUK@ recovery was denied',
      html: wrap('Recovery denied', '<p>An administrator denied this account recovery request. If you still cannot sign in, contact the head-office administrator.</p>')
    });
    logActivity(req, { action: 'recovery.admin_denied', entity: 'recovery_requests', entityId: r.id, details: { email: r.email } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
