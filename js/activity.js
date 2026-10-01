// Activity log (admin only): the complete audit trail of every operation
// users make - sign-ins, data changes, account management, recovery events.
import { initShell, deptLabel, roleLabel } from '../script.js';
import { api } from './api.js';
import { esc, toast, badge, emptyRow, fmtDateTime } from './ui.js';

const shell = initShell({ active: 'activity', requireAdmin: true });

const ACTION_TONES = {
  'auth.login': 'green', 'auth.register': 'blue', 'auth.login_failed': 'red',
  'data.saved': 'blue', 'data.deleted': 'red',
  'users.created': 'blue', 'users.updated': 'amber', 'users.deleted': 'red',
  'recovery.completed': 'green', 'recovery.admin_approved': 'green',
  'recovery.admin_denied': 'red', 'recovery.document_mismatch': 'red',
  'recovery.code_failed': 'red',
  'documents.updated': 'blue', 'documents.deleted': 'amber'
};

let entries = [];

if (shell) {
  document.getElementById('refresh-activity').addEventListener('click', loadActivity);
  document.getElementById('activity-search').addEventListener('input', render);
  document.getElementById('activity-action').addEventListener('change', render);
  loadActivity();
}

async function loadActivity() {
  if (!navigator.onLine) {
    toast('The activity log needs a network connection.', 'info');
    return;
  }
  try {
    const data = await api.adminActivity(500);
    entries = data.entries || [];
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render() {
  const query = (document.getElementById('activity-search').value || '').toLowerCase();
  const prefix = document.getElementById('activity-action').value;

  const list = entries.filter((e) => {
    if (prefix && !String(e.action).startsWith(prefix)) return false;
    if (!query) return true;
    return [e.user_name, e.user_email, e.action, e.entity, e.entity_id, e.details]
      .some((v) => String(v || '').toLowerCase().includes(query));
  });

  document.getElementById('activity-count').textContent = `${list.length} of ${entries.length} entries`;

  document.getElementById('activity-body').innerHTML = list.length
    ? list.map((e) => {
      let details = '';
      try {
        const parsed = e.details ? JSON.parse(e.details) : null;
        if (parsed) details = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(' · ');
      } catch (err) {
        details = String(e.details || '');
      }
      const target = [e.entity, e.entity_id].filter(Boolean).join(' · ');
      return `<tr>
        <td>${fmtDateTime(e.created_at)}</td>
        <td>${esc(e.user_name || 'Unknown')}${e.user_email ? `<br><span class="muted">${esc(e.user_email)}</span>` : ''}
            ${e.role ? `<br>${badge(roleLabel(e.role), e.role === 'admin' ? 'purple' : 'gray')}` : ''}</td>
        <td>${e.department ? esc(deptLabel(e.department)) : '—'}</td>
        <td>${badge(e.action, ACTION_TONES[e.action] || 'gray')}</td>
        <td class="wrap-cell">${esc(target || '—')}</td>
        <td class="wrap-cell details-cell" title="${esc(details)}">${esc(details || '—')}</td>
        <td class="wrap-cell">${esc(e.ip || '—')}</td>
      </tr>`;
    }).join('')
    : emptyRow(7, 'No activity recorded yet.');
}
