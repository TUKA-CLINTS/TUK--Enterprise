// Account recovery ("secret option") wizard: email code + live document
// capture + new password. Public page - no session required.
import { initShell } from '../script.js';
import { api } from './api.js';
import { toast, captureImage } from './ui.js';

const shell = initShell({ active: '', guest: true });

const DOC_LABELS = { national_id: 'National ID', driving_license: 'Driving License', permit: 'Permit' };

let requestId = null;
let capturedImage = null;

const el = (id) => document.getElementById(id);
const errorBox = el('recover-error');

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = !msg;
}

function showStep(n) {
  el('step-email-form').hidden = n !== 1;
  el('step-code-form').hidden = n !== 2;
  el('step-doc-form').hidden = n !== 3;
  el('step-password-form').hidden = n !== 4;
  el('step-done').hidden = n !== 'done';
  [1, 2, 3, 4].forEach((i) => {
    el(`step-${i}`).classList.toggle('active', i === n || (n === 'done' && i === 4));
    el(`step-${i}`).classList.toggle('done', i < n || n === 'done');
  });
  showError('');
}

if (shell) {
  el('step-email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = el('recover-email').value.trim();
    if (!email) return showError('Enter the email of your account.');
    try {
      const data = await api.recoveryRequest(email);
      requestId = data.requestId || null;
      if (data.status === 'approved') {
        toast('An administrator already approved your recovery. Set a new password.', 'info');
        showStep(4);
        return;
      }
      el('code-message').textContent = data.message || 'A 6-digit code has been sent to the account email. It expires in 15 minutes.';
      showStep(2);
      el('recover-code').focus();
    } catch (err) {
      showError(err.message);
    }
  });

  el('step-code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = el('recover-code').value.trim();
    if (!code) return showError('Enter the 6-digit code from the email.');
    try {
      const data = await api.recoveryVerifyCode(requestId, code);
      const select = el('doc-type');
      select.innerHTML = (data.docTypes || []).map((t) => `<option value="${t}">${DOC_LABELS[t] || t}</option>`).join('');
      showStep(3);
    } catch (err) {
      showError(err.message);
    }
  });

  el('recover-capture-btn').addEventListener('click', async () => {
    const img = await captureImage({
      title: 'Capture your document',
      note: 'Frame the whole document clearly. Its number must match the one registered on the account.'
    });
    if (img) {
      capturedImage = img;
      const preview = el('recover-doc-preview');
      preview.src = img;
      preview.hidden = false;
      el('recover-capture-btn').textContent = 'Replace image';
    }
  });

  el('step-doc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const docType = el('doc-type').value;
    const docNumber = el('doc-number').value.trim();
    if (!docNumber) return showError('Enter the document number.');
    if (!capturedImage) return showError('Capture or upload the document image.');
    try {
      const data = await api.recoverySubmitDocument({ requestId, docType, docNumber, image: capturedImage });
      if (data.status === 'verified') {
        toast('Document verified.', 'success');
        showStep(4);
        el('new-password').focus();
      } else {
        // needs_review: an administrator will compare the two images.
        toast('The document number did not match. An administrator will review your request and notify you by email.', 'info');
        showError('This document needs administrator review. You will be notified by email once it is checked — then return here, enter your email again and set a new password.');
      }
    } catch (err) {
      showError(err.message);
    }
  });

  el('step-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = el('new-password').value;
    if (password.length < 6) return showError('Password must be at least 6 characters.');
    try {
      await api.recoveryReset(requestId, password);
      showStep('done');
      toast('Password reset. Sign in with your new password.', 'success');
    } catch (err) {
      showError(err.message);
    }
  });
}
