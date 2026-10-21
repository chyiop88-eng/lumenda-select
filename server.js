import postgres from 'postgres';
import { calculateCart } from './lib/cart-pricing.mjs';
import {createPayPalController} from './lib/paypal-service.mjs';
import {buildSellerQuote,checkoutAmountCents,stripeCheckoutParams,quoteHash,paidStripeSessionValid,verifyStripeEvent} from './lib/checkout-payments.mjs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants as ZLIB } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { timingSafeEqual, randomBytes, createHash, createHmac } from 'node:crypto';
// Generated build inserts the exact frontend files and server-side market rules.
const ROOT=dirname(fileURLToPath(import.meta.url));
const STATIC_FILES={
  '/index.html':'text/html; charset=utf-8', '/admin.html':'text/html; charset=utf-8',
  '/styles.css':'text/css; charset=utf-8','/app.js':'text/javascript; charset=utf-8',
  '/i18n.js':'text/javascript; charset=utf-8','/admin.js':'text/javascript; charset=utf-8','/bot.js':'text/javascript; charset=utf-8','/order.js':'text/javascript; charset=utf-8','/order.html':'text/html; charset=utf-8','/lumenda-favicon.png':'image/png',
  '/robots.txt':'text/plain; charset=utf-8','/sitemap.xml':'application/xml; charset=utf-8'
};
const MARKETS = JSON.parse(readFileSync(join(ROOT, 'config', 'markets.json'), 'utf8'));
const PRODUCTS = JSON.parse(readFileSync(join(ROOT, 'config', 'products.json'), 'utf8'));
const STRIPE_MODE=process.env.STRIPE_MODE==='live'?'live':'test';
function stripeProviderConfigured(){
  const key=String(process.env.STRIPE_SECRET_KEY||'');
  const base=String(process.env.PUBLIC_SITE_URL||'');
  let validBase=false;
  try {
    const u=new URL(base);
    validBase=(u.protocol==='https:'||(process.env.NODE_ENV==='test'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))&&u.pathname==='/'&&!u.search&&!u.hash;
  } catch {}
  return !!DB &&
    key.startsWith(STRIPE_MODE==='live'?'sk_live_':'sk_test_') &&
    String(process.env.STRIPE_WEBHOOK_SECRET||'').startsWith('whsec_') &&
    validBase &&(STRIPE_MODE!=='live'||process.env.STRIPE_LIVE_APPROVED==='true');
}
function stripeReady(){return stripeProviderConfigured()&&process.env.STRIPE_CHECKOUT_ENABLED==='true';}
function stripeWebhookReady(){return stripeProviderConfigured();}
function stripeApiBase(){
  if(process.env.NODE_ENV==='test'&&process.env.STRIPE_MOCK_BASE_URL){
    const url=new URL(process.env.STRIPE_MOCK_BASE_URL);
    if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Test Stripe endpoint must be loopback');
    return url.origin;
  }
  return 'https://api.stripe.com';
}
const SHIPPING_POLICY = Object.freeze({ currency: 'HKD', freeShippingThresholdHKD: 4000, qualifyingAmount: 'seller_confirmed_merchandise_subtotal', shippingBelowThreshold: 'quote_by_destination', applicableTaxes: 'quoted_separately', eligibility: 'pending_quote' });
const HD_MEDIA = {
  '/campaign-facial-treatment-essence-hd-v7.webp': 'hd-art/fte-q94.webp',
  '/campaign-genoptics-aura-essence-hd-v7.webp': 'hd-art/aura-q94.webp'
};
const HD_CACHE = new Map();
const PHOTO_CACHE=new Map();
const PHOTO_CACHE_TTL_MS=90_000;
function clientHasEtag(headers,etag){
  const offered=headers?.get('if-none-match')||'';
  return offered.split(',').some(v=>v.trim()==='*'||v.trim()===etag);
}
function mediaEtag(bytes){
  return '"m-'+createHash('sha256').update(bytes).digest('hex').slice(0,24)+'"';
}
function getHDImage(path){
  const relative=HD_MEDIA[path];if(!relative)return null;
  if(HD_CACHE.has(path))return HD_CACHE.get(path);
  try{
    const bytes=readFileSync(join(ROOT,'public',relative));
    const record={bytes,etag:mediaEtag(bytes)};
    HD_CACHE.set(path,record);
    return record;
  }catch(e){console.error('Campaign image failed',e?.message);return null;}
}
function imageResponse(record,mime,method,reqHeaders,cacheControl){
  const headers={
    'Content-Type':mime,'Content-Length':String(record.bytes.length),
    'ETag':record.etag,'Cache-Control':cacheControl,
    'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex,nofollow'
  };
  if(clientHasEtag(reqHeaders,record.etag))
    return new Response(null,{status:304,headers});
  return new Response(method==='HEAD'?null:record.bytes,{headers});
}
function serveHD(path,method,reqHeaders){
  if(!Object.hasOwn(HD_MEDIA,path))return null;
  const record=getHDImage(path);
  if(!record)return new Response('Campaign image unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
  return imageResponse(record,'image/webp',method,reqHeaders,'public, max-age=86400, must-revalidate');
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
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS marketing_source text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS receipt_token_hash text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS quote jsonb`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS cart_snapshot jsonb`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_order_id text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_approval_url text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_quote_hash text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_mode text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_order_created_at timestamptz`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_create_lock text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_create_lock_at timestamptz`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_capture_lock text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_capture_lock_at timestamptz`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS paypal_capture_id text`;
      await DB`CREATE UNIQUE INDEX IF NOT EXISTS lumenda_paypal_order_uidx ON lumenda_orders(paypal_order_id)`;
      await DB`CREATE UNIQUE INDEX IF NOT EXISTS lumenda_paypal_capture_uidx ON lumenda_orders(paypal_capture_id)`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS stripe_session_id text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS stripe_checkout_url text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS stripe_checkout_expires_at timestamptz`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS stripe_quote_hash text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS stripe_checkout_lock text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS stripe_checkout_lock_at timestamptz`;
      await DB`CREATE UNIQUE INDEX IF NOT EXISTS lumenda_stripe_session_uidx ON lumenda_orders(stripe_session_id)`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_requested'`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS payment_reference text`;
      await DB`ALTER TABLE lumenda_orders ADD COLUMN IF NOT EXISTS manual_payment jsonb`;
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
async function serveMedia(key,method,reqHeaders){
  const now=Date.now();
  let entry=PHOTO_CACHE.get(key);
  if(!entry||now-entry.checkedAt>PHOTO_CACHE_TTL_MS){
    try{
      await ensureMediaTable();
      const rows=await DB`SELECT mime,data,updated_at FROM lumenda_media WHERE key=${key} LIMIT 1`;
      if(rows.length){
        const bytes=rows[0].data;
        entry={checkedAt:now,mime:rows[0].mime,bytes,etag:mediaEtag(bytes)};
      }else entry={checkedAt:now,notCustom:true};
      PHOTO_CACHE.set(key,entry);
    }catch(e){
      console.error('Media read failed',e?.code||e?.name);
      entry={checkedAt:now,notCustom:true};
      PHOTO_CACHE.set(key,entry);
    }
  }
  if(!entry.notCustom)
    return imageResponse(entry,entry.mime,method,reqHeaders,'public, max-age=30, must-revalidate');
  const fallback=key==='fte'?'/campaign-facial-treatment-essence-hd-v7.webp':'/campaign-genoptics-aura-essence-hd-v7.webp';
  const record=getHDImage(fallback);
  if(!record)return new Response('Campaign image unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
  return imageResponse(record,'image/webp',method,reqHeaders,'public, max-age=30, must-revalidate');
}

function unpackJsonValue(value,fallback){
  if(typeof value!=='string')return value??fallback;
  try{return JSON.parse(value);}catch{return fallback;}
}
function normalizedOrder(record){
  return {...record,customer:unpackJsonValue(record.customer,{}),
    items:unpackJsonValue(record.items,[]),cart_snapshot:unpackJsonValue(record.cart_snapshot,null),quote:unpackJsonValue(record.quote,null)};
}

const send = (obj, status=200) => Response.json(obj, {status, headers: {
  'Cache-Control':'no-store','X-Robots-Tag':'noindex,nofollow','X-Content-Type-Options':'nosniff'
}});
const PAYPAL=createPayPalController({DB,ensureTable,send,parseJSON,unpackJsonValue,limit});
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
  // Only save a generic referral channel, never a visitor identifier or tracking cookie.
  const source=clean(body.marketingSource,36).toLowerCase();
  const marketingSource=['facebook','instagram','whatsapp','88db','google','carousell','direct','other']
    .includes(source)?source:null;
  return {market,items,customer,note:clean(body.note,500),
    referralCandidate:clean(body.referralCode,24),marketingSource};
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
const PUBLIC_ASSET_CACHE=new Map();
const COMPRESSIBLE_MIME=/^(?:text\/|application\/xml)/;
function getStaticAsset(path,mime){
  if(PUBLIC_ASSET_CACHE.has(path))return PUBLIC_ASSET_CACHE.get(path);
  const bytes=readFileSync(join(ROOT,'public',path.slice(1)));
  const etagBase=createHash('sha256').update(bytes).digest('hex').slice(0,24);
  const encoded={identity:bytes};
  if(COMPRESSIBLE_MIME.test(mime)){
    encoded.br=brotliCompressSync(bytes,{params:{[ZLIB.BROTLI_PARAM_QUALITY]:4}});
    encoded.gzip=gzipSync(bytes,{level:5});
  }
  const asset={encoded,etagBase};
  PUBLIC_ASSET_CACHE.set(path,asset);
  return asset;
}
function serveFile(path, method, reqHeaders){
  if(path==='/admin'||path==='/admin/')path='/admin.html';
  if(path==='/order'||path==='/order/')path='/order.html';
  if(path==='/')path='/index.html';
  const mime=STATIC_FILES[path];if(!mime)return null;
  try{
    const asset=getStaticAsset(path,mime);
    const encodingOffered=reqHeaders?.get('accept-encoding')||'';
    const encoding=asset.encoded.br&&/(?:^|[,;\s])br(?:[,;\s]|$)/i.test(encodingOffered)?
      'br':asset.encoded.gzip&&/(?:^|[,;\s])gzip(?:[,;\s]|$)/i.test(encodingOffered)?'gzip':'identity';
    const bytes=asset.encoded[encoding];
    const isPublicPage=path==='/index.html';
    const isPrivatePage=path==='/admin.html'||path==='/order.html';
    const cacheControl=isPrivatePage?'private, no-store':
      isPublicPage?'public, max-age=60, must-revalidate':
      'public, max-age=86400, must-revalidate';
    const etag='"s-'+asset.etagBase+'-'+encoding+'"';
    const headers={
      'Content-Type':mime,'Content-Length':String(bytes.length),
      'ETag':etag,'Vary':'Accept-Encoding',
      'Cache-Control':cacheControl,'X-Content-Type-Options':'nosniff',
      'X-Frame-Options':'DENY','X-Robots-Tag':isPublicPage?'index,follow':'noindex,nofollow',
      'Referrer-Policy':'strict-origin-when-cross-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    };
    if(encoding!=='identity')headers['Content-Encoding']=encoding;
    if(!isPrivatePage&&clientHasEtag(reqHeaders,etag))
      return new Response(null,{status:304,headers});
    return new Response(method==='HEAD'?null:bytes,{headers});
  }catch(e){
    console.error('Static file unavailable',e?.code||e?.name);
    return new Response('Not found',{status:404});
  }
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
    return en?'Facial Treatment Essence 230ml: CNY 750; 330ml: CNY 990. HKD settlement requires a seller-approved FX rate, shipping and tax quote. GenOptics requires a quote.':'神仙水 230ml 人民幣 ¥750；330ml 人民幣 ¥990。港幣收款金額須先經賣家核對匯率、運費同稅項；小燈泡仍待報價。';
  if(/付款|支付|pay|card|visa|master|paypal|fps|stripe|thanh toán|ชำระ/i.test(q))
    return en?'Submitting an order enquiry never charges you. After the seller confirms a HKD quote, supported PayPal checkout is available only when the merchant enables it; FPS and USDT need owner verification.':'提交訂單查詢唔會扣款。店主確認港幣報價後，如商戶已啟用 PayPal，私人訂單頁可使用 PayPal 結帳；FPS 或 USDT 必須由店主核實真實入帳。';
  if(/order|訂單|订单|落單|đơn hàng|สั่งซื้อ|確認|confirm|进度/i.test(q))
    return en?'Choose SK-II Facial Treatment Essence 230ml or 330ml, or GenOptics. A private order link will be provided; final payment needs a seller-approved HKD quote.':'可選神仙水 230ml／330ml 或小燈泡提交訂單查詢，系統提供私人進度連結；店主確認港幣結帳價後再安排付款。';
  if(/agent|代理|介紹|介绍|referral|affiliate/i.test(q))
    return en?'A referrer can share a unique store link. This does not give anyone administrator access.':'代理／介紹人可以分享專屬連結，系統記錄介紹來源，但代理唔會有後台權限。';
  return en?'I can answer questions about Facial Treatment Essence 230ml and 330ml, GenOptics, HK$4,000 free-shipping and orders. Use the enquiry form for an accurate quote.':'你好！我可以答神仙水、小燈泡、HK$4,000 免運同訂單流程。價格、庫存同正式付款由店主確認。';
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
    return send({ok:true,brand:'LUMENDA SELECT',mode:'order_enquiry',uiVersion:'14.1.0',shippingPolicy:SHIPPING_POLICY,featuredSKUs:PRODUCTS.map(p=>p.sku),hdCampaignsReady:Object.keys(HD_MEDIA).every(path=>!!getHDImage(path)),languages:['zh-Hant','zh-Hans','en','ms','vi','th'],ordersEnabled:!!DB,contactsEnabled:!!DB,receiptBotEnabled:!!DB,agentInvitesEnabled:!!DB,botMode:(process.env.XAI_API_KEY&&process.env.XAI_BOT_ENABLED==='true')?'grok':'rules',paymentLinksEnabled:!!DB,stripeCheckoutEnabled:stripeReady(),stripeMode:stripeReady()?STRIPE_MODE:null,paypalCheckoutEnabled:PAYPAL.available(),paypalMode:PAYPAL.available()?PAYPAL.mode:null,paymentsLive:stripeReady()&&STRIPE_MODE==='live',shippingMarkets:Object.keys(MARKETS)});
  if(path==='/api/cart/estimate' && req.method==='POST'){
    try {const body=await parseJSON(req);return send({ok:true,cart:calculateCart(body.items,PRODUCTS,4000)});}
    catch(e){return send({ok:false,error:e.message||'購物車無效'},400);}
  }
  if(path==='/api/markets' && req.method==='GET')
    return send({markets:MARKETS,paymentMode:'seller_quoted',stripeCheckoutEnabled:stripeReady(),paypalCheckoutEnabled:PAYPAL.available(),paymentsLive:(stripeReady()&&STRIPE_MODE==='live')||(PAYPAL.available()&&PAYPAL.mode==='live'),shippingPolicy:SHIPPING_POLICY});

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
            SELECT COALESCE(NULLIF(c->>'phoneIntl',''),NULLIF(c->>'phone','')) AS phone,
              c->>'name' AS name,market,created_at
            FROM (
              SELECT CASE WHEN jsonb_typeof(customer)='string'
                THEN (customer #>> '{}')::jsonb ELSE customer END AS c,market,created_at
              FROM lumenda_orders
            ) AS normalized
          ) AS entries WHERE phone IS NOT NULL
          GROUP BY phone
        ) SELECT phone,name,market,order_count,last_seen_at FROM grouped
        WHERE strpos(lower(phone),lower(${q}))>0 OR strpos(lower(name),lower(${q}))>0
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
      const rows=await DB`SELECT id,market,created_at,status,items,cart_snapshot,quote,payment_status,payment_verified_at,
        paypal_order_id,customer,stripe_session_id
        FROM lumenda_orders WHERE receipt_token_hash=${hash} LIMIT 1`;
      if(!rows.length)return send({ok:false,error:'搵唔到呢張訂單'},404);
      const o=rows[0];
      return send({ok:true,order:{id:o.id,market:o.market,createdAt:o.created_at,
        status:o.status,items:unpackJsonValue(o.items,[]),
        cart:unpackJsonValue(o.cart_snapshot,null),quote:unpackJsonValue(o.quote,null),paymentStatus:o.payment_status,
        paidVerified:!!o.payment_verified_at,
        paymentPreference:unpackJsonValue(o.customer,{})?.paymentMethod||'',
        paypalCheckoutAvailable:PAYPAL.available()&&unpackJsonValue(o.customer,{})?.paymentMethod==='PAYPAL'&&!!o.quote&&!o.quote.paymentLink&&!o.payment_verified_at&&o.status!=='cancelled'&&!o.stripe_session_id,
        paypalMode:PAYPAL.available()?PAYPAL.mode:null,
        stripeCheckoutAvailable:stripeReady()&&!!o.quote&&!o.quote.paymentLink&&!o.payment_verified_at&&o.status!=='cancelled'&&!o.paypal_order_id,
        stripeCheckoutMode:stripeReady()?STRIPE_MODE:null},
        botMessage:'已收到訂單查詢，店主稍後核實商品、運費、稅項同正式報價。'});
    }catch(e){if(e.status)return send({ok:false,error:e.message},e.status);
      console.error('Receipt lookup failed',e?.code||e?.name);
      return send({ok:false,error:'訂單進度暫時無法顯示'},503);}
  }


  // Owner quote must match the server's SKU prices and actual quantities.
  // Unknown products require an explicit seller-entered UNIT price for each unpriced SKU.
  if(path.startsWith('/api/admin/orders/')&&path.endsWith('/quote')&&req.method==='POST'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    try{
      const id=path.slice('/api/admin/orders/'.length,-'/quote'.length);
      if(!/^LMD-[0-9]{8}-[A-Fa-f0-9]{10}$/.test(id))err('訂單編號無效',400);
      const body=await parseJSON(req);
      await ensureTable();
      const existing=await DB`SELECT items,cart_snapshot FROM lumenda_orders WHERE id=${id} LIMIT 1`;
      if(!existing.length)err('訂單不存在',404);
      const originalItems=unpackJsonValue(existing[0].items,[]);
      const cart=unpackJsonValue(existing[0].cart_snapshot,null);
      // Freeze original seller catalogue prices at the time the customer submitted the enquiry.
      if(!cart||!Array.isArray(cart.lines)||cart.lines.length!==originalItems.length||
         !cart.lines.every((line,i)=>line.sku===originalItems[i].sku &&
           line.qty===originalItems[i].qty))
        err('舊訂單冇可靠原價快照，請轉人工核對，唔可以套用新售價',409);
      const breakdown=buildSellerQuote(cart,body);
      const paymentLink=paymentProviderUrl(body.paymentLink||'');
      const quote={...breakdown,note:clean(body.note,280),paymentLink,quotedAt:new Date().toISOString()};
      const updated=await DB`UPDATE lumenda_orders SET quote=${DB.json(quote)}::jsonb,
        payment_status=${paymentLink?'link_ready':'not_requested'},payment_verified_at=NULL,
        payment_reference=NULL
        WHERE id=${id} AND status<>'cancelled' AND payment_verified_at IS NULL
          AND stripe_session_id IS NULL AND paypal_order_id IS NULL
          AND (paypal_create_lock IS NULL OR paypal_create_lock_at < now()-interval '2 minutes')
          AND (stripe_checkout_lock IS NULL OR stripe_checkout_lock_at < now()-interval '2 minutes')
        RETURNING id,quote,payment_status`;
      if(!updated.length)err('訂單已付款或結帳進行中，不能修改報價，請轉人工核對',409);
      return send({ok:true,quote:unpackJsonValue(updated[0].quote,null),paymentStatus:updated[0].payment_status});
    }catch(e){if(e.status||e instanceof RangeError)return send({ok:false,error:e.message},e.status||400);
      console.error('Seller quote unavailable',e?.code||e?.name);
      return send({ok:false,error:'正式報價暫時未能保存'},503);}
  }

  // FPS and USDT are HUMAN-VERIFIED, never inferred from an uploaded receipt.
  // This endpoint also preserves legacy hosted-PayPal-link manual confirmation.
  if(path.startsWith('/api/admin/orders/')&&path.endsWith('/payment')&&req.method==='POST'){
    if(!validAdmin(req)||!validAdminOrigin(req))return send({ok:false,error:'Unauthorized'},401);
    try{
      const id=path.slice('/api/admin/orders/'.length,-'/payment'.length);
      if(!/^LMD-[0-9]{8}-[A-Fa-f0-9]{10}$/.test(id))err('訂單編號無效',400);
      const body=await parseJSON(req);
      if(body.confirmed!==true)err('必須先從自己銀行／錢包／PayPal 商戶後台核實實際入帳',400);
      const ref=clean(body.transactionReference,100);
      if(ref.length<6)err('請提供有效嘅實際交易參考編號',400);
      await ensureTable();
      const found=await DB`SELECT customer,quote,payment_status FROM lumenda_orders WHERE id=${id} LIMIT 1`;
      if(!found.length)err('搵唔到訂單',404);
      const customer=unpackJsonValue(found[0].customer,{});
      const quoted=unpackJsonValue(found[0].quote,null);
      if(!quoted)err('必須先保存正式報價',409);
      checkoutAmountCents(quoted);
      const chosen=clean(body.method,24).toUpperCase();
      const preference=clean(customer.paymentMethod,24).toUpperCase();
      const method=chosen||(['FPS','USDT'].includes(preference)?preference:'PAYPAL_LINK');
      if(!['FPS','USDT','PAYPAL_LINK'].includes(method))err('無效收款方式',400);
      if(method==='PAYPAL_LINK'&&found[0].payment_status!=='link_ready')
        err('未有人工付款連結，無法手動確認 PayPal',409);
      if(['FPS','USDT'].includes(method)&&preference!==method)
        err('請先核對訂單原本選擇嘅收款方式',409);
      const network=method==='USDT'?clean(body.network,20).toUpperCase():'';
      if(method==='USDT'){
        if(!['TRC20','ERC20','BEP20'].includes(network))err('請選擇實際使用嘅 USDT 區塊鏈網絡',400);
        if(!/^(0x)?[a-fA-F0-9]{64}$/.test(ref))err('USDT 必須提供真實鏈上交易 Hash（64位十六進位）',400);
      }
      const details={method,network,reviewedAt:new Date().toISOString(),verifiedBy:'owner_manual_bank_or_blockchain_review'};
      const updated=await DB`UPDATE lumenda_orders SET payment_status='owner_verified',
        payment_verified_at=now(),payment_reference=${ref},manual_payment=${DB.json(details)}::jsonb
        WHERE id=${id} AND quote IS NOT NULL AND status<>'cancelled'
          AND payment_verified_at IS NULL AND stripe_session_id IS NULL AND paypal_order_id IS NULL
        RETURNING id,payment_status`;
      return send({ok:updated.length>0,paymentStatus:updated[0]?.payment_status},updated.length?200:409);
    }catch(e){if(e.status)return send({ok:false,error:e.message},e.status);
      return send({ok:false,error:'人工付款核對暫時失敗'},503);}
  }


  if(path==='/api/order/paypal/create'&&req.method==='POST')return PAYPAL.create(req);
  if(path==='/api/order/paypal/capture'&&req.method==='POST')return PAYPAL.capture(req);
  if(path==='/api/payments/paypal/webhook'&&req.method==='POST')return PAYPAL.webhook(req);

  // Card collection occurs ONLY at the PSP-hosted Stripe Checkout page.
  // A secret receipt token authorizes the request, not an order ID or client prices.
  if(path==='/api/order/checkout'&&req.method==='POST'){
    if(!stripeReady())return send({ok:false,error:'正式信用卡結帳暫未啟用；請向賣家查詢'},503);
    if(limit(req))return send({ok:false,error:'請稍後再試'},429);
    let locked=null;
    try{
      const input=await parseJSON(req),token=String(input.token||'');
      if(!/^[A-Za-z0-9_-]{43}$/.test(token))err('私人訂單連結無效',400);
      await ensureTable();
      const hash=createHash('sha256').update(token).digest('hex');
      const lock=randomBytes(12).toString('hex');
      const selection=await DB.begin(async tx=>{
        const rows=await tx`SELECT id,quote,status,payment_verified_at,stripe_session_id,
          stripe_checkout_url,stripe_checkout_expires_at,stripe_quote_hash,
          stripe_checkout_lock,stripe_checkout_lock_at,paypal_order_id
          FROM lumenda_orders WHERE receipt_token_hash=${hash} FOR UPDATE`;
        if(!rows.length)err('訂單不存在',404);
        const o=rows[0],q=unpackJsonValue(o.quote,null);
        if(o.status==='cancelled'||o.payment_verified_at)err('訂單已結束或付款已核實',409);
        if(!q||q.paymentLink||o.paypal_order_id)err('尚未有可使用嘅 Stripe 正式報價，請聯絡賣家',409);
        const built=stripeCheckoutParams({orderId:o.id,quote:q,publicSiteUrl:process.env.PUBLIC_SITE_URL});
        if(o.stripe_session_id && o.stripe_quote_hash===built.fingerprint &&
           o.stripe_checkout_expires_at && new Date(o.stripe_checkout_expires_at).getTime()>Date.now()+60000){
          const u=new URL(o.stripe_checkout_url);
          if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')err('先前付款連結無效',409);
          return {existing:true,url:u.href};
        }
        if(o.stripe_checkout_lock&&o.stripe_checkout_lock_at&&
           Date.now()-new Date(o.stripe_checkout_lock_at).getTime()<120000)err('付款頁正準備中，請勿重複提交',409);
        await tx`UPDATE lumenda_orders SET stripe_checkout_lock=${lock},stripe_checkout_lock_at=now()
          WHERE id=${o.id}`;
        return {id:o.id,quote:q,lock,...built};
      });
      if(selection.existing)return send({ok:true,url:selection.url,provider:'stripe',reused:true});
      locked=selection;
      const response=await fetch(stripeApiBase()+'/v1/checkout/sessions',{
        method:'POST',headers:{
          Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,
          'Content-Type':'application/x-www-form-urlencoded',
          'Idempotency-Key':'lumenda-'+selection.id+'-'+selection.fingerprint.slice(0,20)+'-'+selection.lock
        },body:selection.params,signal:AbortSignal.timeout(15000)
      });
      if(!response.ok)throw Error('Stripe gateway returned HTTP '+response.status);
      const session=await response.json();
      const u=new URL(session.url);
      if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com'||
         !/^cs_(test_|live_)/.test(session.id||'')||
         session.client_reference_id!==selection.id||session.mode!=='payment'||
         session.currency!=='hkd'||session.amount_total!==selection.amount||
         session.metadata?.quote_hash!==selection.fingerprint||
         session.livemode!==(STRIPE_MODE==='live')||session.status!=='open'||
         !Number.isInteger(session.expires_at)||session.expires_at*1000<Date.now()+60000)
        throw Error('Stripe checkout response did not match this order');
      const saved=await DB`UPDATE lumenda_orders SET stripe_session_id=${session.id},
        stripe_checkout_url=${u.href},stripe_quote_hash=${selection.fingerprint},
        stripe_checkout_expires_at=${new Date(session.expires_at*1000).toISOString()},
        stripe_checkout_lock=NULL,stripe_checkout_lock_at=NULL,payment_status='checkout_ready'
        WHERE id=${selection.id} AND stripe_checkout_lock=${selection.lock}
          AND payment_verified_at IS NULL
          AND quote->>'quotedAt'=${selection.quote.quotedAt} AND paypal_order_id IS NULL
        RETURNING id`;
      if(!saved.length)err('結帳過程資料已改變，請聯絡賣家',409);
      return send({ok:true,url:u.href,provider:'stripe',mode:STRIPE_MODE});
    }catch(e){
      if(locked?.id&&locked?.lock){
        try{await DB`UPDATE lumenda_orders SET stripe_checkout_lock=NULL,stripe_checkout_lock_at=NULL
          WHERE id=${locked.id} AND stripe_checkout_lock=${locked.lock}`;}catch{}
      }
      console.warn('Checkout issue',e?.status||e?.name||'error');
      return send({ok:false,error:e.status?e.message:'付款頁目前未能建立，請稍後再試'},e.status||502);
    }
  }

  // Stripe signs the exact raw bytes. A return URL or screenshot NEVER confirms payment.
  if(path==='/api/payments/stripe/webhook'&&req.method==='POST'){
    if(!stripeWebhookReady())return send({ok:false,error:'Webhook unavailable'},503);
    try{
      const raw=await req.text();
      const event=verifyStripeEvent(raw,req.headers.get('stripe-signature'),
        process.env.STRIPE_WEBHOOK_SECRET);
      if(!['checkout.session.completed','checkout.session.async_payment_succeeded',
            'checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type))
        return send({ok:true,ignored:true});
      const session=event.data.object;
      if(session.object!=='checkout.session'||!/^cs_(test_|live_)/.test(session.id||''))
        err('Invalid payment event',400);
      await ensureTable();
      const found=await DB`SELECT id,quote,stripe_quote_hash,stripe_session_id,payment_status,
        payment_verified_at,status FROM lumenda_orders WHERE stripe_session_id=${session.id} LIMIT 1`;
      if(!found.length)return send({ok:true,ignored:true});
      const o=found[0],quote=unpackJsonValue(o.quote,null);
      if(!quote||o.stripe_quote_hash!==quoteHash(o.id,quote)||
         session.client_reference_id!==o.id||session.metadata?.quote_hash!==o.stripe_quote_hash||
         session.livemode!==(STRIPE_MODE==='live'))
        err('Payment quote mismatch - requires reconciliation',409);
      if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
        if(session.payment_status!=='paid')return send({ok:true,awaitingPayment:true});
        if(!paidStripeSessionValid(session,{orderId:o.id,quote,
          sessionId:o.stripe_session_id,mode:STRIPE_MODE}))
          err('Payment amount mismatch - requires reconciliation',409);
        if(o.payment_verified_at)return send({ok:true,duplicate:true});
        const reference=typeof session.payment_intent==='string'?session.payment_intent:session.id;
        const updated=await DB`UPDATE lumenda_orders SET payment_status='stripe_paid',
          payment_verified_at=now(),payment_reference=${reference}
          WHERE id=${o.id} AND stripe_session_id=${session.id}
            AND stripe_quote_hash=${o.stripe_quote_hash} AND payment_verified_at IS NULL
            AND status<>'cancelled' RETURNING id`;
        if(!updated.length)err('Order payment needs manual review',409);
        return send({ok:true,verified:true});
      }
      if(!o.payment_verified_at){
        const newStatus=event.type==='checkout.session.expired'?'checkout_expired':'checkout_failed';
        await DB`UPDATE lumenda_orders SET payment_status=${newStatus}
          WHERE id=${o.id} AND stripe_session_id=${session.id}
            AND payment_verified_at IS NULL AND payment_status='checkout_ready'`;
      }
      return send({ok:true,updated:true});
    }catch(e){
      if(e.status)return send({ok:false,error:e.message},e.status);
      console.warn('Stripe webhook rejected',e?.name||'Error');
      return send({ok:false,error:'Webhook signature or payload invalid'},400);
    }
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
                  {role:'system',content:'You are the concise multilingual FAQ agent of independent beauty retailer LUMENDA SELECT. Reply in '+lang+'. Only SK-II Facial Treatment Essence 230ml and 330ml, and GenOptics Aura Essence 50ml. Not officially affiliated with SK-II or P&G. Facial Treatment Essence 230ml is CNY 750 and 330ml is CNY 990. The buyer pays only a separately confirmed HKD quote using an explicitly seller-approved CNY to HKD rate. GenOptics Aura Essence price is unconfirmed. Never invent any other prices, inventory, shipping charges or destination tax amounts. Merchandise subtotal HK$4,000 or more gets free shipping but NOT waived taxes. Below HK$4,000 shipping and applicable taxes require the seller quote. All enquiries must be submitted in the on-site form. Never say an order, payment or stock is confirmed. Do not request or disclose private contact/payment details. Never provide unverified external payment links. Answer under 80 words.'},
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
      const cart=calculateCart(data.items,PRODUCTS,4000);
      const id='LMD-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+randomBytes(5).toString('hex').toUpperCase();
      const customer=DB.json(data.customer),items=DB.json(data.items);
      const referralCode=await activeReferralCode(data.referralCandidate);
      const receiptToken=randomBytes(32).toString('base64url');
      const receiptHash=createHash('sha256').update(receiptToken).digest('hex');
      await DB`INSERT INTO lumenda_orders(id,status,market,customer,items,note,referral_code,marketing_source,receipt_token_hash,cart_snapshot)
        VALUES (${id},${'pending_quote'},${data.market},${customer}::jsonb,${items}::jsonb,${data.note},${referralCode},${data.marketingSource},${receiptHash},${DB.json(cart)}::jsonb)`;
      return send({ok:true,orderId:id,status:'pending_quote',cart,paymentRequired:false,
        botAcknowledgement:'已收到你的訂單查詢。店主稍後核實貨品、運費、稅費同報價。提交唔代表已付款。',
        receiptToken,referralTracked:!!referralCode},201);
    } catch(e) {
      if(e.status) return send({ok:false,error:e.message},e.status);
      console.error('Order save failed',e?.message);return send({ok:false,error:'訂單暫時未能儲存，請稍後再試'},503);
    }
  }
  if(path==='/api/orders' && req.method==='GET') {
    if(!validAdmin(req)||!validAdminOrigin(req)) return send({ok:false,error:'Unauthorized'},401);
    try {await ensureTable();const orders=await DB`SELECT id,created_at,status,market,customer,items,note,referral_code,marketing_source,quote,cart_snapshot,payment_status,payment_verified_at,payment_reference,manual_payment,paypal_order_id,stripe_session_id FROM lumenda_orders ORDER BY created_at DESC LIMIT 300`;return send({ok:true,orders:orders.map(normalizedOrder)});}
    catch(e){console.error('Order fetch failed',e?.message);return send({ok:false,error:'Database unavailable'},503);}
  }
  if(path.startsWith('/api/orders/') && req.method==='PATCH') {
    if(!validAdmin(req)||!validAdminOrigin(req)) return send({ok:false,error:'Unauthorized'},401);
    try {await ensureTable();const body=await parseJSON(req);
      if(!['pending_quote','confirmed','packed','shipped','completed','cancelled'].includes(body.status)) err('Invalid status',400);
      const id=clean(path.split('/').pop(),90);
      const updated=await DB`UPDATE lumenda_orders SET status=${body.status}
        WHERE id=${id}
          AND (${body.status} NOT IN ('packed','shipped','completed') OR payment_verified_at IS NOT NULL)
          AND (${body.status}<>'cancelled' OR
            (payment_verified_at IS NULL AND stripe_session_id IS NULL AND paypal_order_id IS NULL))
        RETURNING id`;
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

