// Security centre (admin only): recovery documents with live capture,
// recovery-request review (side-by-side document comparison) and the
// notification history.
import { initShell } from '../script.js';
import { api } from './api.js';
import {
  esc, toast, openModal, confirmDialog, field, formValue,
  badge, emptyRow, fmtDateTime, setupTabs, captureImage
} from './ui.js';

const shell = initShell({ active: 'security', requireAdmin: true });

const DOC_LABELS = { national_id: 'National ID', driving_license: 'Driving License', permit: 'Permit' };
const DOC_OPTIONS = [
  { value: 'national_id', label: 'National ID' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'permit', label: 'Permit' }
];
const REQ_LABELS = {
  awaiting_code: 'Code sent', awaiting_document: 'Verifying', verified: 'Verified',
  needs_review: 'Needs review', approved: 'Approved', completed: 'Completed',
  denied: 'Denied', expired: 'Expired'
};
const REQ_TONES = {
  awaiting_code: 'blue', awaiting_document: 'amber', verified: 'green',
  needs_review: 'red', approved: 'green', completed: 'gray', denied: 'red', expired: 'gray'
};
const NOTIF_TONES = { sent: 'green', queued: 'blue', skipped: 'gray', failed: 'red' };

let documents = [];
let requests = [];
let notifications = [];

if (shell) {
  setupTabs();
  document.getElementById('add-doc').addEventListener('click', addDocumentModal);
  document.getElementById('refresh-all').addEventListener('click', loadAll);
  document.getElementById('docs-grid').addEventListener('click', onDocsClick);
  document.getElementById('requests-body').addEventListener('click', onRequestsClick);
  document.getElementById('notifications-body').addEventListener('click', onNotificationsClick);
  loadAll();
}

