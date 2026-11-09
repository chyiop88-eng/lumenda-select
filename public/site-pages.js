'use strict';
/* Shared multipage navigation, customer-safe session cart and optional showcase.
 * No automated customer support, API keys or payment requests are made here. */
(()=>{
  const i18n=window.LUMENDA_I18N;
  if(!i18n)return;
  const checkout=!!document.getElementById('orderForm');
  const languagePicker=document.getElementById('language');
  const CART_KEY='lumenda_cart_v1';
  const VALID_SKUS=new Set(['FTE230','FTE330','GENOPTICS50']);
  const messages={
    'zh-Hant':{home:'首頁',catalog:'所有商品',about:'購物須知',cartNav:'購物車',details:'查看詳情',
      addToCart:'加入購物車',goToCheckout:'前往購物車／落單',backCatalog:'返回商品目錄',askQuote:'另行報價',
      collectionTitle:'明星產品目錄',collectionIntro:'獨立商品詳情、清晰標價，再到購物車提交訂單查詢。',
      detailIntro:'獨立商品詳情頁。商品標價以人民幣顯示，實際支付以正式報價為準。',
      sizeLabel:'商品規格',currencyLabel:'商品標價幣種',paymentLabel:'付款安排',
      quoteBeforePay:'核實運費／稅項／港幣報價後再安排付款',
      checkoutDisclosure:'提交訂單查詢不會扣款。請等待賣家確認商品、配送與結算價。',
      moreProducts:'探索其他商品',homeStepHeading:'由探索開始，慢慢挑選',
      homeStepDesc:'瀏覽獨立商品頁、查看清晰容量與人民幣標價；揀啱產品後，再去購物車提交查詢。',
      checkoutTitle:'購物車與訂單查詢',checkoutIntro:'選擇產品、填寫聯絡與配送資料，提交後等候正式港幣報價。',
      aboutTitle:'購物與配送須知',aboutIntro:'清楚了解查詢、報價與付款嘅分別。',
      guideStepOne:'選擇商品',guideStepOneDesc:'前往商品目錄，揀選神仙水 230ml／330ml 或小燈泡，加入購物車。',
      guideStepTwo:'提交查詢',guideStepTwoDesc:'填寫收件地、聯絡資料及付款偏好；完成提交後獲得私人訂單進度連結。',
      guideStepThree:'等候正式報價',guideStepThreeDesc:'賣家核對供應、港幣換算匯率、運費與稅費。未經核實不會直接扣款。',
      shippingTitle:'配送、運費與付款',shippingPolicyDetail:'經賣家確認嘅港幣商品小計滿 HK$4,000 可免運費；未滿門檻需按收件地另報運費。適用稅費另計；免運不等於免稅。',
      currencyPolicyDetail:'神仙水 230ml 標價 CNY ¥750、330ml 標價 CNY ¥990。港幣應付金額必須以賣家核實嘅匯率及報價為準。'},
    'zh-Hans':{home:'首页',catalog:'全部商品',about:'购物须知',cartNav:'购物车',details:'查看详情',
      addToCart:'加入购物车',goToCheckout:'前往购物车／下单',backCatalog:'返回商品目录',askQuote:'另行报价',
      collectionTitle:'明星产品目录',collectionIntro:'独立商品详情、清晰标价，再到购物车提交订单咨询。',
      detailIntro:'独立商品详情页。商品标价为人民币，实际付款以正式报价为准。',
      sizeLabel:'商品规格',currencyLabel:'商品标价币种',paymentLabel:'付款安排',
      quoteBeforePay:'核实运费、税费和港币报价后安排付款',
      checkoutDisclosure:'提交订单咨询不会扣款。请等待卖家确认商品、配送及结算金额。',
      moreProducts:'探索其他商品',homeStepHeading:'从探索开始，慢慢挑选',homeStepDesc:'浏览独立商品页，查看规格和人民币价格，再去购物车提交咨询。',
      checkoutTitle:'购物车与订单咨询',checkoutIntro:'选择商品，填写联系方式和配送资料，等待正式港币报价。',
      aboutTitle:'购物与配送须知',aboutIntro:'清楚了解咨询、报价与付款的区别。',
      guideStepOne:'选择商品',guideStepOneDesc:'前往商品目录，选择神仙水 230ml／330ml 或小灯泡加入购物车。',
      guideStepTwo:'提交咨询',guideStepTwoDesc:'填写收件地、联系方式及付款偏好，提交后获得私人订单查询链接。',
      guideStepThree:'等待正式报价',guideStepThreeDesc:'卖家核实库存、汇率、运费和税费；未核实前不会直接扣款。',
      shippingTitle:'配送、运费与付款',shippingPolicyDetail:'卖家确认的港币商品小计满 HK$4,000 可免运费，不足则另报运费及税费；免运不等于免税。',
      currencyPolicyDetail:'神仙水 230ml CNY ¥750、330ml CNY ¥990；港币应付金额须由卖家确认汇率及报价。'},
    'en':{home:'Home',catalog:'Products',about:'Order Guide',cartNav:'Cart',details:'View details',
      addToCart:'Add to cart',goToCheckout:'Cart & order enquiry',backCatalog:'Back to products',askQuote:'Quote on request',
      collectionTitle:'The Collection',collectionIntro:'Explore separate product details and prices before submitting an order enquiry.',
      detailIntro:'Individual product details. List prices are in CNY; payment requires a confirmed quotation.',
      sizeLabel:'Size',currencyLabel:'List price currency',paymentLabel:'Payment',
      quoteBeforePay:'Subject to confirmed shipping, taxes and HKD quotation',
      checkoutDisclosure:'An enquiry does not charge you. The seller must confirm the product, delivery and final price.',
      moreProducts:'Discover more',homeStepHeading:'A considered selection',
      homeStepDesc:'Explore individual products, compare sizes and CNY prices, then send an enquiry through the cart.',
      checkoutTitle:'Cart & Order Enquiry',checkoutIntro:'Choose products and enter delivery details; a confirmed HKD quote comes later.',
      aboutTitle:'Shopping & Delivery',aboutIntro:'Understand the difference between enquiries, quotations and payments.',
      guideStepOne:'Choose products',guideStepOneDesc:'Browse the collection and add your preferred SK-II items to the cart.',
      guideStepTwo:'Submit enquiry',guideStepTwoDesc:'Provide delivery and contact details to receive a private order tracking link.',
      guideStepThree:'Await confirmation',guideStepThreeDesc:'The seller checks availability, HKD exchange rate, shipping and taxes. No automatic charge.',
      shippingTitle:'Shipping & Payments',shippingPolicyDetail:'Free shipping applies to seller-confirmed HKD merchandise subtotals of HK$4,000 or more. Below that, shipping is quoted. Taxes may still apply.',
      currencyPolicyDetail:'Facial Treatment Essence 230ml CNY ¥750; 330ml CNY ¥990. HKD payable totals require an approved exchange rate and quotation.'},
    'ms':{home:'Utama',catalog:'Produk',about:'Panduan Belian',cartNav:'Troli',details:'Lihat butiran',addToCart:'Tambah ke troli',goToCheckout:'Troli & pertanyaan',backCatalog:'Kembali ke produk',askQuote:'Harga atas permintaan',
      collectionTitle:'Koleksi Pilihan',collectionIntro:'Lihat maklumat produk dan harga sebelum menghantar pertanyaan pesanan.',
      detailIntro:'Harga katalog dalam CNY. Pembayaran tertakluk kepada sebut harga yang disahkan.',
      sizeLabel:'Saiz',currencyLabel:'Mata wang',paymentLabel:'Pembayaran',quoteBeforePay:'Selepas pengesahan penghantaran, cukai dan sebut harga HKD',
      checkoutDisclosure:'Pertanyaan tidak mengenakan bayaran. Penjual akan sahkan stok dan harga.',
      moreProducts:'Produk lain',homeStepHeading:'Pilih dengan yakin',homeStepDesc:'Lihat produk dan harga CNY, kemudian hantar pertanyaan melalui troli.',
      checkoutTitle:'Troli & Pertanyaan Pesanan',checkoutIntro:'Pilih produk dan isi butiran penghantaran untuk mendapat sebut harga HKD.',
      aboutTitle:'Pembelian & Penghantaran',aboutIntro:'Maklumat pertanyaan, sebut harga dan pembayaran.',
      guideStepOne:'Pilih produk',guideStepOneDesc:'Pilih produk SK-II di halaman katalog dan tambah ke troli.',
      guideStepTwo:'Hantar pertanyaan',guideStepTwoDesc:'Isi butiran penghantaran dan dapatkan pautan status pesanan.',
      guideStepThree:'Tunggu sebut harga',guideStepThreeDesc:'Penjual akan semak stok, kadar HKD, penghantaran dan cukai.',
      shippingTitle:'Penghantaran & Pembayaran',shippingPolicyDetail:'Penghantaran percuma bagi subtotal barangan HKD yang disahkan sekurang-kurangnya HK$4,000. Cukai dikenakan berasingan.',
      currencyPolicyDetail:'230ml CNY ¥750; 330ml CNY ¥990. Jumlah HKD tertakluk kepada kadar tukaran yang diluluskan.'},
    'vi':{home:'Trang chủ',catalog:'Sản phẩm',about:'Hướng dẫn mua',cartNav:'Giỏ hàng',details:'Xem chi tiết',addToCart:'Thêm vào giỏ',goToCheckout:'Giỏ hàng & yêu cầu',backCatalog:'Quay lại sản phẩm',askQuote:'Liên hệ báo giá',
      collectionTitle:'Bộ sưu tập',collectionIntro:'Xem từng sản phẩm và giá trước khi gửi yêu cầu đặt hàng.',
      detailIntro:'Giá niêm yết bằng CNY; thanh toán cần báo giá chính thức.',
      sizeLabel:'Dung tích',currencyLabel:'Đơn vị tiền',paymentLabel:'Thanh toán',quoteBeforePay:'Sau khi xác nhận phí vận chuyển, thuế và giá HKD',
      checkoutDisclosure:'Gửi yêu cầu không bị trừ tiền. Người bán sẽ xác nhận hàng, giao hàng và giá.',
      moreProducts:'Sản phẩm khác',homeStepHeading:'Khám phá và lựa chọn',homeStepDesc:'Xem sản phẩm, dung tích và giá CNY rồi gửi yêu cầu qua giỏ hàng.',
      checkoutTitle:'Giỏ hàng & Yêu cầu',checkoutIntro:'Chọn sản phẩm và cung cấp thông tin giao hàng để nhận báo giá HKD.',
      aboutTitle:'Mua hàng & Giao hàng',aboutIntro:'Hiểu rõ các bước yêu cầu, báo giá và thanh toán.',
      guideStepOne:'Chọn sản phẩm',guideStepOneDesc:'Chọn sản phẩm SK-II và thêm vào giỏ hàng.',
      guideStepTwo:'Gửi yêu cầu',guideStepTwoDesc:'Điền thông tin giao hàng và nhận liên kết theo dõi đơn riêng.',
      guideStepThree:'Chờ xác nhận',guideStepThreeDesc:'Người bán xác nhận hàng, tỷ giá HKD, vận chuyển và thuế.',
      shippingTitle:'Vận chuyển & Thanh toán',shippingPolicyDetail:'Miễn phí vận chuyển khi giá trị hàng hóa HKD đã xác nhận đạt HK$4.000. Thuế tính riêng.',
      currencyPolicyDetail:'230ml CNY ¥750; 330ml CNY ¥990. Tổng thanh toán HKD phụ thuộc báo giá chính thức.'},
    'th':{home:'หน้าแรก',catalog:'สินค้า',about:'วิธีสั่งซื้อ',cartNav:'ตะกร้า',details:'ดูรายละเอียด',addToCart:'ใส่ตะกร้า',goToCheckout:'ตะกร้าและสอบถาม',backCatalog:'กลับไปหน้าสินค้า',askQuote:'สอบถามราคา',
      collectionTitle:'สินค้าแนะนำ',collectionIntro:'ดูรายละเอียดสินค้าและราคา ก่อนส่งคำขอสั่งซื้อ',
      detailIntro:'ราคาหน้าเว็บเป็น CNY ยอดชำระต้องยืนยันใบเสนอราคา',
      sizeLabel:'ขนาด',currencyLabel:'สกุลเงิน',paymentLabel:'การชำระเงิน',quoteBeforePay:'หลังยืนยันค่าจัดส่ง ภาษี และราคา HKD',
      checkoutDisclosure:'การส่งคำขอไม่ตัดเงิน ผู้ขายจะยืนยันสินค้า การจัดส่ง และยอดเงิน',
      moreProducts:'ดูสินค้าอื่น',homeStepHeading:'เลือกสินค้าอย่างมั่นใจ',homeStepDesc:'เลือกดูรายละเอียด ขนาด และราคา CNY แล้วส่งคำขอผ่านตะกร้า',
      checkoutTitle:'ตะกร้าและคำขอสั่งซื้อ',checkoutIntro:'เลือกสินค้าและกรอกที่อยู่ เพื่อรับใบเสนอราคา HKD',
      aboutTitle:'วิธีสั่งซื้อและจัดส่ง',aboutIntro:'ขั้นตอนการสอบถาม ยืนยันราคา และชำระเงิน',
      guideStepOne:'เลือกสินค้า',guideStepOneDesc:'เลือกผลิตภัณฑ์ SK-II และเพิ่มลงตะกร้า',
      guideStepTwo:'ส่งคำขอ',guideStepTwoDesc:'กรอกข้อมูลจัดส่งและรับลิงก์ตรวจสถานะส่วนตัว',
      guideStepThree:'รอยืนยันราคา',guideStepThreeDesc:'ผู้ขายตรวจสอบสินค้า อัตราแลกเปลี่ยน HKD ค่าจัดส่ง และภาษี',
      shippingTitle:'จัดส่งและชำระเงิน',shippingPolicyDetail:'ส่งฟรีเมื่อยอดสินค้าสกุล HKD ที่ผู้ขายยืนยันตั้งแต่ HK$4,000 ขึ้นไป ไม่รวมภาษี',
      currencyPolicyDetail:'230ml CNY ¥750 และ 330ml CNY ¥990 ยอด HKD ต้องรอผู้ขายยืนยันราคา'}
  };
  function storedLanguage(){
    try{const x=sessionStorage.getItem('lumenda_language');return i18n.TEXT[x]?x:'zh-Hant';}catch{return 'zh-Hant';}
  }
  function saveLanguage(l){try{sessionStorage.setItem('lumenda_language',l);}catch{}}
  function readCart(){
    let raw;try{raw=JSON.parse(sessionStorage.getItem(CART_KEY)||'{}');}catch{raw={};}
    const cart={};
    for(const [sku,qty] of Object.entries(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{})){
      const n=Number(qty);
      if(VALID_SKUS.has(sku)&&Number.isInteger(n)&&n>0&&n<=30)cart[sku]=n;
    }
    return cart;
  }
  function updateCartBadge(){
    const count=Object.values(readCart()).reduce((a,b)=>a+b,0);
    document.querySelectorAll('.nav-cart-count').forEach(e=>{e.textContent=String(count);});
  }
  function rememberMarketingContext(){
    const search=new URLSearchParams(location.search);
    const raw=String(search.get('ref')||'').toUpperCase();
    const src=String(search.get('utm_source')||'').toLowerCase();
    try{
      if(/^(AG|RF)[A-F0-9]{14}$/.test(raw))sessionStorage.setItem('lumenda_referral',raw);
      if(['facebook','instagram','whatsapp','88db','google','carousell','direct','other'].includes(src))
        sessionStorage.setItem('lumenda_marketing_source',src);
    }catch{}
  }
  function paintLanguage(lang){
    const current=messages[lang]||messages['zh-Hant'];
    document.documentElement.lang=lang;
    if(!checkout){
      for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=i18n.t(lang,el.dataset.i18n);
    }
    for(const el of document.querySelectorAll('[data-site-text]')){
      const key=el.dataset.siteText;
      const value=current[key]||messages['en'][key]||messages['zh-Hant'][key];
      if(value)el.textContent=value;
    }
    saveLanguage(lang);
    updateCartBadge();
  }
  // Mark the current site section for keyboard and screen-reader navigation.
  const currentPath=location.pathname.replace(/\/$/,'')||'/';
  for(const item of document.querySelectorAll('.navigation-links a')){
    const itemPath=new URL(item.href,location.origin).pathname.replace(/\/$/,'')||'/';
    if(itemPath===currentPath||(itemPath==='/products'&&currentPath.startsWith('/product/')))
      item.setAttribute('aria-current','page');
  }
  window.addEventListener('lumenda:language',event=>{
    const lang=event.detail?.lang;
    if(i18n.TEXT[lang])paintLanguage(lang);
  });
  rememberMarketingContext();
  if(languagePicker&&!checkout){
    for(const [code,label] of i18n.LANG_OPTIONS)languagePicker.add(new Option(label,code));
    languagePicker.value=storedLanguage();
    languagePicker.addEventListener('change',()=>paintLanguage(languagePicker.value));
    paintLanguage(languagePicker.value);
  }else{
    paintLanguage(storedLanguage());
    // Checkout's own app controls the selector and the full translated order form.
    languagePicker?.addEventListener('change',()=>paintLanguage(languagePicker.value));
  }
  document.querySelectorAll('[data-add-sku]').forEach(link=>{
    link.addEventListener('click',event=>{
      const sku=link.dataset.addSku;
      if(!VALID_SKUS.has(sku))return;
      event.preventDefault();
      const cart=readCart();
      cart[sku]=Math.min(30,(cart[sku]||0)+1);
      try{sessionStorage.setItem(CART_KEY,JSON.stringify(cart));}catch{}
      location.assign('/checkout');
    });
  });
  updateCartBadge();

  // Existing admin-managed cinematic slots remain usable on the homepage.
  if(!document.getElementById('brandCinema'))return;
  const stages=[
    {slot:'brand',wrapper:'brandCinema',host:'brandMediaHost'},
    {slot:'fte',wrapper:'fteMediaSlot',host:'fteMediaHost'},
    {slot:'aura',wrapper:'auraMediaSlot',host:'auraMediaHost'}
  ];
  (async()=>{
    let slots;
    try{
      const response=await fetch('/api/showcase',{cache:'no-store',credentials:'omit'});
      if(!response.ok)return;
      const payload=await response.json();if(!payload.ok)return;slots=payload.slots||{};
    }catch{return;}
    for(const cfg of stages){
      const wrapper=document.getElementById(cfg.wrapper),host=document.getElementById(cfg.host);
      if(!wrapper||!host)continue;
      const item=slots[cfg.slot];if(!item||!['video','motion'].includes(item.kind))continue;
      let u;try{u=new URL(item.url);}catch{continue;}
      if(u.protocol!=='https:'||u.username||u.password)continue;
      if(item.kind==='motion'&&(item.provider!=='image'||!/\.(gif|webp|apng)$/i.test(u.pathname)))continue;
      if(item.kind==='video'){
        const valid=(item.provider==='file'&&/\.(mp4|webm)$/i.test(u.pathname))||
          (item.provider==='youtube'&&u.hostname==='www.youtube-nocookie.com'&&/^\/embed\/[A-Za-z0-9_-]{11}$/.test(u.pathname))||
          (item.provider==='vimeo'&&u.hostname==='player.vimeo.com'&&/^\/video\/\d+$/.test(u.pathname));
        if(!valid)continue;
      }
      const screen=document.createElement('div');
      screen.className='showcase-video-screen showcase-video-screen--'+cfg.slot;
      if(item.kind==='motion'){
        const image=document.createElement('img');image.className='motion-image';
        image.src=u.href;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
        image.alt='LUMENDA SELECT '+cfg.slot+' visual';
        image.onerror=()=>{wrapper.hidden=true;};screen.append(image);
      }else if(item.provider==='file'){
        const video=document.createElement('video');
        video.src=u.href;video.poster=cfg.slot==='aura'?'/media/aura':'/media/fte';
        video.preload='none';video.muted=true;video.controls=true;video.playsInline=true;
        video.onerror=()=>{wrapper.hidden=true;};screen.append(video);
      }else{
        const preview=document.createElement('div');preview.className='showcase-video-screen__preview';
        const button=document.createElement('button');button.type='button';
        button.className='showcase-video-screen__play';button.textContent='▶ Play';
        button.onclick=()=>{
          const frame=document.createElement('iframe');const full=new URL(u.href);
          full.searchParams.set('autoplay','1');full.searchParams.set(item.provider==='vimeo'?'muted':'mute','1');
          frame.src=full.href;frame.title='LUMENDA SELECT '+cfg.slot+' film';
          frame.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';
          frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';
          screen.replaceChildren(frame);screen.classList.remove('showcase-video-screen--external');
        };
        screen.classList.add('showcase-video-screen--external');screen.append(preview,button);
      }
      host.replaceChildren(screen);wrapper.hidden=false;
    }
  })();
})();
