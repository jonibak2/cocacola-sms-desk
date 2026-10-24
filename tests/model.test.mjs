import test from 'node:test';
import assert from 'node:assert/strict';
import {circleOrder,orderSummary,refundAvailable,normalize,phoneNumber,isRelevant,rowsFrom,csvCell} from '../public/model.js';

test('leading zero SMS codes survive all response formats and refreshes',() => {
  const first = normalize({order_id:'ORDER',phonenumber:'0532411034',status:'pending',code:'0',cost:'.37'});
  assert.equal(first.code,''); assert.equal(first.phone,'+972532411034');
  const completed = normalize({order_id:'ORDER',status:3,sms:'008421'},first);
  assert.equal(completed.code,'008421'); assert.equal(completed.status,'completed'); assert.equal(completed.cost,.37);
  const stale = normalize({order_code:'ORDER',status:'pending',code:'0'},completed);
  assert.equal(stale.code,'008421'); assert.equal(stale.status,'completed');
  assert.equal(normalize({status:3,sms:'000000'}).code,'000000');
});
test('Israeli phone normalization does not duplicate country code',() => {
  for (const phone of ['+972 532411034','972532411034','00972532411034','0532411034','532411034']) assert.equal(phoneNumber({phonenumber:phone}),'+972532411034');
  assert.equal(phoneNumber({cc:'972',phonenumber:'532411034'}),'+972532411034');
  assert.equal(phoneNumber({}), '');
});
test('history includes only CocaCola Israel orders',() => {
  assert.equal(isRelevant({service:'Coca-Cola',short_name:'IL'}),true);
  assert.equal(isRelevant({service:1244,country_id:29}),true);
  assert.equal(isRelevant({service:'CocaCola',short_name:'US'}),false);
  assert.equal(isRelevant({service:'Telegram',short_name:'IL'}),false);
});
test('expired, cancelled, refunded and pending are distinct',() => {
  assert.equal(normalize({status:2}).status,'expired');
  assert.equal(normalize({status:5}).status,'cancelled');
  assert.equal(normalize({status:6}).status,'refunded');
  assert.equal(normalize({status:1}).status,'pending');
  assert.equal(normalize({status:1},{status:'refunded'}).status,'refunded');
});
test('accept documented history arrays and reject unexpected responses',() => {
  assert.deepEqual(rowsFrom([]),[]); assert.deepEqual(rowsFrom({'0':{order_code:'A'}}),[{order_code:'A'}]);
  assert.throws(() => rowsFrom({success:1,message:'unexpected'}));
});
test('CSV export escapes quotes and prevents spreadsheet formulas',() => {
  assert.equal(csvCell('008421'),'"008421"');
  assert.equal(csvCell('="test"'),'"\'=""test"""');
  assert.equal(csvCell('+972532411034'),'"\'+972532411034"');
});

test('refund unlocks at 60 seconds and never for received codes or closed orders',() => {
  const now=100000, order={created:now,status:'pending',code:''};
  assert.equal(refundAvailable(order,now),false);
  assert.equal(refundAvailable(order,now+59999),false);
  assert.equal(refundAvailable(order,now+60000),true);
  assert.equal(refundAvailable({...order,code:'008421'},now+60000),false);
  for(const status of ['completed','refunded','cancelled','expired']) assert.equal(refundAvailable({...order,status},now+120000),false);
  assert.equal(refundAvailable({...order,created:undefined},now+120000),false);
});

test('purchase totals count confirmed codes and estimate buying capacity with average paid price',() => {
  const orders=[{status:'completed',code:'001234',cost:.37},{status:'completed',code:'654321',cost:.43},{status:'pending',code:'',cost:.50},{status:'refunded',code:'',cost:.99},{status:'completed',code:'',cost:.30}];
  assert.deepEqual(orderSummary(orders,2,.5),{confirmedCount:2,totalCost:.8,averagePrice:.4,affordable:5});
  assert.deepEqual(orderSummary([],null),{confirmedCount:0,totalCost:0,averagePrice:null,affordable:null});
  assert.equal(orderSummary([],1,.3).affordable,3);
  assert.equal(orderSummary([{status:'completed',code:'123456',cost:.1}],.3).affordable,3);
  const missing=orderSummary([{status:'completed',code:'123456',cost:null}],1);
  assert.equal(missing.confirmedCount,1);assert.equal(missing.totalCost,null);assert.equal(missing.averagePrice,null);assert.equal(missing.affordable,null);
});

test('circle restores logo when the session order is refunded, cancelled or expired',() => {
 const orders=new Map();
 for(const status of ['pending','processing','activating','resend','completed']){const order={id:'current',status};orders.set('current',order);assert.equal(circleOrder(orders,'current'),order);}
 for(const status of ['refunded','cancelled','expired']){orders.set('current',{id:'current',status});assert.equal(circleOrder(orders,'current'),null);}
 assert.equal(circleOrder(orders,''),null);assert.equal(circleOrder(orders,'missing'),null);
});
