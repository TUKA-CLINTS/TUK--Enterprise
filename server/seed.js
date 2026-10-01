// Seeds the system accounts and demo data.
// Run with: npm run seed  (safe to re-run; existing records are kept)
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const pool = require('./db');

const now = Date.now();
const HOUR = 3600000;
const DAY = 86400000;

function dateStr(offsetDays) {
  return new Date(now + offsetDays * DAY).toISOString().slice(0, 10);
}

async function ensureUser({ name, email, password, department, role }) {
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing.length) {
    console.log(`  = user exists: ${email}`);
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (id, name, email, phone, password_hash, department, role, status, created_at, updated_at, deleted) VALUES (?,?,?,?,?,?,?,?,?,?,0)',
    [randomUUID(), name, email, '', hash, department, role, 'active', now, now]
  );
  console.log(`  + created ${role}: ${email}  (password: ${password})`);
}

async function isEmpty(table) {
  const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM ${table}`);
  return rows[0].c === 0;
}

async function insertRows(table, columns, rows) {
  if (!rows.length) return;
  const placeholders = rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
  const values = rows.flat();
  await pool.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`, values);
  console.log(`  + ${rows.length} rows -> ${table}`);
}

async function seedShop() {
  if (await isEmpty('products')) {
    const base = ['id', 'name', 'sku', 'price', 'cost', 'quantity', 'reorder_level'];
    const mk = (name, sku, price, cost, quantity, reorder) => {
      const id = randomUUID();
      return {
        id,
        row: [id, name, sku, price, cost, quantity, reorder, now, now, 0],
        name
      };
    };
    const rice = mk('Rice 25kg Bag', 'SH-001', 3200, 2850, 42, 10);
    const oil = mk('Cooking Oil 5L', 'SH-002', 950, 820, 30, 8);
    const sugar = mk('Sugar 2kg', 'SH-003', 280, 240, 4, 10);
    const flour = mk('Maize Flour 10kg', 'SH-004', 550, 490, 18, 6);
    const soap = mk('Bar Soap (Pack of 6)', 'SH-005', 240, 195, 60, 15);
    const soda = mk('Soda Crate (24 x 350ml)', 'SH-006', 750, 640, 12, 5);
    await insertRows('products', [...base, 'created_at', 'updated_at', 'deleted'],
      [rice.row, oil.row, sugar.row, flour.row, soap.row, soda.row]);

    await insertRows('inventory_movements',
      ['id', 'product_id', 'movement_type', 'qty', 'note', 'created_at', 'updated_at', 'deleted'],
      [
        [randomUUID(), rice.id, 'in', 50, 'Received from supplier', now - 2 * DAY, now - 2 * DAY, 0],
        [randomUUID(), sugar.id, 'out', 6, 'Shop floor sales', now - 1 * DAY, now - 1 * DAY, 0]
      ]);

    await insertRows('sales_orders',
      ['id', 'customer_name', 'items', 'total', 'status', 'order_date', 'created_at', 'updated_at', 'deleted'],
      [
        [randomUUID(), 'Wanjiku Mini Mart',
          JSON.stringify([{ name: 'Rice 25kg Bag', qty: 5, price: 3200 }, { name: 'Cooking Oil 5L', qty: 2, price: 950 }]),
          17900, 'paid', dateStr(0), now - 5 * HOUR, now - 5 * HOUR, 0],
        [randomUUID(), 'Campus Canteen',
          JSON.stringify([{ name: 'Maize Flour 10kg', qty: 10, price: 550 }]),
          5500, 'pending', dateStr(0), now - 2 * HOUR, now - 2 * HOUR, 0]
      ]);
  }
}

