import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const url='http://127.0.0.1:31994';
const username='round2_audit_owner';
const password='round2-test-only-password-2026';
const secret='round2-only-session-hmac-secret-must-never-be-used-in-production';
let child,cookie='';
const audit=[];
async function request(path,options={}){
 const resp=await fetch(url+path,{...options,signal:AbortSignal.timeout(12000)});
 const payload=await resp.arrayBuffer();
 return {status:resp.status,headers:resp.headers,body:Buffer.from(payload)};
}
function ok(name,description){audit.push({name,result:'PASS',description});console.log('[PASS] '+name+': '+description);}
function finding(name,description){audit.push({name,result:'FINDING',description});console.log('[FINDING] '+name+': '+description);}
before(async()=>{
 const env={...process.env,PORT:'31994',ADMIN_USERNAME:username,ADMIN_PASSWORD:password,ADMIN_SESSION_SECRET:secret};
 assert.ok(env.DATABASE_URL,'Local isolated test Postgres must be configured');
 child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env,stdio:'pipe'});
 child.stdout.on('data',d=>{if(d.toString().includes('LUMENDA_DB_CHECK: FAILED'))console.log('DB startup check failed')});
 child.stderr.on('data',d=>{if(d.toString().includes('LUMENDA_DB_CHECK: FAILED'))console.log('DB startup check failed')});
 let ready=false;
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw new Error('Test server exited unexpectedly');
  try{const r=await request('/api/health');if(r.status===200){ready=true;break;}}catch{}
  await delay(100);
 }
 assert.ok(ready,'Local server failed to start');
 // Readiness of real persistence table instead of relying only on health configuration flag.
 let okDb=false;
 for(let i=0;i<40;i++){
  try{
   const login=await request('/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
   if(login.status===200){cookie=login.headers.get('set-cookie').split(';')[0];okDb=true;break;}
  }catch{}
  await delay(125);
 }
 assert.ok(okDb&&cookie,'Test admin login failed');
});
after(async()=>{if(child){child.kill('SIGTERM');await delay(200);}console.log('ROUND2_ISOLATED_AUDIT: '+JSON.stringify(audit));});
test('01: anonymous simulated Trojan upload is denied',async()=>{
 const body=Buffer.from('MZ__INERT_SIMULATION_NOT_REAL_MALWARE__');
 const r=await request('/api/admin/media/fte',{method:'POST',headers:{'content-type':'application/octet-stream'},body});
 assert.equal(r.status,401);ok('anonymous-media','Anonymous executable-like upload rejected (HTTP 401)');
});
test('02: authenticated executable and HTML masquerading as media are denied',async()=>{
 for(const mime of ['application/x-msdownload','text/html','image/svg+xml','application/javascript']){
  const r=await request('/api/admin/media/aura',{method:'POST',headers:{cookie,'content-type':mime},body:Buffer.from('CANARY_TEST_MARKER_NOT_CODE')});
  assert.equal(r.status,400);
 }
 ok('unsafe-types','Executable, HTML, SVG and JS MIME types denied');
});
test('03: content-type/image signature mismatch is rejected',async()=>{
 for(const mime of ['image/png','image/jpeg','image/webp']){
  const payload=Buffer.alloc(6200,0x41);
  const r=await request('/api/admin/media/fte',{method:'POST',headers:{cookie,'content-type':mime},body:payload});
  assert.equal(r.status,400);
 }
 ok('signature-mismatch','MIME-only spoofing without expected leading file signature rejected');
});
test('04: unknown upload slot and hostile origin are rejected',async()=>{
 const badKey=await request('/api/admin/media/unknown',{method:'POST',headers:{cookie,'content-type':'image/png'},body:Buffer.from('test')});
 assert.equal(badKey.status,400);
 const origin=await request('/api/admin/media/fte',{method:'POST',headers:{cookie,'origin':'https://malicious.invalid','content-type':'image/png'},body:Buffer.from('test')});
 assert.equal(origin.status,401);
 ok('upload-access','Unknown media keys and foreign Origin denied');
});
test('05: an invalid PNG containing inert Trojan-canary bytes is incorrectly accepted',async()=>{
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 const payload=Buffer.concat([signature,Buffer.alloc(5300,0x41),Buffer.from('INERT_TROJAN_SIMULATION_CANARY_NEVER_EXECUTABLE')]);
 const r=await request('/api/admin/media/fte',{method:'POST',headers:{cookie,'content-type':'image/png'},body:payload});
 assert.equal(r.status,200,'The current implementation appears to accept invalid PNG when signature matches');
 const details=JSON.parse(r.body.toString());
 assert.equal(details.ok,true);
 const publicMedia=await request('/media/fte');
 assert.equal(publicMedia.status,200);
 assert.equal(publicMedia.headers.get('content-type'),'image/png');
 assert.equal(publicMedia.headers.get('x-content-type-options'),'nosniff');
 assert.ok(publicMedia.body.includes(Buffer.from('INERT_TROJAN_SIMULATION_CANARY')));
 finding('fake-image-accepted','Malformed PNG with correct 8-byte signature and inert marker stored in isolated DB; served as image/png with nosniff (not evidence of code execution)');
});
test('06: image upload limit rejects an oversized payload in sandbox',async()=>{
 const payload=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(5*1024*1024,0x42)]);
 const r=await request('/api/admin/media/aura',{method:'POST',headers:{cookie,'content-type':'image/png'},body:payload});
 assert.equal(r.status,400);
 ok('oversized-upload','5MB invalid upload rejected; code still buffers body before rejecting');
});
test('07: already-stored media is restricted to image content type',async()=>{
 const r=await request('/media/fte');
 assert.equal(r.status,200);
 assert.equal(r.headers.get('content-type'),'image/png');
 assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 ok('media-serving','Stored file served with image/png and nosniff; no server-side interpretation detected');
});
test('08: logout does not revoke a previously captured authenticated cookie',async()=>{
 const before=await request('/api/admin/session',{headers:{cookie}});
 assert.equal(before.status,200);
 const logout=await request('/api/admin/logout',{method:'POST',headers:{cookie},body:'{}'});
 assert.equal(logout.status,200);
 const again=await request('/api/admin/session',{headers:{cookie}});
 assert.equal(again.status,200,'Expected to reproduce non-revoked token weakness');
 finding('logout-token-reuse','Captured cookie still authenticates after logout; no server-side revocation');
});
test('09: in-memory throttling trusts spoofable client forwarding headers in isolation',async()=>{
 const one={'content-type':'application/json','x-forwarded-for':'198.51.100.197'};
 for(let i=0;i<8;i++){
  const r=await request('/api/admin/login',{method:'POST',headers:one,body:'{}'});
  assert.equal(r.status,401);
 }
 const blocked=await request('/api/admin/login',{method:'POST',headers:one,body:'{}'});
 assert.equal(blocked.status,429);
 const two={'content-type':'application/json','x-forwarded-for':'198.51.100.198'};
 const evasion=await request('/api/admin/login',{method:'POST',headers:two,body:'{}'});
 assert.equal(evasion.status,401);
 finding('spoofable-rate-limit','Local proxy header change resets login attempt counter; upstream Render may prevent this');
});
test('10: forged token, private file and unauthenticated order modifications blocked',async()=>{
 const badCookie='lumenda_admin=YXV0aGVudGljYXRpb24taXMtZmFrZQ';
 const fake=await request('/api/admin/session',{headers:{cookie:badCookie}});
 assert.equal(fake.status,401);
 const order=await request('/api/orders',{headers:{cookie:badCookie}});
 assert.equal(order.status,401);
 const status=await request('/api/orders/FAKE-NONEXISTENT-ID',{method:'PATCH',headers:{cookie:badCookie,'content-type':'application/json'},body:'{"status":"shipped"}'});
 assert.equal(status.status,401);
 for(const path of ['/server.js','/.env','/.git/config']){
  const page=await request(path);assert.equal(page.status,404);
 }
 ok('private-access','Forgery, order mutation and known sensitive paths denied');
});
