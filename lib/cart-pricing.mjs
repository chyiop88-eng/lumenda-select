/**
 * Immutable merchandise listing price in original currency (HKD/CNY).
 * CNY products must receive an explicit seller-confirmed HKD exchange rate
 * before the final PayPal HKD amount can be created. No invented FX rates.
 */
export function normalizeCartItems(rawItems, products) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 20)
    throw new RangeError('請選擇有效商品');
  const catalog = new Map(products.map(p => [p.sku, p]));
  const seen = new Set();
  return rawItems.map(raw => {
    const sku = String(raw?.sku ?? '').trim();
    const qty = Number(raw?.qty);
    if (!catalog.has(sku) || seen.has(sku) || !Number.isInteger(qty) || qty < 1 || qty > 30)
      throw new RangeError('購物車數量或商品無效');
    seen.add(sku);
    return { sku, qty };
  });
}

export function calculateCart(rawItems, products, freeShippingThresholdHkd = 4000) {
  const items = normalizeCartItems(rawItems, products);
  const catalog = new Map(products.map(p => [p.sku, p]));
  let subtotalHkdCents=0,subtotalCnyCents=0,quoteRequired=false,itemCount=0;
  const lines=items.map(({sku,qty})=>{
    const p=catalog.get(sku);
    itemCount+=qty;
    const amount=Number(p.price?.baseAmount),currency=p.price?.baseCurrency;
    const valid=(currency==='HKD'||currency==='CNY') &&
      Number.isFinite(amount) && amount>0 && Math.round(amount*100)===amount*100;
    const unitCents=valid?Math.round(amount*100):null;
    if(unitCents===null||!Number.isSafeInteger(unitCents)){
      quoteRequired=true;
      return {sku,name:p.name,qty,priceStatus:'requires_seller_quote',listedCurrency:null,
        unitPriceCny:null,lineSubtotalCny:null,unitPriceHkd:null,lineSubtotalHkd:null};
    }
    const rowCents=unitCents*qty;
    if(!Number.isSafeInteger(rowCents))throw new RangeError('商品金額超出限制');
    if(currency==='CNY'){
      subtotalCnyCents+=rowCents;quoteRequired=true;
      if(!Number.isSafeInteger(subtotalCnyCents))throw new RangeError('購物車金額超出限制');
      return {sku,name:p.name,qty,priceStatus:'seller_listed_cny',listedCurrency:'CNY',
        unitPriceCny:unitCents/100,lineSubtotalCny:rowCents/100,
        unitPriceHkd:null,lineSubtotalHkd:null};
    }
    subtotalHkdCents+=rowCents;
    if(!Number.isSafeInteger(subtotalHkdCents))throw new RangeError('購物車金額超出限制');
    return {sku,name:p.name,qty,priceStatus:'seller_listed_price',listedCurrency:'HKD',
      unitPriceHkd:unitCents/100,lineSubtotalHkd:rowCents/100,
      unitPriceCny:null,lineSubtotalCny:null};
  });
  const thresholdCents=Math.round(freeShippingThresholdHkd*100);
  const thresholdReached=subtotalHkdCents>=thresholdCents&&!quoteRequired;
  return {currency:'HKD',listingCurrencies:['CNY','HKD'],lines,itemCount,
    pricedSubtotalHkd:subtotalHkdCents/100,
    pricedSubtotalCny:subtotalCnyCents/100,
    quoteRequired,allItemsPriced:!quoteRequired,
    freeShippingThresholdHkd,
    thresholdReachedByPricedItems:thresholdReached,
    amountShortOfFreeShippingHkd:!quoteRequired?Math.max(0,thresholdCents-subtotalHkdCents)/100:null,
    shippingEligibility:'seller_confirmation_required',
    shippingHkd:null,taxHkd:null,finalTotalHkd:null,
    paymentDueNowHkd:0,checkoutStatus:'pending_seller_quote',
    disclaimer:'人民幣價格按商品標價計算；港幣匯率、運費及稅費須店主確認，完成報價之前不會收款。'
  };
}
