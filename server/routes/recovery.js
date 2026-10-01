// Account recovery ("secret option") for forgotten credentials.
// Two factors are required before a password can be reset:
//   1. a one-time code emailed to the account owner
//   2. a live capture of one of the owner's registered documents
//      (national ID / driving license / permit) whose number matches
// If the document number does not match, the request is parked for admin
// review (side-by-side image comparison in the admin panel).
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const pool = require('../db');
const { requireAuth } = require('../middleware');
const { notify, wrap } = require('../mailer');
const { logActivity, clientIp, clientUa } = require('../audit');

const router = express.Router();

const DOC_TYPES = ['national_id', 'driving_license', 'permit'];
const DOC_LABELS = { national_id: 'National ID', driving_license: 'Driving License', permit: 'Permit' };
const CODE_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;
const MAX_OPEN_PER_HOUR = 5;
const MAX_IMAGE_CHARS = 1500000; // ~1.1 MB binary as base64 data URL

const normalize = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');

async function findActiveUserByEmail(email) {
  const [rows] = await pool.query('SELECT id, name, email, status FROM users WHERE email = ? AND deleted = 0 LIMIT 1', [String(email || '').trim().toLowerCase()]);
  return rows[0] || null;
}

async function registeredDocs(userId) {
  const [rows] = await pool.query(
    'SELECT id, doc_type, doc_number, image_data, created_at, updated_at FROM recovery_documents WHERE user_id = ? AND deleted = 0 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

// ---- step 1: request a recovery code ----------------------------------------
router.post('/request', async (req, res, next) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Enter the email of your account.' });

    // Throttle: limit simultaneous open requests per email.
    const [recent] = await pool.query(
      "SELECT COUNT(*) AS c FROM recovery_requests WHERE email = ? AND created_at > ? AND status NOT IN ('completed','denied','expired')",
      [email, Date.now() - 3600000]
    );
    if (recent[0].c >= MAX_OPEN_PER_HOUR) {
      return res.status(429).json({ error: 'Too many recovery attempts for this account. Try again later.' });
    }

    const user = await findActiveUserByEmail(email);
    const docs = user && user.status === 'active' ? await registeredDocs(user.id) : [];
    if (!user || !docs.length) {
      // Never reveal whether the account (or its documents) exist.
      logActivity(req, { userEmail: email, action: 'recovery.requested', details: { result: 'account_not_found_or_no_documents' } });
      return res.json({ ok: true, message: 'If that account exists and has recovery documents, a code has been sent to its email.' });
    }

    // If an admin already approved a previous request, jump straight to reset.
    const [approved] = await pool.query(
      "SELECT id FROM recovery_requests WHERE user_id = ? AND status = 'approved' LIMIT 1",
      [user.id]
    );
    if (approved.length) {
      return res.json({ ok: true, requestId: approved[0].id, status: 'approved', message: 'A recovery request for this account is already approved. You may set a new password now.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const id = randomUUID();
    const ts = Date.now();
    await pool.query(
      `INSERT INTO recovery_requests (id, user_id, email, code_hash, code_expires_at, code_attempts, status, ip, user_agent, created_at, updated_at)
       VALUES (?,?,?,?,?,0,'awaiting_code',?,?,?,?)`,
      [id, user.id, user.email, await bcrypt.hash(code, 10), ts + CODE_MINUTES * 60000, clientIp(req), clientUa(req), ts, ts]
    );

    await notify({
      userId: user.id,
      to: user.email,
      type: 'recovery_requested',
      subject: 'TUK@ account recovery code',
      html: wrap('Account recovery requested', `
        <p>Someone requested to reset the password of your <strong>${user.email}</strong> account.</p>
        <p style="font-size:28px;letter-spacing:6px;font-weight:700;background:#f2f5fa;border-radius:8px;padding:12px 16px;text-align:center">${code}</p>
        <p>This code expires in ${CODE_MINUTES} minutes. If this was not you, ignore this email &mdash; the code alone cannot change your password without your registered document.</p>`)
    });
    logActivity(req, { userId: user.id, userName: user.name, userEmail: user.email, action: 'recovery.requested', details: { requestId: id } });

    res.json({ ok: true, requestId: id, message: `A recovery code has been sent to ${user.email}.` });
  } catch (err) { next(err); }
});

// ---- step 2: verify the emailed code ----------------------------------------
router.post('/verify-code', async (req, res, next) => {
  try {
    const { requestId = '', code = '' } = req.body || {};
    const [rows] = await pool.query('SELECT * FROM recovery_requests WHERE id = ? LIMIT 1', [requestId]);
    const r = rows[0];
    if (!r || r.status !== 'awaiting_code') {
      return res.status(400).json({ error: 'This recovery request is not waiting for a code. Start again.' });
    }
    if (r.code_expires_at < Date.now()) {
      await pool.query("UPDATE recovery_requests SET status = 'expired', updated_at = ? WHERE id = ?", [Date.now(), r.id]);
      return res.status(400).json({ error: 'That code has expired. Start again.' });
    }
    if (r.code_attempts >= MAX_CODE_ATTEMPTS) {
      await pool.query("UPDATE recovery_requests SET status = 'expired', updated_at = ? WHERE id = ?", [Date.now(), r.id]);
      return res.status(429).json({ error: 'Too many wrong codes. Start again.' });
    }
    const ok = await bcrypt.compare(String(code), r.code_hash);
    if (!ok) {
      await pool.query('UPDATE recovery_requests SET code_attempts = code_attempts + 1, updated_at = ? WHERE id = ?', [Date.now(), r.id]);
      logActivity(req, { userId: r.user_id, userEmail: r.email, action: 'recovery.code_failed', details: { attempt: r.code_attempts + 1 } });
      return res.status(400).json({ error: `Wrong code. ${MAX_CODE_ATTEMPTS - r.code_attempts - 1} attempts left.` });
    }
    await pool.query("UPDATE recovery_requests SET status = 'awaiting_document', updated_at = ? WHERE id = ?", [Date.now(), r.id]);
    const docs = await registeredDocs(r.user_id);
    logActivity(req, { userId: r.user_id, userEmail: r.email, action: 'recovery.code_verified', details: { requestId: r.id } });
    res.json({ ok: true, docTypes: [...new Set(docs.map((d) => d.doc_type))] });
  } catch (err) { next(err); }
});

// ---- step 3: capture the document live and match its number ------------------
router.post('/submit-document', async (req, res, next) => {
  try {
    const { requestId = '', docType = '', docNumber = '', image = '' } = req.body || {};
    const [rows] = await pool.query('SELECT * FROM recovery_requests WHERE id = ? LIMIT 1', [requestId]);
    const r = rows[0];
    if (!r || r.status !== 'awaiting_document') {
      return res.status(400).json({ error: 'This request is not waiting for a document.' });
    }
    if (!DOC_TYPES.includes(docType)) return res.status(400).json({ error: 'Choose a valid document type.' });
    const cleanNumber = String(docNumber).trim();
    if (!cleanNumber) return res.status(400).json({ error: 'Enter the document number.' });
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(String(image))) {
      return res.status(400).json({ error: 'Capture or upload the document image.' });
    }
    if (String(image).length > MAX_IMAGE_CHARS) return res.status(413).json({ error: 'Image too large. Try again.' });

    const docs = await registeredDocs(r.user_id);
    const registered = docs.find((d) => d.doc_type === docType);
    if (!registered) return res.status(400).json({ error: `No ${DOC_LABELS[docType]} is registered on this account.` });

    const match = normalize(registered.doc_number) === normalize(cleanNumber);
    await pool.query(
      `UPDATE recovery_requests SET status = ?, submitted_doc_type = ?, submitted_doc_number = ?, submitted_image = ?, registered_doc_id = ?, updated_at = ? WHERE id = ?`,
      [match ? 'verified' : 'needs_review', docType, cleanNumber.slice(0, 100), image, registered.id, Date.now(), r.id]
    );

    if (match) {
      await notify({
        userId: r.user_id, to: r.email, type: 'recovery_verified', subject: 'Identity verified - set your new password',
        html: wrap('Identity verified', '<p>Your document matched the one registered on your account. You can now set a new password from the recovery page.</p>')
      });
      logActivity(req, { userId: r.user_id, userEmail: r.email, action: 'recovery.document_matched', details: { requestId: r.id, docType } });
      return res.json({ ok: true, status: 'verified' });
    }

    await notify({
      userId: r.user_id, to: r.email, type: 'recovery_review', subject: 'Security alert: recovery needs administrator review',
      html: wrap('Recovery needs review', '<p>A recovery request for your account submitted a document whose number did not match. An administrator will review it. If this was not you, contact your administrator immediately.</p>')
    });
    logActivity(req, { userId: r.user_id, userEmail: r.email, action: 'recovery.document_mismatch', details: { requestId: r.id, docType, submitted: cleanNumber.slice(0, 40) } });
    res.json({ ok: true, status: 'needs_review' });
  } catch (err) { next(err); }
});

// ---- step 4: set the new password --------------------------------------------
router.post('/reset', async (req, res, next) => {
  try {
    const { requestId = '', password = '' } = req.body || {};
    const [rows] = await pool.query(
      `SELECT r.*, u.status AS user_status, u.deleted AS user_deleted
       FROM recovery_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ? LIMIT 1`,
      [requestId]
    );
    const r = rows[0];
    if (!r || !['verified', 'approved'].includes(r.status)) {
      return res.status(400).json({ error: 'This request is not verified. Complete the previous steps.' });
    }
    if (r.updated_at < Date.now() - 60 * 60000) {
      await pool.query("UPDATE recovery_requests SET status = 'expired', updated_at = ? WHERE id = ?", [Date.now(), r.id]);
      return res.status(400).json({ error: 'This request has expired. Start again.' });
    }
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (r.user_deleted || r.user_status !== 'active') return res.status(400).json({ error: 'This account cannot be recovered.' });

    const hash = await bcrypt.hash(String(password), 10);
    const ts = Date.now();
    await pool.query('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, ts, r.user_id]);
    await pool.query("UPDATE recovery_requests SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?", [ts, ts, r.id]);
    // Any other open request for this account is now obsolete.
    await pool.query(
      "UPDATE recovery_requests SET status = 'expired', updated_at = ? WHERE user_id = ? AND status IN ('awaiting_code','awaiting_document','verified','approved') AND id <> ?",
      [ts, r.user_id, r.id]
    );

    await notify({
      userId: r.user_id, to: r.email, type: 'recovery_completed', subject: 'Your TUK@ password was reset',
      html: wrap('Password reset completed', '<p>The password of your account was just reset through account recovery. If this was not you, contact your administrator immediately.</p>')
    });
    logActivity(req, { userId: r.user_id, userEmail: r.email, action: 'recovery.completed', details: { requestId: r.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- recovery document management (each account manages its own) -------------
router.get('/documents', requireAuth, async (req, res, next) => {
  try {
    const docs = await registeredDocs(req.user.id);
    res.json({ documents: docs });
  } catch (err) { next(err); }
});

router.post('/documents', requireAuth, async (req, res, next) => {
  try {
    const { docType = '', docNumber = '', image = '' } = req.body || {};
    if (!DOC_TYPES.includes(docType)) return res.status(400).json({ error: 'Choose a valid document type.' });
    const cleanNumber = String(docNumber).trim();
    if (cleanNumber.length < 3) return res.status(400).json({ error: 'Enter the document number.' });
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(String(image))) return res.status(400).json({ error: 'Capture or upload the document image.' });
    if (String(image).length > MAX_IMAGE_CHARS) return res.status(413).json({ error: 'Image too large. Try again.' });

    // One document of each type: saving again replaces the previous one.
    const [existing] = await pool.query(
      'SELECT id FROM recovery_documents WHERE user_id = ? AND doc_type = ? AND deleted = 0 LIMIT 1',
      [req.user.id, docType]
    );
    const ts = Date.now();
    if (existing.length) {
      await pool.query('UPDATE recovery_documents SET doc_number = ?, image_data = ?, updated_at = ? WHERE id = ?', [cleanNumber.slice(0, 100), image, ts, existing[0].id]);
    } else {
      await pool.query(
        'INSERT INTO recovery_documents (id, user_id, doc_type, doc_number, image_data, created_at, updated_at, deleted) VALUES (?,?,?,?,?,?,?,0)',
        [randomUUID(), req.user.id, docType, cleanNumber.slice(0, 100), image, ts, ts]
      );
    }
    await notify({
      userId: req.user.id, to: req.user.email, type: 'documents_updated', subject: 'Your recovery documents were updated',
      html: wrap('Recovery documents updated', `<p>The recovery documents of your account were updated (${DOC_LABELS[docType]}). If this was not you, contact your administrator immediately.</p>`)
    });
    logActivity(req, { action: 'documents.updated', entity: 'recovery_documents', details: { docType, replaced: !!existing.length } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/documents/:id', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM recovery_documents WHERE id = ? AND user_id = ? AND deleted = 0 LIMIT 1', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Document not found.' });
    await pool.query('UPDATE recovery_documents SET deleted = 1, updated_at = ? WHERE id = ?', [Date.now(), rows[0].id]);
    await notify({
      userId: req.user.id, to: req.user.email, type: 'documents_updated', subject: 'A recovery document was removed',
      html: wrap('Recovery document removed', `<p>The ${DOC_LABELS[rows[0].doc_type]} registered on your account was removed. If this was not you, contact your administrator immediately.</p>`)
    });
    logActivity(req, { action: 'documents.deleted', entity: 'recovery_documents', entityId: rows[0].id, details: { docType: rows[0].doc_type } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
