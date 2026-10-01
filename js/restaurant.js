// Restaurant department: Menu, Orders and Reservations.
import { initShell } from '../script.js';
import { DB, saveRecord, deleteRecord } from './db.js';
import { notifyLocalChange } from './sync.js';
import {
  esc, fmtMoney, fmtDateTime, todayStr, toast, openModal, confirmDialog,
  field, formValue, formNumber, formChecked, badge, statusBadge, emptyRow, setupTabs
} from './ui.js';

const shell = initShell({ active: 'restaurant', requireDepartment: 'restaurant' });

let menu = [];
let orders = [];
let reservations = [];

if (shell) init();

function init() {
  setupTabs(document);

  document.getElementById('add-menu-item').addEventListener('click', () => menuModal(null));
  document.getElementById('add-rorder').addEventListener('click', () => orderModal(null));
  document.getElementById('add-reservation').addEventListener('click', () => reservationModal(null));

  document.getElementById('menu-search').addEventListener('input', renderMenu);
  document.getElementById('rorder-search').addEventListener('input', renderOrders);
  document.getElementById('reservation-search').addEventListener('input', renderReservations);

  document.getElementById('menu-body').addEventListener('click', onMenuClick);
  document.getElementById('rorders-body').addEventListener('click', onOrdersClick);
  document.getElementById('reservations-body').addEventListener('click', onReservationsClick);

  refreshAll();
  document.addEventListener('tukent:synced', refreshAll);
}

async function refreshAll() {
  await loadAll();
  renderMenu();
  renderOrders();
  renderReservations();
}

async function loadAll() {
  [menu, orders, reservations] = await Promise.all([
    DB.getAll('menu_items'),
    DB.getAll('restaurant_orders'),
    DB.getAll('reservations')
  ]);
  menu.sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
  orders.sort((a, b) => Number(b.created_at) - Number(a.created_at));
  reservations.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));
}

async function afterWrite(message) {
  toast(message, 'success');
  await notifyLocalChange();
  await refreshAll();
}

// ---- Menu --------------------------------------------------------------------

function renderMenu() {
  const query = (document.getElementById('menu-search').value || '').toLowerCase();
  const list = menu.filter((m) =>
    !query ||
    String(m.name).toLowerCase().includes(query) ||
    String(m.category || '').toLowerCase().includes(query));

  document.getElementById('menu-body').innerHTML = list.length
    ? list.map((m) => `<tr>
        <td>${esc(m.name)}</td>
        <td>${badge(m.category || 'main', 'purple')}</td>
        <td class="num">${fmtMoney(m.price)}</td>
        <td>${Number(m.available) ? badge('Available', 'green') : badge('Unavailable', 'red')}</td>
        <td>${esc(m.description || '—')}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${m.id}" type="button">Edit</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${m.id}" type="button">Delete</button>
        </td>
      </tr>`).join('')
    : emptyRow(6, 'The menu is empty. Add your first dish or drink.');
}

async function onMenuClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const item = menu.find((m) => m.id === button.dataset.id);
  if (button.dataset.act === 'edit') {
    menuModal(item);
  } else if (button.dataset.act === 'delete') {
    const ok = await confirmDialog(`Remove "${item ? item.name : 'this item'}" from the menu?`, { title: 'Delete menu item', okLabel: 'Delete' });
    if (!ok) return;
    await deleteRecord('menu_items', button.dataset.id);
    await afterWrite('Menu item deleted.');
  }
}

async function menuModal(item) {
  const isEdit = !!item;
  await openModal({
    title: isEdit ? 'Edit menu item' : 'Add menu item',
    submitLabel: isEdit ? 'Save changes' : 'Add item',
    bodyHTML: `
      ${field({ label: 'Item name', name: 'name', value: item ? item.name : '', required: true, placeholder: 'e.g. Chicken Stew' })}
      <div class="field-row">
        ${field({
          label: 'Category', name: 'category', value: item ? item.category : 'main',
          options: [
            { value: 'main', label: 'Main dish' }, { value: 'side', label: 'Side' },
            { value: 'drink', label: 'Drink' }, { value: 'dessert', label: 'Dessert' }
          ]
        })}
        ${field({ label: 'Price (UGX)', name: 'price', type: 'number', min: 0, value: item ? item.price : '' })}
      </div>
      ${field({ label: 'Description', name: 'description', value: item ? item.description : '', placeholder: 'Short description for the menu', textarea: true })}
      ${field({ label: 'Available today', name: 'available', checkbox: true, value: item ? Number(item.available) : 1 })}
    `,
    onSubmit: async (form) => {
      const name = formValue(form, 'name');
      if (!name) throw new Error('Enter the item name.');
      await saveRecord('menu_items', {
        id: item ? item.id : undefined,
        created_at: item ? item.created_at : undefined,
        name,
        category: formValue(form, 'category') || 'main',
        price: formNumber(form, 'price'),
        available: formChecked(form, 'available') ? 1 : 0,
        description: formValue(form, 'description')
      });
      await afterWrite(isEdit ? 'Menu item updated.' : 'Menu item added.');
    }
  });
}

