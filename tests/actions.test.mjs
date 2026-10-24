import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboard} from './dashboard-harness.mjs';
import {normalize} from '../public/model.js';

test('purchase waits for confirmation; cancellation and repeated taps send nothing',async()=>{
  const app=await dashboard();
  const pending=app.element('buy').onclick();
  assert.equal(app.element('confirm-dialog').open,true);
  assert.equal(app.element('confirm-submit').textContent,'Buy number');
  assert.match(app.element('confirm-detail').textContent,/\$0\.37/);
  await app.element('buy').onclick();
  assert.equal(app.requests.some(r=>r.url.endsWith('/purchase/sms')),false);
  app.element('confirm-dialog').close('cancel');
  await pending;
  assert.equal(app.requests.some(r=>r.url.endsWith('/purchase/sms')),false);
});

test('confirming a purchase buys once and displays and copies the local phone number',async()=>{
  const app=await dashboard();
  const pending=app.element('buy').onclick();
  app.element('confirm-dialog').close('confirm');
  await pending;
  assert.equal(app.requests.filter(r=>r.url.endsWith('/purchase/sms')).length,1);
  assert.equal(app.element('current-phone').textContent,'0539000123');
  assert.match(app.element('history-body').innerHTML,/data-copy="0539000123"/);
  assert.equal(app.element('history-body').innerHTML.includes('+972'),false);
  await app.element('copy-current-phone').onclick();
  assert.deepEqual(app.copied,['0539000123']);
});

test('refund confirmation cancellation preserves the order and approval submits once',async()=>{
  const app=await dashboard();
  app.run("orders.set('old',{id:'old',phone:'0532411034',code:'',status:'pending',cost:.37,created:Date.now()-65000})");
  let pending=app.run("refund('old')");
  assert.equal(app.element('confirm-title').textContent,'Confirm refund');
  assert.match(app.element('confirm-detail').textContent,/0532411034/);
  app.element('confirm-dialog').close('cancel');
  await pending;
  assert.equal(app.requests.some(r=>r.url.endsWith('/sms/cancel')),false);
  pending=app.run("refund('old')");
  app.element('confirm-dialog').close('confirm');
  await pending;
  assert.equal(app.requests.filter(r=>r.url.endsWith('/sms/cancel')).length,1);
  assert.equal(app.run("orders.get('old').status"),'refunded');
});

test('a code arriving during refund confirmation prevents the cancellation request',async()=>{
  const app=await dashboard();
  app.run("orders.set('old',{id:'old',phone:'0532411034',code:'',status:'pending',cost:.37,created:Date.now()-65000})");
  const pending=app.run("refund('old')");
  app.run("orders.get('old').code='008421'; orders.get('old').status='completed'");
  app.element('confirm-dialog').close('confirm');
  await pending;
  assert.equal(app.requests.some(r=>r.url.endsWith('/sms/cancel')),false);
  assert.match(app.element('toast').textContent,/no longer eligible/);
});

test('older cached international phones normalize even when an SMS update omits the phone',()=>{
  assert.equal(normalize({order_id:'old',status:3,sms:'008421'},{phone:'+972532411034',status:'pending'}).phone,'0532411034');
});
