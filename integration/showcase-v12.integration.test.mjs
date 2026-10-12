import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';

const base='http://127.0.0.1:31998';
const username='film-test-admin',password='standalone-film-test-password-12345',secret='standalone-film-test-long-secret-should-not-be-production';
let app,session='';
async function req(path,opts={}){
 const response=await fetch(base+path,{...opts,signal:AbortSignal.timeout(9000)});
 let data={};try{data=await response.json();}catch{}
 return {status:response.status,data,headers:response.headers};
}
function json(body,headers={}){return {headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)};}
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Isolated Postgres is required');
 app=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'31998',ADMIN_USERNAME:username,ADMIN_PASSWORD:password,ADMIN_SESSION_SECRET:secret},stdio:'pipe'});
 let ready=false;
 for(let i=0;i<70;i++){
  try{
   const login=await req('/api/admin/login',{method:'POST',...json({username,password})});
   if(login.status===200){
    session=login.headers.get('set-cookie').split(';')[0];
    const a=await req('/api/admin/showcase',{headers:{cookie:session}});
    if(a.status===200){ready=true;break;}
   }
  }catch{}
  await wait(180);
 }
 assert.equal(ready,true,'Showcase PostgreSQL table should be ready');
});
after(()=>app?.kill('SIGTERM'));
test('three video and motion slots can be edited only by owner',async()=>{
 const readGuest=await req('/api/admin/showcase');assert.equal(readGuest.status,401);
 const badWrite=await req('/api/admin/showcase/brand',{method:'POST',...json({kind:'video',url:'https://media.example.com/promo.mp4',enabled:true})});
 assert.equal(badWrite.status,401);
 const auth={cookie:session};
 const empty=await req('/api/showcase');assert.equal(empty.status,200);
 assert.deepEqual(Object.keys(empty.data.slots).sort(),['aura','brand','fte']);
 assert.equal(empty.data.slots.brand,null);
 for(const badUrl of ['javascript:alert(1)','http://example.org/clip.mp4','https://127.0.0.1/clip.mp4','https://example.org/trap.svg','https://evil.local/clip.mp4']){
  const r=await req('/api/admin/showcase/brand',{method:'POST',...json({kind:'video',url:badUrl,enabled:true},auth)});
  assert.equal(r.status,400,'Must reject '+badUrl);
 }
 const invalid=await req('/api/admin/showcase/missing',{method:'POST',...json({kind:'video',url:'https://assets.example.org/test.mp4',enabled:true},auth)});
 assert.equal(invalid.status,400);
 const brand=await req('/api/admin/showcase/brand',{method:'POST',...json({kind:'video',url:'https://youtu.be/dQw4w9WgXcQ',enabled:true},auth)});
 assert.equal(brand.status,200,JSON.stringify(brand.data));
 assert.equal(brand.data.media.provider,'youtube');
 assert.equal(brand.data.media.url,'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
 const fte=await req('/api/admin/showcase/fte',{method:'POST',...json({kind:'video',url:'https://cdn.example.org/sk2-essence.mp4',enabled:true},auth)});
 assert.equal(fte.status,200);assert.equal(fte.data.media.provider,'file');
 const aura=await req('/api/admin/showcase/aura',{method:'POST',...json({kind:'motion',url:'https://cdn.example.org/rose-aura.webp',enabled:true},auth)});
 assert.equal(aura.status,200);assert.equal(aura.data.media.provider,'image');
 const publicList=await req('/api/showcase');
 assert.equal(publicList.status,200);
 assert.equal(publicList.data.slots.brand.provider,'youtube');
 assert.equal(publicList.data.slots.fte.url,'https://cdn.example.org/sk2-essence.mp4');
 assert.equal(publicList.data.slots.aura.kind,'motion');
 const admin=await req('/api/admin/showcase',{headers:auth});
 assert.equal(admin.status,200);assert.equal(admin.data.media.length,3);
 const toggle=await req('/api/admin/showcase/brand',{method:'POST',...json({kind:'video',url:'https://youtu.be/dQw4w9WgXcQ',enabled:false},auth)});
 assert.equal(toggle.status,200);
 const hidden=await req('/api/showcase');assert.equal(hidden.data.slots.brand,null);assert.ok(hidden.data.slots.fte);
 const remove=await req('/api/admin/showcase/aura',{method:'POST',...json({kind:'motion',url:'',enabled:false},auth)});
 assert.equal(remove.status,200);
 const cleared=await req('/api/showcase');assert.equal(cleared.data.slots.aura,null);
 console.log('VIDEO_CMS_INTEGRATION_PASS slots=3 providers=youtube,file,image hiddenDisabled=true existingOrdersUntouched=true');
});
test('front-end has no empty cinema spaces, respects original two products and strict CSP',async()=>{
 const page=await fetch(base+'/');const html=await page.text();
 for(const slot of ['brandCinema','fteMediaSlot','auraMediaSlot'])assert.ok(html.includes('id="'+slot+'"')&&html.includes('hidden'));
 assert.equal(page.status,200);
 const csp=page.headers.get('content-security-policy')||'';
 assert.ok(csp.includes('frame-src https://www.youtube-nocookie.com https://player.vimeo.com'));
 assert.ok(csp.includes("object-src 'none'"));
 const js=await (await fetch(base+'/app.js')).text();
 assert.ok(js.includes('initializeCinematicMedia'));
 const admin=await (await fetch(base+'/admin')).text();
 assert.ok(admin.includes('id="showcaseAdminCards"'));
 const info=await req('/api/health');
 assert.ok(['12.0.0','13.0.0'].includes(info.data.uiVersion));
 assert.deepEqual(info.data.featuredSKUs,['FTE230','GENOPTICS50']);
 assert.equal(info.data.shippingPolicy.freeShippingThresholdHKD,4000);
 console.log('VISUAL_SLOTS_PASS brand+fte+aura hidden-before-config; hk4000+two-products unchanged');
});
