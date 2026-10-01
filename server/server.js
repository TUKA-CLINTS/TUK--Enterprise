// TUK@ Enterprises Management System - server entry point.
// Serves the PWA frontend AND the API from a single origin on port 3000,
// so the installed app and its data layer share one address (no CORS,
// clean service-worker scope).
const path = require('path');
const os = require('os');
const express = require('express');
require('./db'); // loads .env and creates the MySQL pool

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// -- API ---------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'tukent-server', time: Date.now() });
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/recovery', require('./routes/recovery'));
app.use('/api/admin', require('./routes/admin'));

// Never expose server source code or dependencies over HTTP.
app.use(['/server', '/node_modules'], (req, res) => res.status(404).json({ error: 'Not found' }));

// -- Frontend (project root) --------------------------------------------------
app.use(express.static(path.join(__dirname, '..'), { extensions: ['html'] }));

app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
});
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// -- Start --------------------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lanAddresses = Object.values(nets)
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

  console.log('');
  console.log('  TUK@ ENTERPRISES Management System');
  console.log('  ----------------------------------');
  console.log(`  Local:    http://localhost:${PORT}`);
  lanAddresses.forEach((ip) => console.log(`  Network:  http://${ip}:${PORT}   (phones / tablets on this Wi-Fi)`));
  console.log('');
});