// ---- Orders -------------------------------------------------------------------

function menuName(id, fallback) {
  const item = menu.find((m) => m.id === id);
  return item ? item.name : (fallback || 'Deleted item');
}

function itemsSummary(items) {
  const list = Array.isArray(items) ? items : [];
  return list.length ? list.map((i) => `${i.name} ×${i.qty}`).join(', ') : '—';
}

function renderOrders() {
  const query = (document.getElementById('rorder-search').value || '').toLowerCase();
  const list = orders.filter((o) => !query || String(o.table_no || '').toLowerCase().includes(query));

  document.getElementById('rorders-body').innerHTML = list.length
    ? list.map((o) => `<tr>
        <td class="nowrap">${fmtDateTime(o.created_at)}</td>
        <td>Table ${esc(o.table_no || '—')}</td>
        <td>${esc(itemsSummary(o.items))}</td>
        <td class="num">${fmtMoney(o.total)}</td>
        <td>${statusBadge(o.status)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${o.id}" type="button">Edit</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${o.id}" type="button">Delete</button>
        </td>
      </tr>`).join('')
    : emptyRow(6, 'No restaurant orders yet.');
}

async function onOrdersClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const order = orders.find((o) => o.id === button.dataset.id);
  if (button.dataset.act === 'edit') {
    orderModal(order);
  } else if (button.dataset.act === 'delete') {
    const ok = await confirmDialog('Delete this restaurant order?', { title: 'Delete order', okLabel: 'Delete' });
    if (!ok) return;
    await deleteRecord('restaurant_orders', button.dataset.id);
    await afterWrite('Order deleted.');
  }
}

