import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {calculateCart} from '../lib/cart-pricing.mjs';
import {hkdCents,buildSellerQuote,checkoutAmountCents,stripeCheckoutParams,
  quoteHash,paidStripeSessionValid,verifyStripeEvent} from '../lib/checkout-payments.mjs';
const products=JSON.parse(readFileSync(new URL('../config/products.json',import.meta.url),'utf8')).map(p=>p.sku==='FTE230'?{...p,price:{baseCurrency:'HKD',baseAmount:899}}:p);
const one=calculateCart([{sku:'FTE230',qty:1}],products);
const five=calculateCart([{sku:'FTE230',qty:5}],products);
const mixed=calculateCart([{sku:'FTE230',qty:2},{sku:'GENOPTICS50',qty:1}],products);
test('HK$899 x qty remains server authoritative and tax/shipping reconcile',()=>{
  assert.throws(()=>buildSellerQuote(one,{subtotalHkd:'900',shippingHkd:'50',taxHkd:'20'}),/小計/);
  assert.throws(()=>buildSellerQuote(one,{subtotalHkd:'4000',shippingHkd:'50',taxHkd:'20'}),/小計/);
  const q=buildSellerQuote(one,{subtotalHkd:'899',shippingHkd:'35.50',taxHkd:'20.25'});
  assert.equal(q.subtotalHkd,899);assert.equal(q.shippingHkd,35.5);
  assert.equal(q.taxHkd,20.25);assert.equal(q.totalHkd,954.75);
  assert.equal(q.lines[0].unitPriceHkd,899);
  assert.equal(checkoutAmountCents({...q,quotedAt:'2026-10-12T00:00:00Z'}),95475);
  assert.equal(buildSellerQuote(five,{subtotalHkd:'4495',shippingHkd:'999',taxHkd:'10'}).totalHkd,4505);
  assert.equal(buildSellerQuote(five,{subtotalHkd:'4495',shippingHkd:'999',taxHkd:'10'}).shippingHkd,0);
});
test('unpriced SKUs require owner-entered per-unit price, not arbitrary subtotal',()=>{
  assert.throws(()=>buildSellerQuote(mixed,{subtotalHkd:'1798',taxHkd:'0'}),/尚未填寫/);
  assert.throws(()=>buildSellerQuote(mixed,{unitPricesHkd:{GENOPTICS50:'0'},taxHkd:'0'}),/大於零/);
  assert.throws(()=>buildSellerQuote(mixed,{unitPricesHkd:{GENOPTICS50:'1500'},subtotalHkd:'3000',taxHkd:'0'}),/唔一致/);
  const q=buildSellerQuote(mixed,{unitPricesHkd:{GENOPTICS50:'1500'},subtotalHkd:'3298',shippingHkd:'22',taxHkd:'4'});
  assert.equal(q.totalHkd,3324);assert.equal(q.lines[1].unitPriceHkd,1500);
});
test('invalid prices and quote edits fail closed',()=>{
  for(const v of ['-1','2.123','x','',1000000.999])assert.throws(()=>hkdCents(v),RangeError);
  const quote={...buildSellerQuote(one,{subtotalHkd:'899',shippingHkd:'0',taxHkd:'0'}),quotedAt:'2026-10-12T00:00:00.000Z'};
  assert.throws(()=>checkoutAmountCents({...quote,totalHkd:1}),/不一致/);
  assert.throws(()=>checkoutAmountCents({...quote,lines:[{...quote.lines[0],lineSubtotalHkd:1}]}),/不一致/);
  assert.throws(()=>checkoutAmountCents({...quote,shippingHkd:1,freeShipping:true}),/運費|不一致/);
});
test('Stripe form contains exclusively server-quoted cents with binding metadata',()=>{
  const quote={...buildSellerQuote(one,{subtotalHkd:'899',shippingHkd:'40',taxHkd:'5'}),quotedAt:'2026-10-12T00:00:00Z'};
  const orderId='LMD-20261012-ABCDEF1234';
  const {params,amount,fingerprint}=stripeCheckoutParams({orderId,quote,publicSiteUrl:'https://shop.example.test/'});
  assert.equal(amount,94400);assert.equal(params.get('mode'),'payment');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'),'94400');
  assert.equal(params.get('line_items[0][price_data][currency]'),'hkd');
  assert.equal(params.get('client_reference_id'),orderId);
  assert.equal(params.get('metadata[quote_hash]'),fingerprint);
  assert.equal(params.get('success_url'),'https://shop.example.test/order?payment=success');
  assert.equal(fingerprint,quoteHash(orderId,quote));
  const signedSession={
    id:'cs_test_fixture1234',object:'checkout.session',mode:'payment',client_reference_id:orderId,
    currency:'hkd',amount_total:94400,payment_status:'paid',status:'complete',livemode:false,
    metadata:{order_id:orderId,quote_hash:fingerprint}
  };
  assert.equal(paidStripeSessionValid(signedSession,{orderId,quote,sessionId:signedSession.id,mode:'test'}),true);
  assert.equal(paidStripeSessionValid({...signedSession,amount_total:1},{orderId,quote,sessionId:signedSession.id,mode:'test'}),false);
  assert.equal(paidStripeSessionValid({...signedSession,livemode:true},{orderId,quote,sessionId:signedSession.id,mode:'test'}),false);
});
test('Webhook requires constant-time valid signature and fresh timestamp',()=>{
  const secret='whsec_local_test_secret',now=1781410000;
  const raw=JSON.stringify({id:'evt_local_test',type:'checkout.session.completed',data:{object:{id:'cs_test_foo'}}});
  const sig=ts=>'t='+ts+',v1='+createHmac('sha256',secret).update(ts+'.'+raw).digest('hex');
  assert.equal(verifyStripeEvent(raw,sig(now),secret,now).id,'evt_local_test');
  assert.throws(()=>verifyStripeEvent(raw,sig(now-301),secret,now),/expired/);
  assert.throws(()=>verifyStripeEvent(raw,'t='+now+',v1='+'0'.repeat(64),secret,now),/mismatch/);
  assert.throws(()=>verifyStripeEvent(raw+' ',sig(now),secret,now),/mismatch/);
});
