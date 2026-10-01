// Registry of syncable entities: maps API entity names to database tables.
// Shared by the sync push/pull routes and the seed script.
const ENTITIES = {
  // -- Shop ----------------------------------------------------------------
  products: {
    table: 'products',
    department: 'shop',
    columns: ['id', 'name', 'sku', 'price', 'cost', 'quantity', 'reorder_level', 'created_at', 'updated_at', 'deleted'],
    jsonColumns: []
  },
  inventory_movements: {
    table: 'inventory_movements',
    department: 'shop',
    columns: ['id', 'product_id', 'movement_type', 'qty', 'note', 'created_at', 'updated_at', 'deleted'],
    jsonColumns: []
  },
  sales_orders: {
    table: 'sales_orders',
    department: 'shop',
    columns: ['id', 'customer_name', 'items', 'total', 'status', 'order_date', 'created_at', 'updated_at', 'deleted'],
    jsonColumns: ['items']
  },

  // -- Transport ------------------------------------------------------------
  vehicles: {
    table: 'vehicles',
    department: 'transport',
    columns: ['id', 'plate_no', 'model', 'vehicle_type', 'capacity', 'status', 'created_at', 'updated_at', 'deleted'],
    jsonColumns: []
  },
  drivers: {
    table: 'drivers',
    department: 'transport',
    columns: ['id', 'name', 'license_no', 'phone', 'status', 'created_at', 'updated_at', 'deleted'],
    jsonColumns: []
  },
  trips: {
    table: 'trips',
    department: 'transport',
    columns: ['id', 'vehicle_id', 'driver_id', 'origin', 'destination', 'customer_name', 'fare', 'departure', 'arrival', 'cargo', 'status', 'created_at', 'updated_at', 'deleted'],
    jsonColumns: []
  },

  // -- Restaurant -----------------------------------------------------------
  menu_items: {
    table: 'menu_items',
    department: 'restaurant',
    columns: ['id', 'name', 'category', 'price', 'available', 'description', 'created_at', 'updated_at', 'deleted'],
    jsonColumns: []
  },
  restaurant_orders: {
    table: 'restaurant_orders',
    department: 'restaurant',
    columns: ['id', 'customer_name', 'table_no', 'items', 'total', 'status', 'created_at', 'updated_at', 'deleted'],
    jsonColumns: ['items']
  },
  reservations: {
    table: 'reservations',
    department: 'restaurant',
    columns: ['id', 'customer_name', 'phone', 'party_size', 'date', 'time', 'table_no', 'status', 'created_at', 'updated_at', 'deleted'],
    jsonColumns: []
  }
};

function entitiesForDepartment(department) {
  return Object.keys(ENTITIES).filter((key) => ENTITIES[key].department === department);
}

module.exports = { ENTITIES, entitiesForDepartment };
