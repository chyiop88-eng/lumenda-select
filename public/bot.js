'use strict';
(() => {
  const $=id=>document.getElementById(id),form=$('conciergeForm'),input=$('conciergeQuestion'),output=$('conciergeMessages');
  if(!form||!input||!output)return;
  const t=key=>window.LUMENDA_I18N?.t($('language')?.value||'zh-Hant',key)||key;
  let busy=false;
  function bubble(content,kind){
    const p=document.createElement('p');p.className='concierge-bubble concierge-bubble--'+kind;p.textContent=content;output.append(p);
    output.scrollTop=output.scrollHeight;
  }
  form.addEventListener('submit',async ev=>{
    ev.preventDefault();if(busy)return;
    const message=input.value.trim();
    if(message.length<2||message.length>350){bubble('請輸入 2–350 字問題。','system');return;}
    bubble(message,'user');input.value='';busy=true;
    const button=$('conciergeSend');button.disabled=true;
    try{
      const response=await fetch('/api/bot/reply',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message,language:$('language')?.value||'zh-Hant'}),signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      bubble(response.ok?String(data.reply||''):String(data.error||'暫時無法回覆，請用訂單表格提交查詢'),'system');
      const mode=$('conciergeMode');if(mode)mode.textContent=data.mode==='grok'?'AI · Grok':'客服 · 自動回覆';
    }catch{bubble('暫時未能連線，請稍後再試或者提交訂單查詢。','system');}
    finally{busy=false;button.disabled=false;input.focus();}
  });
  bubble(t('chatWelcome'),'system');
})();
