'use strict';
const $=id=>document.getElementById(id);
const labels={pending_quote:'待報價',confirmed:'已確認（未核實付款）',packed:'包裝中',shipped:'已出貨',completed:'已完成',cancelled:'已取消'};
let rows=[];
let agents=[];
function esc(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeCSV(value){let v=String(value??'');if(/^[\s]*[=+\-@]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function addressText(o){const s=o.customer?.shipping;if(!s)return[o.customer?.address,o.customer?.city,o.customer?.postalCode].filter(Boolean).join(', ');return[s.postcode,s.province,s.region,s.city,s.district,s.subdistrict,s.address1,s.address2].filter(Boolean).join(' / ');}
function show(el,txt,ok){el.textContent=txt;el.className='status show '+(ok?'ok':'err');}
function setLoggedIn(on){$('loginCard').hidden=on;$('adminArea').hidden=!on;if(!on){rows=[];agents=[];$('orders').replaceChildren();$('agentList').replaceChildren();$('showcaseAdminCards').replaceChildren();$('contactsList').replaceChildren();$('export').disabled=true;}}
async function api(url,options={}){const res=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});let data={};try{data=await res.json();}catch{}if(!res.ok){const e=new Error(data.error||('HTTP '+res.status));e.status=res.status;throw e;}return data;}
async function uploadMedia(key,inputId){const file=$(inputId).files?.[0];if(!file){show($('mediaStatus'),'請先揀圖片。',false);return;}if(file.size>4*1024*1024){show($('mediaStatus'),'圖片不可超過 4 MB。',false);return;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)){show($('mediaStatus'),'只支援 JPG、PNG、WebP。',false);return;}show($('mediaStatus'),'上傳中…',true);const res=await fetch('/api/admin/media/'+key,{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type},body:file});let data={};try{data=await res.json();}catch{}if(!res.ok){if(res.status===401){setLoggedIn(false);show($('loginStatus'),'登入已失效，請重新登入。',false);}else show($('mediaStatus'),data.error||'上傳失敗',false);return;}show($('mediaStatus'),'✅ 已上傳 '+(key==='fte'?'神仙水':'小燈泡')+' 廣告圖（'+Math.round(data.bytes/1024)+' KB）。首頁已更新。',true);$(inputId).value='';}
async function loadOrders(){try{const data=await api('/api/orders');rows=data.orders||[];show($('status'),'成功讀取 '+rows.length+' 張訂單',true);render();}catch(e){if(e.status===401){setLoggedIn(false);show($('loginStatus'),'登入已失效，請重新登入。',false);}else show($('status'),e.message,false);}}
function render(){const target=$('orders');target.replaceChildren();$('export').disabled=!rows.length;for(const o of rows){const c=o.customer||{},card=document.createElement('section');card.className='card';card.style.marginTop='16px';const h=document.createElement('h3');h.textContent=o.id+' · '+o.market+' · '+new Date(o.created_at||o.createdAt).toLocaleString();const summary=document.createElement('div');const text=[['收件人',c.name],['聯絡電話',c.phoneIntl||c.phone],['電郵',c.email],['公司',c.company],['地址',addressText(o)],['物流備註',c.deliveryNote],['配送',c.deliverySpeed],['付款偏好',c.paymentMethod||c.preferredPayment],['其他收款查詢',c.otherPayment],['聯絡方式',(c.contactMethod||'')+' '+(c.contactId||'')],['介紹來源',o.referral_code?(agents.find(a=>a.code===o.referral_code)?.name||'未命名代理')+' · '+o.referral_code:null],['備註',o.note]].filter(x=>x[1]);summary.innerHTML=text.map(([label,value])=>'<p><b>'+esc(label)+'：</b>'+esc(value)+'</p>').join('');const goods=document.createElement('p');goods.textContent=(o.items||[]).map(i=>i.sku+' × '+i.qty).join('；');const select=document.createElement('select');select.style.maxWidth='240px';for(const [value,label]of Object.entries(labels))select.add(new Option(label,value));select.value=o.status;select.onchange=async()=>{select.disabled=true;try{await api('/api/orders/'+encodeURIComponent(o.id),{method:'PATCH',body:JSON.stringify({status:select.value})});o.status=select.value;show($('status'),'已更新 '+o.id+'；網站不會自動確認付款。',true);}catch(e){show($('status'),e.message,false);await loadOrders();}finally{select.disabled=false;}};const copy=document.createElement('button');copy.className='btn outline';copy.type='button';copy.style.marginLeft='12px';copy.textContent='複製收件資料';copy.onclick=()=>{const msg=[o.id,c.name,c.phoneIntl||c.phone,addressText(o),c.deliveryNote||''].filter(Boolean).join('\n');navigator.clipboard?.writeText(msg).then(()=>show($('status'),'收件資料已複製',true)).catch(()=>show($('status'),'請手動複製收件資料',false));};card.append(h,summary,goods,select,copy,makeQuoteEditor(o));target.append(card);}if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent='暫無訂單';target.append(p);}}
$('login').onclick=async()=>{const username=$('username').value.trim(),password=$('password').value;try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({username,password})});$('password').value='';setLoggedIn(true);show($('status'),'登入成功',true);await loadOrders();await loadAgents();await loadShowcaseMedia();await loadContacts();}catch(e){show($('loginStatus'),e.message,false);}};
$('password').addEventListener('keydown',e=>{if(e.key==='Enter')$('login').click();});
$('uploadFte').onclick=()=>uploadMedia('fte','fteFile');
$('uploadAura').onclick=()=>uploadMedia('aura','auraFile');
$('refresh').onclick=async()=>{await loadOrders();await loadAgents();await loadShowcaseMedia();await loadContacts();};
$('logout').onclick=async()=>{try{await api('/api/admin/logout',{method:'POST',body:'{}'});}catch{}setLoggedIn(false);show($('loginStatus'),'已登出',true);};
$('export').onclick=()=>{if(!rows.length)return;const header=['order_id','created_at','market','status','name','phone','email','company','address','payment_method','other_payment','delivery_speed','delivery_note','items','note','referral_code'];const matrix=[header,...rows.map(o=>{const c=o.customer||{};return[o.id,o.created_at||o.createdAt,o.market,o.status,c.name,c.phoneIntl||c.phone,c.email,c.company,addressText(o),c.paymentMethod||c.preferredPayment,c.otherPayment,c.deliverySpeed,c.deliveryNote,(o.items||[]).map(i=>i.sku+' x '+i.qty).join('; '),o.note,o.referral_code||''];})];const csv='\uFEFF'+matrix.map(cols=>cols.map(safeCSV).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='lumenda-orders-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);};
(async()=>{try{await api('/api/admin/session');setLoggedIn(true);await loadOrders();await loadAgents();await loadShowcaseMedia();await loadContacts();}catch{setLoggedIn(false);}})();


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



// Owner-only cinematic media manager. Sources are HTTPS links, not uploaded binary files.
const SHOWCASE_EDITOR_SLOTS=[
  {slot:'brand',title:'✧ 首頁品牌影片',subtitle:'位於首頁下方、產品區上方'},
  {slot:'fte',title:'01 · 神仙水影片',subtitle:'神仙水產品展示下方'},
  {slot:'aura',title:'02 · 小燈泡影片',subtitle:'小燈泡產品展示下方'}
];
async function loadShowcaseMedia(){
  try{
    const res=await api('/api/admin/showcase');
    const previous=new Map((res.media||[]).map(v=>[v.slot,v]));
    renderShowcaseEditor(previous);
  }catch(e){if(e.status===401){setLoggedIn(false);show($('loginStatus'),'登入已失效，請重新登入。',false);}
    else show($('showcaseAdminStatus'),e.message,false);}
}
function renderShowcaseEditor(records){
  const wrap=$('showcaseAdminCards');wrap.replaceChildren();
  for(const meta of SHOWCASE_EDITOR_SLOTS){
    const saved=records.get(meta.slot)||{kind:'video',url:'',enabled:false};
    const card=document.createElement('section');card.className='showcase-editor-card';
    const name=document.createElement('h4');name.textContent=meta.title;
    const sub=document.createElement('p');sub.className='showcase-editor__hint';sub.textContent=meta.subtitle;
    const kindGroup=document.createElement('div');kindGroup.className='field';
    const kindLabel=document.createElement('label');kindLabel.textContent='素材類型';
    const kind=document.createElement('select');kind.add(new Option('🎥 影片（MP4 / WebM / YouTube / Vimeo）','video'));kind.add(new Option('✨ 動態圖片（GIF / WebP / APNG）','motion'));
    kind.value=saved.kind==='motion'?'motion':'video';
    kindLabel.append(kind);kindGroup.append(kindLabel);
    const urlGroup=document.createElement('div');urlGroup.className='field';
    const urlLabel=document.createElement('label');urlLabel.textContent='HTTPS 素材網址';
    const input=document.createElement('input');input.type='url';input.autocomplete='off';input.spellcheck=false;input.value=saved.url||'';
    input.maxLength=1200;
    const hint=document.createElement('div');hint.className='showcase-editor__hint';
    function updateHint(){
      if(kind.value==='motion'){
        input.placeholder='https://cdn.example.com/rose-animation.webp';
        hint.textContent='動態圖片要使用直接以 .gif、.webp 或 .apng 結尾嘅 HTTPS 網址。';
      }else{
        input.placeholder='https://youtu.be/... 或 https://cdn.example.com/film.mp4';
        hint.textContent='可以貼 YouTube、Vimeo 網址，或者以 .mp4、.webm 結尾嘅 HTTPS 直鏈。';
      }
    }
    kind.onchange=updateHint;updateHint();
    urlLabel.append(input);urlGroup.append(urlLabel,hint);
    const toggleLabel=document.createElement('label');toggleLabel.className='showcase-editor__toggle';
    const check=document.createElement('input');check.type='checkbox';check.checked=!!saved.enabled;
    const checkText=document.createElement('span');checkText.textContent='喺前台顯示呢個位置';
    toggleLabel.append(check,checkText);
    const save=document.createElement('button');save.type='button';save.className='btn';save.textContent='保存此位置';
    save.onclick=async()=>{
      if(check.checked&&!input.value.trim()){
        show($('showcaseAdminStatus'),'請先填寫 '+meta.title+' 嘅網址，或者先取消啟用。',false);return;
      }
      save.disabled=true;save.textContent='保存中…';
      try{
        await api('/api/admin/showcase/'+meta.slot,{method:'POST',body:JSON.stringify({kind:kind.value,url:input.value.trim(),enabled:check.checked})});
        show($('showcaseAdminStatus'),'✅ '+meta.title+' 已保存。'+(check.checked?'前台已啟用，重新整理網站即可查看。':'目前前台保持隱藏。'),true);
        await loadShowcaseMedia();
      }catch(e){show($('showcaseAdminStatus'),e.message,false);}
      finally{save.disabled=false;save.textContent='保存此位置';}
    };
    card.append(name,sub,kindGroup,urlGroup,toggleLabel,save);wrap.append(card);
  }
}



// v13: owner-only phone directory. Built from orders already submitted and consented.
let contactsPage=0,contactsSearch='';
function contactElement(tag,content,cls){
  const el=document.createElement(tag);if(content!==undefined)el.textContent=String(content);
  if(cls)el.className=cls;return el;
}
async function loadContacts(page=0,query=contactsSearch){
  try{
    const result=await api('/api/admin/contacts?'+new URLSearchParams({q:query,page:String(page)}));
    contactsPage=result.page;contactsSearch=query;
    const host=$('contactsList');host.replaceChildren();
    if(!result.contacts.length)host.append(contactElement('p','未有相符電話紀錄。','muted'));
    for(const contact of result.contacts){
      const row=contactElement('article',undefined,'contact-entry');
      const details=document.createElement('div');const phone=contactElement('b',contact.phone||'—');
      const note=contactElement('small',(contact.name||'未填姓名')+' · '+contact.market+' · '+contact.order_count+' 張訂單 · 最近：'+new Date(contact.last_seen_at).toLocaleDateString());
      details.append(phone,note);
      const copy=contactElement('button','複製電話','btn outline');
      copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(contact.phone);show($('contactsStatus'),'電話已複製',true);}
      catch{show($('contactsStatus'),'無法自動複製，請手動選取。',false);}};
      row.append(details,copy);host.append(row);
    }
    $('nextContacts').disabled=!result.hasMore;
    show($('contactsStatus'),'已列出 '+result.contacts.length+' 個聯絡電話 · 第 '+(page+1)+' 頁 · 僅供履行客戶訂單之用',true);
  }catch(e){if(e.status===401){setLoggedIn(false);show($('loginStatus'),'請重新登入',false);}
    else show($('contactsStatus'),e.message,false);}
}
$('searchContacts').onclick=()=>loadContacts(0,$('contactSearch').value.trim());
$('nextContacts').onclick=()=>loadContacts(contactsPage+1,contactsSearch);
$('contactSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();loadContacts(0,$('contactSearch').value.trim());}});
function makeQuoteEditor(o){
  const wrap=contactElement('section',undefined,'order-quote-panel');
  wrap.append(contactElement('h4','🧾 購物車核對 · 正式報價 · 收款'));
  const cart=o.cart_snapshot||{lines:(o.items||[]).map(item=>({
    sku:item.sku,qty:item.qty,
    name:item.sku==='FTE230'?'神仙水 230ml':'小燈泡 50ml',
    priceStatus:item.sku==='FTE230'?'seller_listed_price':'requires_seller_quote',
    unitPriceHkd:item.sku==='FTE230'?899:null,
    lineSubtotalHkd:item.sku==='FTE230'?899*item.qty:null
  }))};
  const lines=cart.lines||[];
  const panel=contactElement('div',undefined,'order-cart-breakdown');
  panel.append(contactElement('strong','商品數量及單價核對（以伺服器計算為準）'));
  for(const line of lines)panel.append(contactElement('p',line.name+' × '+line.qty+
    ' · '+(line.priceStatus==='requires_seller_quote'?'待賣家填正式單價':'HK$'+Number(line.unitPriceHkd).toFixed(2)+'／支 · HK$'+Number(line.lineSubtotalHkd).toFixed(2))));
  wrap.append(panel);
  const settled=o.payment_status==='owner_verified'||o.payment_status==='stripe_paid';
  const locked=settled||!!o.stripe_session_id;
  const fields=contactElement('div',undefined,'field-grid');
  const controls={};
  const specs=[
    ['subtotalHkd','商品小計 HKD（系統自動計算）',o.quote?.subtotalHkd??'','number'],
    ['shippingHkd','運費 HKD（滿 HK$4,000 自動免費）',o.quote?.shippingHkd??'0','number'],
    ['taxHkd','實際適用稅費 HKD（管理員核實）',o.quote?.taxHkd??'0','number'],
    ['paymentLink','PayPal／Stripe 官方付款連結（選填；用於人工核實方式）',o.quote?.paymentLink??'','url'],
    ['note','報價備註',o.quote?.note??'','text']
  ];
  for(const [key,title,value,type] of specs){
    const label=contactElement('label',title,'field'),ctrl=document.createElement('input');
    ctrl.type=type;ctrl.value=String(value);ctrl.autocomplete='off';
    if(type==='number'){ctrl.min='0';ctrl.max='999999.99';ctrl.step='.01';ctrl.inputMode='decimal';}
    if(key==='subtotalHkd')ctrl.readOnly=true;
    if(key==='paymentLink'){ctrl.placeholder='https://www.paypal.com/...';ctrl.maxLength=1200;}
    if(key==='note')ctrl.maxLength=280;
    if(locked)ctrl.disabled=true;
    label.append(ctrl);fields.append(label);controls[key]=ctrl;
  }
  const prices={};
  for(const line of lines.filter(x=>x.priceStatus==='requires_seller_quote')){
    const label=contactElement('label',line.name+'／支正式單價 HKD（數量 '+line.qty+'）','field');
    const ctrl=document.createElement('input');ctrl.type='number';ctrl.min='.01';ctrl.max='999999.99';
    ctrl.step='.01';ctrl.inputMode='decimal';ctrl.placeholder='填入已確認單價';
    ctrl.value=String(o.quote?.lines?.find(x=>x.sku===line.sku)?.unitPriceHkd??'');
    ctrl.disabled=locked;label.append(ctrl);fields.prepend(label);prices[line.sku]=ctrl;
  }
  const summary=contactElement('p','','quote-summary');
  function updateQuote(){
    let subtotal=0,pending=false;
    for(const line of lines){
      const unit=line.priceStatus==='requires_seller_quote'?Number(prices[line.sku]?.value):Number(line.unitPriceHkd);
      if(!(unit>0)||!Number.isFinite(unit)){pending=true;continue;}
      subtotal+=Math.round(unit*100)*line.qty;
    }
    const money=subtotal/100;
    controls.subtotalHkd.value=pending?'':money.toFixed(2);
    const free=!pending&&subtotal>=400000;
    if(!locked){controls.shippingHkd.disabled=free;if(free)controls.shippingHkd.value='0';}
    const shipping=free?0:Number(controls.shippingHkd.value||0);
    const tax=Number(controls.taxHkd.value||0);
    summary.textContent=pending?'⚠ 請先填齊所有待報價商品嘅每支單價。':
      '商品 HK$'+money.toFixed(2)+(free?' · 免運費':' · 未達 HK$4,000 免運門檻')+
      ' + 運費 HK$'+shipping.toFixed(2)+' + 稅費 HK$'+tax.toFixed(2)+
      ' = 正式應付 HK$'+(money+shipping+tax).toFixed(2);
  }
  for(const ctrl of Object.values(prices))ctrl.addEventListener('input',updateQuote);
  for(const key of ['shippingHkd','taxHkd'])controls[key].addEventListener('input',updateQuote);
  updateQuote();
  const actions=contactElement('div',undefined,'button-row');
  if(!locked){
    const save=contactElement('button','保存一致嘅正式報價','btn');save.type='button';
    save.onclick=async()=>{
      save.disabled=true;
      try{
        const payload=Object.fromEntries(Object.entries(controls).map(([key,input])=>[key,input.value]));
        payload.unitPricesHkd=Object.fromEntries(Object.entries(prices).map(([sku,input])=>[sku,input.value]));
        const result=await api('/api/admin/orders/'+encodeURIComponent(o.id)+'/quote',{method:'POST',body:JSON.stringify(payload)});
        show($('status'),'✅ '+o.id+' 核對成功 · 正式應付 HK$'+Number(result.quote.totalHkd).toFixed(2)+
          (payload.paymentLink?' · 已設定獨立付款連結':' · 如啟用 Stripe，客人可用私人進度頁結帳'),true);
        await loadOrders();
      }catch(e){show($('status'),e.message,false);}finally{save.disabled=false;}
    };
    actions.append(save);
  }else actions.append(contactElement('p','報價已鎖定，不能喺付款頁建立後或付款成功後改價。','hint'));
  if(o.payment_status==='link_ready'){
    const verify=contactElement('div',undefined,'quote-verification');
    const checkbox=document.createElement('input');checkbox.type='checkbox';
    const label=document.createElement('label');label.append(checkbox,document.createTextNode(' 我已喺實際商戶後台核對真實付款'));
    const ref=document.createElement('input');ref.type='text';ref.maxLength=100;ref.placeholder='商戶交易參考編號（至少 6 字元）';
    const button=contactElement('button','由管理員核實付款','btn outline');button.type='button';
    button.onclick=async()=>{
      if(!checkbox.checked||ref.value.trim().length<6){show($('status'),'請先核實入帳並填參考編號',false);return;}
      if(!window.confirm('你已到支付服務商確認 '+o.id+' 真實入帳？'))return;
      button.disabled=true;
      try{
        await api('/api/admin/orders/'+encodeURIComponent(o.id)+'/payment',{
          method:'POST',body:JSON.stringify({confirmed:true,transactionReference:ref.value.trim()})});
        show($('status'),'已記錄店主核實付款：'+o.id,true);await loadOrders();
      }catch(e){show($('status'),e.message,false);}finally{button.disabled=false;}
    };
    verify.append(label,ref,button);actions.append(verify);
  }else if(o.payment_status==='stripe_paid'){
    actions.append(contactElement('p','✅ Stripe 簽名 Webhook 已驗證付款 · '+(o.payment_reference||'—'),'hint'));
  }else if(o.payment_status==='owner_verified'){
    actions.append(contactElement('p','✅ 店主已核實付款 · '+(o.payment_reference||'—'),'hint'));
  }else if(o.payment_status==='checkout_ready'){
    actions.append(contactElement('p','Stripe 付款頁已建立，等候網關確認。','hint'));
  }else if(o.payment_status==='checkout_expired'||o.payment_status==='checkout_failed'){
    actions.append(contactElement('p','付款未完成，客人可重新嘗試或轉人工處理。','hint'));
  }else actions.append(contactElement('span','未完成正式收款。','hint'));
  wrap.append(fields,summary,actions);return wrap;
}
