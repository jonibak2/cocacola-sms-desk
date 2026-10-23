export const SERVICE = '1244';
export const COUNTRY = 'IL';
export const WAITING = new Set(['pending', 'activating', 'processing', 'resend']);
const statuses = { 1: 'pending', 2: 'expired', 3: 'completed', 4: 'resend', 5: 'cancelled', 6: 'refunded', 7: 'processing', 8: 'activating' };
export const statusLabels = { pending: 'Ожидание SMS', activating: 'Активация', processing: 'Обработка', resend: 'Повторное SMS', expired: 'Время истекло', completed: 'Код получен', cancelled: 'Отменён', refunded: 'Возврат' };
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
  const timestamp = row.timestamp ? Date.parse(String(row.timestamp).replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(row.timestamp)) ? '' : 'Z')) : NaN;
  return {
    id: String(row.order_id || row.order_code || previous.id || ''),
    phone: phoneNumber(row) || previous.phone || '',
    code,
    fullMessage: String(row.full_sms || row.full_code || previous.fullMessage || ''),
    status: previous.status && !WAITING.has(previous.status) && WAITING.has(status) ? previous.status : status,
    cost: row.cost != null && row.cost !== '' ? Number(row.cost) : row.cost_in_cents != null ? Number(row.cost_in_cents) / 100 : previous.cost ?? null,
    expires: Number(row.expiration || row.expiry || previous.expires || (row.expires_in ? Date.now() / 1000 + Number(row.expires_in) : 0)),
    created: previous.created || (Number.isFinite(timestamp) ? timestamp : Date.now()),
  };
}
export function rowsFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (data && typeof data === 'object' && Object.keys(data).every(key => /^\d+$/.test(key))) return Object.values(data);
  throw new Error('SMSPool вернул неизвестный формат списка заказов.');
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
