'use strict';
const $=id=>document.getElementById(id);
const labels={pending_quote:'待報價',confirmed:'已確認（未核實付款）',packed:'包裝中',shipped:'已出貨',completed:'已完成',cancelled:'已取消'};
let rows=[];
let agents=[];
function esc(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeCSV(value){let v=String(value??'');if(/^[\s]*[=+\-@]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function addressText(o){const s=o.customer?.shipping;if(!s)return[o.customer?.address,o.customer?.city,o.customer?.postalCode].filter(Boolean).join(', ');return[s.postcode,s.province,s.region,s.city,s.district,s.subdistrict,s.address1,s.address2].filter(Boolean).join(' / ');}
function show(el,txt,ok){el.textContent=txt;el.className='status show '+(ok?'ok':'err');}
function setLoggedIn(on){$('loginCard').hidden=on;$('adminArea').hidden=!on;if(!on){rows=[];agents=[];$('orders').replaceChildren();$('agentList').replaceChildren();$('export').disabled=true;}}
async function api(url,options={}){const res=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});let data={};try{data=await res.json();}catch{}if(!res.ok){const e=new Error(data.error||('HTTP '+res.status));e.status=res.status;throw e;}return data;}
async function uploadMedia(key,inputId){const file=$(inputId).files?.[0];if(!file){show($('mediaStatus'),'請先揀圖片。',false);return;}if(file.size>4*1024*1024){show($('mediaStatus'),'圖片不可超過 4 MB。',false);return;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)){show($('mediaStatus'),'只支援 JPG、PNG、WebP。',false);return;}show($('mediaStatus'),'上傳中…',true);const res=await fetch('/api/admin/media/'+key,{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type},body:file});let data={};try{data=await res.json();}catch{}if(!res.ok){if(res.status===401){setLoggedIn(false);show($('loginStatus'),'登入已失效，請重新登入。',false);}else show($('mediaStatus'),data.error||'上傳失敗',false);return;}show($('mediaStatus'),'✅ 已上傳 '+(key==='fte'?'神仙水':'小燈泡')+' 廣告圖（'+Math.round(data.bytes/1024)+' KB）。首頁已更新。',true);$(inputId).value='';}
async function loadOrders(){try{const data=await api('/api/orders');rows=data.orders||[];show($('status'),'成功讀取 '+rows.length+' 張訂單',true);render();}catch(e){if(e.status===401){setLoggedIn(false);show($('loginStatus'),'登入已失效，請重新登入。',false);}else show($('status'),e.message,false);}}
function render(){const target=$('orders');target.replaceChildren();$('export').disabled=!rows.length;for(const o of rows){const c=o.customer||{},card=document.createElement('section');card.className='card';card.style.marginTop='16px';const h=document.createElement('h3');h.textContent=o.id+' · '+o.market+' · '+new Date(o.created_at||o.createdAt).toLocaleString();const summary=document.createElement('div');const text=[['收件人',c.name],['聯絡電話',c.phoneIntl||c.phone],['電郵',c.email],['公司',c.company],['地址',addressText(o)],['物流備註',c.deliveryNote],['配送',c.deliverySpeed],['付款偏好',c.paymentMethod||c.preferredPayment],['其他收款查詢',c.otherPayment],['聯絡方式',(c.contactMethod||'')+' '+(c.contactId||'')],['介紹來源',o.referral_code?(agents.find(a=>a.code===o.referral_code)?.name||'未命名代理')+' · '+o.referral_code:null],['備註',o.note]].filter(x=>x[1]);summary.innerHTML=text.map(([label,value])=>'<p><b>'+esc(label)+'：</b>'+esc(value)+'</p>').join('');const goods=document.createElement('p');goods.textContent=(o.items||[]).map(i=>i.sku+' × '+i.qty).join('；');const select=document.createElement('select');select.style.maxWidth='240px';for(const [value,label]of Object.entries(labels))select.add(new Option(label,value));select.value=o.status;select.onchange=async()=>{select.disabled=true;try{await api('/api/orders/'+encodeURIComponent(o.id),{method:'PATCH',body:JSON.stringify({status:select.value})});o.status=select.value;show($('status'),'已更新 '+o.id+'；網站不會自動確認付款。',true);}catch(e){show($('status'),e.message,false);await loadOrders();}finally{select.disabled=false;}};const copy=document.createElement('button');copy.className='btn outline';copy.type='button';copy.style.marginLeft='12px';copy.textContent='複製收件資料';copy.onclick=()=>{const msg=[o.id,c.name,c.phoneIntl||c.phone,addressText(o),c.deliveryNote||''].filter(Boolean).join('\n');navigator.clipboard?.writeText(msg).then(()=>show($('status'),'收件資料已複製',true)).catch(()=>show($('status'),'請手動複製收件資料',false));};card.append(h,summary,goods,select,copy);target.append(card);}if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent='暫無訂單';target.append(p);}}
$('login').onclick=async()=>{const username=$('username').value.trim(),password=$('password').value;try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({username,password})});$('password').value='';setLoggedIn(true);show($('status'),'登入成功',true);await loadOrders();await loadAgents();}catch(e){show($('loginStatus'),e.message,false);}};
$('password').addEventListener('keydown',e=>{if(e.key==='Enter')$('login').click();});
$('uploadFte').onclick=()=>uploadMedia('fte','fteFile');
$('uploadAura').onclick=()=>uploadMedia('aura','auraFile');
$('refresh').onclick=async()=>{await loadOrders();await loadAgents();};
$('logout').onclick=async()=>{try{await api('/api/admin/logout',{method:'POST',body:'{}'});}catch{}setLoggedIn(false);show($('loginStatus'),'已登出',true);};
$('export').onclick=()=>{if(!rows.length)return;const header=['order_id','created_at','market','status','name','phone','email','company','address','payment_method','other_payment','delivery_speed','delivery_note','items','note','referral_code'];const matrix=[header,...rows.map(o=>{const c=o.customer||{};return[o.id,o.created_at||o.createdAt,o.market,o.status,c.name,c.phoneIntl||c.phone,c.email,c.company,addressText(o),c.paymentMethod||c.preferredPayment,c.otherPayment,c.deliverySpeed,c.deliveryNote,(o.items||[]).map(i=>i.sku+' x '+i.qty).join('; '),o.note,o.referral_code||''];})];const csv='\uFEFF'+matrix.map(cols=>cols.map(safeCSV).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='lumenda-orders-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);};
(async()=>{try{await api('/api/admin/session');setLoggedIn(true);await loadOrders();await loadAgents();}catch{setLoggedIn(false);}})();


function inviteUrl(code){const u=new URL('/',location.origin);u.searchParams.set('ref',code);return u.href;}
async function loadAgents(){
  try{
    const data=await api('/api/admin/agents');agents=data.agents||[];
    renderAgents();render();
  }catch(e){if(e.status===401){setLoggedIn(false);show($('loginStatus'),'登入已失效，請重新登入。',false);}
    else show($('agentStatus'),e.message,false);}
}
function renderAgents(){
  const parent=$('agentParent'),previous=parent.value;
  parent.replaceChildren(new Option('無上線／直屬管理員',''));
  for(const a of agents.filter(a=>a.kind==='agent'&&a.status==='active'))parent.add(new Option(a.name+' · '+a.code,a.code));
  if([...parent.options].some(o=>o.value===previous))parent.value=previous;
  const wrap=$('agentList');wrap.replaceChildren();
  if(!agents.length){const p=document.createElement('p');p.className='muted';p.textContent='未有代理／介紹人。填寫名稱，按「建立專屬邀請連結」開始。';wrap.append(p);return;}
  for(const agent of agents){
    const card=document.createElement('article');card.className='agent-row'+(agent.status==='inactive'?' inactive':'');
    const head=document.createElement('div');head.className='agent-row__top';
    const name=document.createElement('span');name.className='agent-row__name';name.textContent=agent.name+' · '+(agent.kind==='agent'?'下線代理':'介紹人');
    const state=document.createElement('span');state.className=agent.status==='active'?'agent-active':'agent-inactive';state.textContent=agent.status==='active'?'● 有效':'● 已停用';
    head.append(name,state);
    const superior=agents.find(x=>x.code===agent.parent_code);
    const meta=document.createElement('div');meta.className='agent-row__meta';
    meta.textContent='邀請碼 '+agent.code+' · 訂單 '+Number(agent.order_count||0)+' 張'+(agent.parent_code?' · 上線 '+(superior?.name||agent.parent_code):' · 直屬管理員');
    const row=document.createElement('div');row.className='agent-row__url';
    const input=document.createElement('input');input.type='text';input.readOnly=true;input.value=inviteUrl(agent.code);input.setAttribute('aria-label','代理專屬分享網址');
    const copy=document.createElement('button');copy.type='button';copy.className='btn';copy.textContent='複製連結';
    copy.onclick=async()=>{try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(input.value);
      else {input.focus();input.select();if(!document.execCommand('copy'))throw Error('copy not supported');}
      show($('agentStatus'),'已複製 '+agent.name+' 專屬邀請連結',true);
    }catch{input.focus();input.select();show($('agentStatus'),'可手動複製已選取嘅連結',false);}};
    row.append(input,copy);
    const actions=document.createElement('div');actions.className='agent-row__actions';actions.style.marginTop='10px';
    const open=document.createElement('a');open.className='btn outline';open.href=input.value;open.target='_blank';open.rel='noopener noreferrer';open.textContent='開啟分享頁';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='btn outline';toggle.textContent=agent.status==='active'?'停用邀請碼':'重新啟用';
    toggle.onclick=async()=>{toggle.disabled=true;const status=agent.status==='active'?'inactive':'active';
      try{await api('/api/admin/agents/'+encodeURIComponent(agent.code),{method:'PATCH',body:JSON.stringify({status})});
        show($('agentStatus'),'已更新 '+agent.name+'：'+(status==='active'?'有效':'停用')+'。舊訂單資料保留。',true);
        await loadAgents();
      }catch(e){show($('agentStatus'),e.message,false);}finally{toggle.disabled=false;}};
    actions.append(open,toggle);
    card.append(head,meta,row,actions);wrap.append(card);
  }
}
$('createAgent').onclick=async()=>{
  const name=$('agentName').value.trim(),kind=$('agentKind').value,parentCode=$('agentParent').value;
  if(name.length<2){show($('agentStatus'),'請先填最少兩個字嘅代理／介紹人名稱。',false);return;}
  const button=$('createAgent');button.disabled=true;button.textContent='建立中…';
  try{
    const data=await api('/api/admin/agents',{method:'POST',body:JSON.stringify({name,kind,parentCode})});
    $('agentName').value='';show($('agentStatus'),'✅ 已建立 '+name+' 專屬邀請連結：'+inviteUrl(data.agent.code),true);
    await loadAgents();
  }catch(e){show($('agentStatus'),e.message,false);}
  finally{button.disabled=false;button.textContent='建立專屬邀請連結';}
};
$('refreshAgents').onclick=loadAgents;
