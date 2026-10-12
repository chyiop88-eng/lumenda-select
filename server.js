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
  '/i18n.js':'text/javascript; charset=utf-8','/admin.js':'text/javascript; charset=utf-8'
};
const MARKETS = JSON.parse(readFileSync(join(ROOT, 'config', 'markets.json'), 'utf8'));
const PRODUCTS = JSON.parse(readFileSync(join(ROOT, 'config', 'products.json'), 'utf8'));
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
    initPromise = DB`CREATE TABLE IF NOT EXISTS lumenda_orders (
      id text PRIMARY KEY, created_at timestamptz DEFAULT now(), status text NOT NULL,
      market text NOT NULL, customer jsonb NOT NULL, items jsonb NOT NULL, note text
    )`.catch(error => { initPromise = null; throw error; });
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
    shipping,paymentMethod,otherPayment,deliverySpeed,deliveryNote:clean(body.deliveryNote,300)};
  return {market,items,customer,note:clean(body.note,500)};
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
  if(path==='/')path='/index.html';
  const mime=STATIC_FILES[path];if(!mime)return null;
  try{
    const content=readFileSync(join(ROOT,'public',path.slice(1)));
    return new Response(method==='HEAD'?null:content,{headers:{
      'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'X-Frame-Options':'DENY','X-Robots-Tag':'noindex,nofollow',
      'Referrer-Policy':'strict-origin-when-cross-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
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
async function handle(req) {

  const path=new URL(req.url).pathname;
  if(path==='/api/health' && req.method==='GET')
    return send({ok:true,brand:'LUMENDA SELECT',mode:'order_enquiry',uiVersion:'9.0.0',hdCampaignsReady:Object.keys(HD_MEDIA).every(path=>!!getHDImage(path)),languages:['zh-Hant','zh-Hans','en','ms','vi','th'],ordersEnabled:!!DB,paymentsLive:false,shippingMarkets:Object.keys(MARKETS)});
  if(path==='/api/markets' && req.method==='GET')
    return send({markets:MARKETS,paymentMode:'enquiry_only',paymentsLive:false});
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
      await DB`INSERT INTO lumenda_orders(id,status,market,customer,items,note)
        VALUES (${id},${'pending_quote'},${data.market},${customer}::jsonb,${items}::jsonb,${data.note})`;
      return send({ok:true,orderId:id,status:'pending_quote',paymentRequired:false},201);
    } catch(e) {
      if(e.status) return send({ok:false,error:e.message},e.status);
      console.error('Order save failed',e?.message);return send({ok:false,error:'訂單暫時未能儲存，請稍後再試'},503);
    }
  }
  if(path==='/api/orders' && req.method==='GET') {
    if(!validAdmin(req)||!validAdminOrigin(req)) return send({ok:false,error:'Unauthorized'},401);
    try {await ensureTable();const orders=await DB`SELECT id,created_at,status,market,customer,items,note FROM lumenda_orders ORDER BY created_at DESC LIMIT 300`;return send({ok:true,orders});}
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
