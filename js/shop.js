// Shop department: Products, Inventory movements and Sales orders.
import { initShell } from '../script.js';
import { DB, saveRecord, deleteRecord } from './db.js';
import { notifyLocalChange } from './sync.js';
import {
  esc, fmtMoney, fmtDateTime, todayStr, toast, openModal, confirmDialog,
  field, formValue, formNumber, badge, statusBadge, emptyRow, setupTabs
} from './ui.js';

const shell = initShell({ active: 'shop', requireDepartment: 'shop' });

let products = [];
let movements = [];
let orders = [];

if (shell) init();

function init() {
  setupTabs(document);

  document.getElementById('add-product').addEventListener('click', () => productModal(null));
  document.getElementById('product-search').addEventListener('input', renderProducts);
  document.getElementById('add-movement').addEventListener('click', movementModal);
  document.getElementById('add-order').addEventListener('click', () => orderModal(null));
  document.getElementById('order-search').addEventListener('input', renderOrders);

  document.getElementById('products-body').addEventListener('click', onProductsClick);
  document.getElementById('orders-body').addEventListener('click', onOrdersClick);

  refreshAll();
  document.addEventListener('tukent:synced', refreshAll);
}

async function refreshAll() {
  await loadAll();
  renderProducts();
  renderMovements();
  renderOrders();
  renderLowStockCallout();
}

async function loadAll() {
  [products, movements, orders] = await Promise.all([
    DB.getAll('products'),
    DB.getAll('inventory_movements'),
    DB.getAll('sales_orders')
  ]);
  products.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  movements.sort((a, b) => Number(b.updated_at) - Number(a.updated_at));
  orders.sort((a, b) =>
    String(b.order_date || '').localeCompare(String(a.order_date || '')) ||
    Number(b.created_at) - Number(a.created_at));
}

async function afterWrite(message) {
  toast(message, 'success');
  await notifyLocalChange();
  await refreshAll();
}

// ---- Products ---------------------------------------------------------------

function renderLowStockCallout() {
  const host = document.getElementById('products-callout');
  const low = products.filter((p) => Number(p.quantity) <= Number(p.reorder_level));
  host.innerHTML = low.length
    ? `<div class="callout callout-warn"><strong>${low.length} product(s) at or below reorder level:</strong> ${esc(low.map((p) => p.name).join(', '))}</div>`
    : '';
}

function renderProducts() {
  const query = (document.getElementById('product-search').value || '').toLowerCase();
  const list = products.filter((p) =>
    !query ||
    String(p.name).toLowerCase().includes(query) ||
    String(p.sku || '').toLowerCase().includes(query));

  document.getElementById('products-body').innerHTML = list.length
    ? list.map((p) => {
      const low = Number(p.quantity) <= Number(p.reorder_level);
      return `<tr class="${low ? 'row-low' : ''}">
        <td>${esc(p.name)} ${low ? badge('Low stock', 'red') : ''}</td>
        <td>${esc(p.sku || '—')}</td>
        <td class="num">${fmtMoney(p.price)}</td>
        <td class="num">${fmtMoney(p.cost)}</td>
        <td class="num">${Number(p.quantity)}</td>
        <td class="num">${Number(p.reorder_level)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${p.id}" type="button">Edit</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${p.id}" type="button">Delete</button>
        </td>
      </tr>`;
    }).join('')
    : emptyRow(7, 'No products yet. Add your first product.');
}

async function onProductsClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const product = products.find((p) => p.id === button.dataset.id);
  if (button.dataset.act === 'edit') {
    productModal(product);
  } else if (button.dataset.act === 'delete') {
    const ok = await confirmDialog(`Delete "${product ? product.name : 'this product'}"? It will be removed on all devices after sync.`, { title: 'Delete product', okLabel: 'Delete' });
    if (!ok) return;
    await deleteRecord('products', button.dataset.id);
    await afterWrite('Product deleted.');
  }
}

