const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const pool = require('../db');
const { requireAuth, requireRole, publicUser } = require('../middleware');
const { notify, wrap } = require('../mailer');
const { logActivity } = require('../audit');

const router = express.Router();
const DEPARTMENTS = ['shop', 'transport', 'restaurant', 'head-office'];

function cleanId(value) { return String(value || '').trim(); }

async function loadApplication(id) {
  const [rows] = await pool.query('SELECT * FROM account_applications WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function notifyAdmins(subject, title, body) {
  const [admins] = await pool.query("SELECT id, email FROM users WHERE role = 'admin' AND status = 'active' AND deleted = 0");
  await Promise.all(admins.map((admin) => notify({
    userId: admin.id, to: admin.email, type: 'account_application', subject, html: wrap(title, body)
  })));
}

router.get('/', requireAuth, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const params = [];
    let where = '';
    if (req.user.role === 'manager') {
      where = 'WHERE department = ?';
      params.push(req.user.department);
    }
    const [rows] = await pool.query(`SELECT id, name, email, phone, department, requirements, status, manager_id, admin_id, rejection_reason, user_id, created_at, updated_at FROM account_applications ${where} ORDER BY created_at DESC`, params);
    res.json({ applications: rows });
  } catch (err) { next(err); }
});

router.put('/:id/forward', requireAuth, requireRole('manager'), async (req, res, next) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application || application.department !== req.user.department) return res.status(404).json({ error: 'Application not found.' });
    if (application.status !== 'submitted') return res.status(400).json({ error: 'Only submitted applications can be forwarded.' });
    await pool.query("UPDATE account_applications SET status = 'forwarded', manager_id = ?, updated_at = ? WHERE id = ?", [req.user.id, Date.now(), application.id]);
    await notifyAdmins('New account application requires approval', 'Account application forwarded', `<p>${application.name} has been verified by the ${application.department} manager and is awaiting your approval.</p><p><strong>Requirements:</strong> ${application.requirements}</p>`);
    logActivity(req, { action: 'account_application.forwarded', entity: 'account_applications', entityId: application.id, details: { email: application.email } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/:id/approve', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    if (application.status !== 'forwarded') return res.status(400).json({ error: 'Only forwarded applications can be approved.' });
    await pool.query("UPDATE account_applications SET status = 'approved', admin_id = ?, updated_at = ? WHERE id = ?", [req.user.id, Date.now(), application.id]);
    await notify({ userId: '', to: application.email, type: 'account_approved', subject: 'Your TUK@ application was approved', html: wrap('Application approved', '<p>Your application was approved by the administrator. Your department manager will now create your login credentials.</p>') });
    logActivity(req, { action: 'account_application.approved', entity: 'account_applications', entityId: application.id, details: { email: application.email } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/:id/reject', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    if (application.status !== 'forwarded') return res.status(400).json({ error: 'Only forwarded applications can be rejected.' });
    const reason = cleanId(req.body && req.body.reason) || 'The administrator did not approve this application.';
    await pool.query("UPDATE account_applications SET status = 'rejected', admin_id = ?, rejection_reason = ?, updated_at = ? WHERE id = ?", [req.user.id, reason.slice(0, 500), Date.now(), application.id]);
    await notify({ userId: '', to: application.email, type: 'account_rejected', subject: 'Your TUK@ application was rejected', html: wrap('Application rejected', `<p>Your application was not approved by the administrator.</p><p><strong>Reason:</strong> ${reason}</p>`)});
    logActivity(req, { action: 'account_application.rejected', entity: 'account_applications', entityId: application.id, details: { email: application.email, reason } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/credentials', requireAuth, requireRole('manager'), async (req, res, next) => {
  try {
    const application = await loadApplication(req.params.id);
    const password = String(req.body && req.body.password || '');
    if (!application || application.department !== req.user.department) return res.status(404).json({ error: 'Application not found.' });
    if (application.status !== 'approved') return res.status(400).json({ error: 'Admin approval is required before credentials can be created.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ? AND deleted = 0 LIMIT 1', [application.email]);
    if (existing.length) return res.status(409).json({ error: 'An account with this email already exists.' });
    const ts = Date.now();
    const id = randomUUID();
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (id, name, email, phone, password_hash, department, role, status, created_at, updated_at, deleted) VALUES (?,?,?,?,?,?,?,?,?,?,0)', [id, application.name, application.email, application.phone, hash, application.department, 'staff', 'active', ts, ts]);
    await pool.query("UPDATE account_applications SET status = 'credentials_created', manager_id = ?, user_id = ?, updated_at = ? WHERE id = ?", [req.user.id, id, ts, application.id]);
    await notify({ userId: id, to: application.email, type: 'account_created', subject: 'Your TUK@ login credentials are ready', html: wrap('Account created', `<p>Your manager created your TUK@ account.</p><p><strong>Email:</strong> ${application.email}<br><strong>Temporary password:</strong> ${password}</p><p>Sign in and change this password as soon as possible.</p>`) });
    logActivity(req, { userId: id, userName: application.name, userEmail: application.email, department: application.department, role: 'staff', action: 'account_application.credentials_created', entity: 'users', entityId: id });
    const [rows] = await pool.query('SELECT id, name, email, phone, department, role, status, created_at, updated_at FROM users WHERE id = ?', [id]);
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) { next(err); }
});

module.exports = router;