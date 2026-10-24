export const SERVICE = '1244';
export const COUNTRY = 'IL';
export const WAITING = new Set(['pending', 'activating', 'processing', 'resend']);
const statuses = { 1: 'pending', 2: 'expired', 3: 'completed', 4: 'resend', 5: 'cancelled', 6: 'refunded', 7: 'processing', 8: 'activating' };
export const statusLabels = { pending: 'Waiting for SMS', activating: 'Activating', processing: 'Processing', resend: 'Resend requested', expired: 'Expired', completed: 'Code received', cancelled: 'Cancelled', refunded: 'Refunded' };
export const canonical = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function isRelevant(row) {
  return ['cocacola', SERVICE].includes(canonical(row.service ?? row.service_id)) && ['il', 'israel', '29'].includes(String(row.short_name ?? row.country ?? row.country_id).toLowerCase());
}
export function phoneNumber(row) {
  let digits = String(row.number || row.phonenumber || row.phone || '').replace(/\D/g, '');
  if (digits.startsWith('00972')) digits = digits.slice(2);
  if (!digits.startsWith('972') && digits) digits = '972' + digits.replace(/^0/, '');
  return digits ? '+' + digits : '';
}
export function normalize(row, previous = {}) {
  const status = statuses[row.status] || String(row.status || previous.status || 'pending').toLowerCase();
  const rawCode = row.sms ?? row.code;
  const code = rawCode == null || rawCode === '' || (String(rawCode) === '0' && status !== 'completed') ? previous.code || '' : String(rawCode);
  const timestamp = parseOrderTimestamp(row.timestamp);
  const purchasedAt = Number.isFinite(row.purchasedAt) ? row.purchasedAt : previous.purchasedAt;
  return {
    id: String(row.order_id || row.order_code || previous.id || ''),
    phone: phoneNumber(row) || previous.phone || '',
    code,
    fullMessage: String(row.full_sms || row.full_code || previous.fullMessage || ''),
    status: previous.status && !WAITING.has(previous.status) && WAITING.has(status) ? previous.status : status,
    cost: row.cost != null && row.cost !== '' ? Number(row.cost) : row.cost_in_cents != null ? Number(row.cost_in_cents) / 100 : previous.cost ?? null,
    expires: Number(row.expiration || row.expiry || previous.expires || (row.expires_in ? Date.now() / 1000 + Number(row.expires_in) : 0)),
    created: Number.isFinite(timestamp) ? timestamp : previous.created || purchasedAt || 0,
    purchasedAt,
  };
}
export function rowsFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (data && typeof data === 'object' && Object.keys(data).every(key => /^\d+$/.test(key))) return Object.values(data);
  throw new Error('SMSPool returned an unexpected order list format.');
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function refundAvailable(order, now = Date.now()) {
  return Boolean(order && !order.code && WAITING.has(order.status) && Number.isFinite(order.purchasedAt ?? order.created) && (order.purchasedAt ?? order.created) > 0 && now >= (order.purchasedAt ?? order.created) + 60000);
}

export function orderSummary(orders, balance, currentPrice = null) {
  const confirmed = orders.filter(order => order.status === 'completed' && Boolean(order.code));
  const priced = confirmed.filter(order => typeof order.cost === 'number' && Number.isFinite(order.cost) && order.cost >= 0);
  const cents = priced.reduce((sum,order) => sum + Math.round(order.cost * 100), 0);
  const averagePrice = priced.length ? cents / priced.length / 100 : typeof currentPrice === 'number' && currentPrice > 0 ? currentPrice : null;
  const affordable = typeof balance === 'number' && Number.isFinite(balance) && averagePrice > 0 ? Math.max(0, Math.floor((Math.round(balance * 100) / (averagePrice * 100)) + 1e-9)) : null;
  return { confirmedCount:confirmed.length, totalCost:priced.length === confirmed.length ? cents / 100 : null, averagePrice, affordable };
}

export function circleOrder(orders, id) {
  const order = orders.get(id);
  return order && (WAITING.has(order.status) || order.status === 'completed') ? order : null;
}

export function parseOrderTimestamp(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number < 1e12 ? number * 1000 : number : NaN;
  }
  const text = String(value).trim().replace(' ', 'T');
  return Date.parse(text + (/Z$|[+-]\d{2}:?\d{2}$/.test(text) ? '' : 'Z'));
}
export function sortOrders(orders) {
  return [...orders].sort((a,b) => b.created - a.created || (b.purchasedAt || 0) - (a.purchasedAt || 0) || b.id.localeCompare(a.id));
}