function orderModal(order) {
  const isEdit = !!order;
  if (!menu.length) {
    toast('Add menu items before creating orders.', 'info');
    return;
  }

  const lineRowHTML = (line) => `
    <tr data-line>
      <td>
        <select data-line-product>
          <option value="">— choose item —</option>
          ${menu.map((m) => `<option value="${m.id}" ${m.id === line.menu_item_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
        </select>
      </td>
      <td class="col-qty"><input type="number" name="line_qty" min="1" step="1" value="${line.qty || 1}"></td>
      <td><input type="number" name="line_price" min="0" step="any" value="${line.price !== undefined && line.price !== null && line.price !== '' ? line.price : ''}"></td>
      <td class="col-line-total" data-line-total>${fmtMoney(0)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-remove-line>Remove</button></td>
    </tr>`;

  const initialLines = (Array.isArray(order && order.items) && order.items.length
    ? order.items
    : [{ qty: 1, price: '', menu_item_id: '' }]
  ).map((line) => {
    if (line.menu_item_id) return line;
    const match = menu.find((m) => m.name === line.name);
    return { ...line, menu_item_id: match ? match.id : '', price: line.price !== undefined ? line.price : '' };
  });

  const done = openModal({
    title: isEdit ? 'Edit restaurant order' : 'New restaurant order',
    submitLabel: isEdit ? 'Save changes' : 'Create order',
    wide: true,
    bodyHTML: `
      <div class="field-row">
        ${field({ label: 'Table number', name: 'table_no', value: order ? order.table_no : '', required: true, placeholder: 'e.g. 4' })}
        ${field({
          label: 'Status', name: 'status', value: order ? order.status : 'pending',
          options: [
            { value: 'pending', label: 'Pending' },
            { value: 'preparing', label: 'Preparing' },
            { value: 'served', label: 'Served' },
            { value: 'paid', label: 'Paid' }
          ]
        })}
      </div>
      <span class="field-label">Items <em>*</em></span>
      <div class="line-items">
        <table>
          <thead>
            <tr><th>Menu item</th><th class="col-qty">Qty</th><th>Unit price (UGX)</th><th class="col-line-total">Line total</th><th></th></tr>
          </thead>
          <tbody id="line-rows">${initialLines.map(lineRowHTML).join('')}</tbody>
        </table>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="add-line">+ Add item</button>
      <div class="order-total">Total: <span id="order-total">UGX 0</span></div>
    `,
    onSubmit: async (form) => {
      const tableNo = formValue(form, 'table_no');
      if (!tableNo) throw new Error('Enter the table number.');

      const items = [];
      form.querySelectorAll('[data-line]').forEach((row) => {
        const itemId = row.querySelector('select').value;
        const qty = Math.round(Number(row.querySelector('input[name="line_qty"]').value) || 0);
        const price = Number(row.querySelector('input[name="line_price"]').value) || 0;
        if (!itemId && !qty) return;
        const menuItem = menu.find((m) => m.id === itemId);
        if (!menuItem) throw new Error('Choose a menu item for every line.');
        if (qty < 1) throw new Error('Quantities must be at least 1.');
        items.push({ menu_item_id: itemId, name: menuItem.name, qty, price });
      });
      if (!items.length) throw new Error('Add at least one item to the order.');

      await saveRecord('restaurant_orders', {
        id: order ? order.id : undefined,
        created_at: order ? order.created_at : undefined,
        table_no: tableNo,
        status: formValue(form, 'status'),
        items,
        total: items.reduce((sum, i) => sum + i.qty * i.price, 0)
      });
      await afterWrite(isEdit ? 'Order updated.' : 'Order created.');
    }
  });

  const host = document.getElementById('line-rows');
  const recalc = () => {
    let total = 0;
    host.querySelectorAll('[data-line]').forEach((row) => {
      const qty = Number(row.querySelector('input[name="line_qty"]').value) || 0;
      const price = Number(row.querySelector('input[name="line_price"]').value) || 0;
      row.querySelector('[data-line-total]').textContent = fmtMoney(qty * price);
      total += qty * price;
    });
    document.getElementById('order-total').textContent = fmtMoney(total);
  };
  host.addEventListener('input', recalc);
  host.addEventListener('change', (event) => {
    const select = event.target.closest('[data-line-product]');
    if (select) {
      const menuItem = menu.find((m) => m.id === select.value);
      if (menuItem) select.closest('[data-line]').querySelector('input[name="line_price"]').value = menuItem.price;
    }
    recalc();
  });
  host.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-line]');
    if (remove) {
      remove.closest('[data-line]').remove();
      recalc();
    }
  });
  document.getElementById('add-line').addEventListener('click', () => {
    host.insertAdjacentHTML('beforeend', lineRowHTML({ qty: 1, price: '', menu_item_id: '' }));
    recalc();
  });
  recalc();

  return done;
}

// ---- Reservations -------------------------------------------------------------

function renderReservations() {
  const query = (document.getElementById('reservation-search').value || '').toLowerCase();
  const list = reservations.filter((r) =>
    !query ||
    String(r.customer_name || '').toLowerCase().includes(query) ||
    String(r.phone || '').toLowerCase().includes(query));

  document.getElementById('reservations-body').innerHTML = list.length
    ? list.map((r) => `<tr>
        <td class="nowrap">${esc(r.date || '—')}</td>
        <td class="nowrap">${esc(r.time || '—')}</td>
        <td>${esc(r.customer_name || '—')}</td>
        <td>${esc(r.phone || '—')}</td>
        <td class="num">${Number(r.party_size) || 1}</td>
        <td>${esc(r.table_no || '—')}</td>
        <td>${statusBadge(r.status)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}" type="button">Edit</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${r.id}" type="button">Delete</button>
        </td>
      </tr>`).join('')
    : emptyRow(8, 'No reservations yet.');
}

async function onReservationsClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const reservation = reservations.find((r) => r.id === button.dataset.id);
  if (button.dataset.act === 'edit') {
    reservationModal(reservation);
  } else if (button.dataset.act === 'delete') {
    const ok = await confirmDialog(`Delete the reservation for "${reservation ? reservation.customer_name : ''}"?`, { title: 'Delete reservation', okLabel: 'Delete' });
    if (!ok) return;
    await deleteRecord('reservations', button.dataset.id);
    await afterWrite('Reservation deleted.');
  }
}

async function reservationModal(reservation) {
  const isEdit = !!reservation;
  await openModal({
    title: isEdit ? 'Edit reservation' : 'New reservation',
    submitLabel: isEdit ? 'Save changes' : 'Book table',
    bodyHTML: `
      <div class="field-row">
        ${field({ label: 'Customer name', name: 'customer_name', value: reservation ? reservation.customer_name : '', required: true, placeholder: 'e.g. Daniel Mwangi' })}
        ${field({ label: 'Phone', name: 'phone', type: 'tel', value: reservation ? reservation.phone : '', placeholder: '+254 7xx xxx xxx' })}
      </div>
      <div class="field-row">
        ${field({ label: 'Date', name: 'date', type: 'date', value: reservation ? reservation.date : todayStr(), required: true })}
        ${field({ label: 'Time', name: 'time', type: 'time', value: reservation ? reservation.time : '19:00', required: true })}
      </div>
      <div class="field-row">
        ${field({ label: 'Party size', name: 'party_size', type: 'number', min: 1, step: 1, value: reservation ? reservation.party_size : 2 })}
        ${field({ label: 'Table number', name: 'table_no', value: reservation ? reservation.table_no : '', placeholder: 'e.g. 9' })}
      </div>
      ${field({
        label: 'Status', name: 'status', value: reservation ? reservation.status : 'booked',
        options: [
          { value: 'booked', label: 'Booked' },
          { value: 'seated', label: 'Seated' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' }
        ]
      })}
    `,
    onSubmit: async (form) => {
      const name = formValue(form, 'customer_name');
      if (!name) throw new Error('Enter the customer name.');
      await saveRecord('reservations', {
        id: reservation ? reservation.id : undefined,
        created_at: reservation ? reservation.created_at : undefined,
        customer_name: name,
        phone: formValue(form, 'phone'),
        party_size: Math.max(1, Math.round(formNumber(form, 'party_size', 1))),
        date: formValue(form, 'date') || todayStr(),
        time: formValue(form, 'time') || '19:00',
        table_no: formValue(form, 'table_no'),
        status: formValue(form, 'status') || 'booked'
      });
      await afterWrite(isEdit ? 'Reservation updated.' : 'Reservation created.');
    }
  });
}
