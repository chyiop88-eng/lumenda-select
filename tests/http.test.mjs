import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

let app, url;
const user='lumenda_test';
const password='local_smoke_passphrase_12345678';
const secret='test-only-session-secret-should-be-replaced-abcdef1234567890';
before(async()=>{
  const port=31991;
  url=`http://127.0.0.1:${port}`;
  app=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATABASE_URL:'',ADMIN_USERNAME:user,ADMIN_PASSWORD:password,ADMIN_SESSION_SECRET:secret},stdio:'pipe'});
  let ok=false;
  for(let i=0;i<60;i++){
    await sleep(100);
    try{const res=await fetch(url+'/api/health');if(res.ok){ok=true;break;}}catch{}
  }
  assert.ok(ok,'Node server must start');
});
after(()=>app?.kill('SIGTERM'));

test('home and assets are accessible',async()=>{
  const p=await fetch(url+'/');assert.equal(p.status,200);const html=await p.text();
  assert.match(html,/LUMENDA SELECT/);assert.match(html,/\/media\/fte/);
  const js=await fetch(url+'/app.js');assert.equal(js.status,200);const text=await js.text();
  assert.doesNotMatch(text,/__MARKETS_JSON__|__PRODUCTS_JSON__/);assert.match(text,/FTE230/);
});
test('two original HD campaign images are served',async()=>{
  for(const k of ['fte','aura']){
    const r=await fetch(url+'/media/'+k);const bytes=new Uint8Array(await r.arrayBuffer());
    assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/webp');
    assert.ok(bytes.length>300_000,'HD should not be downsampled to thumbnails');
    assert.equal(new TextDecoder().decode(bytes.subarray(0,4)),'RIFF');
  }
});
test('admin page and login work without exposing secrets',async()=>{
  const r=await fetch(url+'/admin');assert.equal(r.status,200);const html=await r.text();
  assert.match(html,/神仙水/);assert.match(html,/小燈泡/);assert.doesNotMatch(html,new RegExp(password));
  const bad=await fetch(url+'/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password:'bad'})});assert.equal(bad.status,401);
  const good=await fetch(url+'/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password})});assert.equal(good.status,200);
  assert.match(good.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  const cookie=good.headers.get('set-cookie').split(';')[0];
  const session=await fetch(url+'/api/admin/session',{headers:{cookie}});assert.equal(session.status,200);
  const deny=await fetch(url+'/api/orders');assert.equal(deny.status,401);
  const mediaDeny=await fetch(url+'/api/admin/media/fte',{method:'POST',headers:{'content-type':'image/png'},body:new Uint8Array(10000)});assert.equal(mediaDeny.status,401);
  const originDeny=await fetch(url+'/api/admin/login',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({username:user,password})});assert.equal(originDeny.status,401);
});
test('missing DB returns explicit error instead of pretending orders are enabled',async()=>{
  const r=await fetch(url+'/api/health');const data=await r.json();
  assert.equal(data.ordersEnabled,false);
  assert.equal(data.hdCampaignsReady,true);
  const order=await fetch(url+'/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(order.status,503);
});
