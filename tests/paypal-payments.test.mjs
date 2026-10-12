import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateCart} from '../lib/cart-pricing.mjs';
import {buildSellerQuote,quoteHash} from '../lib/checkout-payments.mjs';
import {
  buildPayPalOrder,paypalApprovalUrl,validPayPalOrderId,
  validCapturedPayPalOrder,paypalWebhookFields
} from '../lib/paypal-payments.mjs';
const products=JSON.parse(readFileSync(new URL('../config/products.json',import.meta.url),'utf8')).map(p=>p.sku==='FTE230'?{...p,price:{baseCurrency:'HKD',baseAmount:899}}:p);
const cart=calculateCart([{sku:'FTE230',qty:2}],products);
const quote={...buildSellerQuote(cart,{subtotalHkd:'1798',shippingHkd:'45',taxHkd:'5'}),
  quotedAt:'2026-10-12T00:00:00.000Z'};
const merchantOrderId='LMD-20261012-123456ABCD';
const paypalId='8G467899TT123456V';
const captureId='8MC585209K746392H';
const completed={
  id:paypalId,status:'COMPLETED',intent:'CAPTURE',purchase_units:[{
    reference_id:merchantOrderId,custom_id:merchantOrderId,
    amount:{currency_code:'HKD',value:'1848.00'},
    payments:{captures:[{
      id:captureId,status:'COMPLETED',
      amount:{currency_code:'HKD',value:'1848.00'}
    }]}
  }]
};
const context={orderId:merchantOrderId,paypalOrderId:paypalId,quote};
test('PayPal order built from authoritative HKD quote only',()=>{
  const {payload,amountCents,quoteFingerprint}=buildPayPalOrder({
    orderId:merchantOrderId,quote,publicSiteUrl:'https://shop.example.test/'});
  assert.equal(amountCents,184800);
  assert.equal(quoteFingerprint,quoteHash(merchantOrderId,quote));
  assert.equal(payload.purchase_units[0].amount.currency_code,'HKD');
  assert.equal(payload.purchase_units[0].amount.value,'1848.00');
  assert.equal(payload.purchase_units[0].reference_id,merchantOrderId);
  assert.equal(payload.payment_source.paypal.experience_context.return_url,
    'https://shop.example.test/order?payment=paypal-return');
  assert.equal(payload.payment_source.paypal.experience_context.cancel_url,
    'https://shop.example.test/order?payment=paypal-cancel');
  assert.equal(payload.payment_source.paypal.experience_context.user_action,'PAY_NOW');
});
test('PayPal approval URL authenticates the correct PSP domain and single order token',()=>{
  assert.equal(validPayPalOrderId(paypalId),true);
  const ok='https://www.sandbox.paypal.com/checkoutnow?token='+paypalId;
  assert.equal(paypalApprovalUrl([{rel:'payer-action',href:ok}],'sandbox'),ok);
  for(const bad of [
    'https://www.paypal.com/checkoutnow?token='+paypalId,
    'https://www.sandbox.paypal.com.evil.invalid/checkoutnow?token='+paypalId,
    'http://www.sandbox.paypal.com/checkoutnow?token='+paypalId,
    ok+'&token=ANOTHER1234567890',
    ok+'#inject',
    'https://www.sandbox.paypal.com/checkoutnow?token=undefined'
  ]) assert.throws(()=>paypalApprovalUrl([{rel:'approve',href:bad}],'sandbox'));
});
test('PayPal captured order must match order ID, paid status, exact HKD minor units',()=>{
  assert.deepEqual(validCapturedPayPalOrder(completed,context),{
    captureId,amountCents:184800});
  const pu=completed.purchase_units[0];
  const clone=obj=>structuredClone(obj);
  const wrongId=clone(completed);wrongId.id='99999999999999999';
  assert.equal(validCapturedPayPalOrder(wrongId,context),null);
  const pending=clone(completed);pending.status='APPROVED';
  assert.equal(validCapturedPayPalOrder(pending,context),null);
  const wrongRef=clone(completed);wrongRef.purchase_units[0].custom_id='OTHERORDER';
  assert.equal(validCapturedPayPalOrder(wrongRef,context),null);
  const underpaid=clone(completed);underpaid.purchase_units[0].payments.captures[0].amount.value='1847.99';
  assert.equal(validCapturedPayPalOrder(underpaid,context),null);
  const usd=clone(completed);usd.purchase_units[0].payments.captures[0].amount.currency_code='USD';
  assert.equal(validCapturedPayPalOrder(usd,context),null);
  const notSettled=clone(completed);notSettled.purchase_units[0].payments.captures[0].status='PENDING';
  assert.equal(validCapturedPayPalOrder(notSettled,context),null);
  const multiple=clone(completed);multiple.purchase_units[0].payments.captures.push(pu.payments.captures[0]);
  assert.equal(validCapturedPayPalOrder(multiple,context),null);
});
test('PayPal webhook headers require expected time and certificate host',()=>{
  const now=Date.now(),timestamp=new Date(now).toISOString();
  const event={id:'WH-ABCD1234EFGH5678',event_type:'PAYMENT.CAPTURE.COMPLETED'};
  const base={
    'paypal-transmission-id':'abc-123-def-456',
    'paypal-transmission-time':timestamp,
    'paypal-transmission-sig':'A'.repeat(150),
    'paypal-auth-algo':'SHA256withRSA',
    'paypal-cert-url':'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT123'
  };
  const make=(override={})=>new Headers({...base,...override});
  const verified=paypalWebhookFields(event,make(),'WHOOKTEST1234',now);
  assert.equal(verified.webhook_id,'WHOOKTEST1234');
  assert.equal(verified.webhook_event.id,event.id);
  assert.throws(()=>paypalWebhookFields(event,make({
    'paypal-transmission-time':new Date(now-360000).toISOString()
  }),'WHOOKTEST1234',now),/signature metadata/);
  assert.throws(()=>paypalWebhookFields(event,make({
    'paypal-cert-url':'https://evil.invalid/certificate'
  }),'WHOOKTEST1234',now),/certificate URL/);
});
