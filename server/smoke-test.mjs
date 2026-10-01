// Temporary API smoke test for the TUK@ Enterprises backend.
// Run with the server up:  node server/smoke-test.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });

const BASE = process.env.BASE || 'http://localhost:3000';

// Direct DB access (same credentials the server uses). Only used to plant
// known recovery codes and to clean up test rows - the flow under test
// itself is exercised purely over HTTP.
let db = null;
async function dbConnect() {
  if (db) return db;
  db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tukent'
  });
  return db;
}

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}  ->  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const headers = { 'User-Agent': 'tukent-smoke/1.0' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, contentType: res.headers.get('content-type') || '' };
}

const uid = () => crypto.randomUUID();
const stamp = Date.now();
const staffEmail = `smoke.staff.${stamp}@example.com`;

let adminToken;
let mgrToken;
let staffToken;
let staffUserId;

async function main() {
  console.log(`\nTUK@ smoke test against ${BASE}\n`);

  // ---------- 1. Static files + security ----------
  console.log('1. Static files + security');
  {
    const home = await req('GET', '/');
    check('GET / serves the landing page', home.status === 200 && String(home.data).includes('TUK@'), home.status);

    const dash = await req('GET', '/dashboard.html');
    check('GET /dashboard.html serves', dash.status === 200, dash.status);

    const signIn = await req('GET', '/sign-in.html');
    check('GET /sign-in.html serves', signIn.status === 200, signIn.status);

    const recover = await req('GET', '/recover.html');
    check('GET /recover.html serves', recover.status === 200, recover.status);

    const secPage = await req('GET', '/security.html');
    check('GET /security.html serves', secPage.status === 200, secPage.status);

    const actPage = await req('GET', '/activity.html');
    check('GET /activity.html serves', actPage.status === 200, actPage.status);

    const manifest = await req('GET', '/manifest.json');
    check('manifest.json serves as JSON', manifest.status === 200 && typeof manifest.data === 'object' && manifest.data.start_url === '/dashboard.html', manifest.status);

    const sw = await req('GET', '/sw.js');
    check('sw.js serves', sw.status === 200, sw.status);

    const icon = await req('GET', '/icons/icon-192.png');
    check('icon-192.png serves', icon.status === 200 && icon.contentType.includes('image/png'), icon.contentType);

    const envFile = await req('GET', '/server/.env');
    check('/server/.env is blocked (404)', envFile.status === 404, envFile.status);

    const dbJs = await req('GET', '/server/db.js');
    check('/server/db.js is blocked (404)', dbJs.status === 404, dbJs.status);

    const nm = await req('GET', '/node_modules/express/package.json');
    check('/node_modules is blocked (404)', nm.status === 404, nm.status);

    const health = await req('GET', '/api/health');
    check('GET /api/health ok', health.status === 200 && health.data.ok === true, health.data);

    const unknown = await req('GET', '/api/nope');
    check('unknown API route returns JSON 404', unknown.status === 404 && typeof unknown.data === 'object' && unknown.data.error, unknown.data);
  }

  // ---------- 2. Auth ----------
  console.log('2. Authentication');
  {
    const admin = await req('POST', '/api/auth/login', { body: { email: 'admin@tuk.enterprises', password: 'Admin@123!' } });
    check('admin login', admin.status === 200 && admin.data.user.role === 'admin' && admin.data.user.department === 'head-office', admin.data);
    adminToken = admin.data && admin.data.token;

    const wrong = await req('POST', '/api/auth/login', { body: { email: 'admin@tuk.enterprises', password: 'nope' } });
    check('wrong password rejected (401)', wrong.status === 401, wrong.status);

    const noAuth = await req('GET', '/api/auth/me');
    check('me without token rejected (401)', noAuth.status === 401, noAuth.status);

    const me = await req('GET', '/api/auth/me', { token: adminToken });
    check('me returns the signed-in profile', me.status === 200 && me.data.user.email === 'admin@tuk.enterprises', me.status);

    const reg = await req('POST', '/api/auth/register', {
      body: { name: 'Smoke Tester', email: staffEmail, phone: '0700 000 000', password: 'smoke123', department: 'shop' }
    });
    check('register creates a shop staff account', reg.status === 201 && reg.data.user.role === 'staff' && reg.data.user.department === 'shop', reg.data);
    staffToken = reg.data && reg.data.token;
    staffUserId = reg.data && reg.data.user && reg.data.user.id;

    const dup = await req('POST', '/api/auth/register', {
      body: { name: 'Dup', email: staffEmail, password: 'smoke123', department: 'shop' }
    });
    check('duplicate email rejected (409)', dup.status === 409, dup.status);

    const badDept = await req('POST', '/api/auth/register', {
      body: { name: 'Bad Dept', email: `bad.dept.${stamp}@example.com`, password: 'smoke123', department: 'kitchen' }
    });
    check('invalid department rejected (400)', badDept.status === 400, badDept.status);

    const shortPw = await req('POST', '/api/auth/register', {
      body: { name: 'Bad Pw', email: `bad.pw.${stamp}@example.com`, password: '123', department: 'shop' }
    });
    check('short password rejected (400)', shortPw.status === 400, shortPw.status);
  }

  // ---------- 3. Seeded managers + department scoping ----------
  console.log('3. Department scoping');
  {
    const shopMgr = await req('POST', '/api/auth/login', { body: { email: 'manager.shop@tuk.enterprises', password: 'Manager@123!' } });
    check('shop manager login', shopMgr.status === 200 && shopMgr.data.user.department === 'shop', shopMgr.status);

    const restMgr = await req('POST', '/api/auth/login', { body: { email: 'manager.restaurant@tuk.enterprises', password: 'Manager@123!' } });
    check('restaurant manager login', restMgr.status === 200 && restMgr.data.user.department === 'restaurant', restMgr.status);

    const mgr = await req('POST', '/api/auth/login', { body: { email: 'manager.transport@tuk.enterprises', password: 'Manager@123!' } });
    check('transport manager login', mgr.status === 200 && mgr.data.user.department === 'transport', mgr.status);
    mgrToken = mgr.data && mgr.data.token;

    const pullMgr = await req('GET', '/api/sync/pull?since=0', { token: mgrToken });
    const mgrKeys = Object.keys((pullMgr.data && pullMgr.data.records) || {}).sort();
    check('transport manager pull returns ONLY transport entities', mgrKeys.join(',') === 'drivers,trips,vehicles', mgrKeys);
    check('transport manager sees seeded vehicles (>=3)', ((pullMgr.data.records.vehicles) || []).length >= 3, (pullMgr.data.records.vehicles || []).length);

    const pullStaff = await req('GET', '/api/sync/pull?since=0', { token: staffToken });
    const staffKeys = Object.keys((pullStaff.data && pullStaff.data.records) || {}).sort();
    check('shop staff pull returns ONLY shop entities', staffKeys.join(',') === 'inventory_movements,products,sales_orders', staffKeys);
    check('shop staff sees seeded products (>=6)', ((pullStaff.data.records.products) || []).length >= 6, (pullStaff.data.records.products || []).length);

    const pullAdmin = await req('GET', '/api/sync/pull?since=0', { token: adminToken });
    const adminKeys = Object.keys((pullAdmin.data && pullAdmin.data.records) || {});
    check('admin pull returns all 9 entity sets', adminKeys.length === 9, adminKeys);
    check('product prices come back as numbers', typeof (pullAdmin.data.records.products || [])[0]?.price === 'number', typeof (pullAdmin.data.records.products || [])[0]?.price);
    check('sales order items come back as JSON arrays', Array.isArray((pullAdmin.data.records.sales_orders || [])[0]?.items), typeof (pullAdmin.data.records.sales_orders || [])[0]?.items);
  }

  // ---------- 4. Sync push: upsert / LWW / delete / access ----------
  console.log('4. Sync push');
  {
    const productId = uid();
    const t0 = Date.now();

    const upsert = await req('POST', '/api/sync/push', {
      token: staffToken,
      body: {
        ops: [{
          entity: 'products', op: 'upsert',
          data: { id: productId, name: 'Smoke Test Product', sku: `SMK-${stamp % 1000000}`, price: 150.5, cost: 100, quantity: 7, reorder_level: 3, created_at: t0, updated_at: t0 }
        }]
      }
    });
    check('staff upserts a product (applied=1, no errors)', upsert.status === 200 && upsert.data.applied === 1 && upsert.data.errors.length === 0, upsert.data);

    const stale = await req('POST', '/api/sync/push', {
      token: staffToken,
      body: { ops: [{ entity: 'products', op: 'upsert', data: { id: productId, name: 'Stale Name', updated_at: t0 - 5000 } }] }
    });
    check('stale upsert skipped by LWW (skipped=1, applied=0)', stale.status === 200 && stale.data.skipped === 1 && stale.data.applied === 0, stale.data);

    const pullAfter = await req('GET', `/api/sync/pull?since=${t0 - 1}`, { token: staffToken });
    const testProduct = ((pullAfter.data.records.products) || []).find((p) => p.id === productId);
    check('server kept the newest name (LWW verified)', !!testProduct && testProduct.name === 'Smoke Test Product', testProduct && testProduct.name);

    const forbidden = await req('POST', '/api/sync/push', {
      token: staffToken,
      body: { ops: [{ entity: 'vehicles', op: 'upsert', data: { id: uid(), plate_no: 'KAA 000X', updated_at: Date.now() } }] }
    });
    check('shop staff cannot push vehicles (error listed)', forbidden.status === 200 && forbidden.data.applied === 0 && forbidden.data.errors.some((e) => e.includes('vehicles')), forbidden.data);

    const unknownEnt = await req('POST', '/api/sync/push', {
      token: staffToken,
      body: { ops: [{ entity: 'bogus', op: 'upsert', data: { id: uid() } }] }
    });
    check('unknown entity reported as error', unknownEnt.status === 200 && unknownEnt.data.errors.length === 1, unknownEnt.data);

    const noId = await req('POST', '/api/sync/push', {
      token: staffToken,
      body: { ops: [{ entity: 'products', op: 'upsert', data: { name: 'No id' } }] }
    });
    check('op without id reported as error', noId.status === 200 && noId.data.errors[0].includes('missing id'), noId.data);

    const del = await req('POST', '/api/sync/push', {
      token: staffToken,
      body: { ops: [{ entity: 'products', op: 'delete', data: { id: productId, updated_at: Date.now() } }] }
    });
    check('staff soft-deletes the product (applied=1)', del.status === 200 && del.data.applied === 1, del.data);

    const pullDel = await req('GET', `/api/sync/pull?since=${t0 - 1}`, { token: staffToken });
    const deletedProduct = ((pullDel.data.records.products) || []).find((p) => p.id === productId);
    check('deleted product comes back with deleted=1', !!deletedProduct && Number(deletedProduct.deleted) === 1, deletedProduct && deletedProduct.deleted);

    // JSON column round-trip through push (an order with line items)
    const orderId = uid();
    const orderPush = await req('POST', '/api/sync/push', {
      token: staffToken,
      body: {
        ops: [{
          entity: 'sales_orders', op: 'upsert',
          data: {
            id: orderId, customer_name: 'Smoke Customer', total: 300, status: 'pending', order_date: '2025-01-01',
            items: [{ name: 'Smoke Item', qty: 2, price: 150 }], created_at: Date.now(), updated_at: Date.now()
          }
        }]
      }
    });
    check('order with JSON items pushed', orderPush.status === 200 && orderPush.data.applied === 1 && orderPush.data.errors.length === 0, orderPush.data);

    const pullOrder = await req('GET', `/api/sync/pull?since=${Date.now() - 60000}`, { token: staffToken });
    const testOrder = ((pullOrder.data.records.sales_orders) || []).find((o) => o.id === orderId);
    check('order items round-trip as parsed JSON', !!testOrder && Array.isArray(testOrder.items) && testOrder.items[0].name === 'Smoke Item', testOrder && testOrder.items);

    await req('POST', '/api/sync/push', {
      token: staffToken,
      body: { ops: [{ entity: 'sales_orders', op: 'delete', data: { id: orderId, updated_at: Date.now() } }] }
    });
  }

  // ---------- 5. Users API (ADMIN ONLY) ----------
  console.log('5. Users API (admin only)');
  {
    const staffList = await req('GET', '/api/users', { token: staffToken });
    check('staff cannot list users (403)', staffList.status === 403, staffList.status);

    const mgrList = await req('GET', '/api/users', { token: mgrToken });
    check('managers cannot list users - admin only (403)', mgrList.status === 403, mgrList.status);

    const mgrCreate = await req('POST', '/api/users', {
      token: mgrToken,
      body: { name: 'Blocked Manager', email: `blocked.${stamp}@example.com`, password: 'temp12345', department: 'transport', role: 'staff' }
    });
    check('managers cannot create accounts (403)', mgrCreate.status === 403, mgrCreate.status);

    const mgrUpdate = await req('PUT', `/api/users/${staffUserId}`, {
      token: mgrToken,
      body: { name: 'Hijack', department: 'transport', role: 'manager', status: 'active' }
    });
    check('managers cannot update accounts (403)', mgrUpdate.status === 403, mgrUpdate.status);

    const mgrDelete = await req('DELETE', `/api/users/${staffUserId}`, { token: mgrToken });
    check('managers cannot delete accounts (403)', mgrDelete.status === 403, mgrDelete.status);

    const adminList = await req('GET', '/api/users', { token: adminToken });
    const depts = new Set((adminList.data.users || []).map((u) => u.department));
    check('admin lists EVERY account across all departments', adminList.status === 200 && (adminList.data.users || []).length >= 4 && depts.size >= 3, { count: adminList.data.users && adminList.data.users.length, depts: [...depts] });

    const adminCreate = await req('POST', '/api/users', {
      token: adminToken,
      body: { name: 'Admin Made', email: `adminmade.${stamp}@example.com`, password: 'temp12345', department: 'restaurant', role: 'manager' }
    });
    check('admin creates a restaurant manager', adminCreate.status === 201 && adminCreate.data.user.role === 'manager' && adminCreate.data.user.department === 'restaurant', adminCreate.data.user);

    // Admin editing their own credentials (the seeded admin account).
    const meRes = await req('GET', '/api/auth/me', { token: adminToken });
    const selfId = meRes.data.user.id;
    const selfName = meRes.data.user.name;
    const selfPhone = meRes.data.user.phone;

    const selfEdit = await req('PUT', `/api/users/${selfId}`, {
      token: adminToken,
      body: { name: selfName, phone: selfPhone || '+254 700 000 000', department: 'head-office', role: 'admin', status: 'active', password: 'Admin@123!' }
    });
    check('admin CAN edit own credentials (name/phone/password)', selfEdit.status === 200 && selfEdit.data.user.role === 'admin', selfEdit.data.user || selfEdit.status);

    const reLogin = await req('POST', '/api/auth/login', { body: { email: 'admin@tuk.enterprises', password: 'Admin@123!' } });
    check('admin still signs in with the (re-set) password after self-edit', reLogin.status === 200, reLogin.status);

    const selfDemote = await req('PUT', `/api/users/${selfId}`, {
      token: adminToken,
      body: { name: selfName, department: 'head-office', role: 'staff', status: 'active' }
    });
    check('admin cannot demote own account (400)', selfDemote.status === 400, selfDemote.status);

    const selfDisable = await req('PUT', `/api/users/${selfId}`, {
      token: adminToken,
      body: { name: selfName, department: 'head-office', role: 'admin', status: 'disabled' }
    });
    check('admin cannot disable own account (400)', selfDisable.status === 400, selfDisable.status);

    const selfDelete = await req('DELETE', `/api/users/${selfId}`, { token: adminToken });
    check('admin cannot delete own account (400)', selfDelete.status === 400, selfDelete.status);

    // disabled account cannot sign in
    const dis = await req('POST', '/api/users', {
      token: adminToken,
      body: { name: 'Disabled Test', email: `disabled.${stamp}@example.com`, password: 'temp12345', department: 'shop', role: 'staff' }
    });
    await req('PUT', `/api/users/${dis.data.user.id}`, {
      token: adminToken,
      body: { name: 'Disabled Test', department: 'shop', role: 'staff', status: 'disabled' }
    });
    const disLogin = await req('POST', '/api/auth/login', { body: { email: `disabled.${stamp}@example.com`, password: 'temp12345' } });
    check('disabled account cannot sign in (403)', disLogin.status === 403, disLogin.status);

    // cleanup
    const delDis = await req('DELETE', `/api/users/${dis.data.user.id}`, { token: adminToken });
    check('cleanup: disabled test account deleted', delDis.status === 200, delDis.status);
    const delAdminMade = await req('DELETE', `/api/users/${adminCreate.data.user.id}`, { token: adminToken });
    check('cleanup: admin-made manager deleted', delAdminMade.status === 200, delAdminMade.status);
    const delStaff = await req('DELETE', `/api/users/${staffUserId}`, { token: adminToken });
    check('cleanup: smoke staff account deleted', delStaff.status === 200, delStaff.status);

    // deleted account cannot log in any more
    const deletedLogin = await req('POST', '/api/auth/login', { body: { email: staffEmail, password: 'smoke123' } });
    check('deleted account cannot sign in (401)', deletedLogin.status === 401, deletedLogin.status);
  }

  // ---------- 6. Security: recovery ("secret option"), notifications & audit ----------
  console.log('6. Security: recovery, notifications & audit');
  {
    const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const recEmail = `smoke.recov.${stamp}@example.com`;

    // A user registers their recovery document (the "secret option" setup).
    const recReg = await req('POST', '/api/auth/register', {
      body: { name: 'Recovery Tester', email: recEmail, phone: '0700 111 222', password: 'recov12345', department: 'restaurant' }
    });
    check('recovery test account created', recReg.status === 201, recReg.status);
    const recToken = recReg.data && recReg.data.token;

    // The admin panel is admin-only (staffToken was revoked in section 5,
    // so the staff check uses this live non-admin account).
    const anonAct = await req('GET', '/api/admin/activity');
    check('admin audit trail requires a token (401)', anonAct.status === 401, anonAct.status);
    const staffAct = await req('GET', '/api/admin/activity', { token: recToken });
    check('staff cannot read the audit trail (403)', staffAct.status === 403, staffAct.status);
    const mgrNotif = await req('GET', '/api/admin/notifications', { token: mgrToken });
    check('managers cannot read notifications (403)', mgrNotif.status === 403, mgrNotif.status);
    const mgrRecs = await req('GET', '/api/admin/recovery-requests', { token: mgrToken });
    check('managers cannot review recovery requests (403)', mgrRecs.status === 403, mgrRecs.status);

    const badType = await req('POST', '/api/recovery/documents', { token: recToken, body: { docType: 'passport', docNumber: 'P1234', image: TINY_PNG } });
    check('invalid document type rejected (400)', badType.status === 400, badType.status);

    const noImg = await req('POST', '/api/recovery/documents', { token: recToken, body: { docType: 'permit', docNumber: 'P1234', image: 'not-an-image' } });
    check('document without a captured image rejected (400)', noImg.status === 400, noImg.status);

    const docSaved = await req('POST', '/api/recovery/documents', { token: recToken, body: { docType: 'national_id', docNumber: '998-877', image: TINY_PNG } });
    check('user registers a National ID recovery document', docSaved.status === 200 && docSaved.data.ok === true, docSaved.data);

    const docList = await req('GET', '/api/recovery/documents', { token: recToken });
    check('document list shows the saved National ID', docList.status === 200 && (docList.data.documents || []).some((d) => d.doc_type === 'national_id' && d.doc_number === '998-877'), (docList.data.documents || []).map((d) => d.doc_type));

    // Unknown accounts get the same generic answer (no enumeration).
    const ghost = await req('POST', '/api/recovery/request', { body: { email: `ghost.${stamp}@nowhere.dev` } });
    check('unknown account gets a generic answer (no enumeration)', ghost.status === 200 && ghost.data.ok === true && !ghost.data.requestId, ghost.data);

    // Full happy path: emailed code -> live document match -> new password.
    await dbConnect();
    const r1 = await req('POST', '/api/recovery/request', { body: { email: recEmail } });
    check('recovery request accepted with a code', r1.status === 200 && !!r1.data.requestId, r1.data);
    const req1 = r1.data.requestId;

    // The real code only exists bcrypt-hashed in the DB (it is emailed to the
    // owner), so plant a known code hash for this request to test against.
    await db.query('UPDATE recovery_requests SET code_hash = ? WHERE id = ?', [await bcrypt.hash('654321', 10), req1]);

    const wrongCode = await req('POST', '/api/recovery/verify-code', { body: { requestId: req1, code: '000000' } });
    check('wrong code rejected (400, attempts counted)', wrongCode.status === 400, wrongCode.status);

    const v1 = await req('POST', '/api/recovery/verify-code', { body: { requestId: req1, code: '654321' } });
    check('correct code unlocks the document step', v1.status === 200 && (v1.data.docTypes || []).includes('national_id'), v1.data);

    const matched = await req('POST', '/api/recovery/submit-document', { body: { requestId: req1, docType: 'national_id', docNumber: '998 877', image: TINY_PNG } });
    check('document number matches ignoring spaces/hyphens -> verified', matched.status === 200 && matched.data.status === 'verified', matched.data);

    const shortPw = await req('POST', '/api/recovery/reset', { body: { requestId: req1, password: '123' } });
    check('reset rejects a short password (400)', shortPw.status === 400, shortPw.status);

    const reset1 = await req('POST', '/api/recovery/reset', { body: { requestId: req1, password: 'Recovered1' } });
    check('password reset through the recovery flow', reset1.status === 200 && reset1.data.ok === true, reset1.data);

    const reused = await req('POST', '/api/recovery/reset', { body: { requestId: req1, password: 'Other1234' } });
    check('a completed request cannot reset again (400)', reused.status === 400, reused.status);

    const oldPw = await req('POST', '/api/auth/login', { body: { email: recEmail, password: 'recov12345' } });
    check('old password no longer signs in (401)', oldPw.status === 401, oldPw.status);
    const newPw = await req('POST', '/api/auth/login', { body: { email: recEmail, password: 'Recovered1' } });
    check('sign-in with the recovered password works', newPw.status === 200, newPw.status);

    // Mismatch path: document parked for admin review, then approved.
    const r2 = await req('POST', '/api/recovery/request', { body: { email: recEmail } });
    const req2 = r2.data && r2.data.requestId;
    await db.query('UPDATE recovery_requests SET code_hash = ? WHERE id = ?', [await bcrypt.hash('246810', 10), req2]);
    await req('POST', '/api/recovery/verify-code', { body: { requestId: req2, code: '246810' } });
    const mismatch = await req('POST', '/api/recovery/submit-document', { body: { requestId: req2, docType: 'national_id', docNumber: '000000', image: TINY_PNG } });
    check('mismatched document is parked for admin review', mismatch.status === 200 && mismatch.data.status === 'needs_review', mismatch.data);

    const notYet = await req('POST', '/api/recovery/reset', { body: { requestId: req2, password: 'Approved1' } });
    check('reset blocked while the request awaits review (400)', notYet.status === 400, notYet.status);

    const adminReqs = await req('GET', '/api/admin/recovery-requests', { token: adminToken });
    const listed = (adminReqs.data.requests || []).find((x) => x.id === req2);
    check('admin review shows registered AND submitted document images', adminReqs.status === 200 && !!listed
      && listed.status === 'needs_review'
      && String(listed.registered_image || '').startsWith('data:image')
      && String(listed.submitted_image || '').startsWith('data:image'),
      listed && { status: listed.status, registered: !!listed.registered_image, submitted: !!listed.submitted_image });

    const approve = await req('PUT', `/api/admin/recovery-requests/${req2}/approve`, { token: adminToken });
    check('admin approves the reviewed request', approve.status === 200, approve.data);
    const approveTwice = await req('PUT', `/api/admin/recovery-requests/${req2}/approve`, { token: adminToken });
    check('approving twice is rejected (400)', approveTwice.status === 400, approveTwice.status);

    const reset2 = await req('POST', '/api/recovery/reset', { body: { requestId: req2, password: 'Approved1' } });
    check('reset works after admin approval', reset2.status === 200, reset2.status);
    const loginApproved = await req('POST', '/api/auth/login', { body: { email: recEmail, password: 'Approved1' } });
    check('sign-in with the admin-approved password works', loginApproved.status === 200, loginApproved.status);

    // Deny path: a suspicious request can never reset.
    const r3 = await req('POST', '/api/recovery/request', { body: { email: recEmail } });
    const req3 = r3.data && r3.data.requestId;
    await db.query('UPDATE recovery_requests SET code_hash = ? WHERE id = ?', [await bcrypt.hash('135790', 10), req3]);
    await req('POST', '/api/recovery/verify-code', { body: { requestId: req3, code: '135790' } });
    await req('POST', '/api/recovery/submit-document', { body: { requestId: req3, docType: 'national_id', docNumber: 'WRONG', image: TINY_PNG } });
    const deny = await req('PUT', `/api/admin/recovery-requests/${req3}/deny`, { token: adminToken });
    check('admin denies a suspicious request', deny.status === 200, deny.data);
    const reset3 = await req('POST', '/api/recovery/reset', { body: { requestId: req3, password: 'Denied123' } });
    check('a denied request can never reset (400)', reset3.status === 400, reset3.status);

    // Expired code path.
    const r4 = await req('POST', '/api/recovery/request', { body: { email: recEmail } });
    const req4 = r4.data && r4.data.requestId;
    await db.query('UPDATE recovery_requests SET code_expires_at = ? WHERE id = ?', [Date.now() - 1000, req4]);
    const expired = await req('POST', '/api/recovery/verify-code', { body: { requestId: req4, code: '654321' } });
    check('expired code rejected (400)', expired.status === 400, expired.status);

    // Audit trail: every operation users make is kept for the admin panel.
    await new Promise((r) => setTimeout(r, 400)); // fire-and-forget audit writes settle
    const act = await req('GET', '/api/admin/activity?limit=500', { token: adminToken });
    const actions = new Set((act.data.entries || []).map((e) => e.action));
    check('audit trail records sign-ins, failures and registrations', ['auth.login', 'auth.login_failed', 'auth.register'].every((a) => actions.has(a)), [...actions].filter((a) => a.startsWith('auth.')));
    check('audit trail records business data operations', actions.has('data.saved') && actions.has('data.deleted'), [...actions].filter((a) => a.startsWith('data.')));
    check('audit trail records account administration', ['users.created', 'users.updated', 'users.deleted'].every((a) => actions.has(a)), [...actions].filter((a) => a.startsWith('users.')));
    check('audit trail records the whole recovery flow', ['recovery.requested', 'recovery.code_failed', 'recovery.code_verified', 'recovery.document_matched', 'recovery.document_mismatch', 'recovery.completed', 'recovery.admin_approved', 'recovery.admin_denied'].every((a) => actions.has(a)), [...actions].filter((a) => a.startsWith('recovery.')));
    const loginEntry = (act.data.entries || []).find((e) => e.action === 'auth.login' && e.user_email === 'admin@tuk.enterprises');
    check('audit entries capture who, from where and with what', !!loginEntry && !!loginEntry.ip && !!loginEntry.user_agent, loginEntry && { ip: loginEntry.ip, ua: loginEntry.user_agent });

    // Notifications: the account owner's email is triggered for every security event.
    const notif = await req('GET', '/api/admin/notifications?limit=500', { token: adminToken });
    const adminNotifs = (notif.data.notifications || []).filter((n) => n.to_email === 'admin@tuk.enterprises');
    check('sign-in triggers a notification to the owner email', adminNotifs.some((n) => n.type === 'login'), [...new Set(adminNotifs.map((n) => n.type))]);
    check('password change triggers a notification to the owner email', adminNotifs.some((n) => n.type === 'password_changed'), [...new Set(adminNotifs.map((n) => n.type))]);
    const recNotifs = (notif.data.notifications || []).filter((n) => n.to_email === recEmail);
    const recTypes = new Set(recNotifs.map((n) => n.type));
    check('owner notified of recovery document changes', recTypes.has('documents_updated'), [...recTypes]);
    check('owner notified through the whole recovery flow', ['recovery_requested', 'recovery_verified', 'recovery_review', 'recovery_completed', 'recovery_approved', 'recovery_denied'].every((t) => recTypes.has(t)), [...recTypes]);
    check('every notification has a delivery status', recNotifs.length > 0 && recNotifs.every((n) => ['queued', 'sent', 'failed', 'skipped'].includes(n.status)), recNotifs[0] && recNotifs[0].status);

    // Cleanup: remove the document, the requests and the test account.
    const docId = ((docList.data.documents || [])[0] || {}).id;
    const docDel = await req('DELETE', `/api/recovery/documents/${docId}`, { token: recToken });
    check('user can remove their recovery document', docDel.status === 200, docDel.status);
    await db.query('DELETE FROM recovery_requests WHERE email = ?', [recEmail]);
    await db.query('DELETE FROM recovery_documents WHERE user_id = ?', [recReg.data.user.id]);
    const delRecUser = await req('DELETE', `/api/users/${recReg.data.user.id}`, { token: adminToken });
    check('cleanup: recovery test account deleted', delRecUser.status === 200, delRecUser.status);
  }

  if (db) await db.end();

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exitCode = 1;
});
