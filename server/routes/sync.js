// Offline-sync API.
// Clients push queued operations (upsert / delete) and pull everything that
// changed since a timestamp. Conflicts are resolved last-write-wins using the
// record's updated_at (epoch ms) value.
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware');
const { ENTITIES } = require('../entities');
const { logActivity } = require('../audit');

const router = express.Router();
router.use(requireAuth);

const MAX_OPS_PER_PUSH = 500;
const MAX_ROWS_PER_PULL = 10000;

function canAccess(user, entityKey) {
  if (user.role === 'admin') return true;
  const def = ENTITIES[entityKey];
  return !!def && def.department === user.department;
}

function normalizeValue(def, column, value) {
  if (def.jsonColumns.includes(column)) {
    if (value === null || value === undefined || value === '') return null;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null || value === undefined) return '';
  return value;
}

// Returns 1 when applied, 0 when skipped because the server copy is newer.
async function applyUpsert(def, data) {
  const incomingTs = Number(data.updated_at) || Date.now();
  const [rows] = await pool.query(`SELECT updated_at FROM ${def.table} WHERE id = ? LIMIT 1`, [data.id]);
  if (rows.length && Number(rows[0].updated_at) > incomingTs) return 0;

  const cols = [...def.columns];
  const values = cols.map((col) => {
    if (col === 'updated_at') return incomingTs;
    if (col === 'created_at') return Number(data.created_at) || incomingTs;
    if (col === 'deleted') return data.deleted ? 1 : 0;
    return normalizeValue(def, col, data[col]);
  });
  const placeholders = cols.map(() => '?').join(', ');
  const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = VALUES(${c})`).join(', ');
  await pool.query(
    `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`,
    values
  );
  return 1;
}

// Soft delete; skipped when the server copy is newer (last-write-wins).
async function applyDelete(def, data) {
  const ts = Number(data.updated_at) || Date.now();
  const [result] = await pool.query(
    `UPDATE ${def.table} SET deleted = 1, updated_at = ? WHERE id = ? AND updated_at <= ?`,
    [ts, data.id, ts]
  );
  return result.affectedRows > 0 ? 1 : 0;
}

// POST /api/sync/push  { ops: [{ entity, op: 'upsert'|'delete', data }] }
router.post('/push', async (req, res, next) => {
  try {
    const ops = Array.isArray(req.body && req.body.ops) ? req.body.ops.slice(0, MAX_OPS_PER_PUSH) : [];
    let applied = 0;
    let skipped = 0;
    const errors = [];

    for (const op of ops) {
      const entityKey = op && op.entity;
      const def = ENTITIES[entityKey];
      if (!def) {
        errors.push(`Unknown entity: ${entityKey}`);
        continue;
      }
      if (!canAccess(req.user, entityKey)) {
        errors.push(`No access to ${entityKey}`);
        continue;
      }
      const data = op.data || {};
      if (!data.id) {
        errors.push(`${entityKey}: missing id`);
        continue;
      }
      try {
        const outcome = op.op === 'delete'
          ? await applyDelete(def, data)
          : await applyUpsert(def, data);
        if (outcome) {
          applied += 1;
          // Audit every business-data operation the user makes.
          logActivity(req, {
            action: op.op === 'delete' ? 'data.deleted' : 'data.saved',
            entity: entityKey,
            entityId: data.id,
            details: { label: data.name || data.customer_name || data.plate_no || data.model || data.table_no || data.license_no || '' }
          });
        } else {
          skipped += 1;
        }
      } catch (e) {
        errors.push(`${entityKey} ${data.id}: ${e.message}`);
      }
    }

    res.json({ ok: true, applied, skipped, errors });
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/pull?since=<epoch-ms>
router.get('/pull', async (req, res, next) => {
  try {
    const since = Math.max(0, Number(req.query.since) || 0);
    const keys = Object.keys(ENTITIES).filter((key) => canAccess(req.user, key));
    const records = {};
    for (const key of keys) {
      const def = ENTITIES[key];
      const [rows] = await pool.query(
        `SELECT * FROM ${def.table} WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ${MAX_ROWS_PER_PULL}`,
        [since]
      );
      records[key] = rows;
    }
    res.json({ ok: true, serverTime: Date.now(), since, records });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