async function loadAll() {
  if (!navigator.onLine) {
    toast('The security centre needs a network connection.', 'info');
    return;
  }
  try {
    const [d, r, n] = await Promise.all([
      api.listRecoveryDocs(),
      api.adminRecoveryRequests(),
      api.adminNotifications()
    ]);
    documents = d.documents || [];
    requests = r.requests || [];
    notifications = n.notifications || [];
    renderDocuments();
    renderRequests();
    renderNotifications();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- recovery documents -------------------------------------------------------

function renderDocuments() {
  const host = document.getElementById('docs-grid');
  host.innerHTML = documents.length
    ? documents.map((d) => `
      <div class="doc-card">
        <div class="doc-thumb" data-act="view" data-id="${d.id}" title="View full image">
          <img src="${d.image_data}" alt="${esc(DOC_LABELS[d.doc_type] || d.doc_type)}">
        </div>
        <div class="doc-meta">
          <strong>${esc(DOC_LABELS[d.doc_type] || d.doc_type)}</strong>
          <span class="muted">&numero; ${esc(d.doc_number)}</span>
          <span class="muted">Registered ${fmtDateTime(d.created_at)}</span>
        </div>
        <div class="doc-actions">
          <button class="btn btn-ghost btn-sm" data-act="view" data-id="${d.id}" type="button">View</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="remove" data-id="${d.id}" type="button">Remove</button>
        </div>
      </div>`).join('')
    : `<p class="muted">No recovery documents yet. Add your National ID, Driving License or Permit so the account can be recovered if the password is forgotten.</p>`;
}

async function onDocsClick(event) {
  const target = event.target.closest('[data-act]');
  if (!target) return;
  const doc = documents.find((d) => d.id === target.dataset.id);
  if (!doc) return;

  if (target.dataset.act === 'view') {
    openModal({
      title: `${DOC_LABELS[doc.doc_type] || doc.doc_type} — ${doc.doc_number}`,
      bodyHTML: `<img class="doc-full" src="${doc.image_data}" alt="Document">`,
      submitLabel: 'Close',
      onSubmit: () => true
    }).catch(() => {});
    return;
  }

  if (target.dataset.act === 'remove') {
    const ok = await confirmDialog(
      `Remove the ${DOC_LABELS[doc.doc_type] || doc.doc_type} from your recovery documents? Recovery will no longer be possible with it.`,
      { title: 'Remove document', okLabel: 'Remove' }
    );
    if (!ok) return;
    try {
      await api.deleteRecoveryDoc(doc.id);
      toast('Document removed.', 'success');
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

function addDocumentModal() {
  if (!navigator.onLine) {
    toast('Document management needs a network connection.', 'info');
    return;
  }
  let image = null;

  const modalPromise = openModal({
    title: 'Register recovery document',
    submitLabel: 'Save document',
    bodyHTML: `
      ${field({ label: 'Document type', name: 'docType', options: DOC_OPTIONS })}
      ${field({ label: 'Document number', name: 'docNumber', required: true, placeholder: 'e.g. 12345678' })}
      <div class="field">
        <span class="field-label">Document image <em>*</em></span>
        <div class="capture-inline">
          <button type="button" class="btn btn-ghost" id="doc-capture-btn">Capture / upload…</button>
          <img id="doc-preview" class="doc-preview" alt="Document preview" hidden>
        </div>
        <span class="field-hint">Capture the document live with the camera, or upload a photo of it.</span>
      </div>`,
    onSubmit: async (form) => {
      const docType = formValue(form, 'docType');
      const docNumber = formValue(form, 'docNumber');
      if (docNumber.length < 3) throw new Error('Enter the document number.');
      if (!image) throw new Error('Capture or upload the document image.');
      await api.saveRecoveryDoc({ docType, docNumber, image });
      toast('Recovery document saved.', 'success');
      await loadAll();
    }
  }).catch(() => {});

  // Wire the live-capture button now that the modal is in the DOM.
  const overlay = document.querySelector('.modal-overlay');
  const captureBtn = overlay && overlay.querySelector('#doc-capture-btn');
  const preview = overlay && overlay.querySelector('#doc-preview');
  if (captureBtn) {
    captureBtn.addEventListener('click', async () => {
      const img = await captureImage({
        title: 'Capture your document',
        note: 'Frame the whole document clearly. The photo is stored only for account recovery.'
      });
      if (img) {
        image = img;
        if (preview) {
          preview.src = img;
          preview.hidden = false;
        }
        captureBtn.textContent = 'Replace image';
      }
    });
  }
  return modalPromise;
}

// ---- recovery requests --------------------------------------------------------

function renderRequests() {
  const host = document.getElementById('requests-body');
  host.innerHTML = requests.length
    ? requests.map((r) => `
      <tr class="${r.status === 'needs_review' ? 'row-alert' : ''}">
        <td>${fmtDateTime(r.created_at)}</td>
        <td>${esc(r.user_name || '—')}<br><span class="muted">${esc(r.email)}</span></td>
        <td>${esc(r.submitted_doc_type ? (DOC_LABELS[r.submitted_doc_type] || r.submitted_doc_type) : '—')}</td>
        <td>${esc(r.submitted_doc_number || '—')}</td>
        <td>${badge(REQ_LABELS[r.status] || r.status, REQ_TONES[r.status] || 'gray')}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="review" data-id="${r.id}" type="button">Review</button>
        </td>
      </tr>`).join('')
    : emptyRow(6, 'No account-recovery attempts so far.');
}

async function onRequestsClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const request = requests.find((r) => r.id === button.dataset.id);
  if (request) reviewRequest(request);
}

function reviewRequest(r) {
  const registered = r.registered_image
    ? `<img class="doc-full" src="${r.registered_image}" alt="Registered document">
       <p class="muted center">Registered &numero; ${esc(r.registered_doc_number || '—')}</p>`
    : '<p class="muted center">No registered document linked.</p>';
  const submitted = r.submitted_image
    ? `<img class="doc-full" src="${r.submitted_image}" alt="Submitted document">
       <p class="muted center">Submitted &numero; ${esc(r.submitted_doc_number || '—')}</p>`
    : `<p class="muted center">No document submitted yet (status: ${esc(REQ_LABELS[r.status] || r.status)}).</p>`;

  const modalPromise = openModal({
    title: 'Recovery request review',
    wide: true,
    submitLabel: 'Close',
    onSubmit: () => true,
    bodyHTML: `
      <div class="review-meta">
        <div><span class="muted">Account</span><strong>${esc(r.user_name || '—')}</strong></div>
        <div><span class="muted">Email</span><strong>${esc(r.email)}</strong></div>
        <div><span class="muted">Requested</span><strong>${fmtDateTime(r.created_at)}</strong></div>
        <div><span class="muted">Status</span>${badge(REQ_LABELS[r.status] || r.status, REQ_TONES[r.status] || 'gray')}</div>
        <div><span class="muted">Wrong codes</span><strong>${r.code_attempts}</strong></div>
        <div><span class="muted">IP</span><strong>${esc(r.ip || '—')}</strong></div>
      </div>
      <div class="compare-images">
        <figure>${registered}<figcaption>Registered document</figcaption></figure>
        <figure>${submitted}<figcaption>Submitted during recovery</figcaption></figure>
      </div>
      ${r.status === 'needs_review'
        ? `<div class="capture-actions center">
             <button type="button" class="btn btn-ghost" data-review="deny">Deny request</button>
             <button type="button" class="btn btn-primary" data-review="approve">Approve — allow password reset</button>
           </div>`
        : ''}`
  }).catch(() => {});

  const overlay = document.querySelector('.modal-overlay');
  const approveBtn = overlay && overlay.querySelector('[data-review="approve"]');
  const denyBtn = overlay && overlay.querySelector('[data-review="deny"]');
  const closeModal = () => {
    const close = overlay && overlay.querySelector('.modal-close');
    if (close) close.click();
  };
  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      closeModal();
      const ok = await confirmDialog(
        'Approve this recovery? The account owner will be able to set a new password from the recovery page.',
        { title: 'Approve recovery', okLabel: 'Approve' }
      );
      if (!ok) return;
      try {
        await api.adminApproveRequest(r.id);
        toast('Recovery request approved.', 'success');
        await loadAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
  if (denyBtn) {
    denyBtn.addEventListener('click', async () => {
      closeModal();
      const ok = await confirmDialog('Deny this recovery request? The requester will be notified.', { title: 'Deny recovery', okLabel: 'Deny' });
      if (!ok) return;
      try {
        await api.adminDenyRequest(r.id);
        toast('Recovery request denied.', 'success');
        await loadAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
  return modalPromise;
}

// ---- notifications ------------------------------------------------------------

function renderNotifications() {
  const note = document.getElementById('smtp-note');
  const anySkipped = notifications.some((n) => n.status === 'skipped');
  note.hidden = !anySkipped;
  if (anySkipped) {
    note.innerHTML = '<strong>Emails are not being sent.</strong> SMTP is not configured, so notifications are recorded here instead. '
      + 'Add <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASS</code> in <code>server/.env</code> to send real emails.';
  }

  const host = document.getElementById('notifications-body');
  host.innerHTML = notifications.length
    ? notifications.map((n) => `
      <tr>
        <td>${fmtDateTime(n.created_at)}</td>
        <td>${esc(n.type)}</td>
        <td>${esc(n.to_email)}</td>
        <td>${esc(n.subject)}</td>
        <td>${badge(n.status, NOTIF_TONES[n.status] || 'gray')}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="view" data-id="${n.id}" type="button">View</button>
        </td>
      </tr>`).join('')
    : emptyRow(6, 'No notifications yet. Sign-in alerts and recovery emails appear here.');
}

async function onNotificationsClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const n = notifications.find((x) => x.id === button.dataset.id);
  if (!n) return;
  openModal({
    title: n.subject || 'Notification',
    wide: true,
    submitLabel: 'Close',
    onSubmit: () => true,
    bodyHTML: `
      <div class="review-meta">
        <div><span class="muted">Recipient</span><strong>${esc(n.to_email)}</strong></div>
        <div><span class="muted">Type</span><strong>${esc(n.type)}</strong></div>
        <div><span class="muted">Time</span><strong>${fmtDateTime(n.created_at)}</strong></div>
        <div><span class="muted">Status</span>${badge(n.status, NOTIF_TONES[n.status] || 'gray')}${n.error ? ` <span class="muted">${esc(n.error)}</span>` : ''}</div>
      </div>
      <div class="email-preview">${n.body || ''}</div>`
  }).catch(() => {});
}
