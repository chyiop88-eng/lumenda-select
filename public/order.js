'use strict';
(async()=>{
  const target=document.getElementById('receiptResult');
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const token=decodeURIComponent(location.hash.slice(1));
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)){target.replaceChildren(el('p','呢條私人連結無效。請使用提交訂單時收到嘅原始連結。'));return;}
  try{
    const response=await fetch('/api/order/lookup',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok||!data.ok)throw Error(data.error||'無法載入訂單');
    const o=data.order,section=document.createElement('div');
    section.append(el('h2','訂單 '+o.id),el('p','訂單狀態：'+o.status),el('p','目的地：'+o.market));
    const names={FTE230:'神仙水 Facial Treatment Essence 230ml',GENOPTICS50:'小燈泡 GenOptics Aura Essence 50ml'};
    const items=el('p','產品：'+(o.items||[]).map(x=>(names[x.sku]||x.sku)+' × '+x.qty).join('；'));
    section.append(items);
    if(o.quote){
      const q=o.quote;
      section.append(el('h3','賣家正式報價（港幣 HKD）'),el('p','商品小計：HK$'+Number(q.subtotalHkd).toFixed(2)),
        el('p','運費：HK$'+Number(q.shippingHkd).toFixed(2)+(q.freeShipping?' · 已符合免運門檻':'')),
        el('p','適用稅費：HK$'+Number(q.taxHkd).toFixed(2)),
        el('h3','總額：HK$'+Number(q.totalHkd).toFixed(2)));
      if(q.note)section.append(el('p','報價備註：'+q.note));
      if(q.paymentLink){
        let u;try{u=new URL(q.paymentLink)}catch{}
        const allowed=new Set(['checkout.stripe.com','buy.stripe.com','www.paypal.com','paypal.com','paypal.me','www.paypal.me']);
        if(u?.protocol==='https:'&&allowed.has(u.hostname)){
          const a=el('a','前往 Stripe／PayPal 安全付款頁 ↗','btn');
          a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';section.append(a);
        }
      }
    }else{section.append(el('p','尚未出正式報價。店主會核實商品、運費及稅費後更新。'));}
    const paid=o.paidVerified&&o.paymentStatus==='owner_verified';
    section.append(el('p',paid?'付款狀態：店主已核對交易參考紀錄':'付款狀態：未核實付款；請勿單憑付款截圖當作成功'));
    section.append(el('p',data.botMessage||'已收到你的查詢。'));
    const btn=el('button','重新整理進度','btn outline');btn.type='button';btn.onclick=()=>location.reload();section.append(btn);
    target.replaceChildren(section);
  }catch(e){target.replaceChildren(el('p',e.message||'訂單查詢暫時不可使用'));}
})();
