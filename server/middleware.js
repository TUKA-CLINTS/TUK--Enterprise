// Authentication helpers: JWT signing, auth middleware and role checks.
const jwt = require('jsonwebtoken');
const pool = require('./db'); // also loads .env

const SECRET = process.env.JWT_SECRET || 'tukent-dev-secret';

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, department: user.department },
    SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    department: u.department,
    role: u.role,
    status: u.status,
    created_at: Number(u.created_at),
    updated_at: Number(u.updated_at)
  };
}

// Verifies the Bearer token and re-loads the user from the database so
// disabled/deleted accounts lose access immediately.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required.' });

    let payload;
    try {
      payload = jwt.verify(token, SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    const [rows] = await pool.query(
      'SELECT id, name, email, phone, department, role, status, created_at, updated_at FROM users WHERE id = ? AND deleted = 0 LIMIT 1',
      [payload.id]
    );
    if (!rows.length) return res.status(401).json({ error: 'Account not found. Please sign in again.' });
    const user = rows[0];
    if (user.status !== 'active') return res.status(403).json({ error: 'This account has been disabled. Contact your manager.' });

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

module.exports = { SECRET, signToken, publicUser, requireAuth, requireRole };