async function productModal(product) {
  const isEdit = !!product;
  await openModal({
    title: isEdit ? 'Edit product' : 'Add product',
    submitLabel: isEdit ? 'Save changes' : 'Add product',
    bodyHTML: `
      ${field({ label: 'Product name', name: 'name', value: product ? product.name : '', required: true, placeholder: 'e.g. Rice 25kg Bag' })}
      <div class="field-row">
        ${field({ label: 'SKU / code', name: 'sku', value: product ? product.sku : '', placeholder: 'SH-001' })}
        ${field({ label: 'Reorder level', name: 'reorder_level', type: 'number', min: 0, step: 1, value: product ? product.reorder_level : 5, hint: 'Alert when stock falls to this level.' })}
      </div>
      <div class="field-row">
        ${field({ label: 'Selling price (UGX)', name: 'price', type: 'number', min: 0, value: product ? product.price : '' })}
        ${field({ label: 'Cost price (UGX)', name: 'cost', type: 'number', min: 0, value: product ? product.cost : '' })}
      </div>
      ${field({ label: 'Quantity in stock', name: 'quantity', type: 'number', min: 0, step: 1, value: product ? product.quantity : 0 })}
    `,
    onSubmit: async (form) => {
      const name = formValue(form, 'name');
      if (!name) throw new Error('Enter the product name.');
      await saveRecord('products', {
        id: product ? product.id : undefined,
        created_at: product ? product.created_at : undefined,
        name,
        sku: formValue(form, 'sku'),
        price: formNumber(form, 'price'),
        cost: formNumber(form, 'cost'),
        quantity: Math.max(0, Math.round(formNumber(form, 'quantity'))),
        reorder_level: Math.max(0, Math.round(formNumber(form, 'reorder_level', 5)))
      });
      await afterWrite(isEdit ? 'Product updated.' : 'Product added.');
    }
  });
}

// ---- Inventory movements ------------------------------------------------------

function productName(id) {
  const product = products.find((p) => p.id === id);
  return product ? product.name : 'Deleted product';
}

function renderMovements() {
  document.getElementById('movements-body').innerHTML = movements.length
    ? movements.map((m) => `<tr>
        <td class="nowrap">${fmtDateTime(m.created_at)}</td>
        <td>${esc(productName(m.product_id))}</td>
        <td>${statusBadge(m.movement_type)}</td>
        <td class="num">${m.movement_type === 'out' ? '−' : '+'}${Math.abs(Number(m.qty))}</td>
        <td>${esc(m.note || '—')}</td>
      </tr>`).join('')
    : emptyRow(5, 'No stock movements recorded yet.');
}

async function movementModal() {
  if (!products.length) {
    toast('Add a product before recording stock movements.', 'info');
    return;
  }
  await openModal({
    title: 'Record stock movement',
    submitLabel: 'Save movement',
    bodyHTML: `
      ${field({
        label: 'Product', name: 'product_id', required: true,
        options: products.map((p) => ({ value: p.id, label: `${p.name} — ${p.quantity} in stock` }))
      })}
      <div class="field-row">
        ${field({
          label: 'Movement type', name: 'movement_type',
          options: [{ value: 'in', label: 'Stock in (+)' }, { value: 'out', label: 'Stock out (−)' }]
        })}
        ${field({ label: 'Quantity', name: 'qty', type: 'number', min: 1, step: 1, value: 1, required: true })}
      </div>
      ${field({ label: 'Note', name: 'note', placeholder: 'e.g. Received from supplier', textarea: true })}
    `,
    onSubmit: async (form) => {
      const productId = formValue(form, 'product_id');
      const type = formValue(form, 'movement_type') === 'out' ? 'out' : 'in';
      const qty = Math.round(formNumber(form, 'qty'));
      const product = products.find((p) => p.id === productId);
      if (!product) throw new Error('Choose a product.');
      if (qty < 1) throw new Error('Enter a quantity of at least 1.');
      if (type === 'out' && qty > Number(product.quantity)) {
        throw new Error(`Only ${product.quantity} in stock — cannot remove ${qty}.`);
      }

      await saveRecord('inventory_movements', {
        product_id: productId,
        movement_type: type,
        qty,
        note: formValue(form, 'note')
      });
      await saveRecord('products', {
        ...product,
        quantity: Number(product.quantity) + (type === 'in' ? qty : -qty)
      });
      await afterWrite('Stock movement recorded.');
    }
  });
}

// ---- Sales orders ------------------------------------------------------------

function itemsSummary(items) {
  const list = Array.isArray(items) ? items : [];
  return list.length ? list.map((i) => `${i.name} ×${i.qty}`).join(', ') : '—';
}

function renderOrders() {
  const query = (document.getElementById('order-search').value || '').toLowerCase();
  const list = orders.filter((o) => !query || String(o.customer_name || '').toLowerCase().includes(query));

  document.getElementById('orders-body').innerHTML = list.length
    ? list.map((o) => `<tr>
        <td class="nowrap">${esc(o.order_date || '—')}</td>
        <td>${esc(o.customer_name || 'Walk-in customer')}</td>
        <td>${esc(itemsSummary(o.items))}</td>
        <td class="num">${fmtMoney(o.total)}</td>
        <td>${statusBadge(o.status)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${o.id}" type="button">Edit</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${o.id}" type="button">Delete</button>
        </td>
      </tr>`).join('')
    : emptyRow(6, 'No sales orders yet. Create the first order.');
}

