import { SERVICE, COUNTRY, WAITING, statusLabels, isRelevant, normalize, rowsFrom, csvCell } from './model.js';

const paths = {
  refresh:'M20 7v5h-5M4 17v-5h5M6.1 8a7 7 0 0 1 11.6-2L20 9M4 15l2.3 3A7 7 0 0 0 18 16',
  settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  plus:'M12 5v14M5 12h14',arrow:'M5 12h14m-5-5 5 5-5 5',copy:'M9 8h10v13H9zM15 4V2H3v14h2',
  message:'M21 4H3v13h5l4 4v-4h9V4ZM7 9h10M7 12h6',shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 9 3 3 5-5',
  lock:'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',chevron:'m9 6 6 6-6 6','chevron-left':'m15 6-6 6 6 6',
  search:'M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13ZM16 16l5 5',download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  history:'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',close:'m6 6 12 12M6 18 18 6',play:'m9 5 11 7-11 7V5',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.arrow}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value == null || !Number.isFinite(Number(value)) ? '$ —' : '$' + Number(value).toFixed(2);
const storage = { get(key, session = false) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(key)); } catch { return null; } }, set(key, value, session = false) { try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); return true; } catch { return false; } } };
let prefs = storage.get('smsdesk.preferences') || {};
let key = '', account = '', connected = false, demo = false, buying = false, uncertain = false, syncing = false, epoch = 0;
let orders = new Map(), selected = '', filter = 'all', page = 1, pageSize = 4, balance = null, price = null, pollTimer, toastTimer, lastHistory = 0, lastBalance = 0, checkOffset = 0, pollDelay = 3000;
let audio;
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
function proxyBase() { return prefs.proxy || (isLocal ? location.origin + '/api' : ''); }
function notify(message, error = false) { $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 3000); }
function setConnection(text, state = '') { $('connection').className = 'connection ' + state; $('connection').lastElementChild.textContent = text; $('poll-dot').className = state; }
function persist() { if (!demo && account && !storage.set('smsdesk.history.' + account, [...orders.values()])) notify('Хранилище браузера заполнено. Скачайте историю CSV.', true); }
function beep() { if (!prefs.sound || !audio) return; try { const oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.connect(gain); gain.connect(audio.destination); oscillator.frequency.value = 820; gain.gain.setValueAtTime(.05, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .25); oscillator.start(); oscillator.stop(audio.currentTime + .25); } catch {} }
function enableAudio() { if (!prefs.sound) return; try { audio ||= new AudioContext(); void audio.resume(); } catch {} }
async function api(endpoint, parameters = {}, options = {}) {
  const base = proxyBase();
  if (!base) throw new Error('Укажите адрес API-прокси в настройках подключения.');
  let response;
  try { response = await fetch(base + endpoint, { method:'POST', body:new URLSearchParams({ key, ...parameters }), credentials:'omit', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(options.purchase ? 45000 : 20000) }); }
  catch { const error = new Error(options.purchase ? 'Ответ на покупку не получен. Номер мог быть куплен. Сначала проверьте заказы кнопкой обновления.' : 'Нет связи с API-прокси. Проверьте адрес, интернет и ALLOWED_ORIGIN в Worker.'); error.uncertain = Boolean(options.purchase); throw error; }
  let data;
  try { data = await response.json(); } catch { const error = new Error('Прокси вернул некорректный ответ. Проверьте подключение и историю.'); error.uncertain = Boolean(options.purchase); throw error; }
  if (!response.ok || String(data?.success) === '0') {
    const messages = { OUT_OF_STOCK:'Израильских номеров для Coca-Cola сейчас нет. Попробуйте позже.', BALANCE_ERROR:'Недостаточно средств на балансе SMSPool.', PRICE_NOT_FOUND:'Нет номера по выбранному лимиту цены.' };
    const error = new Error(response.status === 401 || response.status === 403 ? 'Ключ не принят или доступ запрещён. Проверьте ключ и настройки Worker.' : response.status === 429 ? 'Лимит запросов SMSPool. Подождите немного.' : messages[data?.type] || String(data?.errors?.[0]?.message || data?.message || `Ошибка API (${response.status})`).replace(/<[^>]*>/g,''));
    error.uncertain = Boolean(options.purchase && response.status >= 500); error.rateLimited = response.status === 429; throw error;
  }
  return data;
}
function merge(row, announce = false) {
  const id = String(row.order_id || row.order_code || ''); if (!id) return;
  const previous = orders.get(id), next = normalize(row, previous);
  orders.set(id, next);
  if (announce && next.code && !previous?.code) { notify(`SMS получено: ${next.code}`); beep(); }
}
const sorted = () => [...orders.values()].sort((a,b) => b.created - a.created || b.id.localeCompare(a.id));
function filtered() { const search = $('search').value.trim().toLowerCase(); return sorted().filter(order => (filter === 'all' || (filter === 'waiting' ? WAITING.has(order.status) : order.status === 'completed')) && (!search || [order.phone, order.code, order.id].some(value => value.toLowerCase().includes(search)))); }
const badge = order => `<span class="status ${escape(order.status)}">${escape(statusLabels[order.status] || order.status)}</span>`;
function render() {
  $('balance').textContent = money(balance); $('price').textContent = money(price);
  $('buy').disabled = buying || uncertain; $('settings').disabled = buying; $('demo').disabled = buying;
  $('buy-label').textContent = buying ? 'Покупаем номер…' : uncertain ? 'Сначала проверьте заказы' : demo ? 'Купить демо-номер' : connected ? 'Купить номер' : 'Подключить SMSPool';
  $('purchase-note').textContent = demo ? 'Демо. Реальные деньги не списываются.' : prefs.maxPrice ? `Лимит покупки: ${money(prefs.maxPrice)} за номер` : 'Одна кнопка — один номер. Без подписки.';
  $('history-count').textContent = orders.size; $('waiting-count').textContent = [...orders.values()].filter(o => WAITING.has(o.status)).length;
  const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / pageSize)); page = Math.min(page, pages);
  const visible = rows.slice((page-1)*pageSize, page*pageSize);
  $('history-body').innerHTML = visible.map((o,i) => `<tr data-order="${escape(o.id)}" class="${o.id === selected ? 'selected' : ''}" tabindex="0" aria-label="Открыть заказ ${escape(o.id)}"><td>${(page-1)*pageSize+i+1}</td><td><button class="table-copy" data-copy="${escape(o.phone)}" title="Скопировать номер">${escape(o.phone)}${icon('copy')}</button></td><td>${o.code ? `<button class="table-copy table-code" data-copy="${escape(o.code)}" title="Скопировать SMS-код">${escape(o.code)}${icon('copy')}</button>` : '<span class="waiting-code">— — —</span>'}</td><td>CocaCola</td><td><span class="table-country"><span class="israel-flag" aria-hidden="true">✡</span>IL</span></td><td>${badge(o)}</td><td>${money(o.cost)}</td><td><span class="row-arrow">${icon('arrow')}</span></td></tr>`).join('');
  $('history-empty').hidden = rows.length > 0;
  $('history-empty').querySelector('strong').textContent = orders.size ? 'Ничего не найдено' : 'История начинается с первого номера';
  $('history-empty').lastElementChild.textContent = orders.size ? 'Измените поиск или фильтр.' : 'Ваши номера и полученные коды сохранятся здесь.';
  $('rows-info').textContent = rows.length ? `${(page-1)*pageSize+1}–${Math.min(page*pageSize,rows.length)} из ${rows.length} номеров` : 'Пока нет заказов';
  $('page-info').textContent = `${page} / ${pages}`; $('prev').disabled = page === 1; $('next').disabled = page >= pages; $('export').disabled = !orders.size;
  renderCurrent();
}
function renderCurrent() {
  const current = orders.get(selected) || sorted()[0];
  $('current-empty').hidden = Boolean(current); $('current-order').hidden = !current;
  if (!current) return;
  selected = current.id;
  $('current-status').outerHTML = `<span id="current-status" class="status ${escape(current.status)}">${escape(statusLabels[current.status] || current.status)}</span>`;
  $('current-phone').textContent = current.phone; $('current-code').textContent = current.code || '••• •••';
  $('copy-current-code').disabled = !current.code; $('current-id').textContent = 'Заказ ' + current.id;
  $('code-caption').textContent = current.code ? 'Нажмите на код, чтобы скопировать' : WAITING.has(current.status) ? 'Проверяем каждые 3 секунды' : 'Заказ закрыт';
  $('full-message').textContent = current.fullMessage || (current.code ? 'SMS-код получен' : WAITING.has(current.status) ? 'Ожидаем входящее сообщение…' : 'SMS не получено');
  $('full-message').title = current.fullMessage;
  $('cancel-order').hidden = !WAITING.has(current.status); updateCountdown();
}
function updateCountdown() { const o = orders.get(selected); if (!o) return; const remaining = Math.max(0,Math.ceil(o.expires - Date.now()/1000)); $('countdown').textContent = WAITING.has(o.status) && o.expires ? remaining ? `Осталось ${Math.floor(remaining/60).toString().padStart(2,'0')}:${(remaining%60).toString().padStart(2,'0')}` : 'Проверяем статус…' : ''; }
function fitRows() { const height = $('table-viewport').clientHeight, rowHeight = innerWidth <= 760 ? 43 : 49, header = innerWidth <= 760 ? 30 : 36; const size = Math.max(1, Math.floor((height-header)/rowHeight)); if (size !== pageSize) { pageSize = size; render(); } }
async function copy(text) { if (!text) return; try { await navigator.clipboard.writeText(text); notify('Скопировано: ' + text); } catch { notify('Не удалось скопировать. Разрешите доступ к буферу обмена в браузере.', true); } }
async function syncBalance(token) { const result = await api('/request/balance'); const number = Number(result.balance); if (result.balance == null || result.balance === '' || !Number.isFinite(number)) throw new Error('Не удалось прочитать баланс SMSPool.'); if (token === epoch) { balance = number; lastBalance = Date.now(); } }
async function syncHistory(token, all = false) {
  let start = 0;
  do { const rows = rowsFrom(await api('/request/history', { start, length:500, search:'CocaCola' })); if (token !== epoch) return; rows.filter(isRelevant).forEach(row => merge(row)); if (!all || rows.length < 500) break; start += rows.length; } while (true);
  if (token === epoch) { lastHistory = Date.now(); persist(); }
}
async function syncPrice(token) { const data = await api('/request/price', {country:COUNTRY,service:SERVICE}); if (token === epoch) price = Number.isFinite(Number(data.price)) && Number(data.price) > 0 ? Number(data.price) : null; }
async function syncActive(token) {
  const rows = rowsFrom(await api('/request/active')); if (token !== epoch) return;
  const seen = new Set(); rows.filter(isRelevant).forEach(row => { seen.add(String(row.order_code || row.order_id)); merge(row, true); });
  const missing = [...orders.values()].filter(o => WAITING.has(o.status) && !seen.has(o.id));
  const targets = missing.slice(checkOffset,checkOffset + 4); checkOffset = checkOffset+4 >= missing.length ? 0 : checkOffset+4;
  for (const order of targets) { const result = await api('/sms/check',{orderid:order.id}); if (token !== epoch) return; merge({...result,order_id:order.id}, true); }
  persist();
}
async function refresh(manual = false) {
  if (!connected || demo || syncing) return;
  syncing = true; const token = epoch; $('refresh').classList.add('spinning');
  try {
    await syncActive(token);
    if (manual || Date.now()-lastBalance > 30000) await syncBalance(token);
    if (manual || Date.now()-lastHistory > 60000) await syncHistory(token, manual);
    if (manual) await syncPrice(token).catch(() => {});
    if (token !== epoch) return;
    pollDelay = 3000;
    if (manual) uncertain = false;
    setConnection('SMSPool подключён','connected'); $('last-sync').textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    $('poll-label').textContent = 'Автообновление каждые 3 секунды'; render();
  } catch(error) { if (token !== epoch) return; pollDelay = Math.min(60000,Math.max(error.rateLimited ? 15000 : 6000,pollDelay * 2)); setConnection('Ошибка связи','error'); $('poll-label').textContent = `Повторная проверка через ${pollDelay/1000} сек.`; if (manual) notify(error.message, true); }
  finally { if (token === epoch) { syncing = false; $('refresh').classList.remove('spinning'); schedulePoll(pollDelay); } }
}
function schedulePoll(delay = 3000) { clearTimeout(pollTimer); if (connected && !demo) pollTimer = setTimeout(() => { void refresh(); }, delay); }
function resetSession() { epoch++; clearTimeout(pollTimer); connected = false; demo = false; syncing = false; buying = false; uncertain = false; key = ''; account = ''; orders = new Map(); selected = ''; balance = null; price = null; lastHistory = 0; lastBalance = 0; pollDelay = 3000; page = 1; filter = 'all'; $('search').value = ''; document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active',button.dataset.filter === 'all')); try { sessionStorage.removeItem('smsdesk.session'); } catch {} document.body.classList.remove('demo-mode'); $('refresh').classList.remove('spinning'); setConnection('Не подключено'); $('last-sync').textContent = 'Ожидаем подключения'; $('poll-label').textContent = 'Автоматическое получение кода'; render(); }
function openSettings() { $('api-key').value = key; $('proxy-url').value = prefs.proxy || ''; $('max-price').value = prefs.maxPrice || ''; $('sound').checked = prefs.sound !== false; $('settings-error').textContent = ''; $('disconnect').disabled = !connected && !demo; $('settings-dialog').showModal(); }
async function connectAccount(newKey, newPrefs, restore = false) {
  resetSession(); key = newKey; prefs = newPrefs; const token = epoch;
  await syncBalance(token); if (token !== epoch) return;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)); if (token !== epoch) return;
  account = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('').slice(0,24);
  const cached = storage.get('smsdesk.history.' + account); orders = new Map((Array.isArray(cached) ? cached : []).map(o => [o.id,o]));
  connected = true; storage.set('smsdesk.preferences',prefs); storage.set('smsdesk.session',{key},true); setConnection('SMSPool подключён','connected'); render();
  if ($('settings-dialog').open) $('settings-dialog').close(); if (!restore) notify('Аккаунт подключён');
  enableAudio();
  try { await syncHistory(token,true); await syncPrice(token); } catch(error) { if (token === epoch) notify(error.message,true); }
  if (token === epoch) { render(); void refresh(); }
}
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('settings-error').textContent = ''; $('connect').disabled = true;
  try {
    let proxy = $('proxy-url').value.trim().replace(/\/$/,'');
    if (proxy) { const url = new URL(proxy); if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Используйте HTTPS-адрес вашего Worker без параметров.'); }
    if (!proxy && !isLocal) throw new Error('Для этой страницы нужен HTTPS-адрес API-прокси.');
    const maxPrice = $('max-price').value ? Number($('max-price').value) : null;
    await connectAccount($('api-key').value.trim(),{proxy,maxPrice,sound:$('sound').checked});
  } catch(error) { $('settings-error').textContent = error.message; setConnection('Не удалось подключиться','error'); }
  finally { $('connect').disabled = false; }
});
$('settings').onclick = openSettings; $('close-settings').onclick = () => $('settings-dialog').close();
$('disconnect').onclick = () => { resetSession(); try { sessionStorage.removeItem('smsdesk.session'); } catch {} $('api-key').value = ''; $('settings-dialog').close(); render(); notify('Аккаунт отключён. История сохранена для этого аккаунта.'); };
$('refresh').onclick = () => { if (demo) { notify('Демо-данные актуальны'); return; } if (!connected) openSettings(); else void refresh(true); };
$('buy').onclick = async () => {
  if (buying || uncertain) return;
  if (!connected && !demo) { openSettings(); return; }
  enableAudio(); if (demo) { buyDemo(); return; }
  buying = true; render(); const token = epoch;
  try {
    const parameters = {country:COUNTRY,service:SERVICE,quantity:1,pricing_option:0,activation_type:'SMS'}; if (prefs.maxPrice) parameters.max_price = prefs.maxPrice;
    const result = await api('/purchase/sms',parameters,{purchase:true});
    if (token !== epoch) return;
    if (!result.order_id || !(result.number || result.phonenumber)) { const error = new Error('Покупка могла пройти, но ответ неполный. Проверьте историю кнопкой обновления.'); error.uncertain = true; throw error; }
    merge({...result,status:'pending'}); selected = String(result.order_id); page = 1; filter = 'all'; $('search').value = ''; setFilter('all'); persist(); render(); notify('Номер куплен. Ожидаем SMS.');
    await syncBalance(token).catch(() => {});
  } catch(error) { if (token === epoch) { uncertain = Boolean(error.uncertain); notify(error.message,true); } }
  finally { if (token === epoch) { buying = false; render(); schedulePoll(); } }
};
$('cancel-order').onclick = async () => {
  const order = orders.get(selected); if (!order || !WAITING.has(order.status)) return;
  const token = epoch; $('cancel-order').disabled = true;
  try { if (!demo) { const result = await api('/sms/cancel',{orderid:order.id}); if (String(result.success) !== '1') throw new Error('SMSPool не подтвердил отмену заказа.'); } if (token !== epoch) return; orders.set(order.id,{...order,status:'refunded'}); if (demo) balance += order.cost || 0; persist(); render(); notify('Номер отменён, средства возвращены'); if (!demo) await syncBalance(token); }
  catch(error) { if (token === epoch) notify(error.message,true); }
  finally { if (token === epoch) { $('cancel-order').disabled = false; render(); } }
};
$('copy-current-phone').onclick = () => copy(orders.get(selected)?.phone);
$('copy-current-code').onclick = () => copy(orders.get(selected)?.code);
$('history-body').onclick = event => { const button = event.target.closest('[data-copy]'); if (button) { void copy(button.dataset.copy); return; } const row = event.target.closest('[data-order]'); if (row) { selected = row.dataset.order; render(); } };
$('history-body').onkeydown = event => { if (event.target.matches('tr') && ['Enter',' '].includes(event.key)) { event.preventDefault(); selected = event.target.dataset.order; render(); } };
function setFilter(value) { filter = value; page = 1; document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active',button.dataset.filter === value)); render(); }
document.querySelectorAll('[data-filter]').forEach(button => { button.onclick = () => setFilter(button.dataset.filter); });
$('search').oninput = () => { page = 1; render(); }; $('prev').onclick = () => { page--; render(); }; $('next').onclick = () => { page++; render(); };
$('export').onclick = () => {
  const rows = [['Order ID','Phone','Code','Service','Country','Status','Cost USD','Created UTC','Message'],...sorted().map(o => [o.id,o.phone,o.code,'CocaCola','IL',o.status,o.cost,new Date(o.created).toISOString(),o.fullMessage])];
  const url = URL.createObjectURL(new Blob(['\ufeff'+rows.map(row => row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `cocacola-sms-${demo ? 'demo-' : ''}${new Date().toISOString().slice(0,10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
};
function loadDemo() {
  resetSession(); demo = true; prefs.sound ??= true; enableAudio(); document.body.classList.add('demo-mode'); balance = 24.63; price = .37; setConnection('Демо · без списаний');
  const now = Date.now();
  for (let i = 0; i < 18; i++) { const id = 'DEMO'+String(18-i).padStart(3,'0'), status = i === 0 || i === 3 ? 'pending' : i === 5 || i === 9 ? 'expired' : 'completed'; orders.set(id,{id,phone:'+97253'+String(2411034+i*137).padStart(7,'0'),code:status === 'completed' ? ['715017','093246','382149','820614'][i%4] : '',status,cost:.37,fullMessage:status === 'completed' ? 'Coca-Cola: ваш код подтверждения '+['715017','093246','382149','820614'][i%4] : '',expires:now/1000+987-i*10,created:now-i*360000}); }
  selected = 'DEMO018'; $('last-sync').textContent = 'Демонстрационные данные'; $('poll-label').textContent = 'Демо · тестовое SMS через 6 секунд'; render();
  const token = epoch; setTimeout(() => { if (demo && token === epoch && WAITING.has(orders.get('DEMO018')?.status)) { merge({order_id:'DEMO018',status:3,sms:'715017',full_sms:'Coca-Cola: ваш код подтверждения 715017'},true); render(); } },6000);
}
function buyDemo() { const id = 'DEMO'+Date.now(), token = epoch; orders.set(id,{id,phone:'+972539000123',code:'',status:'pending',cost:.37,expires:Date.now()/1000+1200,created:Date.now(),fullMessage:''}); selected = id; balance = Math.round((balance-.37)*100)/100; page = 1; render(); notify('Демо-номер добавлен. Код появится через 6 секунд.'); setTimeout(() => { if (demo && token === epoch && WAITING.has(orders.get(id)?.status)) { merge({order_id:id,status:3,sms:'008421',full_sms:'Coca-Cola: ваш код подтверждения 008421'},true); render(); } },6000); }
$('demo').onclick = () => { if (buying) return; if (demo) { resetSession(); render(); } else { enableAudio(); loadDemo(); } };
new ResizeObserver(fitRows).observe($('table-viewport')); setInterval(updateCountdown,1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && connected && !demo) void refresh(); });
render();
const session = storage.get('smsdesk.session',true);
if (session?.key) connectAccount(session.key,prefs,true).catch(error => { resetSession(); render(); notify(error.message,true); });
