'use strict';
// Both frontend and backend use the same market rules, embedded at build time.
const MARKETS = __MARKETS_JSON__;
const PRODUCTS = __PRODUCTS_JSON__;
const I18N = window.LUMENDA_I18N;
if (!I18N) throw new Error('The translation dictionary did not load.');
const $ = id => document.getElementById(id);
const selected = {};
const marketSelect = $('market');
const languageSelect = $('language');
let language = I18N.DEFAULT_LANG.HK;
let lastResult = null;
const tr = (key, vars) => I18N.t(language, key, vars);
for (const [code,m] of Object.entries(MARKETS)) marketSelect.add(new Option(`${m.flag} ${m.name} · ${m.currency}`,code));
for (const [code,label] of I18N.LANG_OPTIONS) languageSelect.add(new Option(label,code));
marketSelect.value = 'HK';
languageSelect.value = language;
function updateTranslations() {
  document.documentElement.lang = language;
  document.title = 'LUMENDA SELECT | ' + tr('productHeading');
  for(const el of document.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n);
  for(const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = tr(el.dataset.i18nPlaceholder);
}
function makeField(spec, market) {
  const wrap=document.createElement('div');
  wrap.className='field'+(spec.key==='address1'||spec.key==='address2'?' wide':'');
  const lbl=document.createElement('label');
  lbl.htmlFor='shipping_'+spec.key;
  lbl.textContent=I18N.fieldLabel(language,market,spec.key,spec.label)+(spec.required?' *':'');
  if(spec.required) lbl.classList.add('required');
  let ctrl;
  if(Array.isArray(spec.options)) {
    ctrl=document.createElement('select');
    ctrl.add(new Option(tr('choose'),'') );
    for(const value of spec.options){
      const caption=market==='HK'?(I18N.HK_REGION_LABELS[language]||I18N.HK_REGION_LABELS['zh-Hant'])[value]||value:value;
      ctrl.add(new Option(caption,value));
    }
  } else {
    ctrl=document.createElement('input');ctrl.type='text';ctrl.maxLength=250;
    ctrl.placeholder=spec.example||tr('genericPlaceholder');
    if(spec.key==='postcode'){
      ctrl.inputMode='numeric';
      if(market==='HK'||market==='VN') ctrl.placeholder=tr('optionalPostcode');
      if(market==='TW') ctrl.placeholder='100006';
      if(market==='CN') ctrl.placeholder='100000';
    }
  }
  ctrl.id=lbl.htmlFor;ctrl.name='shipping_'+spec.key;ctrl.required=!!spec.required;
  wrap.append(lbl,ctrl);
  return wrap;
}
function updateOther() {
  const isOther=$('paymentMethod').value==='OTHER';
  $('otherPaymentWrap').hidden=!isOther;
  $('otherPayment').required=isOther;
}
// Change language without discarding previously typed address details.
// On a destination change, rebuild that country's address fields to avoid cross-country data mixups.
function updateCountry(preserveAddress) {
  const code=marketSelect.value, m=MARKETS[code];
  const old={};
  if(preserveAddress){for(const el of $('addressFields').querySelectorAll('input,select')) old[el.name]=el.value;}
  $('addressFields').replaceChildren();
  const specs=[...m.addressFields, ...(m.postcode?[{...m.postcode,key:'postcode'}]:[])];
  for(const spec of specs){
    const el=makeField(spec,code);
    $('addressFields').append(el);
    const control=el.querySelector('input,select');
    if(preserveAddress && Object.prototype.hasOwnProperty.call(old,control.name)) control.value=old[control.name];
  }
  $('dial').textContent=m.dial;
  $('currencyMessage').textContent=tr('currency',{currency:m.currency});
  $('countryHint').textContent=(I18N.COUNTRY_HINTS[language]||I18N.COUNTRY_HINTS['zh-Hant'])[code];
  const choice=$('paymentMethod'),oldPay=choice.value;
  choice.replaceChildren();
  for(const name of m.payments){const key=({FPS:'fps',PAYPAL:'paypal',USDT:'usdt',OTHER:'other'})[name];choice.add(new Option(tr(key),name));}
  if(preserveAddress&&m.payments.includes(oldPay)) choice.value=oldPay;
  $('paymentHint').textContent=['CN','TH','VN'].includes(code)?tr('paymentHintRestricted'):tr('paymentHintGeneral');
  updateOther();
}
function renderProducts(){
  const grid=$('productsGrid');grid.replaceChildren();
  const tagKeys={FTE230:'essence',GENOPTICS50:'serum'};
  for(const p of PRODUCTS){
    const card=document.createElement('article');card.className='product';
    const body=document.createElement('div');body.className='product-body';
    const tag=document.createElement('span');tag.className='pill';tag.textContent=tr(tagKeys[p.sku]||'set');
    const title=document.createElement('h3');title.textContent=p.name;
    const hint=document.createElement('p');hint.className='hint';hint.textContent=tr('priceRequest');
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=tr('add');
    button.addEventListener('click',()=>{selected[p.sku]=Math.min(30,(selected[p.sku]||0)+1);renderCart();});
    body.append(tag,title,hint,button);card.append(body);grid.append(card);
  }
}
function renderCart(){
  const lines=$('cartLines');lines.replaceChildren();let count=0;
  for(const p of PRODUCTS){
    const q=selected[p.sku]||0;if(!q)continue;count+=q;
    const row=document.createElement('div');row.className='cart-row';
    const name=document.createElement('div');name.textContent=p.name;
    const controls=document.createElement('div');controls.className='qty';
    const down=document.createElement('button');down.type='button';down.textContent='−';down.ariaLabel=tr('decrease');
    down.onclick=()=>{selected[p.sku]=Math.max(0,(selected[p.sku]||0)-1);renderCart();};
    const qty=document.createElement('b');qty.textContent=String(q);
    const up=document.createElement('button');up.type='button';up.textContent='+';up.ariaLabel=tr('increase');
    up.onclick=()=>{selected[p.sku]=Math.min(30,(selected[p.sku]||0)+1);renderCart();};
    controls.append(down,qty,up);row.append(name,controls);lines.append(row);
  }
  if(count===0){const p=document.createElement('p');p.className='muted';p.textContent=tr('cartEmpty');lines.append(p);}
  $('cartCount').textContent=String(count);
}
function textVal(name){const el=document.querySelector('[name="'+name+'"]');return el?.value?.trim()||'';}
function renderResult(){
  const target=$('result');
  if(!lastResult){target.textContent='';target.className='status';return;}
  const msg=lastResult.type==='success'?tr('orderSuccess',{id:lastResult.orderId}):
    lastResult.type==='empty'?tr('orderEmpty'):
    lastResult.type==='error'?tr('orderFailed',{message:lastResult.message}):tr('serviceFailed');
  target.textContent=msg;
  target.className='status show '+(lastResult.type==='success'?'ok':'err');
}
function setResult(data){lastResult=data;renderResult();}
function setLanguage(lang,preserveAddress=true){
  language=I18N.TEXT[lang]?lang:'zh-Hant';
  languageSelect.value=language;
  updateTranslations();
  updateCountry(preserveAddress);
  renderProducts();renderCart();renderResult();
}
$('orderForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;
  if(!form.reportValidity())return;
  const market=marketSelect.value,m=MARKETS[market];
  const items=PRODUCTS.filter(p=>selected[p.sku]>0).map(p=>({sku:p.sku,qty:selected[p.sku]}));
  if(!items.length){setResult({type:'empty'});return;}
  const shipping={};for(const field of m.addressFields) shipping[field.key]=textVal('shipping_'+field.key);
  shipping.postcode=textVal('shipping_postcode');
  const customer={name:textVal('recipient'),phone:textVal('phone'),email:textVal('email'),contactMethod:textVal('contactMethod'),contactId:textVal('contactId'),company:textVal('company'),shipping};
  const data={market,items,customer,paymentMethod:textVal('paymentMethod'),otherPayment:textVal('otherPayment'),deliverySpeed:textVal('deliverySpeed'),deliveryNote:textVal('deliveryNote'),note:textVal('orderNote'),consent:$('privacy').checked,website:textVal('website')};
  const button=$('submitOrder');button.disabled=true;button.textContent=tr('submitting');
  try{
    const res=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const reply=await res.json();if(!res.ok) throw new Error(reply.error||tr('serviceFailed'));
    setResult({type:'success',orderId:reply.orderId});
    for(const sku of Object.keys(selected))delete selected[sku];renderCart();
    // Keep the user's selected destination and language after success.
    form.reset();updateCountry(false);updateTranslations();
  }catch(e){setResult({type:'error',message:e.message});}
  finally{button.disabled=false;button.textContent=tr('submit');}
});
marketSelect.addEventListener('change',()=>{setLanguage(I18N.DEFAULT_LANG[marketSelect.value]||'en',false);});
languageSelect.addEventListener('change',()=>{setLanguage(languageSelect.value,true);});
setLanguage(I18N.DEFAULT_LANG[marketSelect.value],false);


