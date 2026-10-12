'use strict';
(async()=>{
  const target=document.getElementById('receiptResult');
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  let token='';
  const paymentReturn=new URLSearchParams(location.search).get('payment');
  let paypalCaptureNote='';
  try{
    const fragment=decodeURIComponent(location.hash.slice(1));
    const isReturn=!fragment && ['success','cancel','paypal-return','paypal-cancel'].includes(paymentReturn);
    token=/^[A-Za-z0-9_-]{43}$/.test(fragment)?fragment:(isReturn?sessionStorage.getItem('lumenda_receipt_token')||'':'');
    if(/^[A-Za-z0-9_-]{43}$/.test(token)){
      sessionStorage.setItem('lumenda_receipt_token',token);
      if(!location.hash||location.search)history.replaceState(null,'','/order#'+token);
    }
  }catch{}
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)){
    target.replaceChildren(el('p','私人訂單連結無效。請重新開啟原本嘅訂單進度連結。'));return;
  }
  try{
    if(paymentReturn==='paypal-return'){
      try{
        const result=await fetch('/api/order/paypal/capture',{
          method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
          body:JSON.stringify({token}),signal:AbortSignal.timeout(30000)});
        const outcome=await result.json();
        if(!result.ok||!outcome.verified)throw Error(outcome.error||'PayPal 交易仍需核實');
        paypalCaptureNote='PayPal 已成功由官方 API 核實收款。';
      }catch(e){paypalCaptureNote='PayPal 付款仍未核實：'+(e.message||'請聯絡賣家對帳')+'。請勿重複付款。';}
    }
    const response=await fetch('/api/order/lookup',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok||!data.ok)throw Error(data.error||'無法載入訂單');
    const o=data.order,section=document.createElement('div');
    section.append(el('h2','訂單 '+o.id),el('p','訂單狀態：'+o.status),el('p','目的地：'+o.market));
    if(paypalCaptureNote)section.append(el('p',paypalCaptureNote,'hint'));
    if(paymentReturn==='paypal-cancel')section.append(el('p','已離開 PayPal 付款頁；未有付款確認。','hint'));

    const names={FTE230:'神仙水 Facial Treatment Essence 230ml',FTE330:'神仙水 Facial Treatment Essence 330ml',GENOPTICS50:'小燈泡 GenOptics Aura Essence 50ml'};
    section.append(el('p','產品：'+(o.items||[]).map(x=>(names[x.sku]||x.sku)+' × '+x.qty).join('；')));
    if(o.cart?.pricedSubtotalCny>0){
      section.append(el('p','人民幣商品標價小計：CNY ¥'+Number(o.cart.pricedSubtotalCny).toFixed(2)));
      section.append(el('p','此金額係商品人民幣標價，唔係 PayPal 港幣扣款金額。最終 HKD 結帳要由賣家確認匯率、運費及稅費。','hint'));
    }
    if(o.quote){
      const q=o.quote;
      section.append(el('h3','賣家正式報價（HKD）'));
      if(q.fxRateCnyToHkd)section.append(el('p','已確認換算匯率：1 CNY = HK
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
      if(!o.paidVerified&&o.paypalCheckoutAvailable){
        if(o.paypalMode==='sandbox')section.append(el('p','PayPal Sandbox 測試模式：不會扣取真錢。','hint'));
        const button=el('button','透過 PayPal 安全結帳 ↗','btn');
        button.type='button';
        button.onclick=async()=>{
          button.disabled=true;button.textContent='正喺 PayPal 準備結帳…';
          try{
            sessionStorage.setItem('lumenda_receipt_token',token);
            const response=await fetch('/api/order/paypal/create',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(26000)
            });
            const result=await response.json();
            if(!response.ok||!result.ok)throw Error(result.error||'PayPal 訂單暫時不可使用');
            const u=new URL(result.url);
            const allowed=result.mode==='sandbox'?'www.sandbox.paypal.com':'www.paypal.com';
            if(u.protocol!=='https:'||u.hostname!==allowed||!/^\/checkoutnow\/?$/.test(u.pathname))
              throw Error('PayPal 官方付款網址無效');
            location.assign(u.href);
          }catch(e){
            button.disabled=false;button.textContent='重試 PayPal 結帳';
            section.append(el('p',e.message||'無法開啟 PayPal','status show err'));
          }
        };
        section.append(button);
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
    if(!o.paidVerified&&o.quote&&o.paymentPreference==='FPS')
      section.append(el('p','轉數快 FPS：請先向賣家取得核實過嘅 FPS 收款識別碼，再按正式港幣總額付款；只以銀行實際入帳紀錄核實。','hint'));
    if(!o.paidVerified&&o.quote&&o.paymentPreference==='USDT')
      section.append(el('p','USDT：須先同賣家確認網絡（例如 TRC20）、收款地址、幣量同報價有效期。未核對齊全前切勿轉幣；交易雜湊唔等於已核實入帳。','hint'));
    const paid=o.paidVerified&&['owner_verified','stripe_paid','paypal_paid'].includes(o.paymentStatus);
    section.append(el('p',paid?
      (o.paymentStatus==='stripe_paid'?'✅ Stripe 已經由簽名 Webhook 核實入帳':o.paymentStatus==='paypal_paid'?'✅ PayPal 官方 API 已核實並完成收款':'✅ 店主已核實商戶交易紀錄'):
      '付款狀態：尚未核實付款。離開付款網站或返回本頁，都唔代表付款成功。'));
    section.append(el('p',data.botMessage||'已收到你的訂單查詢。'));
    const refresh=el('button','重新整理訂單及付款狀態','btn outline');
    refresh.type='button';refresh.onclick=()=>location.reload();section.append(refresh);
    target.replaceChildren(section);
  }catch(e){target.replaceChildren(el('p',e.message||'訂單查詢暫時不可使用'));}
})();
+Number(q.fxRateCnyToHkd).toFixed(6)));
      for(const line of q.lines||[]){
        const cnyPart=line.listedCurrency==='CNY'?'CNY ¥'+Number(line.unitPriceCny).toFixed(2)+'／支 → ':'';
        section.append(el('p',line.name+' × '+line.qty+' · '+cnyPart+
          'HK
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
      if(!o.paidVerified&&o.paypalCheckoutAvailable){
        if(o.paypalMode==='sandbox')section.append(el('p','PayPal Sandbox 測試模式：不會扣取真錢。','hint'));
        const button=el('button','透過 PayPal 安全結帳 ↗','btn');
        button.type='button';
        button.onclick=async()=>{
          button.disabled=true;button.textContent='正喺 PayPal 準備結帳…';
          try{
            sessionStorage.setItem('lumenda_receipt_token',token);
            const response=await fetch('/api/order/paypal/create',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(26000)
            });
            const result=await response.json();
            if(!response.ok||!result.ok)throw Error(result.error||'PayPal 訂單暫時不可使用');
            const u=new URL(result.url);
            const allowed=result.mode==='sandbox'?'www.sandbox.paypal.com':'www.paypal.com';
            if(u.protocol!=='https:'||u.hostname!==allowed||!/^\/checkoutnow\/?$/.test(u.pathname))
              throw Error('PayPal 官方付款網址無效');
            location.assign(u.href);
          }catch(e){
            button.disabled=false;button.textContent='重試 PayPal 結帳';
            section.append(el('p',e.message||'無法開啟 PayPal','status show err'));
          }
        };
        section.append(button);
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
    if(!o.paidVerified&&o.quote&&o.paymentPreference==='FPS')
      section.append(el('p','轉數快 FPS：請先向賣家取得核實過嘅 FPS 收款識別碼，再按正式港幣總額付款；只以銀行實際入帳紀錄核實。','hint'));
    if(!o.paidVerified&&o.quote&&o.paymentPreference==='USDT')
      section.append(el('p','USDT：須先同賣家確認網絡（例如 TRC20）、收款地址、幣量同報價有效期。未核對齊全前切勿轉幣；交易雜湊唔等於已核實入帳。','hint'));
    const paid=o.paidVerified&&['owner_verified','stripe_paid','paypal_paid'].includes(o.paymentStatus);
    section.append(el('p',paid?
      (o.paymentStatus==='stripe_paid'?'✅ Stripe 已經由簽名 Webhook 核實入帳':o.paymentStatus==='paypal_paid'?'✅ PayPal 官方 API 已核實並完成收款':'✅ 店主已核實商戶交易紀錄'):
      '付款狀態：尚未核實付款。離開付款網站或返回本頁，都唔代表付款成功。'));
    section.append(el('p',data.botMessage||'已收到你的訂單查詢。'));
    const refresh=el('button','重新整理訂單及付款狀態','btn outline');
    refresh.type='button';refresh.onclick=()=>location.reload();section.append(refresh);
    target.replaceChildren(section);
  }catch(e){target.replaceChildren(el('p',e.message||'訂單查詢暫時不可使用'));}
})();
+Number(line.unitPriceHkd).toFixed(2)+'／支 = HK
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
      if(!o.paidVerified&&o.paypalCheckoutAvailable){
        if(o.paypalMode==='sandbox')section.append(el('p','PayPal Sandbox 測試模式：不會扣取真錢。','hint'));
        const button=el('button','透過 PayPal 安全結帳 ↗','btn');
        button.type='button';
        button.onclick=async()=>{
          button.disabled=true;button.textContent='正喺 PayPal 準備結帳…';
          try{
            sessionStorage.setItem('lumenda_receipt_token',token);
            const response=await fetch('/api/order/paypal/create',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(26000)
            });
            const result=await response.json();
            if(!response.ok||!result.ok)throw Error(result.error||'PayPal 訂單暫時不可使用');
            const u=new URL(result.url);
            const allowed=result.mode==='sandbox'?'www.sandbox.paypal.com':'www.paypal.com';
            if(u.protocol!=='https:'||u.hostname!==allowed||!/^\/checkoutnow\/?$/.test(u.pathname))
              throw Error('PayPal 官方付款網址無效');
            location.assign(u.href);
          }catch(e){
            button.disabled=false;button.textContent='重試 PayPal 結帳';
            section.append(el('p',e.message||'無法開啟 PayPal','status show err'));
          }
        };
        section.append(button);
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
    if(!o.paidVerified&&o.quote&&o.paymentPreference==='FPS')
      section.append(el('p','轉數快 FPS：請先向賣家取得核實過嘅 FPS 收款識別碼，再按正式港幣總額付款；只以銀行實際入帳紀錄核實。','hint'));
    if(!o.paidVerified&&o.quote&&o.paymentPreference==='USDT')
      section.append(el('p','USDT：須先同賣家確認網絡（例如 TRC20）、收款地址、幣量同報價有效期。未核對齊全前切勿轉幣；交易雜湊唔等於已核實入帳。','hint'));
    const paid=o.paidVerified&&['owner_verified','stripe_paid','paypal_paid'].includes(o.paymentStatus);
    section.append(el('p',paid?
      (o.paymentStatus==='stripe_paid'?'✅ Stripe 已經由簽名 Webhook 核實入帳':o.paymentStatus==='paypal_paid'?'✅ PayPal 官方 API 已核實並完成收款':'✅ 店主已核實商戶交易紀錄'):
      '付款狀態：尚未核實付款。離開付款網站或返回本頁，都唔代表付款成功。'));
    section.append(el('p',data.botMessage||'已收到你的訂單查詢。'));
    const refresh=el('button','重新整理訂單及付款狀態','btn outline');
    refresh.type='button';refresh.onclick=()=>location.reload();section.append(refresh);
    target.replaceChildren(section);
  }catch(e){target.replaceChildren(el('p',e.message||'訂單查詢暫時不可使用'));}
})();
+Number(line.lineSubtotalHkd).toFixed(2)));
      }
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
      if(!o.paidVerified&&o.paypalCheckoutAvailable){
        if(o.paypalMode==='sandbox')section.append(el('p','PayPal Sandbox 測試模式：不會扣取真錢。','hint'));
        const button=el('button','透過 PayPal 安全結帳 ↗','btn');
        button.type='button';
        button.onclick=async()=>{
          button.disabled=true;button.textContent='正喺 PayPal 準備結帳…';
          try{
            sessionStorage.setItem('lumenda_receipt_token',token);
            const response=await fetch('/api/order/paypal/create',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(26000)
            });
            const result=await response.json();
            if(!response.ok||!result.ok)throw Error(result.error||'PayPal 訂單暫時不可使用');
            const u=new URL(result.url);
            const allowed=result.mode==='sandbox'?'www.sandbox.paypal.com':'www.paypal.com';
            if(u.protocol!=='https:'||u.hostname!==allowed||!/^\/checkoutnow\/?$/.test(u.pathname))
              throw Error('PayPal 官方付款網址無效');
            location.assign(u.href);
          }catch(e){
            button.disabled=false;button.textContent='重試 PayPal 結帳';
            section.append(el('p',e.message||'無法開啟 PayPal','status show err'));
          }
        };
        section.append(button);
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
    if(!o.paidVerified&&o.quote&&o.paymentPreference==='FPS')
      section.append(el('p','轉數快 FPS：請先向賣家取得核實過嘅 FPS 收款識別碼，再按正式港幣總額付款；只以銀行實際入帳紀錄核實。','hint'));
    if(!o.paidVerified&&o.quote&&o.paymentPreference==='USDT')
      section.append(el('p','USDT：須先同賣家確認網絡（例如 TRC20）、收款地址、幣量同報價有效期。未核對齊全前切勿轉幣；交易雜湊唔等於已核實入帳。','hint'));
    const paid=o.paidVerified&&['owner_verified','stripe_paid','paypal_paid'].includes(o.paymentStatus);
    section.append(el('p',paid?
      (o.paymentStatus==='stripe_paid'?'✅ Stripe 已經由簽名 Webhook 核實入帳':o.paymentStatus==='paypal_paid'?'✅ PayPal 官方 API 已核實並完成收款':'✅ 店主已核實商戶交易紀錄'):
      '付款狀態：尚未核實付款。離開付款網站或返回本頁，都唔代表付款成功。'));
    section.append(el('p',data.botMessage||'已收到你的訂單查詢。'));
    const refresh=el('button','重新整理訂單及付款狀態','btn outline');
    refresh.type='button';refresh.onclick=()=>location.reload();section.append(refresh);
    target.replaceChildren(section);
  }catch(e){target.replaceChildren(el('p',e.message||'訂單查詢暫時不可使用'));}
})();
