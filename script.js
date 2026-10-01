// Shared app shell loaded by every page: header/navigation, session guard,
// sync status pill, install prompt, footer and service-worker registration.
import { getUser, isSignedIn, logout, refreshProfile, canAccess, canManageEmployees } from './js/auth.js';
import { onStatus, getStatus, syncNow, startSyncEngine } from './js/sync.js';
import { toast, esc } from './js/ui.js';

const DEPT_LABELS = { shop: 'Shop', transport: 'Transport', restaurant: 'Restaurant', 'head-office': 'Head Office' };
const ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', staff: 'Staff' };

export function deptLabel(d) {
  return DEPT_LABELS[d] || d || '';
}

export function roleLabel(r) {
  return ROLE_LABELS[r] || r || '';
}

const NAV = [
  { key: 'dashboard', label: 'Dashboard', href: 'dashboard.html' },
  { key: 'shop', label: 'Shop', href: 'shop.html', dept: 'shop' },
  { key: 'transport', label: 'Transport', href: 'transport.html', dept: 'transport' },
  { key: 'restaurant', label: 'Restaurant', href: 'restaurant.html', dept: 'restaurant' },
  { key: 'employees', label: 'Employees', href: 'employees.html', admins: true },
  { key: 'security', label: 'Security', href: 'security.html', admins: true },
  { key: 'activity', label: 'Activity', href: 'activity.html', admins: true }
];

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  const btn = document.getElementById('install-btn');
  if (btn) btn.hidden = false;
});

function currentPage() {
  const parts = window.location.pathname.split('/');
  return parts[parts.length - 1] || 'index.html';
}

function renderHeader({ active = '', guest = false }) {
  const host = document.getElementById('app-header');
  if (!host) return;
  const user = getUser();
  const links = guest ? [] : NAV.filter((item) => {
    if (item.admins) return canManageEmployees();
    if (item.dept) return canAccess(item.dept);
    return true;
  });

  host.innerHTML = `
    <header class="app-header">
      <div class="header-inner">
        <a class="brand" href="${guest ? 'index.html' : 'dashboard.html'}">
          <span class="brand-mark">T@</span>
          <span class="brand-text">TUK<em>@</em> ENTERPRISES</span>
        </a>
        ${guest ? '' : `<nav class="main-nav" aria-label="Main navigation">
          ${links.map((l) => `<a href="${l.href}" class="${l.key === active ? 'active' : ''}">${esc(l.label)}</a>`).join('')}
        </nav>`}
        <div class="header-tools">
          ${guest ? `<a class="btn btn-primary btn-sm" href="sign-in.html">Sign in</a>` : `
            <button id="sync-pill" class="sync-pill busy" type="button" title="Sync status">…</button>
            <span class="user-chip" title="${esc(user.email)}">
              <span class="user-name">${esc(user.name)}</span>
              <span class="chip-badge">${esc(deptLabel(user.department))}</span>
              <span class="chip-badge chip-role">${esc(roleLabel(user.role))}</span>
            </span>
            <button id="install-btn" class="btn btn-ghost btn-sm" type="button" hidden>Install</button>
            <button id="logout-btn" class="btn btn-ghost btn-sm" type="button">Sign out</button>`}
        </div>
      </div>
    </header>`;

  if (guest) return;

  const pill = document.getElementById('sync-pill');
  onStatus((s) => {
    if (!pill) return;
    if (s.syncing) {
      pill.className = 'sync-pill busy';
      pill.textContent = 'Syncing…';
    } else if (!s.online) {
      pill.className = 'sync-pill offline';
      pill.textContent = 'Offline';
    } else if (s.pending > 0) {
      pill.className = 'sync-pill warn';
      pill.textContent = `${s.pending} to sync`;
    } else {
      pill.className = 'sync-pill ok';
      pill.textContent = 'Synced';
    }
    pill.title = s.error
      ? `Last error: ${s.error}`
      : (s.lastSyncAt ? `Last sync: ${new Date(s.lastSyncAt).toLocaleTimeString()}` : 'Sync status');
  });
  if (pill) {
    pill.addEventListener('click', async () => {
      await syncNow('manual');
      const s = getStatus();
      if (!s.online) toast('You are offline. Changes are saved on this device and sync automatically later.', 'info');
      else if (s.error) toast(`Sync failed: ${s.error}`, 'error');
      else toast('Everything is synced.', 'success');
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  const installBtn = document.getElementById('install-btn');
  if (installBtn) {
    if (deferredInstall) installBtn.hidden = false;
    installBtn.addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      installBtn.hidden = true;
    });
  }
}

function renderFooter() {
  const host = document.getElementById('app-footer');
  if (!host) return;
  host.innerHTML = `
    <footer class="app-footer">
      <div class="footer-inner">
        <span><strong>TUK@ ENTERPRISES</strong> — Shop &bull; Transport &bull; Restaurant</span>
        <span class="muted">Works offline &middot; Syncs automatically</span>
      </div>
    </footer>`;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* Service workers need https or localhost; plain LAN http still works, just without offline shell caching. */
    });
  });
}

function renderDenied(root, user, department) {
  if (!root) return;
  root.innerHTML = `
    <section class="card denied-card">
      <h2>Access restricted</h2>
      ${department
        ? `<p>Your account is in the <strong>${esc(deptLabel(user.department))}</strong> department,
        so this ${esc(deptLabel(department))} module is not available to you.</p>`
        : `<p>Only administrators can manage employee accounts.
        Ask the head-office administrator if you need a change.</p>`}
      <a class="btn btn-primary" href="dashboard.html">Back to dashboard</a>
    </section>`;
}

/**
 * Initialise the page shell.
 * Options:
 *   active            - nav key to highlight
 *   guest             - public page (no session required, guest header)
 *   requireAuth       - redirect to sign-in when not signed in
 *   requireDepartment - also require access to a department module
 *   requireAdmin      - also require the admin role (e.g. Employees page)
 * Returns { user } on success, or null when the page should stop rendering.
 */
export function initShell({ active = '', guest = false, requireAuth = false, requireDepartment = null, requireAdmin = false } = {}) {
  registerServiceWorker();

  if (guest) {
    renderHeader({ active, guest: true });
    renderFooter();
    return { user: null, guest: true };
  }

  const needsAuth = requireAuth || !!requireDepartment || requireAdmin;
  if (needsAuth && !isSignedIn()) {
    window.location.replace(`sign-in.html?next=${encodeURIComponent(currentPage())}`);
    return null;
  }

  const user = getUser();
  renderHeader({ active, guest: false });
  renderFooter();

  const root = document.getElementById('page');
  if (requireDepartment && !canAccess(requireDepartment)) {
    renderDenied(root, user, requireDepartment);
    return null;
  }
  if (requireAdmin && !canManageEmployees()) {
    renderDenied(root, user, null);
    return null;
  }

  startSyncEngine();
  if (navigator.onLine) refreshProfile();
  return { user, guest: false };
}
