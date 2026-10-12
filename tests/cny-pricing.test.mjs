import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {calculateCart} from '../lib/cart-pricing.mjs';
import {buildSellerQuote,checkoutAmountCents,cnyHkdRateMicros,
  cnyUnitToHkdCents,quoteHash} from '../lib/checkout-payments.mjs';

const catalog=JSON.parse(readFileSync(new URL('../config/products.json',import.meta.url),'utf8'));
test('authoritative new CNY catalogue shows two sizes at exact stated prices',()=>{
  assert.equal(catalog.find(p=>p.sku==='FTE230').price.baseCurrency,'CNY');
  assert.equal(catalog.find(p=>p.sku==='FTE230').price.baseAmount,750);
  assert.equal(catalog.find(p=>p.sku==='FTE330').price.baseCurrency,'CNY');
  assert.equal(catalog.find(p=>p.sku==='FTE330').price.baseAmount,990);
  const cart=calculateCart([{sku:'FTE230',qty:2},{sku:'FTE330',qty:1}],catalog);
  assert.equal(cart.pricedSubtotalCny,2490);
  assert.equal(cart.pricedSubtotalHkd,0);
  assert.equal(cart.lines[0].unitPriceCny,750);
  assert.equal(cart.lines[1].unitPriceCny,990);
  assert.equal(cart.lines[0].lineSubtotalCny,1500);
  assert.equal(cart.lines[1].lineSubtotalCny,990);
  assert.equal(cart.quoteRequired,true);
  assert.equal(cart.amountShortOfFreeShippingHkd,null);
  assert.equal(cart.paymentDueNowHkd,0);
  assert.equal(cart.finalTotalHkd,null);
});
test('seller confirmed FX rate locks HKD unit amounts consistently',()=>{
  const cart=calculateCart([{sku:'FTE230',qty:1},{sku:'FTE330',qty:1}],catalog);
  assert.throws(()=>buildSellerQuote(cart,{shippingHkd:'40',taxHkd:'5'}),/匯率/);
  const q=buildSellerQuote(cart,{fxRateCnyToHkd:'1.2',subtotalHkd:'2088',
    shippingHkd:'40',taxHkd:'5'});
  assert.equal(q.fxRateCnyToHkd,'1.200000');
  assert.equal(q.pricedSubtotalCny,1740);
  assert.equal(q.lines[0].unitPriceHkd,900);
  assert.equal(q.lines[1].unitPriceHkd,1188);
  assert.equal(q.lines[0].unitPriceCny,750);
  assert.equal(q.subtotalHkd,2088);
  assert.equal(q.totalHkd,2133);
  assert.equal(checkoutAmountCents({...q,quotedAt:'2026-10-12T08:00:00Z'}),213300);
  assert.equal(cnyUnitToHkdCents(750,'1.172460'),87935);
  assert.equal(cnyHkdRateMicros('1.172460'),1172460);
  assert.equal(buildSellerQuote(calculateCart([{sku:'FTE230',qty:5}],catalog),{
    fxRateCnyToHkd:'1.2',subtotalHkd:'4500',shippingHkd:'99',taxHkd:'25'
  }).totalHkd,4525);
  assert.throws(()=>buildSellerQuote(cart,{fxRateCnyToHkd:'1.2',subtotalHkd:'1740'}),/唔一致/);
});
test('no client repricing: refuse fake CNY amount and tampered FX on PSP quote',()=>{
  const cart=calculateCart([{sku:'FTE230',qty:1}],catalog);
  const original={...buildSellerQuote(cart,{fxRateCnyToHkd:'1.172460',
    shippingHkd:'0',taxHkd:'0'}),quotedAt:'2026-10-12T08:00:00Z'};
  const orderId='LMD-20261012-ABCDEF1234';
  assert.equal(original.lines[0].unitPriceHkd,879.35);
  assert.throws(()=>checkoutAmountCents({...original,fxRateCnyToHkd:'1.1'}),/不一致/);
  assert.throws(()=>checkoutAmountCents({...original,
    lines:[{...original.lines[0],unitPriceCny:990}]}),/不一致/);
  assert.throws(()=>checkoutAmountCents({...original,
    lines:[{...original.lines[0],unitPriceHkd:750,lineSubtotalHkd:750}],
    subtotalHkd:750,totalHkd:750}),/不一致/);
  assert.throws(()=>buildSellerQuote(cart,{fxRateCnyToHkd:'0.00001'}),/範圍/);
  assert.notEqual(quoteHash(orderId,original),quoteHash(orderId,{...original,fxRateCnyToHkd:'1.150000'}));
});
test('legacy quote hashes remain identical after CNY price launch',()=>{
  const quote={currency:'HKD',lines:[{sku:'FTE230',name:'SK-II FTE 230ml',
    qty:1,unitPriceHkd:899,lineSubtotalHkd:899}],
    subtotalHkd:899,shippingHkd:0,taxHkd:0,totalHkd:899,freeShipping:false,
    quotedAt:'2026-10-12T00:00:00Z'};
  const fields={orderId:'LMD-20261012-ABCDEF1234',currency:quote.currency,
    lines:quote.lines,subtotalHkd:quote.subtotalHkd,shippingHkd:quote.shippingHkd,
    taxHkd:quote.taxHkd,totalHkd:quote.totalHkd,quotedAt:quote.quotedAt};
  const previous=createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  assert.equal(quoteHash(fields.orderId,quote),previous);
  assert.equal(checkoutAmountCents(quote),89900);
});
