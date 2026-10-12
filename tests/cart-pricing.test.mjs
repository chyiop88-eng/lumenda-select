import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateCart} from '../lib/cart-pricing.mjs';
import {readFileSync} from 'node:fs';
const PRODUCTS=JSON.parse(readFileSync(new URL('../config/products.json',import.meta.url),'utf8')).map(p=>p.sku==='FTE230'?{...p,price:{baseCurrency:'HKD',baseAmount:899}}:p);
test('HK$899 each, quantity and free shipping threshold',()=>{
 const a=calculateCart([{sku:'FTE230',qty:1}],PRODUCTS);
 assert.equal(a.pricedSubtotalHkd,899);
 assert.equal(a.amountShortOfFreeShippingHkd,3101);
 assert.equal(a.thresholdReachedByPricedItems,false);
 assert.equal(a.shippingHkd,null);
 assert.equal(a.finalTotalHkd,null);
 assert.equal(a.paymentDueNowHkd,0);
 const b=calculateCart([{sku:'FTE230',qty:5}],PRODUCTS);
 assert.equal(b.pricedSubtotalHkd,4495);
 assert.equal(b.thresholdReachedByPricedItems,true);
 assert.equal(b.lines[0].unitPriceHkd,899);
 assert.equal(b.lines[0].lineSubtotalHkd,4495);
});
test('unpriced product does not become free or invent a payable total',()=>{
 const a=calculateCart([{sku:'FTE230',qty:2},{sku:'GENOPTICS50',qty:1}],PRODUCTS);
 assert.equal(a.pricedSubtotalHkd,1798);
 assert.equal(a.quoteRequired,true);
 assert.equal(a.allItemsPriced,false);
 assert.equal(a.lines[1].lineSubtotalHkd,null);
 assert.equal(a.finalTotalHkd,null);
});
test('server rejects invalid, duplicate and oversized quantities',()=>{
 for(const items of [[{sku:'FTE230',qty:31}],[{sku:'FTE230',qty:0}],[{sku:'FTE230',qty:1.5}],[{sku:'FTE230',qty:1},{sku:'FTE230',qty:1}],[{sku:'FAKE',qty:1}],[]])
  assert.throws(()=>calculateCart(items,PRODUCTS),RangeError);
});