async function seedTransport() {
  if (await isEmpty('vehicles')) {
    const truck = randomUUID();
    const van = randomUUID();
    const bus = randomUUID();
    await insertRows('vehicles', ['id', 'plate_no', 'model', 'vehicle_type', 'capacity', 'status', 'created_at', 'updated_at', 'deleted'], [
      [truck, 'KDA 123T', 'Isuzu FRR', 'Truck', '8 tonnes', 'available', now, now, 0],
      [van, 'KDB 456V', 'Toyota Hiace', 'Van', '14 passengers', 'in-service', now, now, 0],
      [bus, 'KDC 789B', 'Toyota Coaster', 'Bus', '30 passengers', 'maintenance', now, now, 0]
    ]);

    const kamau = randomUUID();
    const wanjiku = randomUUID();
    const otieno = randomUUID();
    await insertRows('drivers', ['id', 'name', 'license_no', 'phone', 'status', 'created_at', 'updated_at', 'deleted'], [
      [kamau, 'John Kamau', 'DL-88421', '+254 700 111222', 'on-trip', now, now, 0],
      [wanjiku, 'Mary Wanjiku', 'DL-77310', '+254 711 333444', 'available', now, now, 0],
      [otieno, 'Peter Otieno', 'DL-99125', '+254 722 555666', 'off-duty', now, now, 0]
    ]);

    await insertRows('trips', ['id', 'vehicle_id', 'driver_id', 'origin', 'destination', 'departure', 'arrival', 'cargo', 'status', 'created_at', 'updated_at', 'deleted'], [
      [randomUUID(), truck, kamau, 'Nairobi', 'Mombasa', now - 3 * HOUR, 0, 'General shop supplies', 'ongoing', now, now, 0],
      [randomUUID(), van, wanjiku, 'Nairobi', 'Nakuru', now + DAY, 0, 'Passenger shuttle', 'scheduled', now, now, 0]
    ]);
  }
}

async function seedRestaurant() {
  if (await isEmpty('menu_items')) {
    await insertRows('menu_items', ['id', 'name', 'category', 'price', 'available', 'description', 'created_at', 'updated_at', 'deleted'], [
      [randomUUID(), 'Chicken Stew', 'main', 450, 1, 'Served with rice or chapati', now, now, 0],
      [randomUUID(), 'Beef Stew', 'main', 420, 1, 'Slow-cooked beef in rich gravy', now, now, 0],
      [randomUUID(), 'Pilau', 'main', 350, 1, 'Spiced rice dish', now, now, 0],
      [randomUUID(), 'Chapati', 'side', 30, 1, 'Soft flatbread', now, now, 0],
      [randomUUID(), 'Soda 350ml', 'drink', 60, 1, 'Chilled bottled soda', now, now, 0],
      [randomUUID(), 'Fresh Juice', 'drink', 120, 1, 'Freshly squeezed', now, now, 0],
      [randomUUID(), 'Ice Cream', 'dessert', 150, 1, 'Two scoops', now, now, 0]
    ]);

    await insertRows('restaurant_orders', ['id', 'table_no', 'items', 'total', 'status', 'created_at', 'updated_at', 'deleted'], [
      [randomUUID(), '4',
        JSON.stringify([{ name: 'Chicken Stew', qty: 2, price: 450 }, { name: 'Chapati', qty: 2, price: 30 }]),
        960, 'preparing', now - 40 * 60000, now - 40 * 60000, 0],
      [randomUUID(), '7',
        JSON.stringify([{ name: 'Pilau', qty: 1, price: 350 }, { name: 'Soda 350ml', qty: 1, price: 60 }]),
        410, 'pending', now - 10 * 60000, now - 10 * 60000, 0]
    ]);

    await insertRows('reservations', ['id', 'customer_name', 'phone', 'party_size', 'date', 'time', 'table_no', 'status', 'created_at', 'updated_at', 'deleted'], [
      [randomUUID(), 'Daniel Mwangi', '+254 712 345678', 4, dateStr(0), '19:00', '9', 'booked', now, now, 0],
      [randomUUID(), 'Grace Achieng', '+254 723 987654', 2, dateStr(1), '13:00', '3', 'booked', now, now, 0]
    ]);
  }
}

(async () => {
  console.log('[seed] Seeding TUK@ Enterprises...');
  console.log(' Accounts:');
  await ensureUser({ name: 'System Administrator', email: 'admin@tuk.enterprises', password: 'Admin@123!', department: 'head-office', role: 'admin' });
  await ensureUser({ name: 'Shop Manager', email: 'manager.shop@tuk.enterprises', password: 'Manager@123!', department: 'shop', role: 'manager' });
  await ensureUser({ name: 'Transport Manager', email: 'manager.transport@tuk.enterprises', password: 'Manager@123!', department: 'transport', role: 'manager' });
  await ensureUser({ name: 'Restaurant Manager', email: 'manager.restaurant@tuk.enterprises', password: 'Manager@123!', department: 'restaurant', role: 'manager' });
  console.log(' Demo data:');
  await seedShop();
  await seedTransport();
  await seedRestaurant();
  console.log('[seed] Done.');
  await pool.end();
})().catch((err) => {
  console.error('[seed] Failed:', err.message);
  process.exit(1);
});
