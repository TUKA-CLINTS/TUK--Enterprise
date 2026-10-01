// Dashboard: welcome, sync strip and per-department overview tiles.
import { initShell, deptLabel, roleLabel } from '../script.js';
import { canAccess } from './auth.js';
import { DB } from './db.js';
import { onStatus, syncNow } from './sync.js';
import { esc, fmtMoney, fmtDateTime, todayStr, toast } from './ui.js';

const shell = initShell({ active: 'dashboard', requireAuth: true });

if (shell) {
  renderWelcome(shell.user);
  renderSyncStrip();
  const refresh = async () => renderDepartments(shell.user, await loadAll());
  refresh();
  document.addEventListener('tukent:synced', refresh);
}

function renderWelcome(user) {
  const host = document.getElementById('welcome');
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  host.innerHTML = `
    <section class="card welcome-card">
      <h2>Welcome, ${esc(user.name)}</h2>
      <div class="welcome-meta">
        <span>${esc(deptLabel(user.department))} department</span>
        <span>&middot;</span>
        <span>${esc(roleLabel(user.role))}</span>
        <span>&middot;</span>
        <span>${esc(today)}</span>
      </div>
    </section>`;
}

function renderSyncStrip() {
  const host = document.getElementById('sync-strip');
  onStatus((s) => {
    let message;
    if (s.syncing) message = 'Syncing with the cloud…';
    else if (!s.online) message = 'Offline — changes are saved on this device and upload automatically later.';
    else if (s.pending > 0) message = `${s.pending} change(s) waiting to upload.`;
    else message = 'All changes are saved to the cloud.';
    const last = s.lastSyncAt ? ` Last sync: ${fmtDateTime(s.lastSyncAt)}.` : '';

    host.innerHTML = `
      <div class="sync-strip">
        <div>
          <strong>Data sync</strong>
          <div class="muted">${esc(message)}${esc(last)}</div>
        </div>
        <button class="btn btn-ghost" id="sync-now" type="button" ${s.syncing ? 'disabled' : ''}>Sync now</button>
      </div>`;
    const button = document.getElementById('sync-now');
    if (button) {
      button.addEventListener('click', async () => {
        toast('Syncing…', 'info');
        await syncNow('dashboard');
      });
    }
  });
}

async function loadAll() {
  const [products, orders, vehicles, drivers, trips, menu, rOrders, reservations] = await Promise.all([
    DB.getAll('products'), DB.getAll('sales_orders'),
    DB.getAll('vehicles'), DB.getAll('drivers'), DB.getAll('trips'),
    DB.getAll('menu_items'), DB.getAll('restaurant_orders'), DB.getAll('reservations')
  ]);
  return { products, orders, vehicles, drivers, trips, menu, rOrders, reservations };
}

function statCard(label, value, warn = false) {
  return `<div class="stat-card ${warn ? 'stat-warn' : ''}">
    <div class="stat-value">${esc(value)}</div>
    <div class="stat-label">${esc(label)}</div>
  </div>`;
}

function shopSection(d) {
  const today = todayStr();
  const low = d.products.filter((p) => Number(p.quantity) <= Number(p.reorder_level));
  const todayOrders = d.orders.filter((o) => o.order_date === today);
  const revenue = todayOrders
    .filter((o) => o.status !== 'pending')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);

  return `
    <section class="card dept-block dept-shop">
      <div class="dept-block-head">
        <h2>Shop</h2>
        <a class="btn btn-ghost btn-sm" href="shop.html">Open module</a>
      </div>
      ${low.length ? `<div class="callout callout-warn"><strong>${low.length} product(s) at or below reorder level:</strong> ${esc(low.map((p) => p.name).join(', '))}</div>` : ''}
      <div class="stats-grid">
        ${statCard('Products', d.products.length)}
        ${statCard('Low stock', low.length, low.length > 0)}
        ${statCard('Orders today', todayOrders.length)}
        ${statCard('Revenue today', fmtMoney(revenue))}
      </div>
    </section>`;
}

function transportSection(d) {
  const available = d.vehicles.filter((v) => v.status === 'available').length;
  const ongoing = d.trips.filter((t) => t.status === 'ongoing').length;
  const scheduled = d.trips.filter((t) => t.status === 'scheduled').length;

  return `
    <section class="card dept-block dept-transport">
      <div class="dept-block-head">
        <h2>Transport</h2>
        <a class="btn btn-ghost btn-sm" href="transport.html">Open module</a>
      </div>
      <div class="stats-grid">
        ${statCard('Vehicles available', `${available} / ${d.vehicles.length}`)}
        ${statCard('Drivers', d.drivers.length)}
        ${statCard('Trips in progress', ongoing)}
        ${statCard('Scheduled trips', scheduled)}
      </div>
    </section>`;
}

function restaurantSection(d) {
  const today = todayStr();
  const open = d.rOrders.filter((o) => o.status === 'pending' || o.status === 'preparing').length;
  const todayReservations = d.reservations.filter((r) => r.date === today);

  return `
    <section class="card dept-block dept-restaurant">
      <div class="dept-block-head">
        <h2>Restaurant</h2>
        <a class="btn btn-ghost btn-sm" href="restaurant.html">Open module</a>
      </div>
      <div class="stats-grid">
        ${statCard('Menu items', d.menu.length)}
        ${statCard('Open orders', open)}
        ${statCard('Reservations today', todayReservations.length)}
      </div>
    </section>`;
}

function renderDepartments(user, data) {
  const host = document.getElementById('dept-sections');
  const sections = [];
  if (canAccess('shop')) sections.push(shopSection(data));
  if (canAccess('transport')) sections.push(transportSection(data));
  if (canAccess('restaurant')) sections.push(restaurantSection(data));

  host.innerHTML = sections.length
    ? sections.join('')
    : `<section class="card"><p class="muted">Your account is not attached to a business department yet. Ask an administrator to assign you to Shop, Transport or Restaurant.</p></section>`;
}
