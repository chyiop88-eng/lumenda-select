import {createHash, createHmac, timingSafeEqual} from 'node:crypto';

export function hkdCents(value,label='港幣金額') {
  const s=typeof value==='number'?String(value):String(value??'');
  if(!/^\\d{1,8}(?:\\.\\d{1,2})?$/.test(s))
    throw new RangeError(label+' 必須係最多兩位小數嘅非負港幣金額');
  const valueCents=Math.round(Number(s)*100);
  if(!Number.isSafeInteger(valueCents)||valueCents>99999999)
    throw new RangeError(label+' 超出收款額度');
  return valueCents;
}

export function buildSellerQuote(cart, input) {
  if(!cart?.lines?.length)throw new RangeError('無有效購物車');
  const inputPrices=input?.unitPricesHkd||{};
  if(!inputPrices||typeof inputPrices!=='object'||Array.isArray(inputPrices))
    throw new RangeError('待報價商品單價無效');
  const unpricedSet=new Set(cart.lines.filter(x=>x.priceStatus==='requires_seller_quote').map(x=>x.sku));
  for(const sku of Object.keys(inputPrices))if(!unpricedSet.has(sku))
    throw new RangeError('已標價商品不能透過此欄位自行改價');
  let subtotal=0;
  const lines=cart.lines.map(line=>{
    let unit=0;
    if(line.priceStatus==='seller_listed_price')unit=hkdCents(line.unitPriceHkd,'已標價商品');
    else {
      if(!Object.hasOwn(inputPrices,line.sku))throw new RangeError(line.name+' 尚未填寫正式單價');
      unit=hkdCents(inputPrices[line.sku],line.name);
      if(unit===0)throw new RangeError('待報價商品單價必須大於零');
    }
    const lineCents=unit*line.qty;
    if(!Number.isSafeInteger(lineCents))throw new RangeError('商品金額超出限制');
    subtotal+=lineCents;
    if(!Number.isSafeInteger(subtotal)||subtotal>99999999)throw new RangeError('小計超出收款限額');
    return {sku:line.sku,name:line.name,qty:line.qty,unitPriceHkd:unit/100,lineSubtotalHkd:lineCents/100};
  });
  if(input.subtotalHkd!==undefined&&input.subtotalHkd!==''&&hkdCents(input.subtotalHkd,'商品小計')!==subtotal)
    throw new RangeError('商品小計同購物車逐件計算唔一致，請核對單價與數量');
  const tax=hkdCents(input.taxHkd??'0','稅費');
  const isFree=subtotal>=400000;
  const shipping=isFree?0:hkdCents(input.shippingHkd??'0','運費');
  const total=subtotal+shipping+tax;
  if(!Number.isSafeInteger(total)||total>99999999)throw new RangeError('總額超出收款限額');
  if(total<400)throw new RangeError('Stripe 最低收款金額係 HK$4');
  return {
    currency:'HKD',lines,subtotalHkd:subtotal/100,
    shippingHkd:shipping/100,taxHkd:tax/100,
    totalHkd:total/100,freeShipping:isFree
  };
}

export function quoteHash(orderId,quote) {
  const fields={
    orderId, currency:quote.currency,lines:quote.lines,
    subtotalHkd:quote.subtotalHkd,shippingHkd:quote.shippingHkd,
    taxHkd:quote.taxHkd,totalHkd:quote.totalHkd,
    quotedAt:quote.quotedAt
  };
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export function checkoutAmountCents(quote) {
  if(quote?.currency!=='HKD'||!Array.isArray(quote?.lines)||quote.lines.length===0)
    throw new RangeError('正式報價尚未完成');
  const subtotal=hkdCents(quote.subtotalHkd),shipping=hkdCents(quote.shippingHkd);
  const tax=hkdCents(quote.taxHkd),total=hkdCents(quote.totalHkd);
  if(subtotal+shipping+tax!==total || total<400)
    throw new RangeError('正式報價總額不一致');
  const linesTotal=quote.lines.reduce((a,x)=>a+hkdCents(x.lineSubtotalHkd),0);
  if(linesTotal!==subtotal)throw new RangeError('報價商品明細不一致');
  if((subtotal>=400000)!==quote.freeShipping||(subtotal>=400000&&shipping!==0))
    throw new RangeError('運費門檻計算不一致');
  return total;
}

export function stripeCheckoutParams({orderId,quote,publicSiteUrl}) {
  const amount=checkoutAmountCents(quote);
  const base=new URL(publicSiteUrl);
  if((base.protocol!=='https:' && !(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))||
     base.username||base.password||base.search||base.hash||base.pathname!=='/')
    throw new Error('網站公開網址必須係 HTTPS 網站根目錄');
  const fingerprint=quoteHash(orderId,quote);
  const params=new URLSearchParams();
  const entries={
    mode:'payment',
    'payment_method_types[0]':'card',
    client_reference_id:orderId,
    'metadata[order_id]':orderId,
    'metadata[quote_hash]':fingerprint,
    'payment_intent_data[metadata][order_id]':orderId,
    'line_items[0][price_data][currency]':'hkd',
    'line_items[0][price_data][unit_amount]':String(amount),
    'line_items[0][price_data][product_data][name]':'LUMENDA SELECT · Order '+orderId,
    'line_items[0][quantity]':'1',
    success_url:new URL('/order?payment=success',base).href,
    cancel_url:new URL('/order?payment=cancel',base).href
  };
  for(const [key,value] of Object.entries(entries))params.set(key,value);
  return {params,amount,fingerprint};
}

export function verifyStripeEvent(raw,header,secret,nowSeconds=Math.floor(Date.now()/1000)) {
  if(typeof raw!=='string'||raw.length>200000||!secret?.startsWith('whsec_'))
    throw new Error('Invalid webhook body or signing secret');
  const parts=String(header||'').split(',').map(x=>x.trim());
  const timestamp=parts.find(x=>x.startsWith('t='))?.slice(2)||'';
  const signatures=parts.filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));
  if(!/^\\d{10,}$/.test(timestamp)||Math.abs(nowSeconds-Number(timestamp))>300||signatures.length===0)
    throw new Error('Invalid or expired Stripe signature');
  const expected=createHmac('sha256',secret).update(timestamp+'.'+raw,'utf8').digest();
  const ok=signatures.some(value=>{
    if(!/^[0-9a-f]{64}$/i.test(value))return false;
    const received=Buffer.from(value,'hex');
    return received.length===expected.length && timingSafeEqual(received,expected);
  });
  if(!ok)throw new Error('Stripe webhook signature mismatch');
  const event=JSON.parse(raw);
  if(typeof event.id!=='string'||!event.id.startsWith('evt_')||typeof event.type!=='string'||!event.data?.object)
    throw new Error('Stripe webhook payload invalid');
  return event;
}

export function paidStripeSessionValid(session,{orderId,quote,sessionId,mode}) {
  return Boolean(session && session.object==='checkout.session' &&
    session.id===sessionId && session.client_reference_id===orderId &&
    session.metadata?.order_id===orderId &&
    session.metadata?.quote_hash===quoteHash(orderId,quote) &&
    session.currency==='hkd' && session.mode==='payment' &&
    session.payment_status==='paid' && Number(session.amount_total)===checkoutAmountCents(quote) &&
    session.livemode===(mode==='live'));
}
