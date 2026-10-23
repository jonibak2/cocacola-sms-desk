import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,phoneNumber,isRelevant,rowsFrom,csvCell} from '../public/model.js';

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
