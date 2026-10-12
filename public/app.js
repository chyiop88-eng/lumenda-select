'use strict';
// Both frontend and backend use the same market rules, embedded at build time.
const MARKETS = {"CN":{"name":"中國大陸","flag":"🇨🇳","currency":"CNY","dial":"+86","addressFields":[{"key":"province","label":"省／自治區／直轄市","required":true},{"key":"city","label":"城市／地級市","required":true},{"key":"district","label":"區／縣","required":true},{"key":"address1","label":"街道、路名及門牌號碼","required":true},{"key":"address2","label":"樓宇、樓層、單位（如有）","required":false}],"postcode":{"label":"郵政編碼（6 位）","required":true,"pattern":"^[0-9]{6}$","example":"100000"},"payments":["PAYPAL","OTHER"]},"HK":{"name":"香港","flag":"🇭🇰","currency":"HKD","dial":"+852","addressFields":[{"key":"region","label":"地區（港島／九龍／新界）","required":true,"options":["香港島","九龍","新界"]},{"key":"district","label":"地區／分區","required":true},{"key":"address1","label":"街道、門牌號碼、屋苑／大廈","required":true},{"key":"address2","label":"座數／樓層／單位（如適用）","required":false}],"postcode":{"label":"郵政編碼（香港一般不使用）","required":false,"pattern":"^.{0,12}$","example":"可留空"},"payments":["FPS","PAYPAL","USDT","OTHER"]},"TW":{"name":"台灣","flag":"🇹🇼","currency":"TWD","dial":"+886","addressFields":[{"key":"province","label":"縣／市","required":true},{"key":"district","label":"區／鄉／鎮／市","required":true},{"key":"address1","label":"路街、段、巷、弄、號","required":true},{"key":"address2","label":"樓層／室／附加地址","required":false}],"postcode":{"label":"郵遞區號（建議 3+3 碼）","required":true,"pattern":"^[0-9]{3}([0-9]{3})?$","example":"100006 或 100"},"payments":["PAYPAL","USDT","OTHER"]},"MY":{"name":"Malaysia 馬來西亞","flag":"🇲🇾","currency":"MYR","dial":"+60","addressFields":[{"key":"province","label":"State / 州屬","required":true},{"key":"city","label":"City / Town 城市","required":true},{"key":"district","label":"District / Area 區域（如適用）","required":false},{"key":"address1","label":"Street, house no. / 街道門牌","required":true},{"key":"address2","label":"Unit / Building 公寓／單位","required":false}],"postcode":{"label":"Poskod / 郵編（5 位）","required":true,"pattern":"^[0-9]{5}$","example":"50450"},"payments":["PAYPAL","USDT","OTHER"]},"VN":{"name":"Việt Nam 越南","flag":"🇻🇳","currency":"VND","dial":"+84","addressFields":[{"key":"province","label":"Tỉnh / Thành phố 省／直轄市","required":true},{"key":"district","label":"Quận / Huyện 區／縣（按當地地址填）","required":false},{"key":"subdistrict","label":"Phường / Xã 坊／社","required":true},{"key":"address1","label":"Số nhà, đường 門牌／街道","required":true},{"key":"address2","label":"Tòa nhà / Căn hộ 大廈／單位","required":false}],"postcode":{"label":"Mã bưu chính 郵編（如有）","required":false,"pattern":"^([0-9]{5})?$","example":"5 位數或留空"},"payments":["PAYPAL","OTHER"]},"TH":{"name":"ประเทศไทย 泰國","flag":"🇹🇭","currency":"THB","dial":"+66","addressFields":[{"key":"province","label":"จังหวัด / Province 府／省","required":true},{"key":"district","label":"อำเภอ / เขต District 縣／區","required":true},{"key":"subdistrict","label":"ตำบล / แขวง Subdistrict 分區","required":true},{"key":"address1","label":"บ้านเลขที่ ถนน House no. / Street 門牌街道","required":true},{"key":"address2","label":"หมู่บ้าน / Unit 屋苑／單位","required":false}],"postcode":{"label":"รหัสไปรษณีย์ 郵編（5 位）","required":true,"pattern":"^[0-9]{5}$","example":"10110"},"payments":["PAYPAL","OTHER"]}};
const PRODUCTS = [{"sku":"FTE230","name":"SK-II Facial Treatment Essence 230ml","tag":"Essence / 精華露","visual":"ESSENCE"},{"sku":"CLEAR230","name":"SK-II Facial Treatment Clear Lotion 230ml","tag":"Toner / 化妝水","visual":"CLEAR"},{"sku":"SKINPOWER80","name":"SK-II SKINPOWER Advanced Cream 80g","tag":"Moisturiser / 面霜","visual":"CREAM"},{"sku":"GENOPTICS50","name":"SK-II GenOptics Essence 50ml","tag":"Serum / 精華","visual":"SERUM"},{"sku":"MASK6","name":"SK-II Facial Treatment Mask 6pcs","tag":"Mask / 面膜","visual":"MASK"},{"sku":"SET01","name":"SK-II Skincare Selection (contents to confirm)","tag":"Custom Set / 套裝待確認","visual":"SET"}];
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
  const tagKeys={FTE230:'essence',CLEAR230:'toner',SKINPOWER80:'cream',GENOPTICS50:'serum',MASK6:'mask',SET01:'set'};
  for(const p of PRODUCTS){
    const card=document.createElement('article');card.className='product';
    const art=document.createElement('div');art.className='product-art';
    const artLabel=document.createElement('span');artLabel.textContent=p.visual;art.append(artLabel);
    const body=document.createElement('div');body.className='product-body';
    const tag=document.createElement('span');tag.className='pill';tag.textContent=tr(tagKeys[p.sku]||'set');
    const title=document.createElement('h3');title.textContent=p.name;
    const hint=document.createElement('p');hint.className='hint';hint.textContent=tr('priceRequest');
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=tr('add');
    button.addEventListener('click',()=>{selected[p.sku]=Math.min(30,(selected[p.sku]||0)+1);renderCart();});
    body.append(tag,title,hint,button);card.append(art,body);grid.append(card);
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
