// Shared UI helpers: escaping, formatting, badges, toasts, modals and
// form-field builders used by every page script.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function fmtMoney(n) {
  const num = Number(n) || 0;
  return 'KES ' + num.toLocaleString('en-KE', { maximumFractionDigits: 2 });
}

export function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(Number(ms)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(ms) {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(Number(ms)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Local (not UTC) YYYY-MM-DD for "today" defaults.
export function todayStr() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// epoch ms <-> value for <input type="datetime-local">
export function toDatetimeLocal(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromDatetimeLocal(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

const TONES = {
  pending: 'amber', preparing: 'blue', served: 'green', paid: 'green',
  scheduled: 'blue', ongoing: 'amber', completed: 'green', cancelled: 'red',
  available: 'green', 'in-service': 'blue', maintenance: 'amber',
  'on-trip': 'blue', 'off-duty': 'gray',
  booked: 'blue', seated: 'green',
  active: 'green', disabled: 'red',
  in: 'green', out: 'red', adjust: 'amber'
};

export function badge(text, tone = 'gray') {
  return `<span class="badge badge-${tone}">${esc(text)}</span>`;
}

export function statusBadge(status) {
  return badge(status, TONES[status] || 'gray');
}

export function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="empty-cell">${esc(message)}</td></tr>`;
}

// ---- Toasts -----------------------------------------------------------------

export function toast(message, type = 'success') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 3600);
}

// ---- Modal ------------------------------------------------------------------

// openModal({ title, bodyHTML, submitLabel, onSubmit })
// onSubmit(form) runs on submit; throw new Error(msg) to keep it open and
// show the message. Resolves with the onSubmit result, or null when closed.
export function openModal({ title, bodyHTML, submitLabel = 'Save', cancelLabel = 'Cancel', onSubmit, wide = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button type="button" class="modal-close" aria-label="Close">&times;</button>
        </div>
        <form class="modal-form" novalidate>
          <div class="modal-body">${bodyHTML}</div>
          <div class="modal-error" hidden></div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost modal-cancel">${esc(cancelLabel)}</button>
            <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    const form = overlay.querySelector('form');
    const errorBox = overlay.querySelector('.modal-error');
    const close = (result) => {
      overlay.remove();
      document.body.classList.remove('modal-open');
      resolve(result);
    };

    overlay.querySelector('.modal-close').addEventListener('click', () => close(null));
    overlay.querySelector('.modal-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close(null);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      errorBox.hidden = true;
      submitBtn.disabled = true;
      try {
        const result = await onSubmit(form);
        close(result === undefined ? true : result);
      } catch (err) {
        errorBox.textContent = err && err.message ? err.message : 'Something went wrong.';
        errorBox.hidden = false;
        submitBtn.disabled = false;
      }
    });

    const first = overlay.querySelector('input, select, textarea');
    if (first) first.focus();
  });
}

export function confirmDialog(message, { title = 'Please confirm', okLabel = 'Confirm' } = {}) {
  return openModal({
    title,
    bodyHTML: `<p class="confirm-text">${esc(message)}</p>`,
    submitLabel: okLabel,
    onSubmit: () => true
  }).then((result) => result !== null && result !== false);
}

// ---- Form field builders ----------------------------------------------------

export function field({ label, name, type = 'text', value = '', required = false, placeholder = '', step, min, max, options = null, checkbox = false, textarea = false, hint = '' }) {
  const id = `f-${name}`;
  let control = '';
  if (checkbox) {
    return `<label class="field checkbox-field">
      <input type="checkbox" id="${id}" name="${name}" ${value ? 'checked' : ''}>
      <span>${esc(label)}</span>
    </label>`;
  }
  if (options) {
    control = `<select id="${id}" name="${name}" ${required ? 'required' : ''}>
      ${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  } else if (textarea) {
    control = `<textarea id="${id}" name="${name}" rows="2" placeholder="${esc(placeholder)}" ${required ? 'required' : ''}>${esc(value)}</textarea>`;
  } else {
    const numAttrs = type === 'number' ? ` step="${step ?? 'any'}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''}` : '';
    control = `<input id="${id}" type="${esc(type)}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''}${numAttrs}>`;
  }
  return `<label class="field" for="${id}">
    <span class="field-label">${esc(label)}${required ? ' <em>*</em>' : ''}</span>
    ${control}
    ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  </label>`;
}

// value(form, name) shorthand
export function formValue(form, name) {
  const el = form.elements[name];
  return el ? String(el.value || '').trim() : '';
}

export function formChecked(form, name) {
  const el = form.elements[name];
  return !!(el && el.checked);
}

export function formNumber(form, name, fallback = 0) {
  const v = Number(formValue(form, name));
  return Number.isFinite(v) ? v : fallback;
}

// ---- Tabs -------------------------------------------------------------------

export function setupTabs(root = document) {
  const buttons = [...root.querySelectorAll('.tab-btn')];
  const show = (key) => {
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    root.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.hidden = panel.id !== `tab-${key}`;
    });
  };
  buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  return { show };
}

// ---- Live document capture ---------------------------------------------------

// captureImage(): opens a modal that captures a photo of a document with the
// device camera (getUserMedia) with an upload fallback for browsers where the
// camera is unavailable (e.g. plain http on a LAN). Resolves with a compressed
// JPEG data URL, or null when cancelled.
export function captureImage({ title = 'Capture document', note = '' } = {}) {
  return new Promise((resolve) => {
    let stream = null;
    let dataUrl = null;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button type="button" class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-form">
          <div class="modal-body">
            ${note ? `<p class="muted">${esc(note)}</p>` : ''}
            <div class="capture-frame">
              <video class="capture-video" autoplay playsinline muted></video>
              <img class="capture-photo" alt="Captured document" hidden>
              <div class="capture-empty muted">Start the camera or upload an image of the document.</div>
            </div>
            <p class="form-error capture-error" hidden></p>
            <div class="capture-actions">
              <button type="button" class="btn btn-primary" data-cam="start">Start camera</button>
              <button type="button" class="btn btn-primary" data-cam="shot" hidden>Capture photo</button>
              <button type="button" class="btn btn-ghost" data-cam="retake" hidden>Retake</button>
              <label class="btn btn-ghost capture-upload">Upload image<input type="file" accept="image/*" hidden></label>
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" data-cam="cancel">Cancel</button>
            <button type="button" class="btn btn-primary" data-cam="use" disabled>Use this image</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    const video = overlay.querySelector('.capture-video');
    const photo = overlay.querySelector('.capture-photo');
    const emptyHint = overlay.querySelector('.capture-empty');
    const errorBox = overlay.querySelector('.capture-error');
    const [btnStart, btnShot, btnRetake, btnCancel, btnUse] = [
      overlay.querySelector('[data-cam="start"]'),
      overlay.querySelector('[data-cam="shot"]'),
      overlay.querySelector('[data-cam="retake"]'),
      overlay.querySelector('[data-cam="cancel"]'),
      overlay.querySelector('[data-cam="use"]')
    ];

    const showError = (msg) => {
      errorBox.textContent = msg;
      errorBox.hidden = !msg;
    };
    const stopCamera = () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    };
    const close = (result) => {
      stopCamera();
      overlay.remove();
      document.body.classList.remove('modal-open');
      resolve(result);
    };
    const showPreview = (url) => {
      dataUrl = url;
      photo.src = url;
      photo.hidden = false;
      video.hidden = true;
      emptyHint.hidden = true;
      btnShot.hidden = true;
      btnRetake.hidden = false;
      btnUse.disabled = false;
      stopCamera();
    };

    // Compress to a max width of 1280px JPEG so uploads stay small.
    const compress = (source) => {
      const MAX_W = 1280;
      const ratio = Math.min(1, MAX_W / source.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(source.width * ratio);
      canvas.height = Math.round(source.height * ratio);
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.8);
    };

    btnStart.addEventListener('click', async () => {
      showError('');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showError('Live camera is unavailable in this browser. Use "Upload image" instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1600 } },
          audio: false
        });
        video.srcObject = stream;
        video.hidden = false;
        photo.hidden = true;
        emptyHint.hidden = true;
        btnStart.hidden = true;
        btnShot.hidden = false;
      } catch (e) {
        showError('Camera could not be started (permission denied or needs https/localhost). Use "Upload image" instead.');
      }
    });

    btnShot.addEventListener('click', () => {
      if (!video.videoWidth) return;
      showPreview(compress(video));
    });

    btnRetake.addEventListener('click', async () => {
      photo.hidden = true;
      btnRetake.hidden = true;
      btnUse.disabled = true;
      dataUrl = null;
      btnStart.hidden = false;
      btnStart.click();
    });

    overlay.querySelector('.capture-upload input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      showError('');
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => showPreview(compress(img));
        img.onerror = () => showError('That file could not be read as an image.');
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

    btnUse.addEventListener('click', () => close(dataUrl));
    btnCancel.addEventListener('click', () => close(null));
    overlay.querySelector('.modal-close').addEventListener('click', () => close(null));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}