// Rose Aura: lightweight cinematic light movement; visual-only enhancements.
(function initRoseAuraEffects(){
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if(reduced)return;
  const reveals=[...document.querySelectorAll('.reveal')];
  if('IntersectionObserver' in window){
    const watcher=new IntersectionObserver(entries=>{
      for(const entry of entries){if(entry.isIntersecting){entry.target.classList.add('is-visible');watcher.unobserve(entry.target);}}
    },{threshold:0.08,rootMargin:'0px 0px -16px 0px'});
    document.documentElement.classList.add('motion-ready');
    reveals.forEach(node=>watcher.observe(node));
  }else{reveals.forEach(node=>node.classList.add('is-visible'));}
  const hero=document.querySelector('.hero-premiere');
  if(hero&&window.matchMedia?.('(hover:hover) and (pointer:fine)').matches){
    let pending=false,point=null;
    hero.addEventListener('pointermove',event=>{
      const rect=hero.getBoundingClientRect();
      point=[Math.round((event.clientX-rect.left)/rect.width*100)+'%',Math.round((event.clientY-rect.top)/rect.height*100)+'%'];
      if(pending)return;
      pending=true;
      requestAnimationFrame(()=>{if(point){hero.style.setProperty('--px',point[0]);hero.style.setProperty('--py',point[1]);}pending=false;});
    },{passive:true});
  }
})();
