import {randomBytes,createHash} from 'node:crypto';
import {checkoutAmountCents,quoteHash} from './checkout-payments.mjs';
import {buildPayPalOrder,paypalApprovalUrl,validPayPalOrderId,
        validCapturedPayPalOrder,paypalWebhookFields} from './paypal-payments.mjs';

/**
 * Direct PayPal Orders v2 + authenticated capture + verified webhook. 
 * No credentials, card numbers, FPS banking data or USDT private keys in source.
 */
export function createPayPalController({DB,ensureTable,send,parseJSON,unpackJsonValue,limit}) {
  const mode=process.env.PAYPAL_MODE==='live'?'live':'sandbox';
  function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
  function publicSite(){
    const raw=String(process.env.PUBLIC_SITE_URL||'');
    try{
      const u=new URL(raw);
      if(!((u.protocol==='https:')||
        (process.env.NODE_ENV==='test'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))||
        u.username||u.password||u.search||u.hash||u.pathname!=='/')return '';
      return u.href;
    }catch{return '';}
  }
  function configured(){
    return !!DB&&!!publicSite()&&String(process.env.PAYPAL_CLIENT_ID||'').length>8&&
      String(process.env.PAYPAL_CLIENT_SECRET||'').length>8&&
      String(process.env.PAYPAL_WEBHOOK_ID||'').length>=8&&
      (mode!=='live'||process.env.PAYPAL_LIVE_APPROVED==='true');
  }
  const available=()=>configured()&&process.env.PAYPAL_CHECKOUT_ENABLED==='true';
  function gateway(){
    if(process.env.NODE_ENV==='test'&&process.env.PAYPAL_MOCK_BASE_URL){
      const u=new URL(process.env.PAYPAL_MOCK_BASE_URL);
      if(u.protocol!=='http:'||!['localhost','127.0.0.1'].includes(u.hostname)||
        u.username||u.password||u.pathname!=='/'||u.search||u.hash)
        throw Error('PayPal mock endpoint must be local');
      return u.origin;
    }
    return mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  }
  async function oauth(){
    const basic=Buffer.from(process.env.PAYPAL_CLIENT_ID+':'+process.env.PAYPAL_CLIENT_SECRET).toString('base64');
    const res=await fetch(gateway()+'/v1/oauth2/token',{
      method:'POST',headers:{
        Authorization:'Basic '+basic,
        'Content-Type':'application/x-www-form-urlencoded'
      },body:'grant_type=client_credentials',signal:AbortSignal.timeout(14000)
    });
    if(!res.ok)throw Error('PayPal OAuth failed');
    const data=await res.json();
    if(typeof data.access_token!=='string'||data.access_token.length<8)throw Error('Missing PayPal access token');
    return data.access_token;
  }
  async function call(method,path,body,requestId){
    const key=await oauth();
    const headers={Authorization:'Bearer '+key,'Content-Type':'application/json',
      Accept:'application/json'};
    if(requestId)headers['PayPal-Request-Id']=requestId;
    const res=await fetch(gateway()+path,{method,headers,
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(18000)});
    if(!res.ok)throw Error('PayPal '+path.split('/').slice(0,4).join('/')+' returned '+res.status);
    return res.status===204?{}:await res.json();
  }
  const statusError=e=>e?.status?e.status:503;
  const safeError=e=>e?.status?e.message:'PayPal 暫時未能完成請求，請核實付款狀態後再試';

  // The bearer token is the random secret URL sent only after submitting a valid enquiry.
  async function create(req){
    if(!available())return send({ok:false,error:'PayPal 網上結帳暫未啟用；請使用人工收款方式'},503);
    if(limit(req))return send({ok:false,error:'提交太密，請稍後再試'},429);
    let lockData=null;
    try{
      const body=await parseJSON(req),token=String(body.token||'');
      if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('私人訂單識別碼無效');
      await ensureTable();
      const receiptHash=createHash('sha256').update(token).digest('hex');
      const lock=randomBytes(12).toString('hex');
      const picked=await DB.begin(async tx=>{
        const found=await tx`SELECT id,quote,status,payment_verified_at,
          stripe_session_id,paypal_order_id,paypal_approval_url,
          paypal_quote_hash,paypal_mode,paypal_order_created_at,
          paypal_create_lock,paypal_create_lock_at
          FROM lumenda_orders WHERE receipt_token_hash=${receiptHash} FOR UPDATE`;
        if(!found.length)fail('搵唔到訂單',404);
        const o=found[0],q=unpackJsonValue(o.quote,null);
        if(o.status==='cancelled'||o.payment_verified_at)fail('訂單已完成或已取消',409);
        if(!q||q.paymentLink||o.stripe_session_id)fail('請先向賣家取得 PayPal 正式報價',409);
        checkoutAmountCents(q);
        const fingerprint=quoteHash(o.id,q);
        if(o.paypal_order_id){
          if(o.paypal_quote_hash!==fingerprint||o.paypal_mode!==mode)
            fail('原有 PayPal 訂單資料不符，請轉人工處理',409);
          // Never create a second order while a previous PayPal order might have captured funds.
          if(new Date(o.paypal_order_created_at).getTime()<Date.now()-2*60*60*1000)
            fail('付款連結已過期，請管理員核實後重新安排',409);
          const link=paypalApprovalUrl([{rel:'approve',href:o.paypal_approval_url}],mode);
          return {reuse:true,url:link,id:o.paypal_order_id};
        }
        if(o.paypal_create_lock&&o.paypal_create_lock_at &&
          Date.now()-new Date(o.paypal_create_lock_at).getTime()<120000)
          fail('PayPal 付款頁正在建立，請勿重複提交',409);
        await tx`UPDATE lumenda_orders SET paypal_create_lock=${lock},paypal_create_lock_at=now()
          WHERE id=${o.id}`;
        return {id:o.id,quote:q,fingerprint,lock};
      });
      if(picked.reuse)return send({ok:true,provider:'paypal',mode,url:picked.url,reused:true});
      lockData=picked;
      const {payload,amountCents}=buildPayPalOrder({orderId:picked.id,
        quote:picked.quote,publicSiteUrl:publicSite()});
      const response=await call('POST','/v2/checkout/orders',payload,
        'lumenda-create-'+picked.lock);
      if(!validPayPalOrderId(response.id)||
         response.status!=='CREATED'&&response.status!=='PAYER_ACTION_REQUIRED'||
         amountCents!==checkoutAmountCents(picked.quote))
        throw Error('Unexpected PayPal order create response');
      const approval=paypalApprovalUrl(response.links,mode);
      if(new URL(approval).searchParams.get('token')!==response.id)
        throw Error('PayPal approval link does not belong to this order');
      const saved=await DB`UPDATE lumenda_orders SET paypal_order_id=${response.id},
        paypal_approval_url=${approval},paypal_quote_hash=${picked.fingerprint},
        paypal_mode=${mode},paypal_order_created_at=now(),
        paypal_create_lock=NULL,paypal_create_lock_at=NULL,
        payment_status='paypal_approval_pending'
        WHERE id=${picked.id} AND paypal_create_lock=${picked.lock}
          AND payment_verified_at IS NULL AND paypal_order_id IS NULL
          AND quote->>'quotedAt'=${picked.quote.quotedAt}
        RETURNING id`;
      if(!saved.length)fail('訂單狀態已更新，請聯絡賣家核對 PayPal',409);
      return send({ok:true,provider:'paypal',mode,url:approval,reused:false});
    }catch(e){
      if(lockData?.id&&lockData.lock){
        try{await DB`UPDATE lumenda_orders SET paypal_create_lock=NULL,paypal_create_lock_at=NULL
          WHERE id=${lockData.id} AND paypal_create_lock=${lockData.lock}`;}catch{}
      }
      console.warn('PayPal order create issue',e?.status||e?.name||'error');
      return send({ok:false,error:safeError(e)},statusError(e));
    }
  }

  async function recordCompletedPayPalOrder(paypalOrder,lockedOrder,captureLock=null){
    const quote=unpackJsonValue(lockedOrder.quote,null);
    if(!quote||lockedOrder.paypal_quote_hash!==quoteHash(lockedOrder.id,quote)||
       lockedOrder.paypal_mode!==mode||lockedOrder.status==='cancelled')
      fail('PayPal 報價資料不符，請人工核查',409);
    const result=validCapturedPayPalOrder(paypalOrder,{
      orderId:lockedOrder.id,paypalOrderId:lockedOrder.paypal_order_id,quote});
    if(!result)fail('PayPal 付款狀態或港幣金額不符，請人工核查',409);
    const updated=await DB`UPDATE lumenda_orders SET payment_status='paypal_paid',
      payment_reference=${result.captureId},paypal_capture_id=${result.captureId},
      payment_verified_at=now(),paypal_capture_lock=NULL,paypal_capture_lock_at=NULL
      WHERE id=${lockedOrder.id} AND payment_verified_at IS NULL
        AND paypal_order_id=${lockedOrder.paypal_order_id}
        AND paypal_quote_hash=${lockedOrder.paypal_quote_hash}
        AND status<>'cancelled'
        AND (${captureLock}::text IS NULL OR paypal_capture_lock=${captureLock})
      RETURNING id`;
    if(updated.length)return {ok:true,verified:true,captureId:result.captureId};
    const check=await DB`SELECT payment_status,paypal_capture_id FROM lumenda_orders WHERE id=${lockedOrder.id}`;
    if(check[0]?.payment_status==='paypal_paid'&&check[0]?.paypal_capture_id===result.captureId)
      return {ok:true,verified:true,duplicate:true,captureId:result.captureId};
    fail('PayPal 入帳與訂單狀態存在衝突，需要人工對帳',409);
  }

  async function capture(req){
    if(!configured())return send({ok:false,error:'PayPal 收款核實服務暫未設定'},503);
    if(limit(req))return send({ok:false,error:'操作太頻密，請稍後再試'},429);
    let lockData=null;
    try{
      const body=await parseJSON(req),token=String(body.token||'');
      if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('私人訂單識別碼無效');
      await ensureTable();
      const receiptHash=createHash('sha256').update(token).digest('hex');
      const lock=randomBytes(12).toString('hex');
      const picked=await DB.begin(async tx=>{
        const found=await tx`SELECT id,quote,status,payment_verified_at,
          paypal_order_id,paypal_quote_hash,paypal_mode,paypal_capture_id,
          paypal_capture_lock,paypal_capture_lock_at
          FROM lumenda_orders WHERE receipt_token_hash=${receiptHash} FOR UPDATE`;
        if(!found.length)fail('搵唔到私人訂單',404);
        const o=found[0];
        if(o.payment_verified_at&&o.paypal_capture_id&&o.paypal_mode===mode)
          return {already:true,captureId:o.paypal_capture_id};
        if(o.status==='cancelled'||o.payment_verified_at||!validPayPalOrderId(o.paypal_order_id)||
           o.paypal_mode!==mode||!o.quote)fail('PayPal 訂單未完成付款準備',409);
        if(o.paypal_capture_lock&&o.paypal_capture_lock_at &&
          Date.now()-new Date(o.paypal_capture_lock_at).getTime()<120000)
          fail('正喺 PayPal 核實交易，請勿重複操作',409);
        const q=unpackJsonValue(o.quote,null);
        if(quoteHash(o.id,q)!==o.paypal_quote_hash)fail('原有報價已變更，請轉人工',409);
        checkoutAmountCents(q);
        await tx`UPDATE lumenda_orders SET paypal_capture_lock=${lock},paypal_capture_lock_at=now()
          WHERE id=${o.id}`;
        return {...o,lock};
      });
      if(picked.already)return send({ok:true,verified:true,duplicate:true,provider:'paypal'});
      lockData=picked;
      let paid;
      try{
        paid=await call('POST','/v2/checkout/orders/'+picked.paypal_order_id+'/capture',{},
          'lumenda-capture-'+picked.paypal_order_id);
      }catch(firstError){
        // A network timeout after funds were captured must never cause a second charge.
        // Read back from PayPal using authenticated GET before treating it as failed.
        paid=await call('GET','/v2/checkout/orders/'+picked.paypal_order_id);
      }
      const confirmed=await recordCompletedPayPalOrder(paid,picked,picked.lock);
      return send({...confirmed,provider:'paypal'});
    }catch(e){
      console.warn('PayPal capture issue',e?.status||e?.name||'error');
      return send({ok:false,error:safeError(e)},statusError(e));
    }finally{
      if(lockData?.lock){
        try{await DB`UPDATE lumenda_orders SET paypal_capture_lock=NULL,paypal_capture_lock_at=NULL
          WHERE id=${lockData.id} AND paypal_capture_lock=${lockData.lock}`;}catch{}
      }
    }
  }

  async function webhook(req){
    if(!configured())return send({ok:false,error:'PayPal webhook 尚未設定'},503);
    try{
      const raw=await req.text();
      if(raw.length>200000)fail('PayPal webhook 過大',413);
      let event;try{event=JSON.parse(raw);}catch{fail('PayPal webhook 格式無效');}
      const fields=paypalWebhookFields(event,req.headers,process.env.PAYPAL_WEBHOOK_ID);
      const verified=await call('POST','/v1/notifications/verify-webhook-signature',fields);
      if(verified.verification_status!=='SUCCESS')fail('PayPal webhook 簽署驗證失敗',401);
      if(event.event_type!=='PAYMENT.CAPTURE.COMPLETED')
        return send({ok:true,ignored:true});
      const relatedId=event.resource?.supplementary_data?.related_ids?.order_id;
      const captureId=event.resource?.id;
      if(!validPayPalOrderId(relatedId)||!/^[A-Z0-9]{8,36}$/.test(captureId||''))
        fail('PayPal webhook 缺少有效訂單識別',400);
      await ensureTable();
      const found=await DB`SELECT id,quote,status,payment_verified_at,paypal_order_id,
        paypal_quote_hash,paypal_mode,paypal_capture_id
        FROM lumenda_orders WHERE paypal_order_id=${relatedId} LIMIT 1`;
      if(!found.length)return send({ok:true,ignored:true});
      const o=found[0];
      if(o.payment_verified_at&&o.paypal_capture_id===captureId)return send({ok:true,duplicate:true});
      if(o.status==='cancelled'||o.payment_verified_at)
        fail('訂單已取消或由其他方式收款，請人工核對',409);
      const fresh=await call('GET','/v2/checkout/orders/'+relatedId);
      const parsed=validCapturedPayPalOrder(fresh,{orderId:o.id,paypalOrderId:relatedId,
        quote:unpackJsonValue(o.quote,null)});
      if(!parsed||parsed.captureId!==captureId)fail('PayPal webhook 與實際入帳金額不相符',409);
      return send(await recordCompletedPayPalOrder(fresh,o));
    }catch(e){
      console.warn('PayPal webhook rejected',e?.status||e?.name||'error');
      return send({ok:false,error:e?.status?e.message:'PayPal 通知驗證失敗'},e?.status||400);
    }
  }

  return {available,configured,mode,create,capture,webhook};
}
