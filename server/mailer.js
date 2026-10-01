// Email notifications for security events (sign-ins, recovery, password
// changes). When SMTP is not configured the message is still recorded in the
// notifications table (visible in the admin panel) so nothing is ever lost -
// the system runs in "demo mode" instead of failing.
const nodemailer = require('nodemailer');
const { randomUUID } = require('crypto');
const pool = require('./db');

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  const port = Number(process.env.SMTP_PORT || 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  console.log(`[mailer] SMTP configured -> ${process.env.SMTP_HOST}:${port}`);
} else {
  console.log('[mailer] SMTP not configured - notifications are recorded but not emailed (see Security page)');
}

const FROM = process.env.SMTP_FROM || 'TUK@ Enterprises <no-reply@tuk.enterprises>';

// Branded HTML wrapper shared by every notification email.
function wrap(title, inner) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e3e8f2;border-radius:10px;overflow:hidden">
    <div style="background:#16418b;color:#fff;padding:16px 20px;font-size:18px;font-weight:600">TUK<span style="color:#f2a516">@</span> ENTERPRISES</div>
    <div style="padding:20px;color:#22304a">
      <h2 style="margin:0 0 12px;font-size:17px">${title}</h2>
      ${inner}
      <p style="margin:18px 0 0;font-size:12px;color:#8a93a6">TUK@ Enterprises Management System &middot; Shop &bull; Transport &bull; Restaurant</p>
    </div>
  </div>`;
}

// Record a notification and email it when possible.
// Never throws: notifications must not break the request that triggered them.
async function notify({ userId = '', to = '', type = '', subject = '', html = '' }) {
  const id = randomUUID();
  try {
    await pool.query(
      'INSERT INTO notifications (id, user_id, to_email, type, subject, body, status, error, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, userId || '', to, type, subject, html, transporter ? 'queued' : 'skipped', transporter ? '' : 'SMTP not configured', Date.now()]
    );
    if (transporter) {
      try {
        await transporter.sendMail({ from: FROM, to, subject, html });
        await pool.query('UPDATE notifications SET status = ? WHERE id = ?', ['sent', id]);
      } catch (e) {
        await pool.query('UPDATE notifications SET status = ?, error = ? WHERE id = ?', ['failed', String(e.message).slice(0, 250), id]);
        console.warn('[mailer] send failed:', e.message);
      }
    } else {
      console.log(`[mailer] (recorded, SMTP off) ${type} -> ${to}: ${subject}`);
    }
  } catch (e) {
    console.warn('[mailer] could not record notification:', e.message);
  }
  return id;
}

module.exports = { notify, wrap, mailerConfigured: () => !!transporter };
