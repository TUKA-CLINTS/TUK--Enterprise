// Employee / account management (online only, ADMIN ONLY).
// The admin is the single point of control: every account, every department.
// Managers and staff have no access to these routes at all.
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const pool = require('../db');
const { requireAuth, requireRole, publicUser } = require('../middleware');
const { notify, wrap } = require('../mailer');
const { logActivity } = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const DEPARTMENTS = ['shop', 'transport', 'restaurant', 'head-office'];
const ROLES = ['admin', 'manager', 'staff'];
const STATUSES = ['active', 'disabled'];

const SELECT_USER = 'SELECT id, name, email, phone, password_hash, department, role, status, created_at, updated_at FROM users';

async function loadUser(id) {
  const [rows] = await pool.query(`${SELECT_USER} WHERE id = ? AND deleted = 0 LIMIT 1`, [id]);
  return rows[0] || null;
}

async function activeAdminCount() {
  const [rows] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active' AND deleted = 0");
  return rows[0].c;
}

function clean(body) {
  return {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    phone: String(body.phone || '').trim(),
    department: String(body.department || '').trim(),
    role: String(body.role || '').trim(),
    status: String(body.status || '').trim()
  };
}

// GET /api/users - list every account (admin only).
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`${SELECT_USER} WHERE deleted = 0 ORDER BY department, name`);
    res.json({ users: rows.map(publicUser) });
  } catch (err) {
    next(err);
  }
});

// POST /api/users - create an account in any department / role.
router.post('/', async (req, res, next) => {
  try {
    const { password = '' } = req.body || {};
    const u = clean(req.body || {});
    if (u.name.length < 2) return res.status(400).json({ error: 'Enter the employee name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    if (!DEPARTMENTS.includes(u.department)) return res.status(400).json({ error: 'Choose a valid department.' });
    if (!ROLES.includes(u.role)) return res.status(400).json({ error: 'Choose a valid role.' });

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [u.email]);
    if (existing.length) return res.status(409).json({ error: 'An account with this email already exists.' });

    const ts = Date.now();
    const hash = await bcrypt.hash(String(password), 10);
    const id = randomUUID();
    await pool.query(
      'INSERT INTO users (id, name, email, phone, password_hash, department, role, status, created_at, updated_at, deleted) VALUES (?,?,?,?,?,?,?,?,?,?,0)',
      [id, u.name, u.email, u.phone, hash, u.department, u.role, 'active', ts, ts]
    );
    const created = await loadUser(id);
    logActivity(req, { action: 'users.created', entity: 'users', entityId: id, details: { email: u.email, department: u.department, role: u.role } });
    res.status(201).json({ user: publicUser(created) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id - update an account (optional password reset).
router.put('/:id', async (req, res, next) => {
  try {
    const target = await loadUser(req.params.id);
    if (!target) return res.status(404).json({ error: 'Account not found.' });

    const { password = '' } = req.body || {};
    const u = clean(req.body || {});

    // Nobody can remove their own admin rights or disable themselves.
    if (target.id === req.user.id && (u.role !== 'admin' || u.status !== 'active')) {
      return res.status(400).json({ error: 'You cannot change your own role or status.' });
    }
    // Always keep at least one active admin.
    const losingAdmin = target.role === 'admin' && target.status === 'active' && (u.role !== 'admin' || u.status !== 'active');
    if (losingAdmin && (await activeAdminCount()) <= 1) {
      return res.status(400).json({ error: 'At least one active admin account must remain.' });
    }

    if (u.name.length < 2) return res.status(400).json({ error: 'Enter the employee name.' });
    if (!DEPARTMENTS.includes(u.department) || !ROLES.includes(u.role) || !STATUSES.includes(u.status)) {
      return res.status(400).json({ error: 'Invalid department, role or status.' });
    }

    const ts = Date.now();
    const fields = ['name = ?', 'phone = ?', 'department = ?', 'role = ?', 'status = ?', 'updated_at = ?'];
    const values = [u.name, u.phone, u.department, u.role, u.status, ts];
    if (String(password)) {
      if (String(password).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
      fields.push('password_hash = ?');
      values.push(await bcrypt.hash(String(password), 10));
    }
    values.push(target.id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    const updated = await loadUser(target.id);
    logActivity(req, {
      action: 'users.updated', entity: 'users', entityId: target.id,
      details: { email: target.email, department: u.department, role: u.role, status: u.status, passwordReset: !!String(password) }
    });
    // Tell the owner when their password has been reset by an administrator.
    if (String(password)) {
      notify({
        userId: target.id,
        to: target.email,
        type: 'password_changed',
        subject: 'Your TUK@ password was changed',
        html: wrap('Password changed', `<p>An administrator just changed the password of your account <strong>${target.email}</strong>.</p><p>If this was not you, contact your administrator immediately.</p>`)
      });
    }
    res.json({ user: publicUser(updated) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id - soft delete (the router already requires admin).
router.delete('/:id', async (req, res, next) => {
  try {
    const target = await loadUser(req.params.id);
    if (!target) return res.status(404).json({ error: 'Account not found.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    if (target.role === 'admin' && target.status === 'active' && (await activeAdminCount()) <= 1) {
      return res.status(400).json({ error: 'At least one active admin account must remain.' });
    }
    await pool.query('UPDATE users SET deleted = 1, updated_at = ? WHERE id = ?', [Date.now(), target.id]);
    logActivity(req, { action: 'users.deleted', entity: 'users', entityId: target.id, details: { email: target.email, department: target.department, role: target.role } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
