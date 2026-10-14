import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';

const port=31997, base='http://127.0.0.1:'+port;
const user='agent-integration-test', pass='integration-test-password-never-real',secret='integration-test-secret-never-use-this-in-production-1234567890';
let app,cookie='';
async function api(path,opts={}){
  const res=await fetch(base+path,{...opts,headers:{...(opts.headers||{})},signal:AbortSignal.timeout(9000)});
  let data={};try{data=await res.json();}catch{}
  return {status:res.status,body:data,headers:res.headers};
}
const json=(body,headers={})=>({headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
before(async()=>{
  assert.ok(process.env.DATABASE_URL?.includes('postgres'), 'Integration test needs disposable DB');
  app=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),ADMIN_USERNAME:user,ADMIN_PASSWORD:pass,ADMIN_SESSION_SECRET:secret},stdio:'pipe'});
  let connected=false;
  for(let n=0;n<80;n++){
    try{
      const login=await api('/api/admin/login',{method:'POST',...json({username:user,password:pass})});
      if(login.status===200){
        cookie=login.headers.get('set-cookie').split(';')[0];
        const agents=await api('/api/admin/agents',{headers:{cookie}});
        if(agents.status===200){connected=true;break;}
      }
    }catch{}
    await sleep(150);
  }
  assert.ok(connected,'Postgres+server+admin should initialize');
});
after(()=>app?.kill('SIGTERM'));
test('agent invite lifecycle and real order attribution',async()=>{
  const notLogged=await api('/api/admin/agents');assert.equal(notLogged.status,401);
  const forbidden=await api('/api/admin/agents',{method:'POST',...json({name:'Unauthorized Agent',kind:'agent'})});
  assert.equal(forbidden.status,401);
  const auth={cookie};
  const invalid=await api('/api/admin/agents',{method:'POST',...json({name:'x',kind:'agent'},auth)});
  assert.equal(invalid.status,400);

  const agent=await api('/api/admin/agents',{method:'POST',...json({name:'Integration Agent 01',kind:'agent'},auth)});
  assert.equal(agent.status,201);assert.equal(agent.body.ok,true);
  const agentCode=agent.body.agent.code;assert.match(agentCode,/^AG[A-F0-9]{14}$/);
  const child=await api('/api/admin/agents',{method:'POST',...json({name:'Subagent 01',kind:'agent',parentCode:agentCode},auth)});
  assert.equal(child.status,201);assert.equal(child.body.agent.parent_code,agentCode);
  const referrer=await api('/api/admin/agents',{method:'POST',...json({name:'Inviter 01',kind:'referrer',parentCode:agentCode},auth)});
  assert.equal(referrer.status,201);const code=referrer.body.agent.code;assert.match(code,/^RF[A-F0-9]{14}$/);

  const beforeOrder=await api('/api/admin/agents',{headers:auth});
  assert.equal(beforeOrder.status,200);assert.ok(beforeOrder.body.agents.some(a=>a.code===agentCode&&a.order_count===0));
  const sample={
    market:'HK',items:[{sku:'FTE230',qty:1}],customer:{
      name:'Fictional Test Customer',phone:'91234567',email:'noreply@example.test',
      shipping:{region:'香港島',district:'中西區',address1:'Example Street 1',address2:''}
    },paymentMethod:'FPS',otherPayment:'',deliverySpeed:'standard',
    deliveryNote:'',note:'AUTOMATED INTEGRATION TEST ONLY',consent:true,website:'',referralCode:code,marketingSource:'facebook'
  };
  const create=await api('/api/orders',{method:'POST',...json(sample)});
  assert.equal(create.status,201,JSON.stringify(create.body));assert.equal(create.body.referralTracked,true);
  assert.match(create.body.orderId,/^LMD-/);
  const orders=await api('/api/orders',{headers:auth});
  assert.equal(orders.status,200);
  const record=orders.body.orders.find(o=>o.id===create.body.orderId);
  assert.ok(record,'Order must persist in DB');assert.equal(record.referral_code,code);
  assert.equal(record.marketing_source,'facebook','organic campaign source must be stored separately from referral commissions');
  const counted=await api('/api/admin/agents',{headers:auth});
  assert.equal(counted.body.agents.find(a=>a.code===code)?.order_count,1);
  const suspended=await api('/api/admin/agents/'+code,{method:'PATCH',...json({status:'inactive'},auth)});
  assert.equal(suspended.status,200);
  const inactiveOrder=await api('/api/orders',{method:'POST',...json(sample)});
  assert.equal(inactiveOrder.status,201);
  assert.equal(inactiveOrder.body.referralTracked,false);
  const finalOrders=await api('/api/orders',{headers:auth});
  assert.equal(finalOrders.body.orders.find(o=>o.id===inactiveOrder.body.orderId)?.referral_code,null);
  const afterDisable=await api('/api/admin/agents',{headers:auth});
  assert.equal(afterDisable.body.agents.find(a=>a.code===code)?.order_count,1);
  const site=await fetch(base+'/');const page=await site.text();assert.match(page,/id="referralNotice"/);
  const appJS=await (await fetch(base+'/app.js')).text();assert.match(appJS,/lumenda_referral/);
  const adminPage=await (await fetch(base+'/admin')).text();assert.match(adminPage,/id="createAgent"/);
  const adminJS=await (await fetch(base+'/admin.js')).text();assert.match(adminJS,/referral_code/);
  console.log('INVITE_INTEGRATION_PASS agent='+agentCode+' referrer='+code+' trackedCount=1 inactiveIgnored=true; temporary database only');
});
