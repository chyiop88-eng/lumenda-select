import {checkoutAmountCents,quoteHash,hkdCents} from './checkout-payments.mjs';

export function validPayPalOrderId(id){
  return typeof id==='string' && /^[A-Z0-9]{10,36}$/.test(id);
}

export function paypalApprovalUrl(links,mode){
  if(!Array.isArray(links))throw new RangeError('PayPal 未提供付款核准連結');
  const link=links.find(x=>x.rel==='payer-action')||links.find(x=>x.rel==='approve');
  if(typeof link?.href!=='string')throw new RangeError('PayPal 缺少付款核准網址');
  const u=new URL(link.href);
  const host=mode==='live'?'www.paypal.com':'www.sandbox.paypal.com';
  if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password||u.port||
      !/^\/checkoutnow\/?$/.test(u.pathname)||!validPayPalOrderId(u.searchParams.get('token')) ||
      u.hash||u.searchParams.get('token')!==u.searchParams.getAll('token')[0])
    throw new RangeError('PayPal 付款核准連結未通過安全檢查');
  return u.href;
}

export function buildPayPalOrder({orderId,quote,publicSiteUrl}){
  const amount=checkoutAmountCents(quote);
  const origin=new URL(publicSiteUrl);
  if(!((origin.protocol==='https:')||(origin.protocol==='http:'&&
    ['localhost','127.0.0.1'].includes(origin.hostname)))||
    origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)
    throw new RangeError('PayPal 回傳網址必須係安全網站根目錄');
  const value=(amount/100).toFixed(2);
  const fingerprint=quoteHash(orderId,quote);
  const payload={
    intent:'CAPTURE',
    purchase_units:[{
      reference_id:orderId,
      custom_id:orderId,
      description:'LUMENDA SELECT order '+orderId,
      amount:{currency_code:'HKD',value}
    }],
    payment_source:{paypal:{experience_context:{
      user_action:'PAY_NOW',
      shipping_preference:'GET_FROM_FILE',
      return_url:new URL('/order?payment=paypal-return',origin).href,
      cancel_url:new URL('/order?payment=paypal-cancel',origin).href
    }}}
  };
  return {payload,amountCents:amount,quoteFingerprint:fingerprint};
}

export function validCapturedPayPalOrder(paypalOrder,{orderId,paypalOrderId,quote}){
  if(!validPayPalOrderId(paypalOrderId)||paypalOrder?.id!==paypalOrderId||
     paypalOrder.status!=='COMPLETED'||paypalOrder.intent!=='CAPTURE')return null;
  const units=paypalOrder.purchase_units;
  if(!Array.isArray(units)||units.length!==1)return null;
  const pu=units[0];
  if(pu.reference_id!==orderId||pu.custom_id!==orderId)return null;
  const expected=checkoutAmountCents(quote);
  if(pu.amount &&(pu.amount.currency_code!=='HKD'||hkdCents(pu.amount.value)!==expected))return null;
  const captures=pu.payments?.captures;
  if(!Array.isArray(captures)||captures.length!==1)return null;
  const capture=captures[0];
  if(capture.status!=='COMPLETED'||
     !/^[A-Z0-9]{8,36}$/.test(capture.id||'')||
     capture.amount?.currency_code!=='HKD'||
     hkdCents(capture.amount?.value)!==expected)return null;
  return {captureId:capture.id,amountCents:expected};
}

export function paypalWebhookFields(event,headers,webhookId,nowMs=Date.now()){
  if(!event||typeof event!=='object'||typeof event.id!=='string'||
    !/^WH-[A-Z0-9-]{8,}$/.test(event.id)||
    typeof event.event_type!=='string')throw new Error('PayPal webhook event invalid');
  const get=k=>String(headers.get(k)||'').trim();
  const transmissionId=get('paypal-transmission-id');
  const time=get('paypal-transmission-time');
  const signature=get('paypal-transmission-sig');
  const algorithm=get('paypal-auth-algo');
  const cert=get('paypal-cert-url');
  const parsed=Date.parse(time);
  if(!transmissionId||transmissionId.length>128||
    !Number.isFinite(parsed)||Math.abs(nowMs-parsed)>300000||
    signature.length<40||signature.length>2048||
    algorithm!=='SHA256withRSA'||!webhookId||webhookId.length>100)
    throw new Error('PayPal webhook signature metadata invalid');
  const certUrl=new URL(cert);
  if(certUrl.protocol!=='https:'||
    !['api-m.paypal.com','api-m.sandbox.paypal.com','api.paypal.com','api.sandbox.paypal.com'].includes(certUrl.hostname)||
    certUrl.username||certUrl.password||certUrl.port)
    throw new Error('PayPal webhook certificate URL invalid');
  return {
    transmission_id:transmissionId,
    transmission_time:time,
    cert_url:cert,
    auth_algo:algorithm,
    transmission_sig:signature,
    webhook_id:webhookId,
    webhook_event:event
  };
}
