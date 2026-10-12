import postgres from 'postgres';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { timingSafeEqual, randomBytes, createHash, createHmac } from 'node:crypto';
// Generated build inserts the exact frontend files and server-side market rules.
const ROOT=dirname(fileURLToPath(import.meta.url));
const STATIC_FILES={
  '/index.html':'text/html; charset=utf-8', '/admin.html':'text/html; charset=utf-8',
  '/styles.css':'text/css; charset=utf-8','/app.js':'text/javascript; charset=utf-8',
  '/i18n.js':'text/javascript; charset=utf-8','/admin.js':'text/javascript; charset=utf-8','/bot.js':'text/javascript; charset=utf-8','/order.js':'text/javascript; charset=utf-8','/order.html':'text/html; charset=utf-8','/lumenda-favicon.png':'image/png'
};
const MARKETS = JSON.parse(readFileSync(join(ROOT, 'config', 'markets.json'), 'utf8'));
const PRODUCTS = JSON.parse(readFileSync(join(ROOT, 'config', 'products.json'), 'utf8'));
const SHIPPING_POLICY = Object.freeze({ currency: 'HKD', freeShippingThresholdHKD: 4000, qualifyingAmount: 'seller_confirmed_merchandise_subtotal', shippingBelowThreshold: 'quote_by_destination', applicableTaxes: 'quoted_separately', eligibility: 'pending_quote' });
const HD_MEDIA = {
  '/campaign-facial-treatment-essence-hd-v7.webp': 'hd-art/fte-q94.webp',
  '/campaign-genoptics-aura-essence-hd-v7.webp': 'hd-art/aura-q94.webp'
};
const HD_CACHE = new Map();
function getHDImage(path){
  const relative=HD_MEDIA[path]; if (!relative)return null;
  if (HD_CACHE.has(path))return HD_CACHE.get(path);
  try {const data=readFileSync(join(ROOT,'public',relative));HD_CACHE.set(path,data);return data;}
  catch(e){console.error('Campaign image failed',e?.message);return null;}
}
function serveHD(path,method){
  if(!Object.hasOwn(HD_MEDIA,path))return null;
  const data=getHDImage(path);
  if(!data)return new Response('Campaign image unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
  return new Response(method==='HEAD'?null:data,{headers:{'Content-Type':'image/webp','Content-Length':String(data.length),'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
}

const DB = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { max: 4, idle_timeout: 20 }) : null;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || '';
const ADMIN_SESSION_SECONDS = 8*60*60;
let initPromise;
let mediaInitPromise;
function ensureTable() {
  if (!DB) throw new Error('Database not configured');
  if (!initPromise) {
    initPromise = (async()=>{
      await DB`CREATE TABLE IF NOT EXISTS lumenda_orders (
        id text PRIMARY KEY, created_at timestamptz DEFAULT now(), status text NOT NULL,
        market text NOT NULL, customer jsonb NOT NULL, items jsonb NOT NULL, note text
      )`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS referral_code text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS receipt_token_hash text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS quote jsonb`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_requested'`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS payment_reference text`;
      await DB`CREATE UNIQUE INDEX IF NOT EXISTS lumenda_orders_receipt_token_hash_uidx ON lumenda_orders(receipt_token_hash)`;
    })().catch(error => { initPromise = null; throw error; });
  }
  return initPromise;
}
function ensureMediaTable(){
  if(!DB)throw new Error('Database not configured');
  if(!mediaInitPromise) mediaInitPromise=DB`CREATE TABLE IF NOT EXISTS lumenda_media (
    key text PRIMARY KEY, mime text NOT NULL, data bytea NOT NULL, updated_at timestamptz DEFAULT now()
  )`.catch(error=>{mediaInitPromise=null;throw error;});
  return mediaInitPromise;
}
// Agent/referrer share links are public codes, never owner credentials.

const SHOWCASE_SLOTS=Object.freeze(['brand','fte','aura']);
let showcaseInitPromise;
function ensureShowcaseTable(){
  if(!DB)throw new Error('Database not configured');
  if(!showcaseInitPromise)showcaseInitPromise=DB`CREATE TABLE IF NOT EXISTS lumenda_showcase_media (
    slot text PRIMARY KEY CHECK (slot IN ('brand','fte','aura')),
    kind text NOT NULL CHECK (kind IN ('video','motion')),
    provider text NOT NULL CHECK (provider IN ('file','youtube','vimeo','image','none')),
    url text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`.catch(e=>{showcaseInitPromise=null;throw e;});
  return showcaseInitPromise;
}
// Links only, never media uploaded to ephemeral Render disk.
// Canonical URL processing prevents javascript:, http:, credentials and local targets.
function normalizeShowcaseUrl(raw,kind){
  const source=String(raw??'').trim();
  if(!['video','motion'].includes(kind))err('請選擇影片或動態圖片',400);
  if(!source)return {url:'',provider:'none'};
  if(source.length>1200)err('影片網址過長',400);
  let u;try{u=new URL(source);}catch{err('請輸入有效 HTTPS 影片網址',400);}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)err('只接受無帳密嘅 HTTPS 網址',400);
  const host=u.hostname.toLowerCase();
  if(!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.invalid')||/^[0-9.]+$/.test(host)||host.includes(':'))err('唔接受內部或無效主機網址',400);
  if(kind==='motion'){
    if(!/\.(?:gif|webp|apng)$/i.test(u.pathname))err('動態圖片只支援 GIF、Animated WebP 或 APNG HTTPS 直鏈',400);
    return {url:u.href,provider:'image'};
  }
  if(/\.(?:mp4|webm)$/i.test(u.pathname))return {url:u.href,provider:'file'};
  let id;
  if(['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be','www.youtube-nocookie.com'].includes(host)){
    if(host==='youtu.be'||host==='www.youtu.be')id=u.pathname.split('/')[1];
    else if(u.pathname==='/watch')id=u.searchParams.get('v');
    else if(/^\/(?:shorts|embed)\//.test(u.pathname))id=u.pathname.split('/')[2];
    if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))err('YouTube 影片 ID 無效',400);
    return {url:'https://www.youtube-nocookie.com/embed/'+id,provider:'youtube'};
  }
  if(['vimeo.com','www.vimeo.com','player.vimeo.com'].includes(host)){
    const matched=(host==='player.vimeo.com'?u.pathname.match(/^\/video\/(\d+)\/?$/):u.pathname.match(/^\/(\d+)\/?$/));
    if(!matched)err('Vimeo 影片網址無效',400);
    return {url:'https://player.vimeo.com/video/'+matched[1],provider:'vimeo'};
  }
  err('請提供 MP4/WebM、YouTube 或 Vimeo 影片網址',400);
}
function emptyShowcase(){return Object.fromEntries(SHOWCASE_SLOTS.map(slot=>[slot,null]));}

const AGENT_CODE_PATTERN=/^(AG|RF)[A-F0-9]{14}$/;
let agentsInitPromise;
function ensureAgentsTable(){
  if(!DB)throw new Error('Database not configured');
  if(!agentsInitPromise) agentsInitPromise=DB`CREATE TABLE IF NOT EXISTS lumenda_agents (
    code text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('agent','referrer')),
    parent_code text REFERENCES lumenda_agents(code),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    created_at timestamptz NOT NULL DEFAULT now()
  )`.catch(e=>{agentsInitPromise=null;throw e;});
  return agentsInitPromise;
}
async function activeReferralCode(value){
  const code=clean(value,24).toUpperCase();
  if(!AGENT_CODE_PATTERN.test(code))return null;
  await ensureAgentsTable();
  const rows=await DB`SELECT code FROM lumenda_agents WHERE code=${code} AND status='active' LIMIT 1`;
  return rows[0]?.code||null;
}
async function serveMedia(key,method){
  try{await ensureMediaTable();const rows=await DB`SELECT mime,data,updated_at FROM lumenda_media WHERE key=${key} LIMIT 1`;if(rows.length){const data=rows[0].data;return new Response(method==='HEAD'?null:data,{headers:{'Content-Type':rows[0].mime,'Content-Length':String(data.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex,nofollow'}});}}catch(e){console.error('Media read failed',e?.message);}
  const fallback=key==='fte'?'/campaign-facial-treatment-essence-hd-v7.webp':'/campaign-genoptics-aura-essence-hd-v7.webp';
  return serveHD(fallback,method);
}
const send = (obj, status=200) => Response.json(obj, {status, headers: {
  'Cache-Control':'no-store','X-Robots-Tag':'noindex,nofollow','X-Content-Type-Options':'nosniff'
}});
function err(msg, status) { const e=new Error(msg);e.status=status;throw e; }
function clean(v,max=150) { return String(v??'').replace(/[<>]/g,'').trim().slice(0,max); }
function safeEqual(a,b){
  a=String(a??'');b=String(b??'');
  const x=Buffer.from(a,'utf8'),y=Buffer.from(b,'utf8');
  if(x.length!==y.length)return false;
  return timingSafeEqual(x,y);
}
function adminToken(exp,nonce){
  const payload=ADMIN_USERNAME+'|'+exp+'|'+nonce;
  const sig=createHmac('sha256',ADMIN_SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(payload+'|'+sig).toString('base64url');
}
function validAdmin(req){
  if(!ADMIN_USERNAME||ADMIN_PASSWORD.length<16||ADMIN_SESSION_SECRET.length<32)return false;
  const cookies=req.headers.get('cookie')||'';
  const raw=cookies.split(';').map(x=>x.trim()).find(x=>x.startsWith('lumenda_admin='));
  if(!raw)return false;
  try{
    const decoded=Buffer.from(raw.slice('lumenda_admin='.length),'base64url').toString('utf8');
    const parts=decoded.split('|');if(parts.length!==4)return false;
    const [user,exp,nonce,sig]=parts;
    if(!safeEqual(user,ADMIN_USERNAME)||!/^\d+$/.test(exp)||Number(exp)<Math.floor(Date.now()/1000))return false;
    const expected=createHmac('sha256',ADMIN_SESSION_SECRET).update(user+'|'+exp+'|'+nonce).digest('hex');
    return safeEqual(sig,expected);
  }catch{return false;}
}
const adminAttempts=new Map();
function adminLoginLimited(req){
  const ip=(req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim().slice(0,100);
  const now=Date.now(),list=(adminAttempts.get(ip)||[]).filter(x=>x>now-15*60*1000);
  if(list.length>=8)return true;list.push(now);adminAttempts.set(ip,list);if(adminAttempts.size>5000)adminAttempts.clear();return false;
}
async function parseJSON(req) {
  const text = await req.text();
  if (text.length>22000) err('Payload too large', 413);
  try { return JSON.parse(text); } catch { err('Invalid JSON',400); }
}
function validateOrder(body) {
  const market=clean(body.market,4),m=MARKETS[market];
  if (!Object.hasOwn(MARKETS,market)) err('請選擇有效收件地區',400);
  if (!body.consent) err('需要同意訂單資料用途',400);
  if (body.website) err('Invalid order',400);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length>20) err('請選擇有效商品',400);
  const skus=new Set(PRODUCTS.map(p=>p.sku)), seen=new Set();
  const items=body.items.map(item=>({sku:clean(item.sku,40),qty:Number(item.qty)}));
  for(const item of items) {
    if(!skus.has(item.sku)||seen.has(item.sku)||!Number.isInteger(item.qty)||item.qty<1||item.qty>30) err('購物車數量或商品無效',400);
    seen.add(item.sku);
  }
  const person=body.customer||{};
  const name=clean(person.name,100),phone=clean(person.phone,30),email=clean(person.email,140);
  const phoneDigits=phone.replace(/[^0-9]/g,'');
  if(!name || !phoneDigits || phoneDigits.length<7 || phoneDigits.length>14) err('請填完整姓名及有效手機號碼',400);
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err('電郵格式不正確',400);
  const phoneIntl=m.dial + phoneDigits.replace(/^0+/,'');
  if(!/^\+[1-9][0-9]{7,14}$/.test(phoneIntl)) err('國際電話號碼不正確',400);
  if(market==='HK' && phoneDigits.length!==8) err('香港電話通常需要 8 位數',400);
  if(market==='CN' && !/^1[0-9]{10}$/.test(phoneDigits)) err('中國大陸手機需要 11 位數',400);
  const shippingRaw=person.shipping||{};
  const shipping={};
  for(const field of m.addressFields) {
    const value=clean(shippingRaw[field.key],250);
    if(field.required&&!value) err('請填寫 '+field.label,400);
    if(field.options&&value&&!field.options.includes(value)) err('請選擇有效'+field.label,400);
    shipping[field.key]=value;
  }
  const postcode=clean(shippingRaw.postcode,12);
  if(m.postcode?.required && !postcode) err('請填郵遞區號',400);
  if(m.postcode?.pattern && !new RegExp(m.postcode.pattern).test(postcode)) err('郵遞區號格式不正確',400);
  shipping.postcode=postcode;
  const paymentMethod=clean(body.paymentMethod,10);
  if(!m.payments.includes(paymentMethod)) err('此市場未開放你選擇嘅付款查詢方式',400);
  const otherPayment=clean(body.otherPayment,200);
  if(paymentMethod==='OTHER'&&!otherPayment) err('請描述希望使用嘅其他付款方式',400);
  const deliverySpeed=clean(body.deliverySpeed,12);
  if(!['standard','express'].includes(deliverySpeed)) err('請選擇有效運送方式',400);
  const customer={name,phone,phoneIntl,email,company:clean(person.company,120),
    contactMethod:clean(person.contactMethod,30),contactId:clean(person.contactId,100),
    shipping,paymentMethod,otherPayment,deliverySpeed,deliveryNote:clean(body.deliveryNote,300),shippingPolicy:{...SHIPPING_POLICY,freeShippingEligible:null}};
  return {market,items,customer,note:clean(body.note,500),referralCandidate:clean(body.referralCode,24)};
}
// Basic in-memory burst limiter. For serious production traffic add managed protection.
const attempts=new Map();
function limit(req) {
  const ip=(req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim().slice(0,100);
  const now=Date.now();const list=(attempts.get(ip)||[]).filter(x=>x>now-900000);
  if (list.length>=8) return true;
  list.push(now);attempts.set(ip,list);
  if(attempts.size>10000)attempts.clear();
  return false;
}
function serveFile(path, method) {
  if(path==='/admin'||path==='/admin/') path='/admin.html';
  if(path==='/order'||path==='/order/')path='/order.html';
  if(path==='/')path='/index.html';
  const mime=STATIC_FILES[path];if(!mime)return null;
  try{
    const content=readFileSync(join(ROOT,'public',path.slice(1)));
    return new Response(method==='HEAD'?null:content,{headers:{
      'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'X-Frame-Options':'DENY','X-Robots-Tag':'noindex,nofollow',
      'Referrer-Policy':'strict-origin-when-cross-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    }});
  }catch(e){console.error('Static file unavailable',e?.message);return new Response('Not found',{status:404});}
}
// Disallow cross-origin mutation requests to authenticated endpoints.
function validAdminOrigin(req){
  const origin=req.headers.get('origin');
  return !origin||origin===new URL(req.url).origin;
}
function validImageBytes(data,mime){
  const a=new Uint8Array(data);
  if(mime==='image/png')return a.length>8&&a.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]);
  if(mime==='image/jpeg')return a.length>3&&a[0]===255&&a[1]===216&&a[2]===255;
  return mime==='image/webp'&&a.length>12&&Buffer.from(a.subarray(0,4)).toString()==='RIFF'&&Buffer.from(a.subarray(8,12)).toString()==='WEBP';
}

// Storefront assistant only answers catalogue and policy questions; it never persists chat text.
const botAttempts=new Map();
function limitBot(req){
  const ip=(req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim().slice(0,80);
  const now=Date.now(),values=(botAttempts.get(ip)||[]).filter(v=>v>now-900000);
  if(values.length>=30)return true;
  values.push(now);botAttempts.set(ip,values);if(botAttempts.size>5000)botAttempts.clear();
  return false;
}
function ruleBotReply(message,lang){
  const q=message.toLowerCase(),en=lang==='en';
  if(/4000|4,000|免運|免邮|shipping|運費|运费|ขนส่ง|vận chuyển/i.test(q))
    return en?'From HK$4,000 of confirmed merchandise, shipping is free. Below this, shipping and destination taxes are quoted separately. Free shipping does not waive taxes.':'經確認商品小計滿 HK$4,000 免運費；未滿要按收件地另報運費及適用稅費。免運唔等於免稅。';
  if(/price|how much|價錢|价格|售價|giá|ราคา|多少|幾錢|多少钱/i.test(q))
    return en?'Product prices are not published. Please select Facial Treatment Essence or GenOptics Aura Essence and request a quote.':'神仙水同小燈泡暫時冇公開售價。請揀產品提交查詢，店主會核實庫存同正式價錢。';
  if(/付款|支付|pay|card|visa|master|paypal|fps|stripe|thanh toán|ชำระ/i.test(q))
    return en?'Enquiries never charge you. After a seller-confirmed quote, you may receive a Stripe or PayPal payment link in your private order page. Payment must be independently verified.':'提交查詢唔會扣款；店主確認報價後，可能喺私人訂單頁提供 Stripe／PayPal 收款連結。付款必須喺收款平台核實。';
  if(/order|訂單|订单|落單|đơn hàng|สั่งซื้อ|確認|confirm|进度/i.test(q))
    return en?'Choose one of the two SK-II products and submit the enquiry form. You will get a private tracking link and instant receipt acknowledgement; final acceptance requires seller confirmation.':'你可揀神仙水或小燈泡提交查詢。提交成功會收到私人訂單進度連結同「已收到」確認；店主先會確認實際訂單。';
  if(/agent|代理|介紹|介绍|referral|affiliate/i.test(q))
    return en?'A referrer can share a unique store link. This does not give anyone administrator access.':'代理／介紹人可以分享專屬連結，系統記錄介紹來源，但代理唔會有後台權限。';
  return en?'I can answer questions about two SK-II products, the HK$4,000 free-shipping rule and orders. Use the enquiry form for an accurate quote.':'你好！我可以答神仙水、小燈泡、HK$4,000 免運同訂單流程。價格、庫存同正式付款由店主確認。';
}
function moneyInCents(value,label){
  const v=String(value??'');
  if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(v))err(label+'請輸入最多兩位小數嘅港幣金額',400);
  const n=Math.round(Number(v)*100);
  if(!Number.isSafeInteger(n)||n<0||n>1000000000)err(label+'金額無效',400);
  return n;
}
function paymentProviderUrl(source){
  const text=String(source||'').trim();
  if(!text)return '';
  if(text.length>1200)err('付款連結過長',400);
  let u;try{u=new URL(text);}catch{err('付款連結格式無效',400);}
  if(u.protocol!=='https:'||u.username||u.password||u.port)err('只接受安全 HTTPS 付款連結',400);
  if(!['checkout.stripe.com','buy.stripe.com','www.paypal.com','paypal.com','paypal.me','www.paypal.me'].includes(u.hostname.toLowerCase()))
    err('只接受 Stripe 或 PayPal 官方付款連結',400);
  u.hash='';return u.href;
}

async function handle(req) {

  const path=new URL(req.url).pathname;
  if(path==='/api/health' && req.method==='GET')
    return send({ok:true,brand:'LUMENDA SELECT',mode:'order_enquiry',uiVersion:'13.0.0',shippingPolicy:SHIPPING_POLICY,featuredSKUs:PRODUCTS.map(p=>p.sku),hdCampaignsReady:Object.keys(HD_MEDIA).every(path=>!!getHDImage(path)),languages:['zh-Hant','zh-Hans','en','ms','vi','th'],ordersEnabled:!!DB,contactsEnabled:!!DB,receiptBotEnabled:!!DB,agentInvitesEnabled:!!DB,botMode:(process.env.XAI_API_KEY&&process.env.XAI_BOT_ENABLED==='true')?'grok':'rules',paymentLinksEnabled:!!DB,paymentsLive:false,shippingMarkets:Object.keys(MARKETS)});
  if(path==='/api/markets' && req.method==='GET')
    return send({markets:MARKETS,paymentMode:'enquiry_only',paymentsLive:false,shippingPolicy:SHIPPING_POLICY});

  if(path==='/api/showcase' && req.method==='GET'){
    const slots=emptyShowcase();
    try{
      await ensureShowcaseTable();
      const rows=await DB`SELECT slot,kind,provider,url FROM lumenda_showcase_media WHERE enabled=true AND url<>''`;
      for(const row of rows)if(Object.hasOwn(slots,row.slot))slots[row.slot]={kind:row.kind,provider:row.provider,url:row.url};
      return send({ok:true,slots});
    }catch(e){console.error('Public showcase unavailable',e?.code||e?.name);return send({ok:false,slots},503);}
  }
  if(path==='/api/admin/showcase' && req.method==='GET'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    try{
      await ensureShowcaseTable();
      const rows=await DB`SELECT slot,kind,provider,url,enabled,updated_at FROM lumenda_showcase_media ORDER BY slot`;
      return send({ok:true,media:rows});
    }catch(e){console.error('Showcase editor read failed',e?.code||e?.name);return send({ok:false,error:'影片設定暫時讀取失敗'},503);}
  }
  if(path.startsWith('/api/admin/showcase/')&&req.method==='POST'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    const slot=path.slice('/api/admin/showcase/'.length);
    if(!SHOWCASE_SLOTS.includes(slot))return send({ok:false,error:'無效影片位置'},400);
    try{
      const body=await parseJSON(req);
      const kind=String(body.kind||'video');
      if(typeof body.enabled!=='boolean')err('啟用狀態無效',400);
      const normalized=normalizeShowcaseUrl(body.url,kind);
      if(body.enabled&&!normalized.url)err('請先填入影片或動態圖片網址',400);
      await ensureShowcaseTable();
      const rows=await DB`INSERT INTO lumenda_showcase_media(slot,kind,provider,url,enabled,updated_at)
        VALUES(${slot},${kind},${normalized.provider},${normalized.url},${body.enabled},now())
        ON CONFLICT(slot) DO UPDATE SET kind=EXCLUDED.kind,provider=EXCLUDED.provider,url=EXCLUDED.url,enabled=EXCLUDED.enabled,updated_at=now()
        RETURNING slot,kind,provider,url,enabled,updated_at`;
      return send({ok:true,media:rows[0]});
    }catch(e){if(e.status)return send({ok:false,error:e.message},e.status);
      console.error('Showcase save failed',e?.code||e?.name);return send({ok:false,error:'影片設定暫時未能儲存'},503);}
  }


  // Existing submitted orders are the only source of the phone directory.
  if(path==='/api/admin/contacts' && req.method==='GET'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    try{
      await ensureTable();
      const params=new URL(req.url).searchParams;
      const q=clean(params.get('q')||'',36).replace(/[%_]/g,'');
      const page=Math.min(20000,Math.max(0,Number.parseInt(params.get('page')||'0',10)||0));
      const term='%'+q+'%';
      const rows=await DB`WITH grouped AS (
          SELECT phone,(array_agg(name ORDER BY created_at DESC))[1] AS name,
            (array_agg(market ORDER BY created_at DESC))[1] AS market,
            COUNT(*)::int AS order_count,MAX(created_at) AS last_seen_at
          FROM (
            SELECT COALESCE(NULLIF(customer->>'phoneIntl',''),NULLIF(customer->>'phone','')) AS phone,
              customer->>'name' AS name,market,created_at
            FROM lumenda_orders
          ) AS entries WHERE phone IS NOT NULL
          GROUP BY phone
        ) SELECT phone,name,market,order_count,last_seen_at FROM grouped
        WHERE phone ILIKE ${term} OR name ILIKE ${term}
        ORDER BY last_seen_at DESC LIMIT 51 OFFSET ${page*50}`;
      return send({ok:true,contacts:rows.slice(0,50),hasMore:rows.length>50,page,
        scope:'submitted_orders_only',marketingConsent:false});
    }catch(e){console.error('Phonebook unavailable',e?.code||e?.name);
      return send({ok:false,error:'電話通訊錄暫時未能讀取'},503);}
  }
  // A private, unguessable receipt token never includes addresses, names or phone numbers.
  if(path==='/api/order/lookup' && req.method==='POST'){
    try{
      const body=await parseJSON(req),token=String(body.token||'');
      if(!/^[A-Za-z0-9_-]{43}$/.test(token))err('私人訂單連結無效',400);
      await ensureTable();
      const hash=createHash('sha256').update(token).digest('hex');
      const rows=await DB`SELECT id,market,created_at,status,items,quote,payment_status,payment_verified_at
        FROM lumenda_orders WHERE receipt_token_hash=${hash} LIMIT 1`;
      if(!rows.length)return send({ok:false,error:'搵唔到呢張訂單'},404);
      const o=rows[0];
      return send({ok:true,order:{id:o.id,market:o.market,createdAt:o.created_at,
        status:o.status,items:o.items,quote:o.quote,paymentStatus:o.payment_status,
        paidVerified:!!o.payment_verified_at},
        botMessage:'已收到訂單查詢，店主稍後核實商品、運費、稅項同正式報價。'});
    }catch(e){if(e.status)return send({ok:false,error:e.message},e.status);
      console.error('Receipt lookup failed',e?.code||e?.name);
      return send({ok:false,error:'訂單進度暫時無法顯示'},503);}
  }


  // Owner enters actual quote; subtotal controls HK$4,000 free-shipping eligibility.
  // Stripe / PayPal links are owner-issued links only; redirects do not confirm payment.
  if(path.startsWith('/api/admin/orders/')&&path.endsWith('/quote')&&req.method==='POST'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    try{
      const id=path.slice('/api/admin/orders/'.length,-'/quote'.length);
      if(!/^LMD-[0-9]{8}-[A-Fa-f0-9]{10}$/.test(id))err('訂單編號無效',400);
      const body=await parseJSON(req);
      const subtotal=moneyInCents(body.subtotalHkd,'商品小計');
      const tax=moneyInCents(body.taxHkd,'適用稅費');
      const shipping=subtotal>=400000?0:moneyInCents(body.shippingHkd,'運費');
      if(subtotal<100)err('商品小計至少 HK$1',400);
      const total=subtotal+tax+shipping;
      if(total>1000000000)err('報價總額過高',400);
      const paymentLink=paymentProviderUrl(body.paymentLink||'');
      const quote={currency:'HKD',subtotalHkd:subtotal/100,shippingHkd:shipping/100,
        taxHkd:tax/100,totalHkd:total/100,freeShipping:subtotal>=400000,
        note:clean(body.note,280),paymentLink,quotedAt:new Date().toISOString()};
      await ensureTable();
      const updated=await DB`UPDATE lumenda_orders SET quote=${JSON.stringify(quote)}::jsonb,
        payment_status=${paymentLink?'link_ready':'not_requested'},
        payment_verified_at=NULL,payment_reference=NULL
        WHERE id=${id} AND status<>'cancelled'
        RETURNING id,quote,payment_status`;
      return send({ok:updated.length>0,quote:updated[0]?.quote,
        paymentStatus:updated[0]?.payment_status},updated.length?200:404);
    }catch(e){if(e.status)return send({ok:false,error:e.message},e.status);
      console.error('Seller quote unavailable',e?.code||e?.name);
      return send({ok:false,error:'正式報價暫時未能保存'},503);}
  }
  if(path.startsWith('/api/admin/orders/')&&path.endsWith('/payment')&&req.method==='POST'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    try{
      const id=path.slice('/api/admin/orders/'.length,-'/payment'.length);
      if(!/^LMD-[0-9]{8}-[A-Fa-f0-9]{10}$/.test(id))err('訂單編號無效',400);
      const body=await parseJSON(req);
      if(body.confirmed!==true)err('請先喺收款服務商後台核實入帳',400);
      const ref=clean(body.transactionReference,100);
      if(ref.length<6)err('請提供真實嘅付款交易參考編號',400);
      await ensureTable();
      const rows=await DB`UPDATE lumenda_orders SET payment_status='owner_verified',
        payment_verified_at=now(),payment_reference=${ref}
        WHERE id=${id} AND quote IS NOT NULL AND payment_status='link_ready'
        RETURNING id,payment_status`;
      return send({ok:rows.length>0,paymentStatus:rows[0]?.payment_status},rows.length?200:409);
    }catch(e){if(e.status)return send({ok:false,error:e.message},e.status);
      return send({ok:false,error:'付款核實暫時失敗'},503);}
  }


  // Website chat assistant. Grok API requires owner billing/API key, disabled by default.
  if(path==='/api/bot/reply' && req.method==='POST'){
    if(limitBot(req))return send({ok:false,error:'提問太密，請稍後再試'},429);
    try{
      const body=await parseJSON(req);
      const message=clean(body.message,500),lang=clean(body.language,10);
      if(message.length<2||message.length>350)err('每次請輸入 2 至 350 字',400);
      if(!['zh-Hant','zh-Hans','en','ms','vi','th'].includes(lang))err('語言選項無效',400);
      if(/(?:^|[^\d])\d[\d \-]{6,}\d|[^\s@]+@[^\s@]+\.[^\s@]+/.test(message))
        return send({ok:true,mode:'rules',
          reply:'為保障私隱，請唔好喺聊天輸入電話、電郵、卡號、密碼或地址。請透過正式訂單表格提交聯絡資料。',
          requiresHuman:true});
      const fallback=ruleBotReply(message,lang);
      if(process.env.XAI_API_KEY&&process.env.XAI_BOT_ENABLED==='true'){
        try{
          const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9000);
          let result;
          try{
            const upstream=await fetch('https://api.x.ai/v1/chat/completions',{
              method:'POST',
              headers:{Authorization:'Bearer '+process.env.XAI_API_KEY,'Content-Type':'application/json'},
              signal:controller.signal,
              body:JSON.stringify({model:process.env.XAI_MODEL||'grok-4.3',max_tokens:220,
                messages:[
                  {role:'system',content:'You are the concise multilingual FAQ agent of independent beauty retailer LUMENDA SELECT. Reply in '+lang+'. Only SK-II Facial Treatment Essence 230ml and GenOptics Aura Essence 50ml. Not officially affiliated with SK-II or P&G. Never invent prices, inventory, shipping charges or destination tax amounts. Merchandise subtotal HK$4,000 or more gets free shipping but NOT waived taxes. Below HK$4,000 shipping and applicable taxes require the seller quote. All enquiries must be submitted in the on-site form. Never say an order, payment or stock is confirmed. Do not request or disclose private contact/payment details. Never provide unverified external payment links. Answer under 80 words.'},
                  {role:'user',content:message}
                ]})
            });
            if(!upstream.ok)throw Error('AI endpoint failed');
            const json=await upstream.json();
            result=String(json.choices?.[0]?.message?.content||'').slice(0,900);
          }finally{clearTimeout(timeout);}
          if(result)return send({ok:true,mode:'grok',reply:result,requiresHuman:true});
        }catch(e){console.warn('Optional Grok temporarily unavailable',e?.name||'Error');}
      }
      return send({ok:true,mode:'rules',reply:fallback,requiresHuman:true});
    }catch(e){return send({ok:false,error:e.status?e.message:'聊天服務暫時未能使用'},e.status||503);}
  }

  if(path==='/api/admin/agents' && req.method==='GET'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    try{
      await ensureTable();await ensureAgentsTable();
      const agents=await DB`SELECT a.code,a.name,a.kind,a.parent_code,a.status,a.created_at,COUNT(o.id)::int AS order_count
        FROM lumenda_agents a LEFT JOIN lumenda_orders o ON o.referral_code=a.code
        GROUP BY a.code ORDER BY a.created_at DESC LIMIT 250`;
      return send({ok:true,agents});
    }catch(e){console.error('Agent list failed',e?.code||e?.name);return send({ok:false,error:'代理列表暫時未能讀取'},503);}
  }
  if(path==='/api/admin/agents' && req.method==='POST'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    try{
      const body=await parseJSON(req);
      const name=clean(body.name,90),kind=clean(body.kind,12),parentCode=clean(body.parentCode,24).toUpperCase()||null;
      if(name.length<2||!['agent','referrer'].includes(kind))err('請填代理名稱及種類',400);
      if(parentCode&&!AGENT_CODE_PATTERN.test(parentCode))err('上線代理邀請碼無效',400);
      await ensureAgentsTable();
      if(parentCode){
        const parents=await DB`SELECT code FROM lumenda_agents WHERE code=${parentCode} AND kind='agent' AND status='active' LIMIT 1`;
        if(!parents.length)err('上線代理不存在或已停用',400);
      }
      const code=(kind==='agent'?'AG':'RF')+randomBytes(7).toString('hex').toUpperCase();
      const created=await DB`INSERT INTO lumenda_agents(code,name,kind,parent_code,status)
        VALUES(${code},${name},${kind},${parentCode},'active')
        RETURNING code,name,kind,parent_code,status,created_at`;
      return send({ok:true,agent:{...created[0],order_count:0}},201);
    }catch(e){if(e.status)return send({ok:false,error:e.message},e.status);
      console.error('Agent creation failed',e?.code||e?.name);return send({ok:false,error:'建立代理邀請連結失敗'},503);}
  }
  if(path.startsWith('/api/admin/agents/')&&req.method==='PATCH'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    try{
      const code=path.slice('/api/admin/agents/'.length).toUpperCase();
      if(!AGENT_CODE_PATTERN.test(code))err('邀請碼格式無效',400);
      const body=await parseJSON(req);
      if(!['active','inactive'].includes(body.status))err('無效狀態',400);
      await ensureAgentsTable();
      const changed=await DB`UPDATE lumenda_agents SET status=${body.status} WHERE code=${code} RETURNING code,status`;
      return send({ok:!!changed.length},changed.length?200:404);
    }catch(e){if(e.status)return send({ok:false,error:e.message},e.status);
      console.error('Agent update failed',e?.code||e?.name);return send({ok:false,error:'無法更新邀請連結'},503);}
  }
  if(path==='/api/admin/login' && req.method==='POST') {
    if(!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    if(adminLoginLimited(req)) return send({ok:false,error:'嘗試次數太多，請 15 分鐘後再試。'},429);
    try{
      const body=await parseJSON(req);
      if(!ADMIN_USERNAME||ADMIN_PASSWORD.length<16||ADMIN_SESSION_SECRET.length<32||!safeEqual(clean(body.username,100),ADMIN_USERNAME)||!safeEqual(String(body.password||''),ADMIN_PASSWORD)) return send({ok:false,error:'帳號或密碼不正確'},401);
      const exp=Math.floor(Date.now()/1000)+ADMIN_SESSION_SECONDS,token=adminToken(exp,randomBytes(18).toString('hex'));
      return new Response(JSON.stringify({ok:true,user:ADMIN_USERNAME,expiresAt:exp}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Set-Cookie':'lumenda_admin='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+ADMIN_SESSION_SECONDS,'X-Robots-Tag':'noindex,nofollow','X-Content-Type-Options':'nosniff'}});
    }catch(e){return send({ok:false,error:e.status?e.message:'登入失敗'},e.status||400);}
  }
  if(path==='/api/admin/session' && req.method==='GET') return validAdmin(req)?send({ok:true,user:ADMIN_USERNAME}):send({ok:false,error:'Unauthorized'},401);
  if(path==='/api/admin/logout' && req.method==='POST') return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Set-Cookie':'lumenda_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});
  if(path.startsWith('/api/admin/media/') && req.method==='POST'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    const key=clean(path.split('/').pop(),20);if(!['fte','aura'].includes(key))return send({ok:false,error:'Invalid media key'},400);
    const mime=(req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();if(!['image/jpeg','image/png','image/webp'].includes(mime))return send({ok:false,error:'只支援 JPG、PNG、WebP'},400);
    const data=new Uint8Array(await req.arrayBuffer());if(data.byteLength<5000||data.byteLength>4*1024*1024||!validImageBytes(data,mime))return send({ok:false,error:'圖片格式或大小無效（5 KB 至 4 MB）'},400);
    try{await ensureMediaTable();await DB`INSERT INTO lumenda_media(key,mime,data,updated_at) VALUES (${key},${mime},${data},now()) ON CONFLICT (key) DO UPDATE SET mime=EXCLUDED.mime,data=EXCLUDED.data,updated_at=now()`;return send({ok:true,key,bytes:data.byteLength,mime});}catch(e){console.error('Media upload failed',e?.message);return send({ok:false,error:'圖片暫時未能儲存'},503);}
  }
  if(path==='/api/orders' && req.method==='POST') {
    if(limit(req)) return send({ok:false,error:'請稍後再試'},429);
    try {
      await ensureTable();
      const data=validateOrder(await parseJSON(req));
      const id='LMD-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+randomBytes(5).toString('hex').toUpperCase();
      const customer=JSON.stringify(data.customer),items=JSON.stringify(data.items);
      const referralCode=await activeReferralCode(data.referralCandidate);
      const receiptToken=randomBytes(32).toString('base64url');
      const receiptHash=createHash('sha256').update(receiptToken).digest('hex');
      await DB`INSERT INTO lumenda_orders(id,status,market,customer,items,note,referral_code,receipt_token_hash)
        VALUES (${id},${'pending_quote'},${data.market},${customer}::jsonb,${items}::jsonb,${data.note},${referralCode},${receiptHash})`;
      return send({ok:true,orderId:id,status:'pending_quote',paymentRequired:false,
        botAcknowledgement:'已收到你的訂單查詢。店主稍後核實貨品、運費、稅費同報價。提交唔代表已付款。',
        receiptToken,referralTracked:!!referralCode},201);
    } catch(e) {
      if(e.status) return send({ok:false,error:e.message},e.status);
      console.error('Order save failed',e?.message);return send({ok:false,error:'訂單暫時未能儲存，請稍後再試'},503);
    }
  }
  if(path==='/api/orders' && req.method==='GET') {
    if(!validAdmin(req)||!validAdminOrigin(req)) return send({ok:false,error:'Unauthorized'},401);
    try {await ensureTable();const orders=await DB`SELECT id,created_at,status,market,customer,items,note,referral_code,quote,payment_status,payment_verified_at,payment_reference FROM lumenda_orders ORDER BY created_at DESC LIMIT 300`;return send({ok:true,orders});}
    catch(e){console.error('Order fetch failed',e?.message);return send({ok:false,error:'Database unavailable'},503);}
  }
  if(path.startsWith('/api/orders/') && req.method==='PATCH') {
    if(!validAdmin(req)||!validAdminOrigin(req)) return send({ok:false,error:'Unauthorized'},401);
    try {await ensureTable();const body=await parseJSON(req);
      if(!['pending_quote','confirmed','packed','shipped','completed','cancelled'].includes(body.status)) err('Invalid status',400);
      const id=clean(path.split('/').pop(),90);
      const updated=await DB`UPDATE lumenda_orders SET status=${body.status} WHERE id=${id} RETURNING id`;
      return send({ok:updated.length>0},updated.length?200:404);
    }catch(e){return send({ok:false,error:e.status?e.message:'Cannot update order'},e.status||503);}
  }
  if((req.method==='GET'||req.method==='HEAD')&&path==='/media/fte') return (await serveMedia('fte',req.method))||new Response('Not found',{status:404});
  if((req.method==='GET'||req.method==='HEAD')&&path==='/media/aura') return (await serveMedia('aura',req.method))||new Response('Not found',{status:404});
  if(req.method==='GET'||req.method==='HEAD') return serveHD(path,req.method)||serveFile(path,req.method)||new Response('Not found',{status:404});
  return send({ok:false,error:'Method not allowed'},405);
 }
const port=Number(process.env.PORT||3000);
createServer(async (req,res)=>{
  try{
    const host=req.headers.host||'localhost';
    const proto=req.headers['x-forwarded-proto']==='https'?'https':'http';
    const url=proto+'://'+host+req.url;
    const hasBody=req.method!=='GET'&&req.method!=='HEAD';
    const request=new Request(url,{method:req.method,headers:req.headers,
      ...(hasBody?{body:Readable.toWeb(req),duplex:'half'}:{})});
    const response=await handle(request);
    res.statusCode=response.status;
    response.headers.forEach((value,key)=>res.setHeader(key,value));
    if(req.method==='HEAD'){res.end();return;}
    const data=Buffer.from(await response.arrayBuffer());
    res.end(data);
  }catch(err){console.error('Uncaught request failure',err);res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:false,error:'Server error'}));}
}).listen(port,'0.0.0.0',()=>console.log('LUMENDA SELECT listening on '+port));

// Server-side persistence check. Never logs connection strings, credentials or customer data.
async function checkDatabaseAtStartup(){
  if(!DB){console.warn('LUMENDA_DB_CHECK: DATABASE_URL not configured');return;}
  try {
    await ensureTable();
    await ensureMediaTable();
    await ensureAgentsTable();
    await ensureShowcaseTable();
    const ping=await DB`SELECT 1 AS connected`;
    if(ping[0]?.connected!==1)throw new Error('Invalid database response');
    console.log('LUMENDA_DB_CHECK: CONNECTED; orders and media tables ready');
  }catch(e){
    console.error('LUMENDA_DB_CHECK: FAILED '+String(e?.code||e?.name||'unknown').slice(0,80));
  }
}
void checkDatabaseAtStartup();

