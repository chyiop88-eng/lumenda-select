'use strict';
(async()=>{
  const target=document.getElementById('receiptResult');
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  let token='';
  try{
    const fragment=decodeURIComponent(location.hash.slice(1));
    token=/^[A-Za-z0-9_-]{43}$/.test(fragment)?fragment:sessionStorage.getItem('lumenda_receipt_token')||'';
    if(/^[A-Za-z0-9_-]{43}$/.test(token)){
      sessionStorage.setItem('lumenda_receipt_token',token);
      if(!location.hash||location.search)history.replaceState(null,'','/order#'+token);
    }
  }catch{}
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)){
    target.replaceChildren(el('p','私人訂單連結無效。請重新開啟原本嘅訂單進度連結。'));return;
  }
  try{
    const response=await fetch('/api/order/lookup',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok||!data.ok)throw Error(data.error||'無法載入訂單');
    const o=data.order,section=document.createElement('div');
    section.append(el('h2','訂單 '+o.id),el('p','訂單狀態：'+o.status),el('p','目的地：'+o.market));
    const names={FTE230:'神仙水 Facial Treatment Essence 230ml',GENOPTICS50:'小燈泡 GenOptics Aura Essence 50ml'};
    section.append(el('p','產品：'+(o.items||[]).map(x=>(names[x.sku]||x.sku)+' × '+x.qty).join('；')));
    if(o.quote){
      const q=o.quote;
      section.append(el('h3','賣家正式報價（HKD）'));
      for(const line of q.lines||[])section.append(el('p',line.name+' × '+line.qty+
        ' · HK$'+Number(line.unitPriceHkd).toFixed(2)+'／支 = HK$'+Number(line.lineSubtotalHkd).toFixed(2)));
      section.append(el('p','商品小計：HK$'+Number(q.subtotalHkd).toFixed(2)),
        el('p','運費：HK$'+Number(q.shippingHkd).toFixed(2)+(q.freeShipping?' · 已符合免運門檻':'')),
        el('p','適用稅費：HK$'+Number(q.taxHkd).toFixed(2)),
        el('h3','正式應付總額：HK$'+Number(q.totalHkd).toFixed(2)));
      if(q.note)section.append(el('p','報價備註：'+q.note));
      if(!o.paidVerified&&q.paymentLink){
        let u;try{u=new URL(q.paymentLink)}catch{}
        const allowed=new Set(['checkout.stripe.com','buy.stripe.com','www.paypal.com','paypal.com','paypal.me','www.paypal.me']);
        if(u?.protocol==='https:'&&allowed.has(u.hostname)){
          const a=el('a','前往商戶官方安全付款頁 ↗','btn');
          a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';section.append(a);
          section.append(el('p','外部付款連結須由店主喺商戶後台人工核實。','hint'));
        }
      }
      if(!o.paidVerified&&o.stripeCheckoutAvailable){
        if(o.stripeCheckoutMode==='test')section.append(el('p','Stripe 測試模式：不會真正收款。','hint'));
        const pay=el('button','Visa／Mastercard／信用卡安全結帳 ↗','btn');
        pay.type='button';
        pay.onclick=async()=>{
          pay.disabled=true;pay.textContent='正在建立安全付款頁…';
          try{
            sessionStorage.setItem('lumenda_receipt_token',token);
            const res=await fetch('/api/order/checkout',{
              method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
              body:JSON.stringify({token}),signal:AbortSignal.timeout(20000)
            });
            const output=await res.json();
            if(!res.ok||!output.ok)throw Error(output.error||'無法啟動信用卡付款');
            const u=new URL(output.url);
            if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw Error('收款頁網址無效');
            location.assign(u.href);
          }catch(e){
            pay.disabled=false;pay.textContent='重試信用卡結帳';
            section.append(el('p',e.message||'暫時無法開啟付款頁','status show err'));
          }
        };
        section.append(pay);
      }
    }else section.append(el('p','尚未出正式報價。店主會核實商品、運費同稅費後更新。'));
    const paid=o.paidVerified&&['owner_verified','stripe_paid'].includes(o.paymentStatus);
    section.append(el('p',paid?
      (o.paymentStatus==='stripe_paid'?'✅ Stripe 已經由簽名 Webhook 核實入帳':'✅ 店主已核實商戶交易紀錄'):
      '付款狀態：尚未核實付款。離開付款網站或返回本頁，都唔代表付款成功。'));
    section.append(el('p',data.botMessage||'已收到你的訂單查詢。'));
    const refresh=el('button','重新整理訂單及付款狀態','btn outline');
    refresh.type='button';refresh.onclick=()=>location.reload();section.append(refresh);
    target.replaceChildren(section);
  }catch(e){target.replaceChildren(el('p',e.message||'訂單查詢暫時不可使用'));}
})();
