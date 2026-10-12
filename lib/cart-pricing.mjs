/**
 * HKD cart pricing. Pure and server-authoritative; never accept client-supplied prices.
 * Unpriced SKUs must be quoted by the seller, not silently treated as free items.
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
  let subtotalCents = 0;
  let quoteRequired = false;
  let itemCount = 0;
  const lines = items.map(({sku, qty}) => {
    const product = catalog.get(sku);
    itemCount += qty;
    const amount = Number(product.price?.baseAmount);
    const unitCents = product.price?.baseCurrency === 'HKD' &&
      Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
    if (unitCents === null || !Number.isSafeInteger(unitCents)) {
      quoteRequired = true;
      return {sku, name:product.name, qty, priceStatus:'requires_seller_quote',
        unitPriceHkd:null, lineSubtotalHkd:null};
    }
    const lineCents = unitCents * qty;
    if (!Number.isSafeInteger(lineCents)) throw new RangeError('商品金額超出限制');
    subtotalCents += lineCents;
    if (!Number.isSafeInteger(subtotalCents)) throw new RangeError('購物車金額超出限制');
    return {sku, name:product.name, qty, priceStatus:'seller_listed_price',
      unitPriceHkd:unitCents/100, lineSubtotalHkd:lineCents/100};
  });
  const thresholdCents = Math.round(freeShippingThresholdHkd * 100);
  const thresholdReached = subtotalCents >= thresholdCents;
  return {
    currency:'HKD', lines, itemCount,
    pricedSubtotalHkd:subtotalCents/100,
    quoteRequired, allItemsPriced:!quoteRequired,
    freeShippingThresholdHkd,
    thresholdReachedByPricedItems:thresholdReached,
    amountShortOfFreeShippingHkd:Math.max(0, thresholdCents-subtotalCents)/100,
    shippingEligibility:'seller_confirmation_required',
    shippingHkd:null, taxHkd:null, finalTotalHkd:null,
    paymentDueNowHkd:0, checkoutStatus:'pending_seller_quote',
    disclaimer:'商品已知小計只供核對；最終運費、稅款及應付總額須由店主確認，現階段不會即時收款。'
  };
}
