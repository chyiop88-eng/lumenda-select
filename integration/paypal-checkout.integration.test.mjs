import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as wait} from 'node:timers/promises';

const base='http://127.0.0.1:31985',gatewayPort=31986;
const username='paypal-test-owner',password='checkout-isolated-owner-password-123456';
const secret='isolated-checkout-secret-12345678901234567890';
const webhookId='WHOOKTEST12345';
const records=new Map();
let server,gateway,cookie='',created=0,n=0;

const j=(data,extra={})=>({headers:{'content-type':'application/json',
  'x-forwarded-for':'203.0.113.'+((++n%245)+10),...extra},body:JSON.stringify(data)});
async function api(path,options={}){
  const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(12000)});
  let result={};try{result=await response.json();}catch{}
  return {status:response.status,body:result,headers:response.headers};
}
function toPayPalRecord(record){
  return {
    id:record.id,intent:'CAPTURE',
    status:record.captured?'COMPLETED':record.approved?'APPROVED':'PAYER_ACTION_REQUIRED',
    purchase_units:[{
      reference_id:record.payload.purchase_units[0].reference_id,
      custom_id:record.payload.purchase_units[0].custom_id,
      amount:record.payload.purchase_units[0].amount,
      payments:record.captured?{captures:[{
        id:record.captureId,status:'COMPLETED',
        amount:{currency_code:'HKD',value:record.captureAmount||record.payload.purchase_units[0].amount.value}
      }]}:{captures:[]}
    }]
  };
}
function readJSON(req){
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',b=>raw+=b.toString());
    req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch(e){reject(e);}});
    req.on('error',reject);
  });
}
async function stubPayPal(req,res){
  try{
    const send=(code,payload)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(payload));};
    if(req.url==='/v1/oauth2/token'&&req.method==='POST')
      return send(200,{access_token:'stub_paypal_access_token_isolated_abcdef',expires_in:3600});
    if(req.url==='/v2/checkout/orders'&&req.method==='POST'){
      const payload=await readJSON(req);
      assert.equal(payload.intent,'CAPTURE');
      assert.equal(payload.purchase_units[0].amount.currency_code,'HKD');
      const id='8G467899TT'+String(100000+ ++created);
      const rec={id,payload,approved:false,captured:false,
        captureId:'8MC585209K'+String(100000+created)};
      records.set(id,rec);
      return send(201,{id,status:'PAYER_ACTION_REQUIRED',
        links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token='+id}]});
    }
    const match=req.url?.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
    if(match){
      const rec=records.get(match[1]);
      if(!rec)return send(404,{name:'RESOURCE_NOT_FOUND'});
      if(req.method==='GET'&&!match[2])return send(200,toPayPalRecord(rec));
      if(req.method==='POST'&&match[2]){
        if(!rec.approved)return send(422,{name:'ORDER_NOT_APPROVED'});
        rec.captured=true;
        return send(201,toPayPalRecord(rec));
      }
    }
    if(req.url==='/v1/notifications/verify-webhook-signature'&&req.method==='POST'){
      const body=await readJSON(req);
      return send(200,{verification_status:
        body.webhook_id===webhookId && body.transmission_sig==='A'.repeat(160)?'SUCCESS':'FAILURE'});
    }
    return send(404,{name:'UNKNOWN_STUB_URL'});
  }catch(e){
    res.writeHead(500,{'content-type':'application/json'});
    res.end(JSON.stringify({error:String(e)}));
  }
}
async function submit(method='PAYPAL',qty=1){
  const order=await api('/api/orders',{method:'POST',...j({
    market:'HK',items:[{sku:'FTE230',qty}],customer:{
      name:'ISOLATED TEST CUSTOMER',phone:'91234567',
      email:'test-merchant@example.test',
      shipping:{region:'香港島',district:'中西區',address1:'Test Place 9',address2:''}
    },paymentMethod:method,otherPayment:'',deliverySpeed:'standard',
    deliveryNote:'',note:'DISPOSABLE TEST ONLY',consent:true,website:''
  })});
  assert.equal(order.status,201,JSON.stringify(order.body));
  return order.body;
}
async function quote(order,shipping='20',tax='5'){
  const sum=order.cart.pricedSubtotalHkd;
  const response=await api('/api/admin/orders/'+order.orderId+'/quote',{
    method:'POST',...j({subtotalHkd:String(sum),shippingHkd:shipping,taxHkd:tax,
      unitPricesHkd:{},paymentLink:''},{cookie})});
  assert.equal(response.status,200,JSON.stringify(response.body));
  return response.body.quote;
}
async function lookup(order){
  const found=await api('/api/order/lookup',{method:'POST',...j({token:order.receiptToken})});
  assert.equal(found.status,200,JSON.stringify(found.body));
  return found.body.order;
}
function webhookPayload(rec,sig='A'.repeat(160)){
  const event={id:'WH-ABCD1234EFGH5678',event_type:'PAYMENT.CAPTURE.COMPLETED',
    resource:{id:rec.captureId,supplementary_data:{related_ids:{order_id:rec.id}}}};
  return {method:'POST',headers:{
    'content-type':'application/json',
    'paypal-transmission-id':'TRANS1234567890',
    'paypal-transmission-time':new Date().toISOString(),
    'paypal-transmission-sig':sig,
    'paypal-auth-algo':'SHA256withRSA',
    'paypal-cert-url':'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT123'
  },body:JSON.stringify(event)};
}
before(async()=>{
  assert.ok(process.env.DATABASE_URL,'Must use disposable PostgreSQL DB');
  gateway=createServer(stubPayPal);
  await new Promise(resolve=>gateway.listen(gatewayPort,'127.0.0.1',resolve));
  server=spawn(process.execPath,['server.js'],{
    cwd:process.cwd(),env:{...process.env,
      NODE_ENV:'test',PORT:'31985',
      ADMIN_USERNAME:username,ADMIN_PASSWORD:password,ADMIN_SESSION_SECRET:secret,
      PAYPAL_MODE:'sandbox',PAYPAL_CHECKOUT_ENABLED:'true',
      PAYPAL_CLIENT_ID:'sandbox-client-identifier-123',
      PAYPAL_CLIENT_SECRET:'sandbox-secret-identifier-123',
      PAYPAL_WEBHOOK_ID:webhookId,
      PAYPAL_MOCK_BASE_URL:'http://127.0.0.1:'+gatewayPort+'/',
      PUBLIC_SITE_URL:base+'/',XAI_BOT_ENABLED:'false'
    },stdio:'pipe'
  });
  let ready=false;
  for(let i=0;i<90;i++){
    if(server.exitCode!==null)throw Error('Web server crashed');
    try{
      const r=await api('/api/admin/login',{method:'POST',...j({username,password})});
      if(r.status===200){
        cookie=r.headers.get('set-cookie')?.split(';')[0]||'';
        const check=await api('/api/admin/contacts',{headers:{cookie}});
        if(check.status===200){ready=true;break;}
      }
    }catch{}
    await wait(180);
  }
  assert.equal(ready,true,'Server and disposable DB must be ready');
});
after(async()=>{
  server?.kill('SIGTERM');
  if(gateway)await new Promise(resolve=>gateway.close(resolve));
});
test('realistic PayPal sandbox order: quote -> approve -> capture -> receipts',async()=>{
  const order=await submit();
  const official=await quote(order);
  assert.equal(official.subtotalHkd,899);
  assert.equal(official.totalHkd,924);
  const original=await lookup(order);
  assert.equal(original.paypalCheckoutAvailable,true);
  assert.equal(original.paypalMode,'sandbox');
  const create=await api('/api/order/paypal/create',{method:'POST',...j({token:order.receiptToken})});
  assert.equal(create.status,200,JSON.stringify(create.body));
  assert.equal(create.body.mode,'sandbox');
  assert.equal(create.body.provider,'paypal');
  const rec=records.get(new URL(create.body.url).searchParams.get('token'));
  assert.ok(rec,'Paypal mock must be issued');
  assert.equal(rec.payload.purchase_units[0].amount.value,'924.00');
  assert.equal(rec.payload.purchase_units[0].reference_id,order.orderId);
  const again=await api('/api/order/paypal/create',{method:'POST',...j({token:order.receiptToken})});
  assert.equal(again.status,200,JSON.stringify(again.body));
  assert.equal(again.body.url,create.body.url);
  assert.equal(created,1,'Double checkout must not create two PSP orders');
  const change=await api('/api/admin/orders/'+order.orderId+'/quote',{method:'POST',
    ...j({subtotalHkd:'900',shippingHkd:'0',taxHkd:'0'},{cookie})});
  assert.equal(change.status,400,'Price mismatch is rejected');
  const noCancel=await api('/api/orders/'+order.orderId,{method:'PATCH',...j({status:'cancelled'},{cookie})});
  assert.equal(noCancel.status,404,'Active PSP session cannot silently cancel');
  const beforeApproval=await api('/api/order/paypal/capture',{method:'POST',...j({token:order.receiptToken})});
  assert.equal(beforeApproval.status,409,'Unapproved PayPal order cannot capture');
  assert.equal((await lookup(order)).paidVerified,false);
  rec.approved=true;
  const captured=await api('/api/order/paypal/capture',{method:'POST',...j({token:order.receiptToken})});
  assert.equal(captured.status,200,JSON.stringify(captured.body));
  assert.equal(captured.body.verified,true);
  const dup=await api('/api/order/paypal/capture',{method:'POST',...j({token:order.receiptToken})});
  assert.equal(dup.status,200,JSON.stringify(dup.body));
  assert.equal(dup.body.duplicate,true);
  const paid=await lookup(order);
  assert.equal(paid.paidVerified,true);
  assert.equal(paid.paymentStatus,'paypal_paid');
  assert.equal(paid.paypalCheckoutAvailable,false);
  const apiOrders=await api('/api/orders',{headers:{cookie}});
  const saved=apiOrders.body.orders.find(x=>x.id===order.orderId);
  assert.equal(saved.quote.totalHkd,924);
  assert.equal(saved.cart_snapshot.pricedSubtotalHkd,899);
  assert.equal(saved.payment_reference,rec.captureId);
  const changedAfter=await api('/api/admin/orders/'+order.orderId+'/quote',{method:'POST',
    ...j({subtotalHkd:'899',shippingHkd:'0',taxHkd:'0'},{cookie})});
  assert.equal(changedAfter.status,409,'Paid quote remains immutable');
});
test('webhook must be verified with official PayPal API and fresh order amount',async()=>{
  const order=await submit('PAYPAL',2);
  const official=await quote(order,'90','10');
  assert.equal(official.totalHkd,1898);
  const created=await api('/api/order/paypal/create',{method:'POST',...j({token:order.receiptToken})});
  assert.equal(created.status,200,JSON.stringify(created.body));
  const rec=records.get(new URL(created.body.url).searchParams.get('token'));
  const invalid=await api('/api/payments/paypal/webhook',webhookPayload(rec,'B'.repeat(160)));
  assert.equal(invalid.status,401,'Forged signature must never mark paid');
  assert.equal((await lookup(order)).paidVerified,false);
  rec.approved=true;rec.captured=true;rec.captureAmount='1.00';
  const wrongAmount=await api('/api/payments/paypal/webhook',webhookPayload(rec));
  assert.equal(wrongAmount.status,409,'Even signed events need fresh PSP amount reconciliation');
  assert.equal((await lookup(order)).paidVerified,false);
  rec.captureAmount=null;
  const valid=await api('/api/payments/paypal/webhook',webhookPayload(rec));
  assert.equal(valid.status,200,JSON.stringify(valid.body));
  assert.equal(valid.body.verified,true);
  assert.equal((await lookup(order)).paymentStatus,'paypal_paid');
  const duplicated=await api('/api/payments/paypal/webhook',webhookPayload(rec));
  assert.equal(duplicated.status,200);
  assert.equal(duplicated.body.duplicate,true);
});
test('FPS and USDT are manual verified settlement, never fake checkout',async()=>{
  const fps=await submit('FPS');
  await quote(fps);
  const fpsCheck=await lookup(fps);
  assert.equal(fpsCheck.paymentPreference,'FPS');
  const wrongMethod=await api('/api/admin/orders/'+fps.orderId+'/payment',{method:'POST',
    ...j({confirmed:true,method:'USDT',network:'TRC20',transactionReference:'a'.repeat(64)},{cookie})});
  assert.equal(wrongMethod.status,409);
  const needsConfirm=await api('/api/admin/orders/'+fps.orderId+'/payment',{method:'POST',
    ...j({confirmed:false,method:'FPS',transactionReference:'FPS-TEST-123456'},{cookie})});
  assert.equal(needsConfirm.status,400);
  const goodFps=await api('/api/admin/orders/'+fps.orderId+'/payment',{method:'POST',
    ...j({confirmed:true,method:'FPS',transactionReference:'FPS-TEST-123456'},{cookie})});
  assert.equal(goodFps.status,200,JSON.stringify(goodFps.body));
  assert.equal((await lookup(fps)).paymentStatus,'owner_verified');

  const usdt=await submit('USDT');
  await quote(usdt);
  const invalidNetwork=await api('/api/admin/orders/'+usdt.orderId+'/payment',{method:'POST',
    ...j({confirmed:true,method:'USDT',network:'TRC21',transactionReference:'a'.repeat(64)},{cookie})});
  assert.equal(invalidNetwork.status,400);
  const goodUsdt=await api('/api/admin/orders/'+usdt.orderId+'/payment',{method:'POST',
    ...j({confirmed:true,method:'USDT',network:'TRC20',transactionReference:'a'.repeat(64)},{cookie})});
  assert.equal(goodUsdt.status,200,JSON.stringify(goodUsdt.body));
  assert.equal((await lookup(usdt)).paymentStatus,'owner_verified');
});