async function onOrdersClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const order = orders.find((o) => o.id === button.dataset.id);
  if (button.dataset.act === 'edit') {
    orderModal(order);
  } else if (button.dataset.act === 'delete') {
    const ok = await confirmDialog('Delete this sales order? It will be removed on all devices after sync.', { title: 'Delete order', okLabel: 'Delete' });
    if (!ok) return;
    await deleteRecord('sales_orders', button.dataset.id);
    await afterWrite('Order deleted.');
  }
}

function orderModal(order) {
  const isEdit = !!order;
  if (!products.length) {
    toast('Add at least one product before creating orders.', 'info');
    return;
  }

  const lineRowHTML = (line) => `
    <tr data-line>
      <td>
        <select data-line-product>
          <option value="">— choose product —</option>
          ${products.map((p) => `<option value="${p.id}" ${p.id === line.product_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </td>
      <td class="col-qty"><input type="number" name="line_qty" min="1" step="1" value="${line.qty || 1}"></td>
      <td><input type="number" name="line_price" min="0" step="any" value="${line.price !== undefined && line.price !== null && line.price !== '' ? line.price : ''}"></td>
      <td class="col-line-total" data-line-total>${fmtMoney(0)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-remove-line>Remove</button></td>
    </tr>`;

  // Map existing seed/demo items to product ids by name where possible.
  const initialLines = (Array.isArray(order && order.items) && order.items.length
    ? order.items
    : [{ qty: 1, price: '', product_id: '' }]
  ).map((line) => {
    if (line.product_id) return line;
    const match = products.find((p) => p.name === line.name);
    return { ...line, product_id: match ? match.id : '', price: line.price !== undefined ? line.price : '' };
  });

  const done = openModal({
    title: isEdit ? 'Edit sales order' : 'New sales order',
    submitLabel: isEdit ? 'Save changes' : 'Create order',
    wide: true,
    bodyHTML: `
      <div class="field-row">
        ${field({ label: 'Customer name', name: 'customer_name', value: order ? order.customer_name : '', placeholder: 'Walk-in customer' })}
        ${field({ label: 'Order date', name: 'order_date', type: 'date', value: order ? order.order_date : todayStr() })}
      </div>
      ${field({
        label: 'Status', name: 'status', value: order ? order.status : 'pending',
        options: [
          { value: 'pending', label: 'Pending' },
          { value: 'paid', label: 'Paid' },
          { value: 'delivered', label: 'Delivered' }
        ]
      })}
      <span class="field-label">Items <em>*</em></span>
      <div class="line-items">
        <table>
          <thead>
            <tr><th>Product</th><th class="col-qty">Qty</th><th>Unit price (UGX)</th><th class="col-line-total">Line total</th><th></th></tr>
          </thead>
          <tbody id="line-rows">${initialLines.map(lineRowHTML).join('')}</tbody>
        </table>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="add-line">+ Add item</button>
      <div class="order-total">Total: <span id="order-total">UGX 0</span></div>
    `,
    onSubmit: async (form) => {
      const items = [];
      form.querySelectorAll('[data-line]').forEach((row) => {
        const productId = row.querySelector('select').value;
        const qty = Math.round(Number(row.querySelector('input[name="line_qty"]').value) || 0);
        const price = Number(row.querySelector('input[name="line_price"]').value) || 0;
        if (!productId && !qty) return;
        const product = products.find((p) => p.id === productId);
        if (!product) throw new Error('Choose a product for every item line.');
        if (qty < 1) throw new Error('Quantities must be at least 1.');
        items.push({ product_id: productId, name: product.name, qty, price });
      });
      if (!items.length) throw new Error('Add at least one item to the order.');

      await saveRecord('sales_orders', {
        id: order ? order.id : undefined,
        created_at: order ? order.created_at : undefined,
        customer_name: formValue(form, 'customer_name'),
        order_date: formValue(form, 'order_date') || todayStr(),
        status: formValue(form, 'status'),
        items,
        total: items.reduce((sum, i) => sum + i.qty * i.price, 0)
      });
      await afterWrite(isEdit ? 'Order updated.' : 'Order created.');
    }
  });

  // Wire the line-item editor (overlay is already in the DOM).
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
      const product = products.find((p) => p.id === select.value);
      if (product) select.closest('[data-line]').querySelector('input[name="line_price"]').value = product.price;
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
    host.insertAdjacentHTML('beforeend', lineRowHTML({ qty: 1, price: '', product_id: '' }));
    recalc();
  });
  recalc();

  return done;
}
