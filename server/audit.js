// Audit trail helper: records every meaningful operation users make so the
// admin panel can keep a complete history of who did what, when and from where.
const pool = require('./db');

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 45);
  return String((req.socket && req.socket.remoteAddress) || '').slice(0, 45);
}

function clientUa(req) {
  return String(req.headers['user-agent'] || '').slice(0, 250);
}

// Fire-and-forget: an audit failure must never break the request being logged.
// req.user (set by requireAuth) supplies the identity for authenticated calls.
function logActivity(req, { userId = '', userName = '', userEmail = '', department = '', role = '', action = '', entity = '', entityId = '', details = null } = {}) {
  const user = req.user || {};
  pool.query(
    'INSERT INTO activity_log (user_id, user_name, user_email, department, role, action, entity, entity_id, details, ip, user_agent, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      userId || user.id || null,
      userName || user.name || '',
      userEmail || user.email || '',
      department || user.department || '',
      role || user.role || '',
      String(action).slice(0, 60),
      String(entity).slice(0, 40),
      String(entityId).slice(0, 36),
      details ? JSON.stringify(details).slice(0, 4000) : null,
      clientIp(req),
      clientUa(req),
      Date.now()
    ]
  ).catch((e) => console.warn('[audit] failed:', e.message));
}

module.exports = { logActivity, clientIp, clientUa };
