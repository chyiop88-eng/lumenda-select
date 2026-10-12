import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
const base='http://127.0.0.1:31999';
const admin='owner-v13-test',pw='local-only-strong-password-123456',secret='local-only-owner-session-hmac-secret-12345678901234567890123';
let server,cookie='';
const j=(body,headers={})=>({headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
async function api(path,opts={}){
 const r=await fetch(base+path,{...opts,signal:AbortSignal.timeout(10000)});
 let payload={};try{payload=await r.json();}catch{}
 return {status:r.status,body:payload,headers:r.headers};
}
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Isolated PostgreSQL required');
 server=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,
   PORT:'31999',ADMIN_USERNAME:admin,ADMIN_PASSWORD:pw,ADMIN_SESSION_SECRET:secret,
   XAI_API_KEY:'',XAI_BOT_ENABLED:'false'},stdio:'pipe'});
 let started=false;
 for(let n=0;n<80;n++){
  if(server.exitCode!==null)throw Error('Server exited early');
  try{
   const r=await api('/api/admin/login',{method:'POST',...j({username:admin,password:pw})});
   if(r.status===200){
     cookie=r.headers.get('set-cookie').split(';')[0];
     const c=await api('/api/admin/contacts',{headers:{cookie}});
     if(c.status===200){started=true;break;}
   }
  }catch{}
  await wait(150);
 }
 assert.equal(started,true,'App and contact schema should be ready');
});
after(()=>server?.kill('SIGTERM'));
test('v13 CRM, bot, price, private receipt and payment confirmation lifecycle',async()=>{
 const auth={cookie};
 assert.equal((await api('/api/admin/contacts')).status,401);
 assert.equal((await api('/api/order/lookup',{method:'POST',...j({token:'not-a-valid-token'})})).status,400);
 const bot=await api('/api/bot/reply',{method:'POST',...j({message:'HK$4000 運費點計?',language:'zh-Hant'})});
 assert.equal(bot.status,200);assert.equal(bot.body.mode,'rules');assert.match(bot.body.reply,/HK\$4,000/);
 const privateBot=await api('/api/bot/reply',{method:'POST',...j({message:'我電話號碼91234567',language:'zh-Hant'})});
 assert.equal(privateBot.status,200);assert.match(privateBot.body.reply,/私隱/);
 const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/conciergeMessages/);
 for(const path of ['/bot.js','/order','/order.js']){
  const r=await fetch(base+path);assert.equal(r.status,200,path);
 }
 const products=await api('/api/health');assert.equal(products.body.uiVersion,'13.0.0');
 assert.deepEqual(products.body.featuredSKUs,['FTE230','GENOPTICS50']);
 assert.equal(products.body.shippingPolicy.freeShippingThresholdHKD,4000);
 assert.equal(products.body.paymentsLive,false);
 assert.equal(products.body.botMode,'rules');
 const sample={market:'HK',items:[{sku:'FTE230',qty:1}],customer:{
  name:'TEST CUSTOMER ONLY',phone:'91234567',email:'contact@example.test',
  shipping:{region:'香港島',district:'中西區',address1:'Example Street 2',address2:''}
 },paymentMethod:'FPS',otherPayment:'',deliverySpeed:'standard',deliveryNote:'',
  note:'DISPOSABLE DATABASE ONLY',consent:true,website:''};
 const res=await api('/api/orders',{method:'POST',...j(sample)});
 assert.equal(res.status,201,JSON.stringify(res.body));
 assert.match(res.body.receiptToken,/^[A-Za-z0-9_-]{43}$/);
 assert.match(res.body.botAcknowledgement,/收到/);
 const lookup=await api('/api/order/lookup',{method:'POST',...j({token:res.body.receiptToken})});
 assert.equal(lookup.status,200);assert.equal(lookup.body.order.id,res.body.orderId);
 assert.ok(!JSON.stringify(lookup.body).includes('91234567'),'Private receipt may not show PII');
 assert.equal(lookup.body.order.paidVerified,false);
 const contacts=await api('/api/admin/contacts?q=91234567',{headers:auth});
 assert.equal(contacts.status,200);assert.ok(contacts.body.contacts.some(c=>c.phone.includes('91234567')));
 const rows=await api('/api/orders',{headers:auth});
 assert.equal(rows.status,200);assert.ok(rows.body.orders.some(r=>r.id===res.body.orderId));
 const quoteURL='/api/admin/orders/'+res.body.orderId+'/quote';
 const adminOnly=await api(quoteURL,{method:'POST',...j({subtotalHkd:'3800',taxHkd:'20',shippingHkd:'70',paymentLink:'https://buy.stripe.com/example'})});
 assert.equal(adminOnly.status,401);
 const badLink=await api(quoteURL,{method:'POST',...j({subtotalHkd:'3800',taxHkd:'20',shippingHkd:'70',paymentLink:'https://example.com/scam'},auth)});
 assert.equal(badLink.status,400);
 const below=await api(quoteURL,{method:'POST',...j({subtotalHkd:'3800',taxHkd:'20',shippingHkd:'70',paymentLink:''},auth)});
 assert.equal(below.status,200,JSON.stringify(below.body));
 assert.equal(below.body.quote.totalHkd,3890);assert.equal(below.body.quote.freeShipping,false);
 const over=await api(quoteURL,{method:'POST',...j({subtotalHkd:'4000',taxHkd:'50',shippingHkd:'99',paymentLink:'https://buy.stripe.com/example'},auth)});
 assert.equal(over.status,200,JSON.stringify(over.body));
 assert.equal(over.body.quote.shippingHkd,0);assert.equal(over.body.quote.totalHkd,4050);
 assert.equal(over.body.paymentStatus,'link_ready');
 const updated=await api('/api/order/lookup',{method:'POST',...j({token:res.body.receiptToken})});
 assert.equal(updated.status,200);assert.equal(updated.body.order.paidVerified,false);
 assert.equal(updated.body.order.quote.totalHkd,4050);
 const pay='/api/admin/orders/'+res.body.orderId+'/payment';
 const notAllowed=await api(pay,{method:'POST',...j({confirmed:false,transactionReference:'ABCDEF'},auth)});
 assert.equal(notAllowed.status,400);
 const unauthorizedPay=await api(pay,{method:'POST',...j({confirmed:true,transactionReference:'ABCDEF'})});
 assert.equal(unauthorizedPay.status,401);
 const verified=await api(pay,{method:'POST',...j({confirmed:true,transactionReference:'TEST_TRANSACTION_NOT_REAL'},auth)});
 assert.equal(verified.status,200);
 const final=await api('/api/order/lookup',{method:'POST',...j({token:res.body.receiptToken})});
 assert.equal(final.body.order.paidVerified,true);
 console.log('OWNER_V13_INTEGRATION_PASS CRMPHONE=true BOT=rules RECEIPT=private QUOTE_HKD4000=true PAYMENT=owner-verification-only');
});
