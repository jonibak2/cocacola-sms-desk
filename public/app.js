import { SERVICE, COUNTRY, WAITING, sortOrders, circleOrder, orderSummary, refundAvailable, statusLabels, isRelevant, normalize, rowsFrom, csvCell } from './model.js';

const iconNames = {wallet:'wallet',can:'cylinder',average:'coins',spent:'receipt',hash:'hash',phone:'phone',key:'key',pending:'clock',completed:'check-circle',expired:'hourglass',cancelled:'prohibit',refunded:'arrow-counter-clockwise',activating:'spinner-gap',processing:'spinner-gap',resend:'arrows-clockwise',refresh:'arrow-clockwise',settings:'gear-six',copy:'copy',plus:'plus',refund:'arrow-counter-clockwise',close:'x',download:'download-simple',arrow:'caret-right',chevron:'caret-right','chevron-left':'caret-left',play:'play'};
const icon = name => '<img class="icon" src="./assets/icons/'+(iconNames[name] || 'plus')+'.svg" alt="" aria-hidden="true">';
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value == null || !Number.isFinite(Number(value)) ? '$ —' : '$' + Number(value).toFixed(2);
const storage = { get(key, session = false) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(key)); } catch { return null; } }, set(key, value, session = false) { try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); return true; } catch { return false; } } };
let prefs = storage.get('smsdesk.preferences') || {};
if (!prefs.proxy && !['localhost','127.0.0.1'].includes(location.hostname)) prefs.proxy = 'https://cocacola-sms-proxy.jonibak2006.workers.dev';
const refundBusy = new Set();
let key = '', account = '', connected = false, demo = false, buying = false, uncertain = false, syncing = false, epoch = 0;
let orders = new Map(), selected = '', filter = 'all', page = 1, pageSize = 4, balance = null, price = null, pollTimer, toastTimer, lastHistory = 0, lastBalance = 0, checkOffset = 0, pollDelay = 3000;
let audio;
let activeOrderId = ''; // Only a purchase made on this page may occupy the circle.
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
function proxyBase() { return prefs.proxy || (isLocal ? location.origin + '/api' : ''); }
function notify(message, error = false) { $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 3000); }
function setConnection(text, state = '') { $('connection').className = 'connection ' + state; $('connection').lastElementChild.textContent = text;  }
function persist() { if (!demo && account && !storage.set('smsdesk.history.' + account, [...orders.values()])) notify('Browser storage is full. Export your history as CSV.', true); }
function beep() { if (!prefs.sound || !audio) return; try { const oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.connect(gain); gain.connect(audio.destination); oscillator.frequency.value = 820; gain.gain.setValueAtTime(.05, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .25); oscillator.start(); oscillator.stop(audio.currentTime + .25); } catch {} }
function enableAudio() { if (!prefs.sound) return; try { audio ||= new AudioContext(); void audio.resume(); } catch {} }
async function api(endpoint, parameters = {}, options = {}) {
  const base = proxyBase();
  if (!base) throw new Error('Enter the API proxy URL in Settings.');
  let response;
  try { response = await fetch(base + endpoint, { method:'POST', body:new URLSearchParams({ key, ...parameters }), credentials:'omit', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(options.purchase ? 45000 : 20000) }); }
  catch { const error = new Error(options.purchase ? 'Purchase response lost. The number may have been purchased. Refresh your orders before buying again.' : 'Cannot reach the API proxy. Check its URL, your connection and the Worker ALLOWED_ORIGIN.'); error.uncertain = Boolean(options.purchase); throw error; }
  let data;
  try { data = await response.json(); } catch { const error = new Error('Invalid proxy response. Check your connection and order history.'); error.uncertain = Boolean(options.purchase); throw error; }
  if (!response.ok || String(data?.success) === '0') {
    const messages = { OUT_OF_STOCK:'No Israel numbers available for Coca-Cola. Try again later.', BALANCE_ERROR:'Insufficient SMSPool balance.', PRICE_NOT_FOUND:'No numbers available within your price limit.' };
    const error = new Error(response.status === 401 || response.status === 403 ? 'Invalid API key or access denied. Check your key and Worker settings.' : response.status === 429 ? 'SMSPool rate limit reached. Please wait.' : messages[data?.type] || String(data?.errors?.[0]?.message || data?.message || `API error (${response.status})`).replace(/<[^>]*>/g,''));
    error.uncertain = Boolean(options.purchase && response.status >= 500); error.rateLimited = response.status === 429; throw error;
  }
  return data;
}
function merge(row, announce = false) {
  const id = String(row.order_id || row.order_code || ''); if (!id) return;
  const previous = orders.get(id), next = normalize(row, previous);
  orders.set(id, next);
  if (announce && id === activeOrderId && next.code && !previous?.code) { notify(`SMS received: ${next.code}`); beep(); }
}
const sorted = () => sortOrders(orders.values());
function filtered() { return sorted(); }
const badge = order => '<span class="status '+escape(order.status)+'" title="'+escape(statusLabels[order.status] || order.status)+'" aria-label="'+escape(statusLabels[order.status] || order.status)+'">'+icon(order.status)+'</span>';
function render() {
  $('balance').textContent = money(balance);
  const summary = orderSummary([...orders.values()], balance, price);
  $('confirmed-count').textContent = summary.confirmedCount;
  $('confirmed-cost').textContent = money(summary.totalCost);
  $('average-price').textContent = money(summary.averagePrice);
  $('affordable-count').textContent = summary.affordable == null ? '—' : '≈ '+summary.affordable;
  const rowNumbers = new Map(sorted().map((order,index) => [order.id,orders.size-index]));
  $('buy').disabled = buying || uncertain; $('new-order').disabled = buying || uncertain;
  $('settings').disabled = buying; $('demo').disabled = buying;
  $('circle').classList.toggle('buying',buying);
  $('buy-label').textContent = buying ? 'Buying…' : uncertain ? 'Check your orders' : 'Buy a Coca-Cola number';
  $('buy').title = uncertain ? 'Refresh your orders first' : 'Buy a number' + (price ? ' · '+money(price) : '');
  $('demo-indicator').hidden = !demo;
  const rows = filtered(), pages = Math.max(1,Math.ceil(rows.length/pageSize)); page = Math.min(page,pages);
  $('history-body').innerHTML = rows.slice((page-1)*pageSize,page*pageSize).map(o => '<tr data-order="'+escape(o.id)+'" tabindex="0" class="'+(selected===o.id?'selected':'')+'" aria-label="Select order '+escape(o.id)+'"><td class="order-id" title="'+escape(o.id)+'">'+rowNumbers.get(o.id)+'</td><td><button class="table-copy phone" data-copy="'+escape(o.phone)+'" title="Copy phone number">'+escape(o.phone)+icon('copy')+'</button></td><td>'+(o.code?'<button class="table-copy code" data-copy="'+escape(o.code)+'" title="Copy code">'+escape(o.code)+icon('copy')+'</button>':'<span class="dash">—</span>')+'</td><td>'+badge(o)+'</td><td class="cost">'+money(o.cost)+'</td><td><button class="refund" data-refund="'+escape(o.id)+'" '+(!canRefund(o)||refundBusy.has(o.id)?'disabled':'')+' title="'+(o.code?'Code already received':'Request refund')+'">'+icon('refund')+'<span class="refund-label sr-only">Refund</span></button></td></tr>').join('');
  $('history-empty').hidden = rows.length>0;
  const style = getComputedStyle($('table-viewport'));
  const rowHeight = parseFloat(style.getPropertyValue('--row-height')) || 56;
  const headerHeight = parseFloat(style.getPropertyValue('--header-height')) || 32;
  $('table-viewport').style.height = (headerHeight + Math.max(1, Math.min(pageSize, rows.length-(page-1)*pageSize)) * rowHeight)+'px';
  $('page-info').textContent = page+' / '+pages; $('prev').disabled = page===1; $('next').disabled = page>=pages; $('export').disabled = !orders.size;
  renderCurrent();
  updateCountdown();
}
function canRefund(order) { return refundAvailable(order); }
function refundSeconds(order) { return Math.max(0, Math.ceil(((order.purchasedAt ?? order.created) + 60000 - Date.now()) / 1000)); }
function renderCurrent() {
  const current = circleOrder(orders, activeOrderId);
  if (!current) activeOrderId = '';
  $('buy').hidden = Boolean(current) && !buying;
  $('current-order').hidden = !current || buying;
  $('new-order').hidden = !current;
  $('circle').classList.toggle('has-code',Boolean(current?.code));
  if (!current) return;

  $('current-phone').textContent = current.phone;
  $('current-code').textContent = current.code;
  $('copy-current-code').hidden = !current.code;
  updateCountdown();
}
function updateCountdown() {
  document.querySelectorAll('[data-refund]').forEach(button => {
    const order = orders.get(button.dataset.refund);
    if (!order) return;
    const seconds = refundSeconds(order);
    button.disabled = !canRefund(order) || refundBusy.has(order.id);
    if (!order.code && WAITING.has(order.status) && seconds) button.dataset.wait = seconds+'s'; else delete button.dataset.wait;
    button.title = order.code ? 'Code already received' : seconds && WAITING.has(order.status) ? 'Refund available in '+seconds+'s' : 'Request refund';
    button.setAttribute('aria-label',button.title);
    button.querySelector('.refund-label').textContent = !order.code && WAITING.has(order.status) && seconds ? 'Refund · '+seconds+'s' : 'Refund';
  });
  const o = orders.get(activeOrderId); if (!o) return;
  const seconds = Math.max(0,Math.ceil(o.expires-Date.now()/1000));
  $('countdown').textContent = !o.code && WAITING.has(o.status) && o.expires ? Math.floor(seconds/60).toString().padStart(2,'0')+':'+(seconds%60).toString().padStart(2,'0') : '';
}
function fitRows() {
  const viewport = $('table-viewport'), style = getComputedStyle(viewport);
  const rowHeight = parseFloat(style.getPropertyValue('--row-height')) || 56;
  const headerHeight = parseFloat(style.getPropertyValue('--header-height')) || 32;
  const stageMin = parseFloat(getComputedStyle(document.querySelector('.stage')).minHeight) || 240;
  const available = document.querySelector('main').clientHeight - stageMin - document.querySelector('.history-footer').getBoundingClientRect().height;
  const size = Math.max(1,Math.floor((available-headerHeight)/rowHeight));
  if(size!==pageSize){pageSize=size;render();}
}
async function copy(text) { if (!text) return; try { await navigator.clipboard.writeText(text); notify('Copied: ' + text); } catch { notify('Could not copy. Allow clipboard access in your browser.', true); } }
async function syncBalance(token) { const result = await api('/request/balance'); const number = Number(result.balance); if (result.balance == null || result.balance === '' || !Number.isFinite(number)) throw new Error('Could not read your SMSPool balance.'); if (token === epoch) { balance = number; lastBalance = Date.now(); } }
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
    setConnection('SMSPool connected','connected');
     render();
  } catch(error) { if (token !== epoch) return; pollDelay = Math.min(60000,Math.max(error.rateLimited ? 15000 : 6000,pollDelay * 2)); setConnection('Connection error','error');  if (manual) notify(error.message, true); }
  finally { if (token === epoch) { syncing = false; $('refresh').classList.remove('spinning'); schedulePoll(pollDelay); } }
}
function schedulePoll(delay = 3000) { clearTimeout(pollTimer); if (connected && !demo) pollTimer = setTimeout(() => { void refresh(); }, delay); }
function resetSession() { epoch++; clearTimeout(pollTimer); connected = false; demo = false; syncing = false; buying = false; uncertain = false; key = ''; account = ''; orders = new Map(); selected = ''; activeOrderId = ''; balance = null; price = null; lastHistory = 0; lastBalance = 0; pollDelay = 3000; page = 1; filter = 'all';  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active',button.dataset.filter === 'all')); try { sessionStorage.removeItem('smsdesk.session'); } catch {} document.body.classList.remove('demo-mode'); $('refresh').classList.remove('spinning'); setConnection('Disconnected');   render(); }
function openSettings() { $('api-key').value = key; $('proxy-url').value = prefs.proxy || ''; $('max-price').value = prefs.maxPrice || ''; $('sound').checked = prefs.sound !== false; $('settings-error').textContent = ''; $('disconnect').disabled = !connected && !demo; $('settings-dialog').showModal(); }
async function connectAccount(newKey, newPrefs, restore = false) {
  resetSession(); key = newKey; prefs = newPrefs; const token = epoch;
  await syncBalance(token); if (token !== epoch) return;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)); if (token !== epoch) return;
  account = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('').slice(0,24);
  const cached = storage.get('smsdesk.history.' + account); orders = new Map((Array.isArray(cached) ? cached : []).map(o => [o.id,o]));
  connected = true; storage.set('smsdesk.preferences',prefs); storage.set('smsdesk.session',{key},true); setConnection('SMSPool connected','connected'); render();
  if ($('settings-dialog').open) $('settings-dialog').close(); if (!restore) notify('Account connected');
  enableAudio();
  try { await syncHistory(token,true); await syncPrice(token); } catch(error) { if (token === epoch) notify(error.message,true); }
  if (token === epoch) { render(); void refresh(); }
}
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('settings-error').textContent = ''; $('connect').disabled = true;
  try {
    let proxy = $('proxy-url').value.trim().replace(/\/$/,'');
    if (proxy) { const url = new URL(proxy); if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Use your Worker HTTPS URL without query parameters.'); }
    if (!proxy && !isLocal) throw new Error('An HTTPS API proxy URL is required.');
    const maxPrice = $('max-price').value ? Number($('max-price').value) : null;
    await connectAccount($('api-key').value.trim(),{proxy,maxPrice,sound:$('sound').checked});
  } catch(error) { $('settings-error').textContent = error.message; setConnection('Connection failed','error'); }
  finally { $('connect').disabled = false; }
});
$('settings').onclick = openSettings; $('close-settings').onclick = () => $('settings-dialog').close();
$('disconnect').onclick = () => { resetSession(); try { sessionStorage.removeItem('smsdesk.session'); } catch {} $('api-key').value = ''; $('settings-dialog').close(); render(); notify('Disconnected. Your account history is saved.'); };
$('refresh').onclick = () => { if (demo) { notify('Demo data is up to date'); return; } if (!connected) openSettings(); else void refresh(true); };
$('buy').onclick = async () => {
  if (buying || uncertain) return;
  if (!connected && !demo) { openSettings(); return; }
  enableAudio(); if (demo) { buyDemo(); return; }
  buying = true; render(); const token = epoch;
  try {
    const parameters = {country:COUNTRY,service:SERVICE,quantity:1,pricing_option:0,activation_type:'SMS'}; if (prefs.maxPrice) parameters.max_price = prefs.maxPrice;
    const result = await api('/purchase/sms',parameters,{purchase:true});
    if (token !== epoch) return;
    if (!result.order_id || !(result.number || result.phonenumber)) { const error = new Error('The purchase may have succeeded, but the response is incomplete. Refresh your order history.'); error.uncertain = true; throw error; }
    merge({...result,status:'pending',purchasedAt:Date.now()}); selected = String(result.order_id); activeOrderId = selected; page = 1; filter = 'all';  setFilter('all'); persist(); render(); notify('Number purchased. Waiting for SMS.');
    await syncBalance(token).catch(() => {});
  } catch(error) { if (token === epoch) { uncertain = Boolean(error.uncertain); notify(error.message,true); } }
  finally { if (token === epoch) { buying = false; render(); schedulePoll(); } }
};
async function refund(id) {
  const order=orders.get(id); if(!canRefund(order)||refundBusy.has(id))return;
  const token=epoch;refundBusy.add(id);render();
  try {
    if(!demo){const result=await api('/sms/cancel',{orderid:id});if(String(result.success)!=='1')throw new Error('SMSPool did not confirm the refund.');}
    if(token!==epoch)return;
    orders.set(id,{...orders.get(id),status:'refunded'});if(demo)balance+=order.cost||0;
    persist();notify('Refund completed');if(!demo)await syncBalance(token);
  }catch(error){if(token===epoch)notify(error.message,true);}
  finally{refundBusy.delete(id);if(token===epoch)render();}
}
$('new-order').onclick=()=>$('buy').onclick();
$('copy-current-phone').onclick = () => copy(orders.get(activeOrderId)?.phone);
$('copy-current-code').onclick = () => copy(orders.get(activeOrderId)?.code);
$('history-body').onclick = event => { const refundButton = event.target.closest('[data-refund]'); if(refundButton){void refund(refundButton.dataset.refund);return;} const button = event.target.closest('[data-copy]'); if (button) { void copy(button.dataset.copy); return; } const row = event.target.closest('[data-order]'); if (row) { selected = row.dataset.order; render(); } };
$('history-body').onkeydown = event => { if (event.target.matches('tr') && ['Enter',' '].includes(event.key)) { event.preventDefault(); selected = event.target.dataset.order; render(); } };
function setFilter(value) { filter = value; page = 1; document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active',button.dataset.filter === value)); render(); }
document.querySelectorAll('[data-filter]').forEach(button => { button.onclick = () => setFilter(button.dataset.filter); });
$('prev').onclick = () => { page--; render(); }; $('next').onclick = () => { page++; render(); };
$('export').onclick = () => {
  const rows = [['Order ID','Phone','Code','Service','Country','Status','Cost USD','Created UTC','Message'],...sorted().map(o => [o.id,o.phone,o.code,'CocaCola','IL',o.status,o.cost,o.created ? new Date(o.created).toISOString() : '',o.fullMessage])];
  const url = URL.createObjectURL(new Blob(['\ufeff'+rows.map(row => row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `cocacola-sms-${demo ? 'demo-' : ''}${new Date().toISOString().slice(0,10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
};
function loadDemo() {
  resetSession(); demo = true; prefs.sound ??= true; enableAudio(); document.body.classList.add('demo-mode'); balance = 24.63; price = .37; setConnection('Demo · no charges');
  const now = Date.now();
  for (let i = 0; i < 18; i++) { const id = 'DEMO'+String(18-i).padStart(3,'0'), status = i === 0 || i === 3 ? 'pending' : i === 5 || i === 9 ? 'expired' : 'completed'; orders.set(id,{id,phone:'+97253'+String(2411034+i*137).padStart(7,'0'),code:status === 'completed' ? ['715017','093246','382149','820614'][i%4] : '',status,cost:.37,fullMessage:status === 'completed' ? 'Coca-Cola: your verification code '+['715017','093246','382149','820614'][i%4] : '',expires:now/1000+987-i*10,created:now-i*360000}); }
  selected = '';   render();
  const token = epoch; setTimeout(() => { if (demo && token === epoch && WAITING.has(orders.get('DEMO018')?.status)) { merge({order_id:'DEMO018',status:3,sms:'715017',full_sms:'Coca-Cola: your verification code 715017'},true); render(); } },6000);
}
function buyDemo() { const id = 'DEMO'+Date.now(), token = epoch; orders.set(id,{id,phone:'+972539000123',code:'',status:'pending',cost:.37,expires:Date.now()/1000+1200,created:Date.now(),fullMessage:''}); selected = id; activeOrderId = id; balance = Math.round((balance-.37)*100)/100; page = 1; render(); notify('Demo number added. Your code will arrive in 6 seconds.'); setTimeout(() => { if (demo && token === epoch && WAITING.has(orders.get(id)?.status)) { merge({order_id:id,status:3,sms:'008421',full_sms:'Coca-Cola: your verification code 008421'},true); render(); } },6000); }
$('demo').onclick = () => { if (buying) return; $('settings-dialog').close(); if (demo) { resetSession(); render(); } else { enableAudio(); loadDemo(); } };
new ResizeObserver(fitRows).observe(document.querySelector('main')); setInterval(updateCountdown,1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && connected && !demo) void refresh(); });
render();
const session = storage.get('smsdesk.session',true);
if (session?.key) connectAccount(session.key,prefs,true).catch(error => { resetSession(); render(); notify(error.message,true); });
