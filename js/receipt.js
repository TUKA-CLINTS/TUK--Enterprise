import { esc, fmtMoney } from './ui.js';

const SERVICES = {
  shop: { name: 'Shop', offer: 'Everyday goods and retail supplies' },
  transport: { name: 'Transport', offer: 'Reliable trips and shipment services' },
  restaurant: { name: 'Restaurant', offer: 'Meals, drinks and table service' }
};

export function printReceipt({ service, receiptNo, customer, date, lines, total, meta = {} }) {
  const current = SERVICES[service];
  const offers = Object.entries(SERVICES)
    .filter(([key]) => key !== service)
    .map(([, item]) => `<li><strong>${esc(item.name)}:</strong> ${esc(item.offer)}</li>`)
    .join('');
  const rows = (Array.isArray(lines) ? lines : []).map((line) => `
    <tr><td>${esc(line.name)}</td><td class="qty">${esc(line.qty)}</td><td class="money">${fmtMoney(line.total)}</td></tr>`).join('');
  const metaRows = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`)
    .join('');
  const popup = window.open('', '_blank', 'popup,width=760,height=900');
  if (!popup) return false;
  popup.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt ${esc(receiptNo)}</title>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#eef1f7;color:#1d2736;font:14px/1.5 Arial,sans-serif}.receipt{max-width:680px;margin:28px auto;background:#fff;padding:34px;box-shadow:0 4px 20px #1022441a}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #16418b;padding-bottom:18px}.brand{font-size:22px;font-weight:800;color:#16418b}.brand em{color:#f2a516;font-style:normal}.muted{color:#5c6b84}.right{text-align:right}.details{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin:22px 0}.details div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #eef1f7;padding:5px 0}.details span{color:#5c6b84}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{text-align:left;padding:9px 6px;border-bottom:1px solid #dde4f0}th{color:#5c6b84;font-size:12px;text-transform:uppercase}.qty{width:70px;text-align:center}.money{text-align:right;white-space:nowrap}.total{display:flex;justify-content:space-between;font-size:19px;font-weight:800;border-top:2px solid #16418b;padding-top:12px}.offers{margin-top:28px;padding:16px;background:#e8eefb;border-left:4px solid #f2a516}.offers h3{margin:0 0 5px;color:#16418b}.offers ul{margin:8px 0 0;padding-left:20px}.foot{text-align:center;margin-top:30px;color:#5c6b84;font-size:12px}@media print{body{background:#fff}.receipt{margin:0;box-shadow:none;max-width:none;padding:10px}.no-print{display:none}}
    </style></head><body><main class="receipt">
    <header class="head"><div><div class="brand">TUK<span>@</span> ENTERPRISES</div><div class="muted">${esc(current ? current.name : 'Service')} receipt</div></div><div class="right"><strong>Receipt ${esc(receiptNo)}</strong><br><span class="muted">${esc(date || new Date().toLocaleString())}</span></div></header>
    <section class="details"><div><span>Client</span><strong>${esc(customer || 'Walk-in customer')}</strong></div>${metaRows}</section>
    <table><thead><tr><th>Description</th><th class="qty">Qty</th><th class="money">Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No line items</td></tr>'}</tbody></table>
    <div class="total"><span>Total</span><span>${fmtMoney(total)}</span></div>
    <section class="offers"><h3>More from TUK@ Enterprises</h3><p>Your attendant can also help you access:</p><ul>${offers}</ul></section>
    <p class="foot">Thank you for doing business with TUK@ Enterprises.</p><button class="no-print" onclick="window.print()">Print receipt</button>
    </main></body></html>`);
  popup.document.close();
  popup.focus();
  return true;
}
