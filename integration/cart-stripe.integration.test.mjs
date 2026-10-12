import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
const base='http://127.0.0.1:31998',mockPort=31997;
const admin='checkout-test-owner',password='test-local-only-owner-password-123456',secret='test-local-session-secret-12345678901234567890123456';
const webhookSecret='whsec_checkout_integration_dummy';
let server,mock,cookie='',created=[];
const req=(data,headers={})=>({headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
async function api(path,opt={}){
  const res=await fetch(base+path,{...opt,signal:AbortSignal.timeout(9000)});
  let body={};try{body=await res.json();}catch{}
  return {status:res.status,body,headers:res.headers};
}
async function order(items){
  const body={
    market:'HK',items,customer:{name:'AUTOMATED TEST ONLY',phone:'91234567',
      email:'checkout@example.test',shipping:{region:'香港島',district:'中西區',address1:'Test Road 1',address2:''}},
    paymentMethod:'FPS',otherPayment:'',deliverySpeed:'standard',deliveryNote:'',
    note:'ISOLATED POSTGRES TEST ONLY',consent:true,website:''
  };
  const response=await api('/api/orders',{method:'POST',...req(body)});
  assert.equal(response.status,201,JSON.stringify(response.body));return response.body;
}
function stripeEvent(session,overrides={},type='checkout.session.completed'){
 const timestamp=Math.floor(Date.now()/1000);
 const event={id:'evt_test_'+timestamp+'_'+Math.random().toString(16).slice(2),type,
   data:{object:{...session,...overrides}}};
 const raw=JSON.stringify(event);
 const signature=createHmac('sha256',webhookSecret).update(timestamp+'.'+raw).digest('hex');
 return {headers:{'stripe-signature':'t='+timestamp+',v1='+signature,'content-type':'application/json'},
   body:raw};
}
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Use isolated PostgreSQL only');
 mock=createServer(async(req0,res)=>{
   if(req0.url!=='/v1/checkout/sessions'||req0.method!=='POST'){res.writeHead(404);return res.end();}
   let content='';for await(const chunk of req0)content+=chunk.toString();
   const p=new URLSearchParams(content),id='cs_test_checkout_'+String(created.length+1);
   const session={
     id,object:'checkout.session',url:'https://checkout.stripe.com/c/pay/'+id,
     client_reference_id:p.get('client_reference_id'),mode:p.get('mode'),currency:'hkd',
     amount_total:Number(p.get('line_items[0][price_data][unit_amount]')),
     metadata:{order_id:p.get('metadata[order_id]'),quote_hash:p.get('metadata[quote_hash]')},
     payment_status:'unpaid',livemode:false,status:'open',
     expires_at:Math.floor(Date.now()/1000)+3600,payment_intent:'pi_local_testing_only'
   };
   created.push({session,p});
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(session));
 });
 await new Promise(r=>mock.listen(mockPort,'127.0.0.1',r));
 server=spawn(process.execPath,['server.js'],{cwd:process.cwd(),
   env:{...process.env,NODE_ENV:'test',PORT:'31998',ADMIN_USERNAME:admin,ADMIN_PASSWORD:password,
     ADMIN_SESSION_SECRET:secret,STRIPE_MODE:'test',STRIPE_CHECKOUT_ENABLED:'true',
     STRIPE_SECRET_KEY:'sk_test_not_real_12345',STRIPE_WEBHOOK_SECRET:webhookSecret,
     STRIPE_MOCK_BASE_URL:'http://127.0.0.1:'+mockPort,PUBLIC_SITE_URL:base+'/',
     XAI_BOT_ENABLED:'false'},stdio:'pipe'});
 let ready=false;
 for(let i=0;i<80;i++){
   if(server.exitCode!==null)throw Error('App exited before tests');
   try{
     const res=await api('/api/admin/login',{method:'POST',...req({username:admin,password})});
     if(res.status===200){cookie=res.headers.get('set-cookie').split(';')[0];ready=true;break;}
   }catch{}
   await wait(150);
 }
 assert.ok(ready,'App, Postgres and admin login must be ready');
});
after(async()=>{server?.kill('SIGTERM');if(mock)await new Promise(r=>mock.close(r));});
test('verified cart -> persisted order -> strict quote -> gateway -> signed webhook -> paid',async()=>{
 const r=await order([{sku:'FTE230',qty:1}]);
 assert.equal(r.cart.pricedSubtotalHkd,899);
 assert.equal(r.cart.lines[0].lineSubtotalHkd,899);
 const id=r.orderId,quoteUrl='/api/admin/orders/'+id+'/quote';
 const list=await api('/api/orders',{headers:{cookie}});
 assert.equal(list.status,200);
 const row=list.body.orders.find(x=>x.id===id);
 assert.equal(row.cart_snapshot.pricedSubtotalHkd,899);
 const bad=await api(quoteUrl,{method:'POST',...req({subtotalHkd:'4000',shippingHkd:'0',taxHkd:'0'},{cookie})});
 assert.equal(bad.status,400,JSON.stringify(bad.body));
 const good=await api(quoteUrl,{method:'POST',...req({
   subtotalHkd:'899',shippingHkd:'35',taxHkd:'20',paymentLink:'',unitPricesHkd:{}
 },{cookie})});
 assert.equal(good.status,200,JSON.stringify(good.body));
 assert.equal(good.body.quote.totalHkd,954);
 assert.equal(good.body.quote.subtotalHkd,899);
 const lookup=await api('/api/order/lookup',{method:'POST',...req({token:r.receiptToken})});
 assert.equal(lookup.body.order.quote.totalHkd,954);
 assert.equal(lookup.body.order.stripeCheckoutAvailable,true);
 assert.ok(!JSON.stringify(lookup.body).includes('91234567'),'Never disclose customer PII in receipt');
 const checkout=await api('/api/order/checkout',{method:'POST',...req({token:r.receiptToken})});
 assert.equal(checkout.status,200,JSON.stringify(checkout.body));
 assert.match(checkout.body.url,/^https:\/\/checkout\.stripe\.com\//);
 assert.equal(created.at(-1).session.amount_total,95400);
 assert.equal(created.at(-1).p.get('line_items[0][price_data][currency]'),'hkd');
 assert.equal(created.at(-1).p.get('client_reference_id'),id);
 const repeat=await api('/api/order/checkout',{method:'POST',...req({token:r.receiptToken})});
 assert.equal(repeat.status,200);assert.equal(repeat.body.url,checkout.body.url);
 assert.equal(created.length,1,'Double-click must not create another live Checkout Session');
 const forged=await api('/api/payments/stripe/webhook',{method:'POST',headers:{'stripe-signature':'t=1111111111,v1=bad','content-type':'application/json'},body:'{}'});
 assert.equal(forged.status,400);
 const fakePaid={...created[0].session,payment_status:'paid',status:'complete'};
 const mismatched=await api('/api/payments/stripe/webhook',{method:'POST',
   ...stripeEvent(fakePaid,{amount_total:1})});
 assert.equal(mismatched.status,409,'Signed but incorrect charge amount must not mark paid');
 const beforePaid=await api('/api/order/lookup',{method:'POST',...req({token:r.receiptToken})});
 assert.equal(beforePaid.body.order.paidVerified,false);
 const verified=await api('/api/payments/stripe/webhook',{method:'POST',...stripeEvent(fakePaid)});
 assert.equal(verified.status,200,JSON.stringify(verified.body));assert.equal(verified.body.verified,true);
 const duplicate=await api('/api/payments/stripe/webhook',{method:'POST',...stripeEvent(fakePaid)});
 assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);
 const afterPaid=await api('/api/order/lookup',{method:'POST',...req({token:r.receiptToken})});
 assert.equal(afterPaid.body.order.paidVerified,true);
 assert.equal(afterPaid.body.order.paymentStatus,'stripe_paid');
 assert.equal(afterPaid.body.order.stripeCheckoutAvailable,false);
 const change=await api(quoteUrl,{method:'POST',...req({subtotalHkd:'899',shippingHkd:'0',taxHkd:'0'},{cookie})});
 assert.equal(change.status,409);
 const noDouble=await api('/api/order/checkout',{method:'POST',...req({token:r.receiptToken})});
 assert.equal(noDouble.status,409);
 const adminList=await api('/api/orders',{headers:{cookie}});
 const persisted=adminList.body.orders.find(x=>x.id===id);
 assert.equal(persisted.payment_status,'stripe_paid');
 assert.equal(persisted.quote.totalHkd,954);
 assert.equal(persisted.cart_snapshot.pricedSubtotalHkd,899);
});
test('HK$4000 free shipping, and unknown SKU requires unit quote',async()=>{
 const five=await order([{sku:'FTE230',qty:5}]);
 const full=await api('/api/admin/orders/'+five.orderId+'/quote',{method:'POST',
  ...req({subtotalHkd:'4495',shippingHkd:'90',taxHkd:'5'}, {cookie})});
 assert.equal(full.status,200);assert.equal(full.body.quote.shippingHkd,0);
 assert.equal(full.body.quote.totalHkd,4500);
 const unknown=await order([{sku:'FTE230',qty:1},{sku:'GENOPTICS50',qty:2}]);
 const invalid=await api('/api/admin/orders/'+unknown.orderId+'/quote',{method:'POST',
   ...req({subtotalHkd:'899',shippingHkd:'0',taxHkd:'0'}, {cookie})});
 assert.equal(invalid.status,400);
 const valid=await api('/api/admin/orders/'+unknown.orderId+'/quote',{method:'POST',
   ...req({subtotalHkd:'3899',unitPricesHkd:{GENOPTICS50:'1500'},shippingHkd:'50',taxHkd:'10'}, {cookie})});
 assert.equal(valid.status,200,JSON.stringify(valid.body));
 assert.equal(valid.body.quote.totalHkd,3959);
 assert.equal(valid.body.quote.lines[1].unitPriceHkd,1500);
});
