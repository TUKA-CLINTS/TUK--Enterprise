// Authentication routes: register, login, current user.
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const pool = require('../db');
const { requireAuth, signToken, publicUser } = require('../middleware');
const { notify, wrap } = require('../mailer');
const { logActivity, clientIp, clientUa } = require('../audit');

const router = express.Router();
const DEPARTMENTS = ['shop', 'transport', 'restaurant', 'head-office'];

// POST /api/auth/register - public sign-up. Every new account starts as
// "staff" of the chosen department; managers/admins can promote later.
router.post('/register', async (req, res, next) => {
  try {
    const { name = '', email = '', phone = '', password = '', department = '' } = req.body || {};
    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = String(phone).trim();
    const cleanDept = String(department).trim();

    if (cleanName.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (!DEPARTMENTS.includes(cleanDept)) return res.status(400).json({ error: 'Please choose your department.' });

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [cleanEmail]);
    if (existing.length) return res.status(409).json({ error: 'An account with this email already exists. Try signing in instead.' });

    const ts = Date.now();
    const user = {
      id: randomUUID(),
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      department: cleanDept,
      role: 'staff',
      status: 'active',
      created_at: ts,
      updated_at: ts
    };
    const hash = await bcrypt.hash(String(password), 10);
    await pool.query(
      'INSERT INTO users (id, name, email, phone, password_hash, department, role, status, created_at, updated_at, deleted) VALUES (?,?,?,?,?,?,?,?,?,?,0)',
      [user.id, user.name, user.email, user.phone, hash, user.department, user.role, user.status, ts, ts]
    );

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
    logActivity(req, { userId: user.id, userName: user.name, userEmail: user.email, department: user.department, role: user.role, action: 'auth.register' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email = '', password = '' } = req.body || {};
    const cleanEmail = String(email).trim().toLowerCase();
    if (!cleanEmail || !password) return res.status(400).json({ error: 'Enter your email and password.' });

    const [rows] = await pool.query(
      'SELECT id, name, email, phone, password_hash, department, role, status, created_at, updated_at FROM users WHERE email = ? AND deleted = 0 LIMIT 1',
      [cleanEmail]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password.' });

    const user = rows[0];
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      logActivity(req, { userEmail: cleanEmail, action: 'auth.login_failed', details: { reason: 'wrong_password' } });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (user.status !== 'active') return res.status(403).json({ error: 'This account has been disabled. Contact your manager.' });

    logActivity(req, { userId: user.id, userName: user.name, userEmail: user.email, department: user.department, role: user.role, action: 'auth.login' });
    // Security alert: the owner is emailed on every sign-in of their account.
    notify({
      userId: user.id,
      to: user.email,
      type: 'login',
      subject: 'New sign-in to your TUK@ account',
      html: wrap('New sign-in', `
        <p>Someone just signed in to your account <strong>${user.email}</strong>.</p>
        <p style="font-size:13px;color:#8a93a6">Time: ${new Date().toLocaleString()}<br>Device: ${clientUa(req)}<br>IP: ${clientIp(req)}</p>
        <p>If this was not you, change your password and contact your administrator.</p>`)
    });

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me - refresh the signed-in profile (used when back online).
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
