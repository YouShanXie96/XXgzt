'use strict';

/**
 * 上品库 · 店铺会话上架驱动 v3（按老软件日志逐段对齐）
 *
 * 依据：老软件一件商品的上架日志顺序（用户提供 E:\临时下载\新建文本文档.txt）
 *   [1/1] 拉取详情 → 按本机草稿上架（参数改 N 项）→ 上架价格 → 打开发布页
 *   · [form-capture] 数据库发布模板 / 收录表单
 *   · [navigate]    直达发布页 fastpath → 品牌 + 系列 原生写入 → 回读
 *   · [fill-title]  填充标题
 *   · [fill-attrs]  填充属性（N 项）→ 店铺品牌原生核对
 *   · [fill-food]   食品安全（条码 / 保质期）
 *   · [fill-sku]    填充 SKU（N 条规格，价格 / 库存 / 多件优惠）
 *   · [fill-images] 主图 / 白底图 / 透明素材图 逐张上传 + 回读
 *   · [fill-detail] 详情图上传 + 逐项核对
 *   · [presubmit-province] 提交前补省份（DOM）
 *   · 提交（勾「放入仓库」）→ success.htm?auctionStatus=-5&primaryId=<id>
 *
 * 三条硬规则：
 *   1) 只用店铺自己的登录态（partition），不伪造 Cookie；
 *   2) 任一步拿不到字段就精确报错并保留发布页，绝不谎报「已入仓」；
 *   3) 每个阶段都写进上架队列日志，界面能像老软件一样看到逐行进度。
 *
 * 本轮修的两个真问题：
 *   - 之前「提交后 90 秒未收到入仓回执」：submit 是在页面里 await 的，
 *     表单提交会销毁执行上下文，页面里的循环永远等不到回执。现在改成
 *     「页面里只点一下提交」+「主进程轮询 URL / 页面提示」。
 *   - 之前只填标题：属性 / SKU / 图片 / 详情 / 物流都没填，必填项缺一大堆，提交必然被拦。
 */

const PUBLISH_HOST = 'https://sell.publish.tmall.com';
const pathModule = require('node:path');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 注入脚本的返回值可能已经是对象（例如脚本直接 return {…}），也可能是 JSON 字符串。
 * 统一入口，避免 "[object Object]" is not valid JSON 这类整段流程被打断的事故（2026-11-18 现场）。
 */
const asJson = value => {
  if (value && typeof value === 'object') return value;
  if (value == null) return null;
  try { return JSON.parse(String(value)); } catch { return null; }
};

/* ------------------------------------------------------------------ 页面脚本 */

/** 就绪 / 登录 / 风控 / 类目权限 探测 */
function probeScript() {
  return `(function(){
  var st=null;try{st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();}catch(e){}
  var body=(document.body&&document.body.innerText)||'';
  var url=location.href;
  // DOM 兜底：新版发布页把组件换成别的 store 时 __SELL_STATE__ 可能没有，
  // 只要页面上真有「标题输入框 + 提交按钮」，就认为可以开始填（用户 2026-11-11：别一上来就 PAGE_MISMATCH）。
  var titleInput=document.querySelector('#struct-title input, input[name="title"], .tm-title input, input[placeholder*="标题"]');
  var submitBtn=document.querySelector('button[name="button-submit"],button[type=submit],.next-btn-primary');
  var domReady=Boolean(titleInput&&submitBtn);
  var componentTitle=Boolean(st&&st.getComponentProps&&st.getComponentProps('title'));
  var staticHint=/请使用最新版chrome|功能缺失|欢迎使用万象客服|标题过长可能折叠/;
  return {
    ready:Boolean(st&&st.engine)||domReady,
    domReady:domReady,
    engine:Boolean(st&&st.engine),
    pathname:location.pathname,search:location.search,url:url.slice(0,300),
    login:/^login\\.(taobao|tmall)\\.com$/.test(location.hostname),
    blocked:/_____tmd_____|\\/punish|nocaptcha/.test(url)||Array.from(document.querySelectorAll('iframe')).some(function(f){return /_____tmd_____|\\/punish/.test(f.src||'');}),
    denied:/商品类目未授权|没有该类目权限/.test(body),
    hasTitle:componentTitle||Boolean(titleInput),
    formItems:document.querySelectorAll('.next-form-item,[class*="info-wrapper-wrap"],[class*="form-item"]').length,
    inputs:document.querySelectorAll('input:not([type=hidden]),textarea,select').length,
    fileInputs:document.querySelectorAll('input[type=file]').length,
    errorText:(function(){
      var out=[];
      document.querySelectorAll('.next-form-item-explain, .next-form-item-help, .next-message-error, [class*="errorText"], [class*="error-text"], [class*="error-msg"], [class*="errorMsg"], [class*="help-text"], [class*="form-item-help"], [role="alert"], [aria-invalid="true"], [class*="error-message"], [class*="feedback-content"], .sell-component-assistant-error-v2-sub-content, .sell-component-assistant-error-v2-error-content, .error-content-title').forEach(function(n){
        var t=(n.textContent||'').trim();if(t&&t.length<100&&/必填|不能为空|请填写|未填|校验失败|不能超过|字符|错误|缺失|过长|请修改|仅支持|格式|不支持|不合规|不符合|尺寸|像素/.test(t)&&!staticHint.test(t)&&out.indexOf(t)<0)out.push(t);
      });
      return out.slice(0,8);
    })()
  };
})()`;
}

/** 原生赋值 + React 事件（受控输入必须这么写才生效） */
// 同源 iframe 也要一起找：发布页有一部分模块挂在 iframe 里，
// 只在顶层 document 查会「一个字段都找不到」（用户 2026-11-12 上架填不进去的主因之一）。
const DOCS_SET = `
  function xxDocs(){
    var out=[document];
    try{
      var frames=document.querySelectorAll('iframe');
      for(var i=0;i<frames.length;i++){
        try{var d=frames[i].contentDocument;if(d&&d.documentElement)out.push(d);}catch(e){}
      }
    }catch(e){}
    return out;
  }
  function xxAll(sel){
    var out=[];
    var docs=xxDocs();
    for(var i=0;i<docs.length;i++){
      try{out=out.concat(Array.prototype.slice.call(docs[i].querySelectorAll(sel)));}catch(e){}
    }
    return out;
  }
`;

const NATIVE_SET = `${DOCS_SET}
  function xxSetNative(el,v){
    if(!el)return false;
    var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    var desc=Object.getOwnPropertyDescriptor(proto,'value');
    if(desc&&desc.set)desc.set.call(el,v);else el.value=v;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new Event('blur',{bubbles:true}));
    return true;
  }
  function xxTypeInto(el,v){
    if(!el)return false;
    var want=String(v==null?'':v);
    try{el.focus();}catch(e){}
    try{el.select();}catch(e){}
    var inserted=false;
    // 真实键盘/输入事件优先：React 受控框会把「直接改 value」回退掉（老软件 100% DOM 驱动原则）
    try{inserted=!!(el.ownerDocument||document).execCommand('insertText',false,want);}catch(e){inserted=false;}
    if(!inserted||String(el.value||'')!==want)xxSetNative(el,want);
    try{
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      el.blur();
    }catch(e){}
    return String(el.value||'')===want;
  }
  /** 按字段名找「所有」输入框。发布页两个 tab 会各自渲染一份同名控件，只写第一个必然漏。
   *  注意：每个 label 只取「所在行」里的第一个输入框，绝不能向上扩到 tab 容器，
   *  否则写导购标题时会把同 tab 的系列/卖点/其它字段一起覆盖掉。 */
  function xxInputsFor(name,selectors,includeLocked){
    var out=[],seen=[];
    function add(el){
      if(!el||!el.tagName||!/^(INPUT|TEXTAREA)$/.test(el.tagName))return;
      if(el.type&&/hidden|checkbox|radio|button|submit|file/i.test(el.type))return;
      if((!includeLocked&&(el.readOnly||el.disabled))||seen.indexOf(el)>=0)return;
      seen.push(el);out.push(el);
    }
    function firstInput(scope,locked){
      if(!scope||!scope.querySelector)return null;
      var sel='input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]):not([type=button]):not([type=submit]),textarea';
      // 系列这类「灰色展示框」是 readonly：includeLocked 时必须一并返回，
      // 否则即使调用方传了 true，标签定位路径仍会把唯一的控件漏掉（日志12「找到 0 个输入框」）。
      var list=Array.prototype.slice.call(scope.querySelectorAll(sel));
      for(var z=0;z<list.length;z++){
        if(!locked&&(list[z].readOnly||list[z].disabled))continue;
        return list[z];
      }
      return null;
    }
    var docs=xxDocs();
    for(var i=0;i<docs.length;i++){
      var d=docs[i];
      // 1) 精确选择器（id / name / 标记）优先
      for(var s=0;s<(selectors||[]).length;s++){
        try{var list=d.querySelectorAll(selectors[s]);for(var j=0;j<list.length;j++)add(list[j]);}catch(e){}
      }
      // 2) 标签匹配：每个标签只贡献所在行的一个控件
      try{
        var labels=Array.prototype.slice.call(d.querySelectorAll('label,.sell-component-info-wrapper-label,[class*="info-wrapper-label"],[class*="form-label"],th,dt,span,div'))
          .filter(function(n){return n.children.length<=1&&String(n.textContent||'').replace(/[:：*\\s]/g,'')===name;});
        for(var k=0;k<labels.length;k++){
          var row=labels[k].closest('[class*="info-wrapper-wrap"],[class*="form-item"],[class*="formItem"],tr,li')||labels[k].parentElement;
          var el=firstInput(row,includeLocked);
          if(el){add(el);continue;}
          var sib=labels[k].parentElement&&labels[k].parentElement.nextElementSibling;
          for(var g=0;g<2&&sib;g++){
            el=firstInput(sib,includeLocked);
            if(el){add(el);break;}
            sib=sib.nextElementSibling;
          }
        }
      }catch(e){}
    }
    // 新页面标签可以包含星号+文案+提示图标三个子元素，不能以 children.length 过滤。
    // 从精确文本标签向上找最小的单输入框容器，不依赖厂商 class，也不扩到整个属性面板。
    if(!out.length){
      for(var di=0;di<docs.length;di++){
        var ns=docs[di].querySelectorAll('label,span,div,th,dt');
        for(var ni=0;ni<ns.length;ni++){
          var nt=String(ns[ni].textContent||'').replace(/[:：*\\s\\u200b\\u00a0]/g,'');
          if(nt!==name)continue;
          var scope=ns[ni];
          for(var up=0;scope&&up<7;up++,scope=scope.parentElement){
            if(String(scope.textContent||'').length>160)break;
            var inputs=Array.prototype.slice.call(scope.querySelectorAll('input,textarea')).filter(function(x){
              return !/hidden|checkbox|radio|button|submit|file/.test(String(x.type||''));
            });
            if(inputs.length>1)break;
            if(inputs.length===1){add(inputs[0]);break;}
          }
        }
      }
    }
    // 标签可能还带副标题/提示（「系列 请输入」「商品系列」）：精确匹配全落空时再宽松找一次。
    // 限定长度且只收「容器中恰好 1 个输入框」的最小范围，避免把整块属性面板或 SKU 表头误当字段。
    if(!out.length){
      for(var fi=0;fi<docs.length;fi++){
        var fns=docs[fi].querySelectorAll('label,span,div,th,dt');
        for(var fj=0;fj<fns.length;fj++){
          var ft=String(fns[fj].textContent||'').replace(/[:：*\\s\\u200b\\u00a0]/g,'');
          if(!ft||ft.length>name.length+6||ft.indexOf(name)<0)continue;
          var fscope=fns[fj];
          for(var fu=0;fscope&&fu<7;fu++,fscope=fscope.parentElement){
            if(String(fscope.textContent||'').length>180)break;
            var fins=Array.prototype.slice.call(fscope.querySelectorAll('input,textarea')).filter(function(x){
              return !/hidden|checkbox|radio|button|submit|file/.test(String(x.type||''));
            });
            if(fins.length>1)break;
            if(fins.length===1){add(fins[0]);break;}
          }
        }
      }
    }
    return out;
  }
  function xxVis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function xxNorm(t){return String(t||'').replace(/[\\s\\u200b\\u00a0:：*（）()【】]/g,'');}
  function xxClassText(n){
    var c=n&&n.className;
    if(c&&c.baseVal!==undefined)c=c.baseVal;
    return String(c||'');
  }
  function xxRadioMarked(n){
    if(!n)return false;
    if(n.checked===true||String(n.getAttribute&&n.getAttribute('aria-checked')||'')==='true')return true;
    var nodes=[n].concat(Array.prototype.slice.call(n.querySelectorAll&&n.querySelectorAll('*')||[])).slice(0,20);
    return nodes.some(function(x){
      var c=xxClassText(x);
      return /(?:^|[-_\\s])(?:checked|selected)(?:$|[-_\\s])|radio[-_]?checked|is[-_]?checked/i.test(c)
        && !/unchecked|not[-_]?checked/i.test(c);
    });
  }
  function xxSampleRow(){
    var docs=xxDocs();
    for(var d=0;d<docs.length;d++){
      var labels=Array.prototype.slice.call(docs[d].querySelectorAll(
        '.sell-component-info-wrapper-label,[class*="info-wrapper-label"],label,span,div'
      )).filter(function(n){
        return n.children.length<=1&&xxVis(n)&&xxNorm(n.textContent)==='是否为样品';
      });
      for(var i=0;i<labels.length;i++){
        var scope=labels[i];
        for(var up=0;scope&&up<7;up++,scope=scope.parentElement){
          var text=String(scope.textContent||'');
          if(text.length>360)break;
          var nt=xxNorm(text);
          if(nt.indexOf('样品')>=0&&nt.indexOf('正装')>=0)return scope;
        }
      }
    }
    // 页面皮肤有时把标签和单选项拆到兄弟节点：按最短的同时含「样品/正装」容器兜底。
    for(var d2=0;d2<docs.length;d2++){
      var words=Array.prototype.slice.call(docs[d2].querySelectorAll('label,span,div')).filter(function(n){
        return n.children.length<=1&&xxVis(n)&&/^(样品|正装)$/.test(xxNorm(n.textContent));
      });
      for(var w=0;w<words.length;w++){
        var box=words[w];
        for(var up2=0;box&&up2<7;up2++,box=box.parentElement){
          var tx=String(box.textContent||'');
          if(tx.length>280)break;
          var nt2=xxNorm(tx);
          if(nt2.indexOf('样品')>=0&&nt2.indexOf('正装')>=0)return box;
        }
      }
    }
    return null;
  }
  /**
   * 样品/正装选项定位（2026-11-18 第二轮重写：以控件为准，不再要求文字节点可见）。
   *
   * 上一版只收「自己可见」的文字节点，实测现场 probe 是 正装文字=3 / 样品文字=3 / 命中=0：
   * 页面上确实有 3 个文字正好是「正装」的节点，但 offsetWidth=0（隐藏在副本里），
   * 收集阶段被 xxVis 全部丢掉，于是日志永远是「页面上找不到正装」。
   *
   * 现在两条路一起走：
   *   A. 控件优先：input[type=radio] / [role=radio] / .next-radio-wrapper 等，
   *      用控件自己的 label / aria-label / 就近父节点文字判断是正装还是样品；
   *      控件可见就行，里面的文字被样式藏起来也不影响。
   *   B. 文字兜底：仍按「正装 / 样品」叶子文字找，但不再要求文字节点自己有尺寸，
   *      只要它所在的选项容器有尺寸就算可见。
   * 选中态只认 input.checked / aria-checked；没有原生控件的皮肤再看 class 里的 checked/selected。
   */
  function xxSampleTargets(){
    var docs=xxDocs();
    function box(n){try{var r=n.getBoundingClientRect();return r&&r.width>0&&r.height>0?r:null;}catch(e){return null;}}
    function vis(n){
      if(!n)return false;
      // 隐藏副本（display:none / visibility:hidden）不能算「可见」：它的 checked 是过期值，
      // 会把「页面其实是样品」读成「正装已选中」，于是要么不点、要么点到整组容器中心（样品那颗）。
      try{
        if(typeof n.checkVisibility==='function'){
          var opt={checkVisibilityCSS:true};
          // radio 本身常用 opacity:0 做皮肤，不能按透明度判隐藏；容器才按透明度判
          if(!/^(input|textarea|select)$/i.test(String(n.tagName||'')))opt.checkOpacity=true;
          if(!n.checkVisibility(opt))return false;
        }
      }catch(e){}
      if(box(n))return true;
      var p=n.parentElement;
      for(var i=0;p&&i<3;i++,p=p.parentElement){if(box(p))return true;}
      return false;
    }
    function wordOf(text){
      var s=xxNorm(text);
      if(!s)return '';
      var z=s.indexOf('正装')>=0,y=s.indexOf('样品')>=0;
      if(z&&!y)return '正装';
      if(y&&!z)return '样品';
      return '';
    }
    function containerOf(el,word){
      var cur=el;
      for(var i=0;i<6&&cur;i++,cur=cur.parentElement){
        var tag=String(cur.tagName||'').toLowerCase();
        var cls=xxClassText(cur);
        if(tag==='label'||/radio/i.test(cls))return cur;
        var t=xxNorm(cur.textContent);
        if(t&&t!==word&&t.length>word.length*2)break;
      }
      return el;
    }
    var cands=[];
    for(var d=0;d<docs.length;d++){
      var doc=docs[d];
      // A. 控件优先
      var ctrls=[];
      try{
        ctrls=Array.prototype.slice.call(doc.querySelectorAll(
          'input[type=radio],[role=radio],label,.next-radio-wrapper,[class*="radio-wrapper"],[class*="radio-item"],[class*="radioItem"]'
        ));
      }catch(e){ctrls=[];}
      for(var c=0;c<ctrls.length;c++){
        var ctl=ctrls[c],texts=[];
        try{
          var lb=ctl.closest&&ctl.closest('label');
          if(lb)texts.push(lb.textContent);
          var aria=ctl.getAttribute&&(ctl.getAttribute('aria-label')||'');
          if(aria)texts.push(aria);
          var p=ctl.parentElement;
          for(var u=0;p&&u<3;u++,p=p.parentElement){
            var pt=xxNorm(p.textContent);
            if(pt&&pt.length<=16)texts.push(p.textContent);
          }
        }catch(e){}
        var word='';
        for(var ti=0;ti<texts.length&&!word;ti++)word=wordOf(texts[ti]);
        if(!word)continue;
        cands.push({el:ctl,word:word,src:'control'});
      }
      // B. 文字兜底（不要求文字节点自己可见）
      var nodes=[];
      try{nodes=Array.prototype.slice.call(doc.querySelectorAll('label,span,div,em,i,li,p,a,b,strong'));}catch(e){nodes=[];}
      for(var n2=0;n2<nodes.length;n2++){
        var nd=nodes[n2];
        if(nd.children.length>1)continue;
        var w=wordOf(nd.textContent);
        if(!w)continue;
        cands.push({el:nd,word:w,src:'text'});
      }
    }
    var out=[],seen=[];
    for(var k=0;k<cands.length;k++){
      var word2=cands[k].word,el2=cands[k].el;
      var holder=containerOf(el2,word2)||el2;
      var ht=xxNorm(holder.textContent);
      // 抓到的是整组（同时含两个词）：退回到这一条文字自己
      if(ht.indexOf('正装')>=0&&ht.indexOf('样品')>=0){holder=el2;ht=xxNorm(holder.textContent);}
      if(seen.indexOf(holder)>=0)continue;
      seen.push(holder);
      var radio=null;
      try{
        if(holder.matches&&holder.matches('input[type=radio],[role=radio]'))radio=holder;
        if(!radio&&holder.querySelector)radio=holder.querySelector('input[type=radio],[role=radio]');
        if(!radio&&holder.parentElement){
          var sib=holder.parentElement.querySelectorAll('input[type=radio],[role=radio]');
          if(sib.length===1)radio=sib[0];
        }
      }catch(e){}
      var checked=false,known=false;
      if(radio){
        if(radio.checked===true){checked=true;known=true;}
        else if(radio.checked===false)known=true;
        var ac=radio.getAttribute&&radio.getAttribute('aria-checked');
        if(ac==='true'){checked=true;known=true;}
        else if(ac==='false')known=true;
      }
      if(!known){
        var probes=[holder];
        try{probes=probes.concat(Array.prototype.slice.call(holder.querySelectorAll('*')).slice(0,20));}catch(e){}
        for(var q=0;q<probes.length;q++){
          var cls=xxClassText(probes[q]);
          if(/(?:^|[-_\s])(?:checked|selected)(?:$|[-_\s])|radio[-_]?checked|is[-_]?checked/i.test(cls)&&!/unchecked|not[-_]?checked/i.test(cls)){checked=true;known=true;break;}
        }
        if(!known&&/radio/i.test(xxClassText(holder)))known=true;
      }
      out.push({
        text:word2,radio:radio,holder:holder,word:el2,src:cands[k].src,
        checked:checked,uiKnown:known,visible:vis(holder),point:null
      });
    }
    // 点到为止地滚一下：只滚第一个可见项，滚完统一重算所有坐标，避免多次滚动把页面拉走
    var firstVisible=out.filter(function(t){return t.visible;})[0]||out[0]||null;
    if(firstVisible){
      try{firstVisible.holder.scrollIntoView({block:'center'});}catch(e){}
      for(var oi=0;oi<out.length;oi++){
        var t2=out[oi];
        // 点击目标必须是「这一颗选项」本身：原生 radio → 只包一颗 radio 的 label → 选项文字。
        // 绝不能退到整组容器——容器中心点常落在「样品」那一颗上，会把默认正装点成样品
        // （2026-11-19 现场：原来碰巧点中正装，后来一直点不中就是这个原因）。
        var radiosInHolder=0;
        try{radiosInHolder=t2.holder&&t2.holder.querySelectorAll?t2.holder.querySelectorAll('input[type=radio],[role=radio]').length:0;}catch(e){radiosInHolder=0;}
        var target=null;
        if(t2.radio&&vis(t2.radio))target=t2.radio;
        else if(t2.holder&&vis(t2.holder)&&(String(t2.holder.tagName||'').toLowerCase()==='label'||radiosInHolder<=1))target=t2.holder;
        else if(vis(t2.word))target=t2.word;
        else target=t2.holder||t2.word;
        var rc=box(target)||box(t2.word)||box(t2.holder);
        if(rc)t2.point={x:rc.left+rc.width/2,y:rc.top+rc.height/2,text:t2.text};
      }
    }
    out.sort(function(a,b){return (b.visible?1:0)-(a.visible?1:0)||(b.uiKnown?1:0)-(a.uiKnown?1:0);});
    return out;
  }
  function xxSampleRead(){
    // 2026-11-18 定案：样品只认 radio 的真实 checked / aria-checked（class 只做没有原生控件的皮肤兜底）。
    // 判定口径同时放宽：只要「正装」那颗被选中、且没有任何一颗「样品」被选中，就算正装；
    // 不再要求两组都读得到状态（那是上一版「控件态无法识别」→ 一直拦死的原因）。
    var targets=xxSampleTargets();
    var z=targets.filter(function(t){return t.text==='正装';});
    var y=targets.filter(function(t){return t.text==='样品';});
    // 页面里常有多份同名字样（含隐藏副本）：有可见的就只看可见的，
    // 免得隐藏副本里一个过期的 checked 把结论带偏。
    var zv=z.filter(function(t){return t.visible;}),yv=y.filter(function(t){return t.visible;});
    var zUse=zv.length?zv:z,yUse=yv.length?yv:y;
    var zChecked=zUse.some(function(t){return t.checked===true;});
    var yChecked=yUse.some(function(t){return t.checked===true;});
    var known=zUse.some(function(t){return t.uiKnown===true;})||yUse.some(function(t){return t.uiKnown===true;});
    var ok=zChecked&&!yChecked;
    var sample=ok?'正装':(yChecked?'样品':(z.length?'未选中':'未找到'));
    var point=(z.filter(function(t){return t.visible&&t.point;})[0]||{}).point||null;
    return {
      sample:sample,
      sampleOk:ok,
      targets:targets.length,
      // found 只算「页面上真有看得见的正装选项」：整组控件只有隐藏副本时，
      // 说明这版页面根本没渲染它，按平台默认（正装）走，不能当成「选项没选中」去拦提交。
      found:zv.length>0,
      hiddenOnly:z.length>0&&zv.length===0,
      domOk:ok,
      uiKnown:known,
      checkedSample:yChecked,
      checkedRegular:zChecked,
      regularPoint:point,
      points:z.map(function(t){return t.point;}).filter(Boolean).slice(0,3),
      reason:ok?'':(!z.length?'no-option':(yChecked?'sample-checked':'not-regular')),
      structure:targets.slice(0,6).map(function(t){
        return {w:t.text,src:t.src,vis:t.visible,known:t.uiKnown,checked:t.checked,radio:Boolean(t.radio)};
      })
    };
  }
  function xxFindByLabel(texts){
    var wanted=texts.map(function(t){return String(t).replace(/[:：*\\s]/g,'');});
    // 新版发布页的字段结构是：span.sell-component-info-wrapper-label（标签）
    //   → div[class*="info-wrapper-wrap"]（整行）→ 右侧控件区（input / next-select / cascader）
    // 之前让 label.closest('div') 当容器，命中的只是「标签外壳」，里面没有输入框 → 全部未命中。
    var nodes=xxAll('label,.sell-component-info-wrapper-label,[class*="info-wrapper-label"],[class*="form-label"],th,dt,span,div')
      .filter(function(n){return n.children.length<=1&&n.textContent&&String(n.textContent).trim().length<=24;});
    function controlIn(scope){
      if(!scope||!scope.querySelector)return null;
      var el=scope.querySelector('input:not([type=hidden]):not([readonly]):not([disabled]),textarea');
      return el||null;
    }
    function search(scope){
      if(!scope)return null;
      var el=controlIn(scope);
      if(el)return el;
      // 控件常在标签列的兄弟列里
      var sib=scope.nextElementSibling,guard=0;
      while(sib&&guard++<3){el=controlIn(sib);if(el)return el;sib=sib.nextElementSibling;}
      return null;
    }
    for(var pass=0;pass<2;pass++){
      for(var i=0;i<wanted.length;i++){
        var want=wanted[i];
        if(!want)continue;
        var hits=[];
        for(var j=0;j<nodes.length;j++){
          var node=nodes[j];
          var text=String(node.textContent||'').replace(/[:：*\\s]/g,'');
          if(!text)continue;
          if(pass===0?text!==want:(text.indexOf(want)<0&&want.indexOf(text)<0))continue;
          if(pass===1&&text.length>want.length+6)continue;
          var scope=node.closest('[class*="info-wrapper-wrap"],[class*="form-item"],[class*="formItem"],tr,dt,li');
          var control=search(scope||node.parentElement);
          if(control){hits.push({input:control,node:node});if(hits.length>1)break;}
        }
        if(hits.length===1)return hits[0];
      }
    }
    return null;
  }
`;

/**
 * 「选择类目」弹窗的公共定位器（2026-11-12 第四轮）。
 * 截图 1：弹窗标题「选择类目」、品牌下拉「请选择」、底部「已选类目：…」+「确定」。
 * 上一版只从标题节点 closest('.next-dialog') 找，实际 DOM 层级对不上 → 弹窗从来没被处理，
 * 而品牌脚本靠 engine.updateModels 自己回读就报成功，弹窗一直盖在发布页上。
 */
const DIALOG_HELPERS = `
  function dvis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function dtxt(n){return String((n&&(n.innerText||n.textContent))||'').trim();}
  function xxDialogButtons(d){
    if(!d||!d.querySelectorAll)return [];
    return Array.prototype.slice.call(d.querySelectorAll('button')).filter(dvis);
  }
  function xxCategoryDialog(){
    var docs=xxDocs();
    for(var k=0;k<docs.length;k++){
      var doc=docs[k],cands=[];
      try{cands=Array.prototype.slice.call(doc.querySelectorAll('[class*="dialog"],[role="dialog"],[class*="Dialog"],[class*="modal"]')).filter(dvis);}catch(e){}
      var best=null,bestLen=1e9;
      for(var i=0;i<cands.length;i++){
        var c=cands[i],t=dtxt(c);
        if(!t||t.length>3000||!/选择类目|类目选择|修改类目|已选类目/.test(t))continue;
        var okB=xxDialogButtons(c).some(function(b){return /^(确定|确认|保存|完成|下一步)$/.test(dtxt(b));});
        if(!okB)continue;
        if(t.length<bestLen){best=c;bestLen=t.length;}
      }
      if(best)return best;
      try{
        var heads=Array.prototype.slice.call(doc.querySelectorAll('div,span,h2,h3,[class*="dialog-title"],[class*="dialog-header"]'))
          .filter(function(n){return dvis(n)&&/^(选择类目|类目选择|修改类目)$/.test(dtxt(n));});
        for(var h=0;h<heads.length;h++){
          var p=heads[h],g=0;
          while(p&&g++<8){
            var bs=xxDialogButtons(p);
            if(bs.length&&bs.some(function(b){return /^(确定|确认|保存|完成|下一步)$/.test(dtxt(b));})&&/已选类目|选择类目|品牌/.test(dtxt(p)))return p;
            p=p.parentElement;
          }
        }
      }catch(e){}
    }
    return null;
  }
  function xxConfirmButton(d){
    if(!d)return null;
    return xxDialogButtons(d).find(function(b){return /^(确定|确认|保存|完成|下一步)$/.test(dtxt(b));})||null;
  }
  function xxButtonPoint(b){
    if(!b)return null;
    try{var r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:!!b.disabled};}catch(e){return null;}
  }
  function xxBrandTrigger(d){
    if(!d||!d.querySelectorAll)return null;
    var sels=d.querySelectorAll('.next-select-trigger,.next-select,[class*="select-trigger"],input[placeholder*="品牌"],input');
    for(var i=0;i<sels.length;i++){
      var el=sels[i];
      if(!dvis(el))continue;
      var t=dtxt(el)+String(el.placeholder||'')+String(el.value||'');
      if(/请选择|品牌/.test(t))return el;
    }
    var nodes=Array.prototype.slice.call(d.querySelectorAll('span,div,button')).filter(function(n){return dvis(n)&&n.children.length<=2&&/请选择/.test(dtxt(n));});
    return nodes[0]||null;
  }
`;

/** 标题：组件 + DOM 双写并回读 */
function fillTitleScript(title) {
  return `(async function(){${NATIVE_SET}
  var want=${JSON.stringify(String(title || ''))};
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  var eng=st&&st.engine;
  if(eng){
    var props=st.getComponentProps('title')||{},cur=st.getComponentValue('title'),value=want;
    if(props.uiType==='tmTitle'){value={};if(cur&&typeof cur==='object'&&!Array.isArray(cur))Object.keys(cur).forEach(function(k){if(!/^\\d+$/.test(k)&&k!=='title')value[k]=cur[k];});value.title=[want];}
    try{eng.getComponent('title').setProps({value:value});}catch(e){}
  }
  var input=document.querySelector('#struct-title input, input[name="title"], .tm-title input');
  if(input)xxSetNative(input,want);
  await new Promise(function(r){setTimeout(r,350);});
  var read='';
  try{var v=st.getComponentValue('title');read=Array.isArray(v)?v.join(''):(v&&v.title?[].concat(v.title).join(''):String(v||''));}catch(e){}
  if(!read&&input)read=input.value;
  return JSON.stringify({ok:Boolean(read&&read.indexOf(want.slice(0,8))>=0),read:String(read).slice(0,80)});
})()`;
}

/** 品牌：发布页的品牌是店铺授权品牌，必须在 keyProp 里原生选中 */
function fillBrandScript(brand) {
  return `(async function(){${NATIVE_SET}
  var want=${JSON.stringify(String(brand || ''))};
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  var read='';
  try{
    var eng=st&&st.engine;
    if(eng&&brand){
      var props=st.getComponentProps('brand')||{};
      if(props&&props.uiType){try{eng.getComponent('brand').setProps({value:want});}catch(e){}}
    }
    var v=st&&st.getComponentValue&&st.getComponentValue('brand');
    read=String(v&&(v.value||v.text||v)||'');
  }catch(e){}
  return JSON.stringify({ok:Boolean(read&&read.indexOf(want)>=0),read:read.slice(0,40)});
})()`;
}

/**
 * 通用表单填充（新版发布页，2026-11-12 现场结构）：
 *   行 = div.sell-component-info-wrapper-wrap
 *   标签 = span.sell-component-info-wrapper-label
 *   控件 = 标签容器的下一个兄弟 div.sell-component-info-wrapper-component-wrap
 * 控件分三类：可写 input/textarea、next-select/cascader（点开选项）、radio/checkbox（点文字）。
 * 返回 {filled:[],missed:[],kinds:{input:n,select:n,choice:n}}
 */
function fillFormScript(pairs) {
  return `(async function(){${NATIVE_SET}
  var list=${JSON.stringify(Array.isArray(pairs) ? pairs.slice(0, 60) : [])};
  var filled=[],missed=[],kinds={input:0,select:0,choice:0};
  function norm(s){return String(s==null?'':s).replace(/[:：*\\s（）()【】\\[\\]]/g,'');}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function labelNodes(){return xxAll('.sell-component-info-wrapper-label,[class*="info-wrapper-label"],label,.next-form-item-label,th,dt')}
  function findLabel(name){
    var want=norm(name);
    if(!want)return null;
    var nodes=labelNodes();
    var exact=null,partial=[];
    for(var i=0;i<nodes.length;i++){
      // 发布页会在标签里塞「重要 / 热 / 新」这类角标，先把尾巴削掉再比
      var t=norm(nodes[i].textContent).replace(/(?:重要|推荐|热|新|必填)+$/,'');
      if(!t||t.length>24)continue;
      if(t===want){exact=nodes[i];break;}
      if(t.indexOf(want)===0&&partial.length<2)partial.push(nodes[i]);
    }
    if(exact)return exact;
    return partial.length===1?partial[0]:null;
  }
  function partOf(label){
    var box=label.closest('[class*="label-container"]')||label.parentElement;
    var row=label.closest('[class*="info-wrapper-wrap"]')||box&&box.parentElement;
    var comp=(box&&box.nextElementSibling)||(row&&row.querySelector('[class*="component-wrap"]'))||row||box;
    return {box:box,row:row,comp:comp};
  }
  function writable(comp){
    if(!comp||!comp.querySelector)return null;
    var els=comp.querySelectorAll('input:not([type=hidden]):not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled])');
    for(var i=0;i<els.length;i++){
      var el=els[i];
      if(el.closest&&el.closest('.next-select,.next-cascader,[role="combobox"],[class*="select-trigger"],[class*="Select"]'))continue;
      return el;
    }
    return null;
  }
  function chooser(comp){
    if(!comp||!comp.querySelector)return null;
    return comp.querySelector('.next-select,.next-cascader,[class*="select-trigger"],[class*="cascader"],[class*="Select"]');
  }
  async function pickFromDropdown(comp,value){
    var trig=chooser(comp);
    if(!trig)return false;
    var fireTarget=trig.querySelector('.next-select-trigger,.next-select-inner,.next-select-arrow,input')||trig;
    try{
      var ev={bubbles:true,cancelable:true,view:window};
      fireTarget.dispatchEvent(new MouseEvent('mousedown',ev));
      fireTarget.dispatchEvent(new MouseEvent('mouseup',ev));
      fireTarget.click();
    }catch(e){return false;}
    await wait(350);
    var want=norm(value);
    var overlays=xxAll('.next-overlay-wrapper.opened .next-overlay-inner,.next-overlay-wrapper.opened .next-menu,.next-select-popup-wrap,.next-overlay-inner,.next-menu-wrapper,[role="listbox"],[class*="overlay-inner"],[class*="dropdown-menu"]').filter(vis);
    for(var o=0;o<overlays.length;o++){
      var opts=Array.prototype.slice.call(overlays[o].querySelectorAll('.next-menu-item,[role="option"],li,div[class*="option"]')).filter(function(n){return n.children.length<=2&&vis(n)&&!(n.querySelector&&n.querySelector('input'));});
      var exact=null,near=null;
      for(var i=0;i<opts.length;i++){
        var t=norm(opts[i].textContent);
        if(!t)continue;
        if(t===want){exact=opts[i];break;}
        if(!near&&(t.indexOf(want)>=0||want.indexOf(t)>=0)&&t.length<=want.length+8)near=opts[i];
      }
      var hit=exact||near;
      if(hit){try{hit.click();await wait(200);return true;}catch(e){}}
    }
    // 关掉下拉，避免挡住后续
    try{document.body.click();}catch(e){}
    return false;
  }
  function pickChoice(comp,value){
    var values=String(value).split(/[、,，\\/]/).map(function(v){return norm(v);}).filter(Boolean);
    var nodes=Array.prototype.slice.call((comp||document).querySelectorAll('label,span,div,li')).filter(function(n){return n.children.length<=1&&vis(n);});
    var hit=0;
    for(var v=0;v<values.length;v++){
      for(var i=0;i<nodes.length;i++){
        if(norm(nodes[i].textContent)!==values[v])continue;
        var box=nodes[i].closest('label')||nodes[i];
        var input=box.querySelector&&box.querySelector('input[type=checkbox],input[type=radio]');
        try{if(input&&!input.checked)input.click();else box.click();hit++;}catch(e){}
        break;
      }
    }
    return hit>0;
  }
  for(var i=0;i<list.length;i++){
    var row=list[i]||{};var name=String(row.name||'').trim();var value=String(row.value==null?'':row.value).trim();
    if(!name||!value)continue;
    var label=findLabel(name);
    if(!label){missed.push(name.slice(0,16));continue;}
    var part=partOf(label);
    try{
      var input=writable(part.comp);
      if(input){
        // 「保质期=365天」「净含量=80g」这种要写数字（页面后缀已经有单位），否则会被组件拒收
        var numeric=/保质期|净含量|数量|价格|重量|容量|克重|净重/.test(name);
        var write=value;
        if(numeric){
          var digits=String(value).replace(/[^\d.]/g,'');
          if(digits&&/\d/.test(digits))write=digits;
        }
        xxSetNative(input,write);filled.push(name.slice(0,16));kinds.input++;
        // 「保质期 365 天」这类：数值框后面还有一个单位下拉（请选单位），一起选掉
        var unitSel=(part.comp||part.row||document).querySelector('.sell-o-measurement-select,[class*="measurement-select"]');
        if(unitSel){
          var unitMatch=String(value).match(/(个月|天|日|小时|分钟|千克|kg|克|g|毫升|ml|升|l|厘米|cm|毫米|mm)/i);
          var unit=unitMatch?unitMatch[1]:'';
          var unitText=/^(?:天|日)$/.test(unit)?'天':unit;
          if(unitText){
            try{unitSel.click();}catch(e){}
            await wait(250);
            var overlays=xxAll('.next-overlay-inner,.next-menu-wrapper,[class*="overlay-inner"]').filter(vis);
            for(var oi=0;oi<overlays.length;oi++){
              var opts=Array.prototype.slice.call(overlays[oi].querySelectorAll('.next-menu-item,[role="option"],li')).filter(vis);
              var hitOpt=opts.find(function(n){return norm(n.textContent)===norm(unitText);})||opts.find(function(n){return norm(n.textContent).indexOf(norm(unitText))>=0;});
              if(hitOpt){try{hitOpt.click();}catch(e){}break;}
            }
          }
        }
        continue;
      }
      if(await pickFromDropdown(part.comp,value)){filled.push(name.slice(0,16));kinds.select++;continue;}
      if(pickChoice(part.comp,value)){filled.push(name.slice(0,16));kinds.choice++;continue;}
      missed.push(name.slice(0,16));
    }catch(e){missed.push(name.slice(0,16));}
  }
  await wait(300);
  return JSON.stringify({filled:filled,missed:missed.slice(0,20),kinds:kinds});
})()`;
}

/**
 * 品牌必须最先选（用户 2026-11-12：天猫改品牌会重置整张表单）。
 * 现场结构：品牌下拉挂在「选择类目」弹窗里（截图 1），选项是**店铺授权品牌**（腾味莱），
 * 而采集到的竞品品牌（燕山神）根本不在下拉里 —— 之前拿竞品品牌做精确匹配，
 * 一个都选不上，日志才会写「品牌：未选中（unknown）」。
 * 规则：草稿品牌能匹配到下拉项就用它；否则取下拉里第一个可用授权品牌。
 * 在类目弹窗里选的，选完点「确定」，让发布页按「类目 + 品牌」重新渲染。
 */
/**
 * 品牌必须最先选（2026-11-12 第二轮，按老软件 app.asar 的实证实现重写）。
 * 逆向证据（用户自有软件，静态解包 dist/main，均为明文 JS）：
 *   · form-capture-publish-core.js:52   裸 catId 直达 publish.htm 会让 itemProp 为空，品牌必须最先定下来
 *   · publish-recovery.js:205-206      buildAuthorizedShopBrandScript：递归 keyProp/itemProp/bindProp
 *                                      找 p-20000 / 品牌，从 dataSource 读授权选项，UI + 引擎双写 + 回读
 *   · publish-navigation.js:1176-1278  #struct-p-20000 打开 .next-overlay-wrapper.opened；
 *                                      选项用 .info-content（不只是 .options-item），用真实鼠标点击
 *   · publish-navigation.js:2025-2038  fastpath：keyProp['p-20000']={value,text} + engine.updateModels
 *   · publish-navigation.js:1738       纯 updateModels 不经 UI 绑定，提交校验不认 → UI 优先、引擎兜底
 */
function selectBrandFirstScript(brand, series) {
  return `(async function(){${NATIVE_SET}${DIALOG_HELPERS}
  var want=${JSON.stringify(String(brand || '').trim())};
  var seriesParam=${JSON.stringify(String(series || '').trim())};
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function norm(s){return String(s||'').replace(/[:：*\\s（）()]/g,'');}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').trim();}
  var docs=xxDocs();
  var st=null,eng=null;
  try{st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();eng=st&&st.engine;}catch(e){}
  function gcp(n){try{return (st&&st.getComponentProps&&st.getComponentProps(n))||{};}catch(e){return {};}}
  function gcv(n){try{return (st&&st.getComponentValue&&st.getComponentValue(n))||{};}catch(e){return {};}}
  // 1) 引擎层：keyProp / itemProp / bindProp 里的 p-20000 授权选项（老软件同款）
  var auth=null;
  function walkFields(x,store,depth){
    if(!x||typeof x!=='object'||auth||depth>8)return;
    if(Array.isArray(x)){for(var i=0;i<x.length;i++)walkFields(x[i],store,depth+1);return;}
    if(String(x.name||'')==='p-20000'||norm(String(x.label||''))==='品牌'){
      var ds=(x.dataSource||[]).filter(function(o){return o&&o.value!=null&&String(o.text||'').trim();});
      var cur=gcv(store)[x.name];
      var hit=null;
      if(want)hit=ds.find(function(o){return String(o.text)===want;})||ds.find(function(o){return String(o.text).indexOf(want)>=0||want.indexOf(String(o.text))>=0;})||null;
      if(!hit)hit=(cur&&cur.value!=null&&ds.find(function(o){return o.value===cur.value;}))||ds[0]||null;
      if(hit)auth={store:store,name:x.name,opt:hit,count:ds.length};
      return;
    }
    for(var k in x){if(Object.prototype.hasOwnProperty.call(x,k))walkFields(x[k],store,depth+1);}
  }
  var stores=['keyProp','itemProp','bindProp'];
  for(var si=0;si<stores.length&&!auth;si++)walkFields(gcp(stores[si]),stores[si],0);
  // 用「授权列表里最终选定的品牌」去匹配 UI，不要拿采集来的竞品品牌去碰运气
  var wantText=(auth&&String(auth.opt.text||'').trim())||want||'';
  // 2) UI 层：先找「选择类目」弹窗（鲁棒定位：容器文本 + 确定按钮），再找 #struct-p-20000
  var dialog=xxCategoryDialog();
  var struct=null;
  for(var d0=0;d0<docs.length&&!struct;d0++){
    try{struct=docs[d0].querySelector('#struct-p-20000,[id="struct-p-20000"]');}catch(e){}
  }
  function triggerIn(root){
    if(!root||!root.querySelectorAll)return null;
    var hit=root.querySelector('.next-select-trigger,.next-select,[class*="select-trigger"],input[placeholder*="品牌"]');
    if(hit&&vis(hit))return hit;
    var labels=Array.prototype.slice.call(root.querySelectorAll('.sell-component-info-wrapper-label,[class*="info-wrapper-label"],label,th,dt,span,div'))
      .filter(function(n){return n.children.length<=1&&vis(n)&&norm(text(n))==='品牌';});
    for(var i=0;i<labels.length;i++){
      var row=labels[i].closest('[class*="info-wrapper-wrap"],[class*="form-item"],tr,li,div[class*="formItem"]')||labels[i].parentElement;
      var scopes=[row,row&&row.nextElementSibling,labels[i].parentElement,labels[i].parentElement&&labels[i].parentElement.parentElement];
      for(var s=0;s<scopes.length;s++){
        var sc=scopes[s];if(!sc||!sc.querySelector)continue;
        var tri=sc.querySelector('.next-select-trigger,.next-select,[class*="select-trigger"],[class*="cascader"],input[placeholder*="品牌"]');
        if(tri&&vis(tri))return tri;
      }
    }
    return null;
  }
  // 截图 1 里品牌下拉挂在「选择类目」弹窗上，弹窗优先；没有弹窗才用发布页表单结构
  var scope=dialog?'category-dialog':(struct?'struct-p-20000':'form');
  var root=dialog||struct||null;
  var trig=triggerIn(root);
  if(!trig&&dialog)trig=xxBrandTrigger(dialog);
  if(!trig){
    for(var d2=0;d2<docs.length&&!trig;d2++)trig=triggerIn(docs[d2].body||docs[d2].documentElement);
    if(!trig)trig=xxBrandTrigger(dialog);
    scope='form';
  }
  // 3) 打开浮层：老软件用 .next-overlay-wrapper.opened，DOM click 不稳就多点几个触发点
  function overlays(){
    var all=[];
    for(var k=0;k<docs.length;k++){
      try{all=all.concat(Array.prototype.slice.call(docs[k].querySelectorAll('.next-overlay-wrapper.opened,.next-overlay-inner,.next-menu-wrapper,[class*="overlay-inner"],[class*="dropdown-menu"],[class*="select-menu"]')).filter(vis));}catch(e){}
    }
    return all;
  }
  var ovs=overlays();
  if(!ovs.length&&trig){
    var pts=[trig.querySelector&&trig.querySelector('input'),trig.querySelector&&trig.querySelector('.next-select-arrow,.next-icon-arrow-down'),trig,trig.parentElement];
    for(var pi=0;pi<pts.length&&!ovs.length;pi++){
      if(!pts[pi])continue;
      try{pts[pi].click();}catch(e){}
      await wait(450);
      ovs=overlays();
    }
  }
  // 4) 选项：老软件明确说 Magix 品牌选项用 .info-content，且要排除「没找到对应品牌/申请品牌类目授权」
  var peerRe=/同行|热销品牌|更多品牌|其他品牌|全部品牌|请输入|搜索品牌|无匹配|暂无数据|没找到对应品牌|申请品牌类目授权|申请品牌|请选择|加载中/;
  var list=[],seen={};
  for(var o=0;o<ovs.length;o++){
    var nodes=Array.prototype.slice.call(ovs[o].querySelectorAll('.options-item,.next-menu-item,.info-content,[role="option"],li,div,span,a')).filter(vis);
    for(var j=0;j<nodes.length;j++){
      var el=nodes[j],t=text(el).replace(/\\s+/g,' ').trim();
      if(!t||t.length<2||t.length>40||peerRe.test(t))continue;
      if(el.children&&el.children.length>3)continue;
      if(!/[\\u4e00-\\u9fa5A-Za-z]/.test(t))continue;
      if(seen[t]&&seen[t].children<=el.children.length)continue;
      seen[t]={el:el,text:t,children:el.children?el.children.length:0};
    }
  }
  list=Object.keys(seen).map(function(k){return seen[k];}).sort(function(a,b){return a.text.length-b.text.length;});
  var chosen=null;
  if(wantText)chosen=list.find(function(x){return x.text===wantText;})||list.find(function(x){return x.text.indexOf(wantText)>=0||wantText.indexOf(x.text)>=0;})||null;
  if(!chosen&&list.length)chosen=list[0];
  var clickPoint=null;
  if(chosen){
    try{var r=chosen.el.getBoundingClientRect();clickPoint={x:r.left+r.width/2,y:r.top+r.height/2,text:chosen.text};}catch(e){}
    try{chosen.el.click();}catch(e){}
    await wait(600);
  }
  // 5) 引擎原生写入：老软件 P6-direct-fastpath（navigation.js:2019-2106，2026-10-04 实证）——
  //    品牌 p-20000 与系列 p-20000~1 属于同一个 keyProp，必须「同一次 updateModels 一起写」，
  //    再补 itemProp 镜像 + DOM nudge（注释原话「三件套，实证回读生效」）。
  //    之前把品牌/系列拆成两个脚本、系列只走 DOM，schema 刷新后系列组件就初始化成 0/42（日志13）。
  var engineWrite=false,seriesEngineWrite=false,seriesReadback=null,brandReadback=null,seriesNudge=null;
  // 用户要求「品牌+时间戳」；脚本内已拿到页面授权品牌文本，直接用它拼，避免用到竞品品牌
  var seriesVal=seriesParam||((auth&&String(auth.opt.text||'').trim())||'商品')+String(Date.now());
  seriesVal=seriesVal.slice(0,42);
  if(eng&&eng.updateModels){
    try{
      var models=(eng.getModels&&eng.getModels())||{};
      var mf=models.formValues||{};
      // ① 品牌 + 系列：同一个 keyProp 对象，一次 updateModels
      var key=Object.assign({},gcv('keyProp')||{},mf.keyProp||{});
      if(auth){
        if(auth.store==='keyProp')key[auth.name]={value:auth.opt.value,text:auth.opt.text};
        else key['p-20000']={value:auth.opt.value,text:auth.opt.text};
      }
      key['p-20000~1']=seriesVal;
      var fv=Object.assign({},mf);
      fv.keyProp=key;
      if(auth&&auth.store!=='keyProp'){
        var av=Object.assign({},gcv(auth.store)||{},mf[auth.store]||{});
        av[auth.name]={value:auth.opt.value,text:auth.opt.text};
        fv[auth.store]=av;
      }
      eng.updateModels({formValues:fv});
      await wait(350);
      engineWrite=true;
      // ② 系列 itemProp 镜像（老软件注释：keyProp 与 itemProp 都要带 p-20000~1）
      var ip0=Object.assign({},gcv('itemProp')||{},((eng.getModels()||{}).formValues||{}).itemProp||{});
      ip0['p-20000~1']=seriesVal;
      var fvB=Object.assign({},((eng.getModels()||{}).formValues||{}));
      fvB.itemProp=ip0;
      eng.updateModels({formValues:fvB});
      await wait(250);
      seriesEngineWrite=true;
    }catch(e){}
  }
  // ③ DOM nudge：老软件找「值为 13 位数字」或「值等于当前系列」的输入框，用原生 setter 触发 React
  try{
    var curS=String((gcv('keyProp')||{})['p-20000~1']||'').trim();
    var allIn=[];
    for(var nd=0;nd<docs.length;nd++){
      try{allIn=allIn.concat(Array.prototype.slice.call(docs[nd].querySelectorAll('input')));}catch(e){}
    }
    var si=allIn.find(function(x){return /^\\d{13}$/.test(String(x.value||'').trim());})
      ||(curS?allIn.find(function(x){return String(x.value||'').trim()===curS&&!x.disabled;}):null)
      ||null;
    if(si){
      si.focus();
      var descS=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
      var trS=si._valueTracker;if(trS)trS.setValue('');
      if(descS&&descS.set)descS.set.call(si,seriesVal);else si.value=seriesVal;
      si.dispatchEvent(new Event('input',{bubbles:true}));
      si.dispatchEvent(new Event('change',{bubbles:true}));
      try{si.blur();}catch(e){}
      seriesNudge=String(si.value||'').slice(0,42);
    }
  }catch(e){}
  // ④ 系列回读：gcv 读的是组件当前值，比 formValues 初始化快照可信
  try{
    var kpRead=gcv('keyProp')||{};
    brandReadback=kpRead['p-20000']||null;
    seriesReadback=kpRead['p-20000~1']||null;
  }catch(e){}
  // 6) 回读：UI 优先。老软件 navigation.js:1738 明确「纯 updateModels 不经 UI 绑定，提交校验不认」，
  //    所以有弹窗时只认「弹窗里品牌下拉真的不再是请选择」，engine 写入不算成功。
  var native=null;
  if(auth){try{native=gcv(auth.store)[auth.name]||null;}catch(e){}}
  var uiText='';
  try{uiText=trig?text(trig).slice(0,40):'';}catch(e){}
  if(dialog&&!uiText){try{var t2=xxBrandTrigger(dialog);uiText=t2?text(t2).slice(0,40):'';}catch(e){}}
  var uiPicked=Boolean(uiText&&!/请选择|^品牌$|^$|没找到对应品牌|申请品牌/.test(uiText));
  var nativeOk=Boolean(native&&native.value!=null);
  var ok=dialog?uiPicked:(nativeOk||uiPicked);
  var confirmPoint=null,confirmDisabled=false,confirmClicked=false,dialogStillOpen=false;
  if(dialog){
    var okBtn=xxConfirmButton(dialog);
    if(okBtn){
      confirmPoint=xxButtonPoint(okBtn);
      confirmDisabled=Boolean(confirmPoint&&confirmPoint.disabled);
      try{okBtn.click();confirmClicked=true;}catch(e){}
      await wait(1200);
      dialogStillOpen=Boolean(xxCategoryDialog());
    }
  }
  var read=(native&&String(native.text||'').trim())||uiText||wantText||'';
  return JSON.stringify({ok:ok,picked:read,native:native?String(native.text||''):'',engineWrite:engineWrite,
    series:seriesVal,seriesReadback:seriesReadback==null?'':String(seriesReadback),
    seriesOk:Boolean(String(seriesReadback||'').trim()===seriesVal),seriesEngineWrite:seriesEngineWrite,seriesNudge:seriesNudge||'',
    brandReadback:brandReadback?String(brandReadback.text||''):'',
    brandOption:auth?{value:auth.opt.value,text:auth.opt.text}:null,
    auth:auth?String(auth.opt.text):'',authCount:auth?auth.count:0,options:list.slice(0,6).map(function(x){return x.text;}),
    clickPoint:clickPoint,scope:scope,uiPicked:uiPicked,uiText:uiText.slice(0,40),dialogPresent:Boolean(dialog),
    confirmPoint:confirmPoint,confirmDisabled:confirmDisabled,confirmClicked:confirmClicked,dialogStillOpen:dialogStillOpen,
    reason:ok?'':(dialog?'dialog-brand-not-picked':(auth?'ui-no-option':(ovs.length?'no-option-in-overlay':'no-authorized-brand')))});
})()`;
}

/** 品牌只读回读（CDP 真实鼠标点击之后用，只信页面状态）。 */
function readBrandScript() {
  return `(function(){${NATIVE_SET}
  var st=null;try{st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();}catch(e){}
  function gcv(n){try{return (st&&st.getComponentValue&&st.getComponentValue(n))||{};}catch(e){return {};}}
  var out={ok:false,text:'',via:''};
  for(var i=0;i<3;i++){
    var store=['keyProp','itemProp','bindProp'][i];
    var v=gcv(store)['p-20000'];
    if(v&&(v.value!=null||String(v.text||'').trim())){out.ok=true;out.text=String(v.text||'').trim();out.via=store;break;}
  }
  if(!out.ok){
    for(var d=0;d<xxDocs().length;d++){
      try{var root=xxDocs()[d].querySelector('#struct-p-20000,[id="struct-p-20000"]');
        if(root){var t=String((root.querySelector('.next-select-trigger,.next-select')||root).innerText||'').trim();
          if(t&&t.indexOf('请选择')<0){out.ok=true;out.text=t.slice(0,30);out.via='dom';break;}}}catch(e){}
    }
  }
  return JSON.stringify(out);
})()`;
}

/**
 * 是否为样品（正品）+ 多件优惠（启用 + 9.5 折）。
 * 用户 2026-11-12 实测：发布页默认「样品」，必须选「正品」；
 * 折扣只勾启用会停在默认 9 折，而且直接改 input.value 会被 React 回退，
 * 所以折扣必须用「聚焦 + 全选 + 浏览器原生插入」产生真实输入事件，并回读校验。
 */
function fillSampleAndMultiBuyScript(options) {
  return `(async function(){${NATIVE_SET}
  var opt=${JSON.stringify(options && typeof options === 'object' ? options : {})};
  var discount=String(opt.discount||'9.5');
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function norm(s){return String(s||'').replace(/[:：*\\s（）()]/g,'');}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').trim();}
  function rowOf(name){
    var labels=xxAll('.sell-component-info-wrapper-label,[class*="info-wrapper-label"]');
    var hit=labels.find(function(n){return norm(n.textContent)===norm(name)});
    if(!hit)hit=labels.find(function(n){return norm(n.textContent).indexOf(norm(name))>=0});
    if(!hit)return null;
    var box=hit.closest('[class*="label-container"]')||hit.parentElement;
    var row=hit.closest('[class*="info-wrapper-wrap"]')||box&&box.parentElement;
    return row||box;
  }
  function labelOf(node){
    var h=node.closest?node.closest('label,.radio-item,.next-radio-wrapper,[class*="radio-wrapper"]'):null;
    if(!h)h=node.parentElement;
    var t=norm(text(h));
    if(!t||t.length>8){var sp=h&&h.querySelector?h.querySelector('span,[class*="item-label"]'):null;t=norm(text(sp||node.nextElementSibling));}
    return t;
  }
  function discountInputIn(row){
    var nums=Array.prototype.slice.call(row.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden])')).filter(function(i){return vis(i)&&!i.disabled&&!i.readOnly;});
    if(!nums.length)return null;
    return nums.find(function(i){
      var p=i.closest('span')||i.parentElement||i;
      return /折/.test(text(p))||/折/.test(text(i.parentElement&&i.parentElement.parentElement));
    })||nums.find(function(i){return /discount|off|折/i.test(String(i.name||'')+String(i.placeholder||''));})||nums[nums.length-1]||null;
  }
  var out={sample:'',sampleOk:false,samplePoint:null,sampleUiKnown:false,multiBuy:'',multiBuyOk:false,discount:discount};
  // 1) 是否为样品 → 正装。
  //    2026-11-19 现场：页面默认就是「正装」，上一版只要读不到 checked 就点一下，
  //    点偏一次就把默认的正装切成「样品」。现在只在「明确读到样品已选中」时才点，
  //    而且只点正装这一颗：整组容器（里面有两颗 radio）和组里第一颗 radio 一律不点——
  //    整组中心点/第一颗 radio 往往就是「样品」。
  var sampleTargets=xxSampleTargets();
  var target=sampleTargets.filter(function(t){return t.text==='正装';})[0]||null;
  if(target)out.samplePoint=target.point||null;
  function regularClickable(tg){
    if(!tg)return null;
    var radios=0;
    try{radios=tg.holder&&tg.holder.querySelectorAll?tg.holder.querySelectorAll('input[type=radio],[role=radio]').length:0;}catch(e){radios=0;}
    if(radios>1)return tg.word||null;
    if(tg.radio)return tg.radio;
    if(tg.holder&&(String(tg.holder.tagName||'').toLowerCase()==='label'||radios<=1))return tg.holder;
    return tg.word||tg.holder||null;
  }
  var sampleBefore=xxSampleRead();
  if(target&&sampleBefore.sample==='样品'){
    for(var t=0;t<2;t++){
      var clickEl=regularClickable(target);
      try{if(clickEl)clickEl.click();}catch(e){}
      await wait(350);
      if(xxSampleRead().sample!=='样品')break;
      target=xxSampleTargets().filter(function(x){return x.text==='正装';})[0]||target;
    }
  }
  var sampleRead=xxSampleRead();
  out.sample=sampleRead.sample||'';
  out.sampleOk=sampleRead.sampleOk===true;
  out.sampleUiKnown=sampleRead.uiKnown===true;
  out.samplePoint=sampleRead.regularPoint||out.samplePoint;
  // 2) 多件优惠 → 勾启用 + 真实输入 9.5 折
  var buyRow=rowOf('多件优惠');
  if(buyRow){
    var box=buyRow.querySelector('input[type=checkbox]');
    if(box&&!box.disabled&&!box.checked){try{box.click();}catch(e){}await wait(500);}
    var pick=discountInputIn(buyRow);
    if(pick){
      for(var k=0;k<2;k++){
        try{pick.focus();pick.select();}catch(e){}
        var inserted=false;
        try{inserted=document.execCommand('insertText',false,discount);}catch(e){inserted=false;}
        if(!inserted||String(pick.value||'').trim()!==discount)xxSetNative(pick,discount);
        await wait(400);
        if(String(pick.value||'').trim()===discount)break;
      }
      try{pick.dispatchEvent(new Event('change',{bubbles:true}));pick.dispatchEvent(new Event('blur',{bubbles:true}));}catch(e){}
      await wait(350);
      out.multiBuy=String(pick.value||'').trim();
      out.multiBuyOk=out.multiBuy===discount;
      try{pick.setAttribute('data-xx-discount','1');}catch(e){}
    }else if(box&&box.disabled){out.multiBuy='disabled';}
  }
  await wait(200);
  return JSON.stringify(out);
})()`;
}

/** 折扣没被页面接受时，主进程用 CDP 真实键盘补写：先聚焦选中折扣框。 */
function focusDiscountScript() {
  return `(function(){${NATIVE_SET}
  var pick=xxAll('input[data-xx-discount="1"]')[0];
  if(!pick)return JSON.stringify({ok:false,reason:'no-marked-input'});
  try{pick.focus();pick.select();}catch(e){}
  return JSON.stringify({ok:true,value:String(pick.value||'')});
})()`;
}

/** 只读回读折扣值（日志只信这个，不再信「我刚写进去的值」）。 */
function readExtraScript() {
  return `(function(){${NATIVE_SET}
  var pick=xxAll('input[data-xx-discount="1"]')[0];
  return JSON.stringify({ok:Boolean(pick),multiBuy:pick?String(pick.value||'').trim():''});
})()`;
}

/** 样品单选只读回读（CDP 真实鼠标点击之后用）。 */
function readSampleScript() {
  return `(function(){${NATIVE_SET}
    return JSON.stringify(xxSampleRead());
  })()`;
}

/**
 * 食品安全 tab 里的「保质期」（截图 3 显示这一格空着，页面报「保质期是必填项，不能为空」）。
 * 老软件 form-capture-publish-scripts.js:306-356 给的是行 id #struct-foodPeriod +
 * Magix 组件 foodPeriod（formValues + setProps 双写），单位在页面上已固定为「天」，只写数字。
 */
function fillFoodSafetyScript(value) {
  return `(async function(){${NATIVE_SET}
  var raw=${JSON.stringify(String(value||'').trim())};
  var m=String(raw).match(/\\d+(?:\\.\\d+)?/);
  var num=m?m[0]:'';
  if(!num)return JSON.stringify({ok:false,reason:'no-number',raw:raw.slice(0,20)});
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').trim();}
  var out={ok:false,num:'',via:[],rows:0};
  var docs=xxDocs(),inputs=[];
  // 1) 老软件同款行 id
  for(var d=0;d<docs.length;d++){
    var row=null;
    try{row=(docs[d].getElementById&&docs[d].getElementById('struct-foodPeriod'))||docs[d].querySelector('#struct-foodPeriod,[id="struct-foodPeriod"]');}catch(e){}
    var inp=row&&row.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([disabled]),textarea');
    if(inp)inputs.push(inp);
  }
  // 2) 兜底：所有「保质期」标签行里还空着的数字框
  if(!inputs.length){
    var labels=xxAll('.sell-component-info-wrapper-label,[class*="info-wrapper-label"],label,th,dt');
    for(var i=0;i<labels.length;i++){
      if(String(text(labels[i])).replace(/[:：*\\s]/g,'').indexOf('保质期')!==0)continue;
      var box=labels[i].closest('[class*="info-wrapper-wrap"],[class*="form-item"],tr,li')||labels[i].parentElement;
      var scopes=[box,box&&box.nextElementSibling];
      for(var s=0;s<scopes.length;s++){
        if(!scopes[s]||!scopes[s].querySelectorAll)continue;
        var ins=Array.prototype.slice.call(scopes[s].querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([disabled])'));
        for(var j=0;j<ins.length;j++)if(inputs.indexOf(ins[j])<0)inputs.push(ins[j]);
      }
    }
  }
  // 3) 再兜底：按「输入框所在行的文字含保质期」找（食品安全 tab 可能是隐藏的，标签与输入框不一定同容器）
  if(!inputs.length){
    var allIns=xxAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([disabled]),textarea');
    for(var q=0;q<allIns.length;q++){
      var e=allIns[q];
      var bx=e.closest('[class*="info-wrapper-wrap"],[class*="form-item"],tr,li,div')||e.parentElement;
      if(text(bx).replace(/\\s+/g,' ').indexOf('保质期')<0)continue;
      if(inputs.indexOf(e)<0)inputs.push(e);
    }
  }
  // 4) 最后兜底：按组件名 foodPeriod 找（新版页面 id 变了但 name 通常还在）
  if(!inputs.length){
    var named=xxAll('input[name*="foodPeriod"],input[id*="foodPeriod"],input[placeholder*="保质期"],textarea[name*="foodPeriod"]');
    for(var z=0;z<named.length;z++)if(inputs.indexOf(named[z])<0)inputs.push(named[z]);
  }
  out.rows=inputs.length;
  for(var k=0;k<inputs.length;k++){
    var el=inputs[k];
    if(String(el.value||'').trim())continue;
    try{el.focus();el.select();}catch(e){}
    var inserted=false;
    try{inserted=document.execCommand('insertText',false,num);}catch(e){inserted=false;}
    if(!inserted||String(el.value||'').trim()!==num)xxSetNative(el,num);
    try{el.dispatchEvent(new Event('blur',{bubbles:true}));}catch(e){}
    await wait(250);
    if(String(el.value||'').trim()===num){out.ok=true;out.num=num;out.via.push('dom');}
  }
  // 3) Magix 组件同步（隐藏 tab 里的 DOM 值不会被 React 提交，必须写 formValues）
  var st=null,eng=null;
  try{st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();eng=st&&st.engine;}catch(e){}
  if(eng&&eng.updateModels){
    try{
      var models=(eng.getModels&&eng.getModels())||{};
      var fv=Object.assign({},models.formValues||{});
      fv.foodPeriod=num;
      eng.updateModels({formValues:fv});
      try{
        var comp=eng.getComponent&&eng.getComponent('foodPeriod');
        if(comp&&comp.setProps)comp.setProps(Object.assign({},(comp.getProps&&comp.getProps())||{},{value:num,message:[]}));
      }catch(e){}
      out.ok=true;out.num=num;out.via.push('magix');
    }catch(e){}
  }
  return JSON.stringify(out);
})()`;
}

/**
 * 导购标题 / 商品卖点：老软件 shopping_title 组件（publish-recovery.js:165-185，值 {title:[文字]}）。
 * 平台要求 20–30 个字符（汉字算 2，即 10–15 汉字）；16 汉字=32 字符会被「不能超过15个汉字或30个字符」拦下。
 *
 * 2026-11-12 第四轮实测（截图 2 / 截图 4）：发布页「图文描述」和「基础信息」两个 tab
 * 各自渲染一份导购标题输入框，之前只写 [id="struct-shopping_title"] input 那一份，
 * 另一个 tab 仍是 16 字 / 32 字符，左侧「优化建议 错误(1)」一直挂着，提交被拦。
 * 现在按字段名找出所有实例逐个真实输入，逐个回读 DOM 值；Magix 写入只作辅助，不算成功。
 */
function fillTitlesAllScript(guide, sell) {
  return `(async function(){${NATIVE_SET}
  var guideWant=${JSON.stringify(String(guide || '').trim())};
  var sellWant=${JSON.stringify(String(sell || '').trim())};
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function errors(){
    var out=[];
    var docs=xxDocs();
    for(var d=0;d<docs.length;d++){
      try{
        var nodes=docs[d].querySelectorAll('[class*="error"],[class*="help"],[role="alert"],[aria-invalid="true"]');
        for(var i=0;i<nodes.length;i++){
          var n=nodes[i];if(!vis(n))continue;
          var t=String(n.textContent||'').trim();
          if(!t||t.length>80||out.indexOf(t)>=0)continue;
          if(/不能超过|字符|填写错误|必填|不能为空|校验失败/.test(t))out.push(t);
        }
      }catch(e){}
    }
    return out.slice(0,10);
  }
  async function writeAll(name,selectors,want){
    var res={name:name,want:want,found:0,before:[],after:[],allOk:false};
    if(!want)return res;
    var els=xxInputsFor(name,selectors);
    res.found=els.length;
    for(var i=0;i<els.length;i++)res.before.push(String(els[i].value||'').trim().slice(0,40));
    for(var j=0;j<els.length;j++)xxTypeInto(els[j],want);
    await wait(400);
    // 受控组件可能异步回退，回退的再写一次
    for(var k=0;k<els.length;k++){
      if(String(els[k].value||'').trim()!==want){xxTypeInto(els[k],want);await wait(200);}
      res.after.push(String(els[k].value||'').trim().slice(0,40));
    }
    res.allOk=els.length>0&&res.after.every(function(v){return v===want;});
    return res;
  }
  var g=await writeAll('导购标题',[
    '[id="struct-shopping_title"] input','input[name*="shopping_title"]','[class*="shopping-title"] input',
    'input[data-xx-guide="1"]'
  ],guideWant);
  var s=await writeAll('商品卖点',[
    '[id="struct-subtitle"] input','input[name*="sell_point"]','input[name*="subtitle"]',
    'input[data-xx-sell="1"]'
  ],sellWant);
  // Magix 组件层补写（辅助，不计入成功判定；老软件 core.js:53 说提交只认组件聚合值）
  var magix=false;
  try{
    var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
    var eng=st&&st.engine;
    if(eng&&eng.updateModels&&guideWant){
      var cur=null;try{cur=st.getComponentValue('shopping_title');}catch(e){}
      var value={};
      if(cur&&typeof cur==='object'&&!Array.isArray(cur))Object.keys(cur).forEach(function(k){if(!/^\\d+$/.test(k)&&k!=='title')value[k]=cur[k];});
      value.title=[guideWant];
      try{var comp=eng.getComponent('shopping_title');var props=st.getComponentProps&&st.getComponentProps('shopping_title');
        if(comp&&comp.setProps)comp.setProps(Object.assign({},props||{},{value:value}));}catch(e){}
      eng.updateModels({formValues:Object.assign({},(eng.getModels()||{}).formValues||{},{shopping_title:value})});
      magix=true;
    }
  }catch(e){}
  await wait(250);
  var errs=errors();
  return JSON.stringify({ok:g.allOk&&(!sellWant||s.allOk),guide:g,sell:s,magix:magix,errors:errs,
    guideRead:g.after.join('|').slice(0,80),sellRead:s.after.join('|').slice(0,80)});
})()`;
}

/** 兼容旧调用：只写导购标题（商品卖点不动）。 */
function fillGuideTitleScript(text) {
  return fillTitlesAllScript(text, null);
}

/**
 * 系列：老软件 keyProp p-20000~1（publish-scripts.js:206-226 / navigation.js:2040-2045）。
 *
 * 2026-11-12 第四轮：用户要求「系列 = 品牌 + 时间戳」（老软件默认 buildUniqueSeriesName
 * 是纯 13 位时间戳 core.js:147-155）。上一版把 engine.updateModels 当成写入成功，
 * 但老软件 core.js:53-54 明确「models.formValues 只是初始化快照，提交时框架从组件聚合数据，
 * 填充必须 100% DOM 驱动」→ 日志报已写入、页面却仍是 0/42 必填空。
 * 现在：找出所有系列输入框（两个 tab 各一份 + 13 位数字占位框）逐个真实输入，
 * 逐个回读 DOM 值；品牌+时间戳被组件清洗时自动回退纯时间戳，绝不谎报成功。
 */
/**
 * 品牌 + 系列「同一次 keyProp 原生写入」的独立补写脚本（老软件 P6 三件套）。
 * 用途：① 里选品牌会触发 schema 重置，可能把刚写的系列冲掉；schema 稳定后再写一次并回读。
 * 老软件 navigation.js:1491/1567/1856 多处 kpFix 也是这个「重置后补写」思路。
 */
function writeBrandSeriesScript(series) {
  return `(async function(){${NATIVE_SET}
  var want=${JSON.stringify(String(series || '').trim())};
  var out={ok:false,series:want,readback:'',brand:null,steps:[],reason:'no-engine'};
  if(!want)return JSON.stringify({ok:false,reason:'no-series-value'});
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  var st=null,eng=null;
  try{st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();eng=st&&st.engine;}catch(e){}
  if(!eng||!eng.updateModels)return JSON.stringify(out);
  function gcv(n){try{return st.getComponentValue(n)||{};}catch(e){return {};}}
  function gcp(n){try{return st.getComponentProps(n)||{};}catch(e){return {};}}
  var models=(eng.getModels&&eng.getModels())||{};
  // 品牌：取 keyProp dataSource 的 p-20000 首个授权选项（老软件：vid 是负数，只能取页面值）
  var kpDs=[];try{kpDs=(gcp('keyProp').dataSource||[]);}catch(e){}
  var bp=kpDs.find(function(p){return String(p.name||'')==='p-20000';});
  var bo=bp&&(bp.dataSource||[]).filter(function(o){return o&&o.value!=null;})[0];
  try{
    var key=Object.assign({},gcv('keyProp')||{},(models.formValues||{}).keyProp||{});
    if(bo)key['p-20000']={value:bo.value,text:bo.text};
    key['p-20000~1']=want;
    var fv=Object.assign({},models.formValues||{});
    fv.keyProp=key;
    eng.updateModels({formValues:fv});
    await wait(350);
    out.steps.push('keyProp');
    var ip0=Object.assign({},gcv('itemProp')||{},(((eng.getModels()||{}).formValues)||{}).itemProp||{});
    ip0['p-20000~1']=want;
    var fvB=Object.assign({},((eng.getModels()||{}).formValues||{}));
    fvB.itemProp=ip0;
    eng.updateModels({formValues:fvB});
    await wait(250);
    out.steps.push('itemProp');
  }catch(e){out.reason='updateModels-failed:'+String(e&&e.message||e).slice(0,60);}
  // DOM nudge：找「值为 13 位时间戳」或「值等于当前系列」的输入框，用原生 setter 触发 React
  try{
    var docs=xxDocs(),allIn=[];
    for(var d=0;d<docs.length;d++){
      try{allIn=allIn.concat(Array.prototype.slice.call(docs[d].querySelectorAll('input')));}catch(e){}
    }
    var curS=String((gcv('keyProp')||{})['p-20000~1']||'').trim();
    var si=allIn.find(function(x){return /^\\d{13}$/.test(String(x.value||'').trim());})
      ||(curS?allIn.find(function(x){return String(x.value||'').trim()===curS&&!x.disabled;}):null)||null;
    if(si){
      si.focus();
      var descS=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
      var trS=si._valueTracker;if(trS)trS.setValue('');
      if(descS&&descS.set)descS.set.call(si,want);else si.value=want;
      si.dispatchEvent(new Event('input',{bubbles:true}));
      si.dispatchEvent(new Event('change',{bubbles:true}));
      try{si.blur();}catch(e){}
      out.steps.push('nudge:'+String(si.value||'').slice(0,20));
    }
  }catch(e){}
  // 回读组件当前值（gcv 比 formValues 初始化快照可信）
  try{
    var kpRead=gcv('keyProp')||{};
    out.readback=String(kpRead['p-20000~1']||'');
    out.brand=kpRead['p-20000']||null;
    out.ok=out.readback.trim()===want;
    if(out.ok)out.reason='';else out.reason='keyProp-readback-mismatch';
  }catch(e){}
  return JSON.stringify(out);
})()`;
}

function fillSeriesScript(value, fallback) {
  return `(async function(){${NATIVE_SET}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  var candidates=[];
  [${JSON.stringify(String(value || '').trim())},${JSON.stringify(String(fallback || '').trim())}].forEach(function(v){
    if(v&&candidates.indexOf(v)<0)candidates.push(v);
  });
  if(!candidates.length)return JSON.stringify({ok:false,reason:'no-value',found:0});
  function collect(){
    var els=xxInputsFor('系列',[
      '[id="struct-p-20000~1"] input','input[name="p-20000~1"]','[class*="p-20000~1"] input',
      'input[data-xx-series="1"]'
    ],true);
    // 老软件 fastpath：系列输入框初始值是 13 位时间戳，仅在上面两种定位都落空时按值兜底，
    // 避免把恰好是 13 位数字的价格/编码输入框误当系列写入。
    if(!els.length){
      var docs=xxDocs();
      for(var d=0;d<docs.length;d++){
        try{
          var all=docs[d].querySelectorAll('input:not([type=hidden]):not([disabled]):not([readonly]),textarea');
          for(var i=0;i<all.length;i++){
            var el=all[i];if(!vis(el)||els.indexOf(el)>=0)continue;
            if(/^\\d{13}$/.test(String(el.value||'').trim())||/^\\d{13}$/.test(String(el.placeholder||'').trim()))els.push(el);
          }
        }catch(e){}
      }
    }
    return els;
  }
  var els=collect();
  var out={ok:false,value:'',usedFallback:false,found:els.length,values:[],via:[],lockedPoints:[],reason:'no-series-input'};
  // 灰色 readonly 展示框：DOM 赋值会被框架忽略。先点开平台自带的编辑层，
  // 并把坐标交给驱动用 CDP 真实鼠标再点一次（DOM click 对 readonly 常被拦）。
  var locked=els.filter(function(e){return e.readOnly||e.disabled;});
  if(locked.length){
    for(var u=0;u<locked.length;u++){
      try{
        var rc=locked[u].getBoundingClientRect();
        out.lockedPoints.push({x:Math.round(rc.left+rc.width/2),y:Math.round(rc.top+rc.height/2)});
        locked[u].click();
        if(locked[u].parentElement)locked[u].parentElement.click();
      }catch(e){}
    }
    await wait(420);
    // 编辑层里新出现的可编辑输入框：只收「系列相关或 42 字上限」的，避免把价格/编码框写坏
    var dcs=xxDocs();
    for(var ci=0;ci<dcs.length;ci++){
      var cand;
      try{cand=dcs[ci].querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]),textarea');}catch(e){continue;}
      for(var cj=0;cj<cand.length;cj++){
        var ce=cand[cj];
        if(ce.readOnly||ce.disabled||!vis(ce)||els.indexOf(ce)>=0)continue;
        var sig=String(ce.name||'')+'|'+String(ce.id||'')+'|'+String(ce.placeholder||'')+'|'+String((ce.getAttribute&&ce.getAttribute('aria-label'))||'');
        if(/系列|series|p-20000~1/i.test(sig)||ce.maxLength===42)els.push(ce);
      }
    }
    out.found=els.length;
  }
  out.controls=els.map(function(el){return {id:el.id||'',name:el.name||'',readonly:!!el.readOnly,disabled:!!el.disabled,value:String(el.value||'').slice(0,42)};});
  if(!els.length)return JSON.stringify(out);
  var writable=els.filter(function(e){return !e.disabled&&!e.readOnly;});
  out.reason=writable.length?'dom-value-mismatch':'readonly-only';
  for(var c=0;c<candidates.length;c++){
    var want=candidates[c];
    for(var i=0;i<writable.length;i++)xxTypeInto(writable[i],want);
    await wait(420);
    var vals=[];
    for(var k=0;k<writable.length;k++){
      if(String(writable[k].value||'').trim()!==want){xxTypeInto(writable[k],want);await wait(180);}
      vals.push(String(writable[k].value||'').trim());
    }
    if(vals.length&&vals.every(function(v){return v===want;})){
      out.ok=true;out.value=want;out.usedFallback=c>0;out.values=vals.map(function(v){return v.slice(0,42);});out.via.push('dom');out.reason='';
      break;
    }
    out.values=vals.map(function(v){return v.slice(0,42);});
  }
  // Magix 镜像只作辅助（提交时以 DOM 组件聚合值为准），不计入 ok
  try{
    var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
    var eng=st&&st.engine;
    if(eng&&eng.updateModels&&out.value){
      var gcv=function(n){try{return st.getComponentValue(n)||{};}catch(e){return {};}};
      var kp=Object.assign({},gcv('keyProp'));kp['p-20000~1']=out.value;
      var ip=Object.assign({},gcv('itemProp'));ip['p-20000~1']=out.value;
      var fv=Object.assign({},(eng.getModels()||{}).formValues||{});
      fv.keyProp=kp;fv.itemProp=ip;
      eng.updateModels({formValues:fv});
      out.via.push('magix');
    }
  }catch(e){}
  for(var m=0;m<els.length;m++){try{els[m].setAttribute('data-xx-series','1');}catch(e){}}
  return JSON.stringify(out);
})()`;
}

/**
 * 是否为样品 → 正装：老软件 harvest.js:449-457 明确 sampleItem 0=正装 / 1=样品。
 *
 * 2026-11-12 第四轮根因：上一版把 Magix 组件写入当成功（driver 第 1964 行又拿这个假成功
 * 覆盖了正确的 DOM 回读），日志「正装（已回读 · magix+dom）」但截图仍是「样品」选中。
 * 现在只认「当前 checked 那颗 radio 的真实文字」，Magix 写入降级为辅助，且返回 CDP 点击坐标。
 */
/**
 * 是否为样品 → 正装。
 *
 * 2026-11-18 定案：不再写任何 formValues/model —— 那是「自己写、自己读回来」的自证，
 * 平台根本不认（日志 `组件 sampleItem=正装` 但页面仍是样品就是这么来的）。
 * 唯一可信的真相是用户眼睛看到的 radio：只用 input.checked / aria-checked 判定，
 * 用 CDP 真实鼠标点「正装」（radio 不是 file input，不会弹系统文件框）。
 * 老软件 dist/main 里也确实没有写「正装」的代码（ harvest 只做 0→正装 的只读映射）。
 */
function fillSampleItemScript() {
  return `(function(){${NATIVE_SET}
  var out={ok:false,sample:'',via:[],point:null,points:[],rows:0,domSample:'',domOk:false,targets:[]};
  var targets=xxSampleTargets();
  out.rows=targets.length;
  out.targets=targets.map(function(t){return {text:t.text,checked:t.checked===true,uiKnown:t.uiKnown===true,visible:t.visible===true,src:t.src,radio:Boolean(t.radio)};});
  // 只认 radio 的真实选中态：正装选中、样品未选（口径与 xxSampleRead 一致）
  function verdict(){
    var cur=xxSampleRead();
    return {ok:cur.sampleOk===true,known:cur.uiKnown===true,point:cur.regularPoint||null,points:cur.points||[],sample:cur.sample};
  }
  var v=verdict();
  out.point=v.point;
  out.points=v.points;
  if(!v.ok){
    // 给主进程 CDP 真实鼠标点击的坐标；点击后主进程再调 readSampleScript 回读
    out.via.push('need-cdp-click');
    // 找不到控件时把现场一并带回去：页面上一共有几个「正装/样品」文字节点、几个 radio、
    // 命中的候选各自长什么样（可见/可读/是否原生控件）。下一轮日志直接能定位，不靠截图猜。
    try{
      var docs=xxDocs(),zw=0,yw=0,radios=0;
      for(var di=0;di<docs.length;di++){
        var nodes=Array.prototype.slice.call(docs[di].querySelectorAll('label,span,div,em,i,li,p,a,b,strong'));
        for(var ni=0;ni<nodes.length;ni++){
          if(nodes[ni].children.length>1)continue;
          var tx=xxNorm(nodes[ni].textContent);
          if(tx==='正装')zw++;
          if(tx==='样品')yw++;
        }
        try{radios+=docs[di].querySelectorAll('input[type=radio],[role=radio]').length;}catch(e){}
      }
      out.probe={docs:docs.length,正装文字:zw,样品文字:yw,radio:radios,命中:targets.length};
    }catch(e){}
  } else {
    out.via.push('radio-checked');
  }
  out.domOk=v.ok;
  out.domKnown=v.known;
  out.domSample=v.sample;
  out.sample=v.ok?'正装':v.sample;
  out.ok=v.ok;
  return JSON.stringify(out);
})()`;
}
/** 「选择类目」弹窗：品牌在弹窗 UI 里选中后必须点确定，否则弹窗一直盖着发布页、挡住提交。
 *  老软件 navigation.js:1619-1633：天猫「下一步/确定」会 STALE disabled，但 CDP 真实坐标点击仍可推进，
 *  所以这里同时返回按钮坐标；关不掉时再用弹窗右上角的 × 兜底。 */
function closeCategoryDialogScript() {
  return `(async function(){${NATIVE_SET}${DIALOG_HELPERS}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  var dlg=xxCategoryDialog();
  if(!dlg)return JSON.stringify({ok:true,closed:true,reason:'no-dialog'});
  var btn=xxConfirmButton(dlg);
  var point=xxButtonPoint(btn);
  var via='';
  if(btn){try{btn.click();via='confirm-dom';}catch(e){}}
  await wait(1000);
  var still=xxCategoryDialog();
  if(still){
    try{
      var closers=Array.prototype.slice.call(still.querySelectorAll('button,a,span,i,[class*="close"]')).filter(function(n){
        return dvis(n)&&/关闭|close/i.test(String(n.className||'')+' '+String(n.getAttribute&&n.getAttribute('aria-label')||''));
      });
      if(closers.length){closers[0].click();via='close-x';}
    }catch(e){}
    await wait(700);
    still=xxCategoryDialog();
  }
  return JSON.stringify({ok:!still,closed:!still,dialogPresent:Boolean(still),confirmPoint:point,via:via,
    reason:still?'still-open':''});
})()`;
}

/** 只读：弹窗是否还在、确定按钮坐标、弹窗里品牌下拉当前文字（CDP 强点前用）。 */
function readCategoryDialogScript() {
  return `(function(){${NATIVE_SET}${DIALOG_HELPERS}
  var dlg=xxCategoryDialog();
  if(!dlg)return JSON.stringify({open:false});
  var btn=xxConfirmButton(dlg);
  var trig=xxBrandTrigger(dlg);
  return JSON.stringify({open:true,confirmPoint:xxButtonPoint(btn),brandText:trig?dtxt(trig).slice(0,40):'',text:dtxt(dlg).slice(0,120)});
})()`;
}

/** 提交前自检：把真正拦住提交的项列成人话，而不是让「请使用最新版chrome」这类静态提示冒充失败原因。
 *  2026-11-12 第四轮：日志最后只报两条静态提示，实际拦路的是弹窗、系列空、导购标题超限、主图 0 张。 */
/**
 * 字段结构诊断：把发布页「系列 / 是否为样品 / 导购标题 / 品牌」四行的真实 DOM 结构原样吐出来。
 * 日志12 的「系列：找到 0 个输入框」说明我们对控件结构的假设本身就是错的；
 * 与其继续猜，不如让下一轮日志直接带上 id/name/readonly/class，一次定位到位。
 */
function fieldDiagnosticsScript() {
  return `(function(){${NATIVE_SET}${DIALOG_HELPERS}
  function vis(n){return dvis(n);}
  function txt(n){return dtxt(n);}
  function clip(s,n){s=String(s==null?'':s);return s.length>n?s.slice(0,n)+'…':s;}
  function one(el){
    var cn=el.className;if(cn&&cn.baseVal!==undefined)cn=cn.baseVal;
    return {tag:el.tagName?String(el.tagName).toLowerCase():'',type:el.type||'',name:el.name||'',id:el.id||'',
      ph:clip(el.placeholder||'',30),cls:clip(String(cn||''),70),ro:!!el.readOnly,dis:!!el.disabled,
      max:el.maxLength==null?'':el.maxLength,val:clip(el.value||'',42),
      checked:el.checked===undefined?'':!!el.checked,txt:clip(txt(el),26)};
  }
  var docs=xxDocs();
  var out={url:String(location.href||'').slice(0,180),docs:docs.length,fields:{},keyControls:[],radios:[]};
  var names=['系列','是否为样品','导购标题','品牌'];
  for(var q=0;q<names.length;q++){
    var name=names[q],rows=[],seen=[];
    for(var d=0;d<docs.length;d++){
      var ns;
      try{ns=Array.prototype.slice.call(docs[d].querySelectorAll('label,span,div,th,dt'));}catch(e){continue;}
      for(var i=0;i<ns.length&&rows.length<6;i++){
        var n=ns[i],t=String(n.textContent||'').replace(/[:：*\\s\\u200b\\u00a0]/g,'');
        if(!t||t.length>name.length+8||t.indexOf(name)<0)continue;
        var row=n.closest('[class*="info-wrapper-wrap"],[class*="form-item"],[class*="formItem"],tr,li,section')||n.parentElement;
        if(!row||seen.indexOf(row)>=0)continue;
        var ctrls=[];
        try{ctrls=Array.prototype.slice.call(row.querySelectorAll('input,textarea,select,button,[role="radio"],[role="combobox"]'));}catch(e){}
        if(!ctrls.length)continue;
        seen.push(row);
        rows.push({label:clip(txt(n),30),rowCls:clip(String(row.className||''),70),
          rowText:clip(txt(row),90),controls:ctrls.slice(0,10).map(one)});
      }
    }
    out.fields[name]={rows:rows.length,detail:rows};
  }
  for(var k=0;k<docs.length;k++){
    var all;
    try{all=docs[k].querySelectorAll('input,textarea,select');}catch(e){continue;}
    for(var a=0;a<all.length;a++){
      var el=all[a],sig=String(el.name||'')+'|'+String(el.id||'')+'|'+String(el.placeholder||'');
      if(/p-20000|series|sample|shopping_title/i.test(sig)&&out.keyControls.length<24)out.keyControls.push(one(el));
      if(String(el.type||'').toLowerCase()==='radio'&&out.radios.length<20){
        var h=el.closest('label')||el.parentElement;
        out.radios.push({name:el.name||'',id:el.id||'',value:clip(el.value||'',20),checked:!!el.checked,label:clip(txt(h),24)});
      }
    }
  }
  return JSON.stringify(out);
})()`;
}

/**
 * 「选择类目」弹窗抑制器（2026-11-12 第八轮 / 日志14）。
 * 现象：品牌+系列已由 keyProp 原生写入、发布页字段全部填好，但点击提交后平台仍会重新弹出
 *   「选择类目」弹窗（弹窗里品牌下拉仍显示「请选择」），盖住整张发布页。上架失败把窗口留给
 *   用户手动补图时，这个弹窗挡得人完全没法操作 —— 用户明确要求「手动填写时不要出现这个页面」。
 * 做法：页面内常驻 guard（setInterval + MutationObserver），弹窗一出现就点右上角 × 让 React
 *   正常卸载，并同时用 important 隐藏弹窗节点与遮罩、恢复 body 滚动，保证视觉上立刻消失。
 *   **绝不点「确定」**：品牌 UI 未选时点确定会弹「请选择品牌」甚至重置整张表（老软件实证）。
 * 幂等：重复调用复用同一 guard；window.__XX_CATEGORY_GUARD_STOP__() 可随时停用。
 */
function suppressCategoryDialogScript() {
  return `(function(){${NATIVE_SET}${DIALOG_HELPERS}
  function findDialogs(){
    var out=[],docs=xxDocs();
    for(var k=0;k<docs.length;k++){
      var doc=docs[k],cands=[];
      try{cands=Array.prototype.slice.call(doc.querySelectorAll('[class*="dialog"],[role="dialog"],[class*="Dialog"],[class*="modal"],[class*="overlay"]'));}catch(e){}
      for(var i=0;i<cands.length;i++){
        var n=cands[i];
        if(!dvis(n))continue;
        var t=dtxt(n);
        if(!t||t.length>4000)continue;
        if(!/选择类目|类目选择|修改类目/.test(t))continue;
        if(!/已选类目|品牌|确定|关闭/.test(t))continue;
        out.push({node:n,doc:doc});
      }
    }
    // 只保留最内层容器：祖先节点会把整页 wrapper 也算进来，隐藏它等于把发布页一起藏了
    return out.filter(function(a){
      return !out.some(function(b){return b!==a&&a.node.contains&&a.node.contains(b.node);});
    });
  }
  function hideBackdrops(doc){
    var sels=['.next-overlay-backdrop','[class*="overlay-backdrop"]','[class*="dialog-mask"]','[class*="dialogMask"]','[class*="-backdrop"]'];
    for(var i=0;i<sels.length;i++){
      try{
        var ns=doc.querySelectorAll(sels[i]);
        for(var j=0;j<ns.length;j++)ns[j].style.setProperty('display','none','important');
      }catch(e){}
    }
    try{doc.body.style.setProperty('overflow','auto','important');}catch(e){}
    try{doc.documentElement.style.setProperty('overflow','auto','important');}catch(e){}
  }
  function closerIn(n){
    var all=[];
    try{all=Array.prototype.slice.call(n.querySelectorAll('button,a,span,i,div,[class*="close"],[aria-label*="关闭"]'));}catch(e){}
    var hit=[];
    for(var i=0;i<all.length;i++){
      var c=all[i];
      if(!dvis(c))continue;
      var cls=String(c.className||''),aria='',tt=dtxt(c),r=null;
      try{aria=String(c.getAttribute('aria-label')||'');}catch(e){}
      try{r=c.getBoundingClientRect();}catch(e){}
      if(r&&(r.width>70||r.height>70))continue;
      if(/close|关闭|dismiss/i.test(cls+' '+aria)||/^[×✕✖╳xX]$/.test(tt))hit.push({el:c,r:r});
    }
    hit.sort(function(a,b){
      var ay=a.r?a.r.top:0,by=b.r?b.r.top:0;
      if(Math.abs(ay-by)>8)return ay-by;
      return (b.r?b.r.left:0)-(a.r?a.r.left:0);
    });
    return hit.length?hit[0].el:null;
  }
  function closeOne(item){
    var n=item.node,doc=item.doc,clicked=false,forced=false;
    var x=closerIn(n);
    if(x){try{x.click();clicked=true;}catch(e){}}
    try{
      n.style.setProperty('display','none','important');
      n.style.setProperty('visibility','hidden','important');
      n.style.setProperty('pointer-events','none','important');
      hideBackdrops(doc);
      forced=true;
    }catch(e){}
    return {clicked:clicked,forced:forced};
  }
  var G=window.__XX_CATEGORY_GUARD__;
  if(G&&G.active){
    G.lastRun=0;G.sweep();
    return JSON.stringify({ok:true,watching:true,reused:true,closed:G.closed,hidden:G.hidden,via:G.lastVia});
  }
  G={active:true,closed:0,hidden:0,lastVia:'',lastRun:0,timer:null,obs:null,
    sweep:function(){
      if(!G.active)return;
      var now=Date.now();
      if(now-G.lastRun<180)return;
      G.lastRun=now;
      var list=findDialogs();
      for(var i=0;i<list.length;i++){
        if(!dvis(list[i].node))continue;
        var r=closeOne(list[i]);
        if(r.clicked)G.closed++;
        if(r.forced)G.hidden++;
        G.lastVia=r.clicked?'close-x+force-hide':(r.forced?'force-hide':'none');
      }
    }};
  window.__XX_CATEGORY_GUARD__=G;
  window.__XX_CATEGORY_GUARD_STOP__=function(){
    G.active=false;
    try{if(G.timer)clearInterval(G.timer);}catch(e){}
    try{if(G.obs)G.obs.disconnect();}catch(e){}
    window.__XX_CATEGORY_GUARD__=null;
  };
  G.timer=setInterval(function(){G.sweep();},500);
  try{
    G.obs=new MutationObserver(function(){G.sweep();});
    G.obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
  }catch(e){}
  G.sweep();
  return JSON.stringify({ok:true,watching:true,reused:false,closed:G.closed,hidden:G.hidden,via:G.lastVia});
})()`;
}

function preSubmitCheckScript(tallExpected) {
  return `(function(){${NATIVE_SET}${DIALOG_HELPERS}
  function vis(n){return dvis(n);}
  function txt(n){return dtxt(n);}
  function width(s){var w=0;s=String(s||'');for(var i=0;i<s.length;i++)w+=/[\\u4e00-\\u9fa5]/.test(s[i])?2:1;return w;}
  var blockers=[],errors=[];
  // 静态提示不算错误，但保留在 errors 里供比对
  var staticRe=/请使用最新版chrome|由于内核问题|标题过长可能折叠|欢迎使用万象客服/;
  var docs=xxDocs();
  for(var d=0;d<docs.length;d++){
    try{
      var nodes=docs[d].querySelectorAll('[class*="error"],[class*="help"],[role="alert"],[aria-invalid="true"],[class*="feedback"],[class*="assistant"]');
      for(var i=0;i<nodes.length;i++){
        var n=nodes[i];if(!vis(n))continue;
        var t=txt(n);
        if(!t||t.length>80||errors.indexOf(t)>=0)continue;
        // 帮助中心/问卷侧栏常把十几条 FAQ 拼成一整串文本，里面夹着「怎么办」「如何」；
        // 日志12 就是它冒充了「页面校验」错误，把真正的拦路项盖住了。
        if(/如何|怎么办|TOP问题|白皮书|问宝贝|问商品|常见问题|引导|教程/.test(t))continue;
        if((t.match(/问/g)||[]).length>=3)continue;
        if(/必填|不能为空|未填|填写错误|未选择|未上传|不能超过|校验失败|请填写|请选择/.test(t))errors.push(t);
      }
    }catch(e){}
  }
  var realErrors=errors.filter(function(t){return !staticRe.test(t);});
  realErrors.slice(0,4).forEach(function(t){blockers.push('页面校验：'+t);});
  // 弹窗
  var dlg=xxCategoryDialog();
  if(dlg)blockers.push('「选择类目」弹窗仍开着，会挡住提交');
  // 系列
  var series=xxInputsFor('系列',['[id="struct-p-20000~1"] input','input[name="p-20000~1"]','input[data-xx-series="1"]'],true);
  // 点开 readonly 展示框后，值可能写在平台弹出的编辑层输入框里，展示框 value 仍为空；
  // 把这些「系列相关可编辑框」也纳入回读，否则会误判「系列必填未填」把提交拦死。
  for(var sd=0;sd<docs.length;sd++){
    try{
      var sc=docs[sd].querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]),textarea');
      for(var sj=0;sj<sc.length;sj++){
        var se=sc[sj];
        if(se.readOnly||se.disabled||series.indexOf(se)>=0)continue;
        var ss=String(se.name||'')+'|'+String(se.id||'')+'|'+String(se.placeholder||'');
        if((/系列|series|p-20000~1/i.test(ss)||se.maxLength===42)&&String(se.value||'').trim())series.push(se);
      }
    }catch(e){}
  }
  var seriesVals=series.map(function(x){return String(x.value||'').trim();});
  // 系列是 keyProp 引擎原生属性，不是普通 DOM 输入框（老软件 P6 三件套实证）。
  // gcv('keyProp') 读的是组件当前值，比 formValues 初始化快照可信；DOM 展示框可能仍显示 0/42。
  var seriesEngine='';
  try{
    var stS=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
    if(stS&&stS.getComponentValue)seriesEngine=String((stS.getComponentValue('keyProp')||{})['p-20000~1']||'').trim();
  }catch(e){}
  var seriesEmpty=!seriesEngine&&(!series.length||seriesVals.every(function(v){return !v;}));
  if(seriesEmpty)blockers.push('系列必填未填（0/42）');
  // 导购标题：所有实例都要 ≤30 字符
  var guides=xxInputsFor('导购标题',['[id="struct-shopping_title"] input','input[name*="shopping_title"]','input[data-xx-guide="1"]']);
  var guideVals=guides.map(function(x){return String(x.value||'').trim();});
  var guideOver=guideVals.some(function(v){return width(v)>30;})||realErrors.some(function(t){return /不能超过|字符/.test(t);});
  if(guideOver)blockers.push('导购标题超出 15 汉字/30 字符限制');
  // 是否为样品：天猫官方说明「发布时不自行选择，默认为正装」。
  // 所以这里改成「只要不是样品就放行」，不再因为读不到控件把整件商品拦死；
  // 真正拦住提交的只有两种：① 样品被选中；② 页面出现「对应正装商品ID 必填」。
  var sampleRead=xxSampleRead();
  var sampleOk=sampleRead.sampleOk===true;
  var sampleText=sampleOk?'正装':(sampleRead.sample||'');
  var pageText=String(document.body&&document.body.innerText||'');
  var sampleNeedsRegularId=/对应正装商品ID[^。]{0,20}必填项未填/.test(pageText);
  var sampleIsSample=sampleText==='样品'||sampleNeedsRegularId;
  var sampleNote='';
  if(sampleIsSample){
    blockers.push('页面按「样品」处理（'+(sampleNeedsRegularId?'要求填写对应正装商品ID':'样品已被选中')+'），不能提交');
  }else if(!sampleOk&&sampleRead.found){
    // 选项看得见但没选中：天猫默认就是正装，不拦，只留一句说明
    sampleNote='「正装」选项未选中，按平台默认（正装）继续';
  }else if(!sampleOk){
    sampleNote='页面没有渲染「正装/样品」控件，按平台默认（正装）继续';
  }
  // 主图：以 mainImagesGroup.images 为准（组件值才是提交值），没有再退 DOM
  var mainImages=0,mainVia='';
  try{
    var stM=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
    var mg=stM&&stM.getComponentValue&&stM.getComponentValue('mainImagesGroup');
    if(mg&&Array.isArray(mg.images)){mainImages=mg.images.filter(function(x){var u=String((x&&(x.url||x.src))||'');return /^https?:/i.test(u);}).length;mainVia='mainImagesGroup';}
  }catch(e){}
  if(!mainVia){
    try{
      mainImages=document.querySelectorAll('[class*="mainPic"] img,[class*="imageItem"] img,[class*="ImgItem"] img,[class*="upload-list"] img').length;
      if(mainImages)mainVia='dom';
    }catch(e){}
  }
  if(!mainImages)blockers.push('主图区回读 0 张（图片为必填）');
  // 3:4 主图：只有「本次有计划图 + 页面确有这个组件」时才核对写入数量。
  // 组件不存在（部分类目没有 3:4 图位）时不拦，避免所有商品都过不了自检。
  var tallExpected=${Number(tallExpected) || 0},tallCount=0,tallKnown=false,tallVia='';
  try{
    var stT=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
    if(stT&&stT.getComponentValue){
      var tv=stT.getComponentValue('threeToFourImages');
      var tp=stT.getComponentProps&&stT.getComponentProps('threeToFourImages');
      if(tv!=null||tp){
        tallKnown=true;tallVia='magix:threeToFourImages';
        var tlist=Array.isArray(tv)?tv:[];
        tallCount=tlist.filter(function(x){return /^https?:/i.test(String(x&&(x.url||x.src)||''));}).length;
      }
    }
  }catch(e){}
  if(tallExpected>0&&tallKnown&&tallCount<tallExpected){
    blockers.push('3:4主图只写入 '+tallCount+'/'+tallExpected+' 张');
  }
  // 透明素材图（导购素材 800x800，必填）。
  // 2026-11-19 现场核实：抠出来的 PNG 本身是 800×800（日志「800×800 · 397KB」），
  // 但发布页把原图显示成 _320x320 缩略图，DOM 的 naturalWidth 是 320，旧逻辑据此判
  // 「不是实际 800×800」并拦下自动提交；用户手动点提交是成功的。
  // 结论：像素回读只能当提示，不能当拦路项。只拦「完全没图」「冻结素材」「页面明确报尺寸错」。
  var whiteBgMissing=false,whiteBgCount=0,whiteBgVerified=false,whiteBgFrozen=false,whiteBgUrls=[],whiteBgReason='',whiteBgNote='',whiteBgPix='',whiteBgThumb=false;
  try{
    function baseAsset(u){return String(u||'').split('?')[0].replace(/_\\.webp$/i,'').replace(/_\\d+x\\d+(?:q\\d+)?(?:\\.(?:jpe?g|png|webp))?$/i,'');}
    var wbr=xxAll('#struct-whiteBgImage,[class*="whiteBgImage"],[class*="transparentImage"]').filter(vis)[0]||null;
    var engineRows=[];
    try{
      var stW=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
      var gi=stW&&stW.getComponentValue&&stW.getComponentValue('guideImageGroup');
      engineRows=gi&&Array.isArray(gi.whiteBgImage)?gi.whiteBgImage.filter(function(x){return /^https?:/i.test(String(x&&x.url||''));}):[];
    }catch(e){}
    var wimgs=wbr?Array.prototype.slice.call(wbr.querySelectorAll('img')).filter(function(im){
      return /^https?:/i.test(String(im.currentSrc||im.src||''))&&(im.offsetWidth||0)>=40;
    }):[];
    var domUrls=wimgs.map(function(im){return String(im.currentSrc||im.src||'');}).filter(Boolean);
    var engineUrls=engineRows.map(function(x){return String(x&&x.url||'');}).filter(Boolean);
    whiteBgUrls=Array.from(new Set(domUrls.concat(engineUrls)));
    whiteBgCount=whiteBgUrls.length;
    // 只要页面或提交值里有图就不算「没上传」：图位折叠/懒渲染时 wbr 可能为空。
    whiteBgMissing=whiteBgCount===0;
    var rootText=wbr?txt(wbr):'';
    whiteBgFrozen=/冻结|已冻结|被锁定|素材失效|不可用/i.test(rootText);
    var matched=null;
    for(var wi=0;wi<wimgs.length&&!matched;wi++){
      var du=String(wimgs[wi].currentSrc||wimgs[wi].src||'').split('?')[0];
      for(var ei=0;ei<engineUrls.length;ei++){
        if(baseAsset(du)&&baseAsset(du)===baseAsset(engineUrls[ei])){matched=wimgs[wi];break;}
      }
    }
    var imgExact=Boolean(matched&&Number(matched.naturalWidth||0)===800&&Number(matched.naturalHeight||0)===800);
    var sameAsset=Boolean(matched);
    // 提交值是缩略图地址时才需要还原成原图；已经是原图就按合规处理。
    whiteBgThumb=engineUrls.some(function(u){return baseAsset(u)!==String(u).split('?')[0];});
    var pageSizeError=/透明素材图[^。]{0,80}(?:图片像素必须|像素必须|尺寸不符|请修改)/i.test(rootText);
    if(whiteBgMissing){
      whiteBgReason='透明素材图未上传（导购素材必填）';
      blockers.push(whiteBgReason);
    }else if(whiteBgFrozen){
      whiteBgReason='透明素材图是冻结/失效素材，需要重新上传';
      blockers.push(whiteBgReason);
    }else if(pageSizeError){
      whiteBgReason='透明素材图页面明确提示像素/尺寸不符（平台要求 800×800）';
      blockers.push(whiteBgReason);
    }else{
      whiteBgVerified=true;
      whiteBgPix=matched?(Number(matched.naturalWidth||0)+'x'+Number(matched.naturalHeight||0)):'';
      if(!imgExact){
        whiteBgNote='透明素材图已上传；页面显示 '+(whiteBgPix||'缩略图')+'，提交值 '+(engineUrls[0]||'')+'（像素以平台提交回执为准）';
      }
      if(!sameAsset&&engineUrls.length&&domUrls.length){
        whiteBgNote='透明素材图页面显示与提交值不同源，已按提交值继续';
      }
    }
  }catch(e){}
  // 包含产品：只在类目把 skuCombineContent 标成必填时才拦（老软件 REQUIRED_CONTAINED_PRODUCTS_SCRIPT 同口径）
  var skuProductsRequired=false,skuProductsMissing=0,skuProductsTotal=0;
  try{
    var stK=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
    if(stK&&stK.getComponentProps){
      var at=stK.getComponentProps('sku')&&stK.getComponentProps('sku').attributes||{};
      var fl=Array.isArray(at)?at:Object.values(at);
      for(var fi=0;fi<fl.length;fi++){
        var f=fl[fi];if(!f)continue;
        var fn=String(f.name||'')+'|'+String(f.label||'');
        if(/skuCombine|包含产品/.test(fn)&&f.required===true)skuProductsRequired=true;
      }
    }
    // 类目没暴露 attributes 时看页面：必填标记紧挨着「包含产品」（截图 1 的 tab 上就是红色 *）
    if(!skuProductsRequired){
      var marks=xxAll('[class*="required"],[class*="Required"],[class*="star"],[class*="Star"],.next-form-item-required');
      for(var mi=0;mi<marks.length&&!skuProductsRequired;mi++){
        if(vis(marks[mi])&&txt(marks[mi]).indexOf('包含产品')>=0)skuProductsRequired=true;
      }
    }
    if(stK&&stK.getComponentValue){
      var kr=stK.getComponentValue('sku')||[];
      skuProductsTotal=kr.length;
      kr.forEach(function(r){var p=r&&r.skuCombineContent;var list=Array.isArray(p)?p:(p&&p.products)||[];if(!list.length)skuProductsMissing++;});
    }
  }catch(e){}
  if(skuProductsRequired&&skuProductsMissing)blockers.push('包含产品未关联（'+skuProductsMissing+'/'+skuProductsTotal+' 行）');
  return JSON.stringify({ok:!blockers.length,blockers:blockers.slice(0,8),errors:errors.slice(0,8),realErrors:realErrors.slice(0,6),
    skuProductsRequired:skuProductsRequired,skuProductsMissing:skuProductsMissing,whiteBgMissing:whiteBgMissing,whiteBgCount:whiteBgCount,
    whiteBgVerified:whiteBgVerified,whiteBgFrozen:whiteBgFrozen,whiteBgUrls:whiteBgUrls.slice(0,3),whiteBgReason:whiteBgReason,
    whiteBgNote:whiteBgNote,whiteBgPix:whiteBgPix,whiteBgThumb:whiteBgThumb,
    tallExpected:tallExpected,tallCount:tallCount,tallKnown:tallKnown,tallVia:tallVia,
    dialogOpen:Boolean(dlg),seriesEmpty:seriesEmpty,seriesEngine:seriesEngine,seriesValues:seriesVals.slice(0,4),guideOver:guideOver,
    guideValues:guideVals.slice(0,4),sampleText:sampleText,sampleOk:sampleOk,sampleNote:sampleNote,sampleRadio:sampleRead,mainImages:mainImages,mainVia:mainVia});
})()`;
}

/**
 * 保质期：采集值形如「30天」，发布页是「数字输入框 + 单位下拉」两个控件。
 * 之前通用填充只写数字、单位停在「请选择单位」，而且 React 受控框会回退成空。
 * 这里专门按采集值写 30 + 天，真实输入 + 回读校验。
 */
function fillShelfLifeScript(value) {
  return `(async function(){${NATIVE_SET}
  var raw=${JSON.stringify(String(value||'').trim())};
  if(!raw)return JSON.stringify({ok:false,reason:'no-value'});
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function norm(s){return String(s||'').replace(/[:：*\\s（）()【】\\[\\]]/g,'');}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').trim();}
  var m=String(raw).match(/\\d+(?:\\.\\d+)?/);
  var num=m?m[0]:'';
  var unit=(String(raw).match(/(个月|天|日|小时|分钟|年|周)/)||[])[1]||'天';
  if(unit==='日')unit='天';
  if(!num)return JSON.stringify({ok:false,reason:'no-number',raw:raw.slice(0,20)});
  var docs=xxDocs();
  var label=null;
  for(var d=0;d<docs.length&&!label;d++){
    var ls=Array.prototype.slice.call(docs[d].querySelectorAll('.sell-component-info-wrapper-label,[class*="info-wrapper-label"],label,th,dt,span,div'))
      .filter(function(n){return n.children.length<=1&&vis(n)&&norm(text(n)).replace(/(?:重要|推荐|热|新|必填)+$/,'')==='保质期';});
    if(ls.length)label=ls[0];
  }
  if(!label)return JSON.stringify({ok:false,reason:'no-row'});
  var row=label.closest('[class*="info-wrapper-wrap"],[class*="form-item"],tr,li')||label.parentElement;
  var scopes=[row,row&&row.nextElementSibling,label.parentElement,label.parentElement&&label.parentElement.parentElement].filter(Boolean);
  var numInput=null,unitTrig=null;
  for(var s=0;s<scopes.length;s++){
    var sc=scopes[s];if(!sc||!sc.querySelectorAll)continue;
    if(!numInput){
      var ins=Array.prototype.slice.call(sc.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio])')).filter(function(i){return vis(i)&&!i.disabled&&!i.readOnly;});
      var plain=ins.filter(function(i){return !i.closest('.next-select,[class*="select-trigger"]');});
      numInput=plain[0]||ins[0]||null;
    }
    if(!unitTrig){
      var cand=Array.prototype.slice.call(sc.querySelectorAll('.next-select,[class*="select-trigger"],[class*="measurement-select"],[class*="unit-select"]')).filter(vis);
      unitTrig=cand.find(function(n){return /单位|请选择/.test(text(n))||/measurement|unit/i.test(String(n.className||''));})||cand[cand.length-1]||null;
      if(unitTrig&&unitTrig===numInput)unitTrig=null;
    }
  }
  var written='';
  if(numInput){
    for(var k=0;k<2;k++){
      try{numInput.focus();numInput.select();}catch(e){}
      var inserted=false;
      try{inserted=document.execCommand('insertText',false,num);}catch(e){inserted=false;}
      if(!inserted||String(numInput.value||'').trim()!==num)xxSetNative(numInput,num);
      await wait(350);
      if(String(numInput.value||'').trim()===num)break;
    }
    try{numInput.dispatchEvent(new Event('blur',{bubbles:true}));}catch(e){}
    written=String(numInput.value||'').trim();
  }
  var unitRead='';
  if(unitTrig&&!/^\\s*$/.test(unit)){
    try{unitTrig.click();}catch(e){}
    await wait(400);
    var hit=null;
    for(var d2=0;d2<docs.length&&!hit;d2++){
      var ovs=Array.prototype.slice.call(docs[d2].querySelectorAll('.next-overlay-inner,.next-menu-wrapper,[class*="overlay-inner"],[class*="dropdown-menu"]')).filter(vis);
      for(var o=0;o<ovs.length&&!hit;o++){
        var opts=Array.prototype.slice.call(ovs[o].querySelectorAll('.next-menu-item,[role="option"],li,div[class*="option"]')).filter(vis);
        hit=opts.find(function(n){return norm(text(n))===norm(unit);})||opts.find(function(n){return norm(text(n)).indexOf(norm(unit))>=0;})||null;
      }
    }
    if(hit){try{hit.click();}catch(e){}}
    await wait(400);
    unitRead=text(unitTrig).slice(0,12);
  }
  var unitOk=!unitTrig||Boolean(unitRead&&!/请选择/.test(unitRead));
  return JSON.stringify({ok:written===num&&unitOk,num:written,unit:unitRead,want:num+unit,raw:raw.slice(0,20),hasUnit:Boolean(unitTrig)});
})()`;
}

/* ------------------------------------------------------------------
 * 店铺中分类（卖家自定义分类，用户 2026-11-21 明确）
 *
 * 「店铺分类」不是平台类目树，而是卖家后台 →「店铺中分类」里自己建的分类
 * （截图：爆单品 / 心想事成 / 多金多金 → 多金T、多金Q …），发布页上是一个
 * 「选择分类」下拉，选项带复选框，可多选。
 * 这里只做三件事：定位字段并打开下拉、按保存的名字勾选、回读已选。
 * 找不到字段就明确报 no-field，绝不按类目树猜。
 * ------------------------------------------------------------------ */
function openShopCategoryScript() {
  return `(function(){${NATIVE_SET}${DIALOG_HELPERS}
  function norm(t){return String(t||'').replace(/[\\s\\u200b\\u00a0:：*]/g,'');}
  function findLabel(){
    var nodes=xxAll('label,span,div,th,dt');
    for(var i=0;i<nodes.length;i++){
      var n=nodes[i];
      if(!dvis(n))continue;
      var t=norm(dtxt(n));
      if(t==='店铺中分类'||t==='店铺分类')return n;
    }
    return null;
  }
  function rowOf(label){
    return label.closest('[class*="info-wrapper-wrap"],[class*="form-item"],[class*="formItem"],tr,li,section')||label.parentElement;
  }
  function triggerIn(row){
    var cands=[];
    try{cands=Array.prototype.slice.call(row.querySelectorAll('[class*="select"],[role="combobox"],input[readonly],[class*="trigger"]'));}catch(e){}
    cands=cands.filter(dvis);
    return cands.find(function(n){return /选择分类|请选择/.test(dtxt(n)||String(n.placeholder||''));})||cands[0]||null;
  }
  // 下拉已经开着就不要再点（再点会把它关掉，第二次勾选就全落空）
  function menuOpen(){
    var docs=xxDocs();
    for(var d=0;d<docs.length;d++){
      var ns;
      try{ns=docs[d].querySelectorAll('.next-menu-item,[role="option"],[class*="menu-item"]');}catch(e){continue;}
      for(var i=0;i<ns.length;i++){ if(dvis(ns[i])) return true; }
    }
    return false;
  }
  var label=findLabel();
  if(!label)return JSON.stringify({ok:false,reason:'no-field'});
  var row=rowOf(label);
  if(!row)return JSON.stringify({ok:false,reason:'no-row'});
  var trigger=triggerIn(row);
  if(!trigger)return JSON.stringify({ok:false,reason:'no-trigger',rowText:dtxt(row).slice(0,80)});
  var r=null;try{r=trigger.getBoundingClientRect();}catch(e){}
  var point=r?{x:r.left+r.width/2,y:r.top+r.height/2}:null;
  if(menuOpen())return JSON.stringify({ok:true,reason:'already-open',
    rowText:dtxt(row).slice(0,100),
    current:String(dtxt(trigger)||'').replace(/^选择分类$/,'').slice(0,160),
    point:point});
  try{
    var o={bubbles:true,cancelable:true,view:window};
    trigger.dispatchEvent(new PointerEvent('pointerdown',o));
    trigger.dispatchEvent(new MouseEvent('mousedown',o));
    trigger.dispatchEvent(new PointerEvent('pointerup',o));
    trigger.dispatchEvent(new MouseEvent('mouseup',o));
    trigger.click();
  }catch(e){}
  return JSON.stringify({ok:true,reason:'',
    rowText:dtxt(row).slice(0,100),
    current:String(dtxt(trigger)||'').replace(/^选择分类$/,'').slice(0,160),
    point:point});
})()`;
}

function readShopCategoryScript() {
  return `(function(){${NATIVE_SET}${DIALOG_HELPERS}
  function norm(t){return String(t||'').replace(/[\\s\\u200b\\u00a0:：*]/g,'');}
  function findLabel(){
    var nodes=xxAll('label,span,div,th,dt');
    for(var i=0;i<nodes.length;i++){
      var n=nodes[i];
      if(!dvis(n))continue;
      var t=norm(dtxt(n));
      if(t==='店铺中分类'||t==='店铺分类')return n;
    }
    return null;
  }
  var label=findLabel();
  if(!label)return JSON.stringify({ok:false,reason:'no-field'});
  var row=label.closest('[class*="info-wrapper-wrap"],[class*="form-item"],[class*="formItem"],tr,li,section')||label.parentElement;
  if(!row)return JSON.stringify({ok:false,reason:'no-row'});
  var tags=[];
  try{
    Array.prototype.slice.call(row.querySelectorAll('[class*="tag"],[class*="Tag"],[class*="chip"],[class*="selected"]')).forEach(function(n){
      if(!dvis(n))return;
      var t=String(dtxt(n)||'').trim();
      if(t&&t.length<=30&&!(/选择分类/.test(t))&&tags.indexOf(t)<0)tags.push(t);
    });
  }catch(e){}
  var trig=null;
  try{trig=Array.prototype.slice.call(row.querySelectorAll('[class*="select"],[role="combobox"]')).filter(dvis)[0]||null;}catch(e){}
  var text=String(dtxt(trig)||'').replace(/^选择分类$/,'').trim();
  return JSON.stringify({ok:true,selected:tags,text:text.slice(0,160)});
})()`;

}

/** 勾选保存的店铺中分类（按名字精确/包含匹配；只点复选框，不点分组标题）。 */
function pickShopCategoryScript(names) {
  const list = JSON.stringify((Array.isArray(names) ? names : []).map(v => String(v || '')).filter(Boolean));
  return `(function(){${NATIVE_SET}${DIALOG_HELPERS}
  var wants=${list};
  function norm(t){return String(t||'').replace(/[\\s\\u200b\\u00a0:：*]/g,'');}
  function isItemPart(n){
    var cls=String((n&&n.className)||'');
    return /(?:^|[-_\s])(?:label|title|text|switcher|indent|icon|arrow|checkbox|content|wrapper)(?:$|[-_\s])/i.test(cls);
  }
  function boxOf(n){
    var box=null;
    try{
      var all=n.querySelectorAll('input[type="checkbox"],.next-checkbox,[role="checkbox"]');
      for(var i=0;i<all.length;i++){
        var c=all[i];
        var owner=c.closest?c.closest('.next-tree-node,.next-menu-item,[role="treeitem"],[role="option"],[role="menuitem"],li'):null;
        if(!owner||owner===n){box=c;break;}
      }
    }catch(e){}
    return box;
  }
  function ownLabelText(n){
    try{
      var lbl=n.querySelector('.next-menu-item-text,.next-tree-node-label,[class*="node-title"],[class*="item-text"]');
      if(lbl&&(!lbl.closest||!lbl.closest('.next-tree-node,.next-menu-item,[role="treeitem"],li')||lbl.closest('.next-tree-node,.next-menu-item,[role="treeitem"],li')===n)){
        var lt=String(dtxt(lbl)||'').replace(/\\s+/g,' ').trim();
        if(lt&&lt.length<=40)return lt;
      }
    }catch(e){}
    var out='';
    try{
      var ch=n.childNodes||[];
      for(var i=0;i<ch.length;i++){
        var nd=ch[i];
        if(nd.nodeType===3){out+=nd.nodeValue;}
        else if(nd.nodeType===1){
          var tag=String(nd.tagName||'').toUpperCase();
          var cls=String(nd.className||'');
          if(tag==='UL'||tag==='OL'||/child-tree|sub-menu|tree-node|menu-item/.test(cls))continue;
          out+=' '+String(dtxt(nd)||'');
        }
      }
    }catch(e){}
    var cleaned=String(out||'').replace(/\\s+/g,' ').trim();
    return cleaned||String(dtxt(n)||'').replace(/\\s+/g,' ').trim();
  }
  function pickable(){
    var out=[],docs=xxDocs();
    var sels=['.next-tree-node','.next-menu-item','[role="treeitem"]','[role="option"]','[role="menuitem"]','li[class*="menu-item"]','li[class*="option"]','label'];
    for(var d=0;d<docs.length;d++){
      for(var s=0;s<sels.length;s++){
        var ns;try{ns=docs[d].querySelectorAll(sels[s]);}catch(e){continue;}
        for(var i=0;i<ns.length;i++){
          var n=ns[i];
          if(!dvis(n)||isItemPart(n))continue;
          if(!boxOf(n))continue;
          var t=norm(ownLabelText(n));
          if(!t||t.length>60)continue;
          if(out.indexOf(n)<0)out.push(n);
        }
      }
    }
    return out.filter(function(n){
      return !out.some(function(m){
        if(m===n||!n.contains||!n.contains(m))return false;
        var inSub=m.closest&&m.closest('.next-tree-child-tree,.next-menu-sub-menu,ul,ol');
        if(inSub&&n.contains(inSub)&&inSub!==n)return false;
        return true;
      });
    });
  }
  function checked(n){
    var b=boxOf(n);
    if(b&&b.tagName==='INPUT')return Boolean(b.checked);
    if(b){var aria=String(b.getAttribute('aria-checked')||'');if(aria)return aria==='true';
      var cls=String(b.className||'');if(/checked/.test(cls)&&!/unchecked/.test(cls))return true;}
    return false;
  }
  var boxes=pickable();
  var picked=[],missing=[];
  for(var w=0;w<wants.length;w++){
    var key=norm(wants[w]);
    if(!key)continue;
    var hit=null;
    for(var i=0;i<boxes.length;i++){
      var t=norm(ownLabelText(boxes[i]));
      if(t===key){hit=boxes[i];break;}
      if(!hit&&t.indexOf(key)>=0&&t.length<=key.length+8)hit=boxes[i];
    }
    if(!hit){missing.push(wants[w]);continue;}
    if(checked(hit)){picked.push(wants[w]);continue;}
    try{
      var b=boxOf(hit);
      // 优先点平台自己的复选框容器（Next 的 .next-checkbox 才有 React 事件），
      // 直接点隐藏 input 有时只改 DOM 不改组件状态。
      var target=(b&&b.closest&&b.closest('.next-checkbox,[class*="checkbox"]'))||b||hit;
      var o={bubbles:true,cancelable:true,view:window};
      target.dispatchEvent(new MouseEvent('mousedown',o));
      target.dispatchEvent(new MouseEvent('mouseup',o));
      target.click();
    }catch(e){}
    picked.push(wants[w]);
  }
  // 分组/父分类是折叠的：目标名字还在 missing 里时，展开未展开的父分组或树开关（只展开未展开节点，避免来回折叠）。
  var expanded=0;
  if(missing.length){
    var docs=xxDocs();
    var switchers=[];
    var swSels=['.next-tree-node-switcher','[class*="switcher"]','[class*="expand"]','[aria-expanded="false"]'];
    for(var d1=0;d1<docs.length;d1++){
      for(var ss=0;ss<swSels.length;ss++){
        var sws;try{sws=docs[d1].querySelectorAll(swSels[ss]);}catch(e){continue;}
        for(var si=0;si<sws.length;si++){
          var sw=sws[si];
          if(!dvis(sw))continue;
          if(sw.getAttribute&&sw.getAttribute('data-xx-cat-expanded')==='1')continue;
          if(sw.getAttribute&&sw.getAttribute('aria-expanded')==='true')continue;
          if(/open|expanded/.test(String(sw.className||''))&&sw.getAttribute('aria-expanded')!=='false')continue;
          if(switchers.indexOf(sw)<0)switchers.push(sw);
        }
      }
    }
    for(var k=0;k<switchers.length&&expanded<8;k++){
      try{
        if(switchers[k].setAttribute)switchers[k].setAttribute('data-xx-cat-expanded','1');
        switchers[k].click();
        expanded++;
      }catch(e){}
    }
    var groups=[];
    var gsels=['.next-menu-sub-menu > .next-menu-item','.next-menu-item','[class*="menu-item"]','[class*="menu-group"]','[role="treeitem"]'];
    for(var d2=0;d2<docs.length;d2++){
      for(var s2=0;s2<gsels.length;s2++){
        var ns2;try{ns2=docs[d2].querySelectorAll(gsels[s2]);}catch(e){continue;}
        for(var i2=0;i2<ns2.length;i2++){ if(dvis(ns2[i2])&&groups.indexOf(ns2[i2])<0)groups.push(ns2[i2]); }
      }
    }
    var passList=groups.filter(function(gn){
      if(boxOf(gn))return false;
      if(gn.getAttribute&&gn.getAttribute('data-xx-cat-expanded')==='1')return false;
      if(gn.getAttribute&&gn.getAttribute('aria-expanded')==='true')return false;
      if(/open|expanded/i.test(String(gn.className||''))&&gn.getAttribute('aria-expanded')!=='false')return false;
      if(gn.querySelector&&gn.querySelector('[data-xx-cat-expanded="1"],[aria-expanded="true"],.next-tree-switcher_open,.next-menu-sub-menu'))return false;
      var gt=norm(ownLabelText(gn));
      return gt&&gt.length<=30;
    });
    // 优先展开名字前缀匹配 missing 的分组，其次再展开其余未展开分组（解决父类「多金多金」与子类「热销款」不同名的问题）
    passList.sort(function(a,b){
      var ta=norm(ownLabelText(a)),tb=norm(ownLabelText(b));
      var ra=missing.some(function(m){var km=norm(m);return km.indexOf(ta)===0&&km!==ta;})?0:1;
      var rb=missing.some(function(m){var km=norm(m);return km.indexOf(tb)===0&&km!==tb;})?0:1;
      return ra-rb;
    });
    for(var g=0;g<passList.length&&expanded<8;g++){
      try{
        if(passList[g].setAttribute)passList[g].setAttribute('data-xx-cat-expanded','1');
        passList[g].click();
        expanded++;
      }catch(e){}
    }
  }
  return JSON.stringify({ok:picked.length>0,found:boxes.length,picked:picked,missing:missing,expanded:expanded,
    all:boxes.map(function(n){return String(ownLabelText(n)||'').replace(/\\s+/g,' ').trim().slice(0,40);}).filter(Boolean).slice(0,200),
    sample:boxes.slice(0,12).map(function(n){return norm(ownLabelText(n)).slice(0,20);})});
})()`;
}

/**
 * 读取本店「店铺中分类」的全部选项（设置页「刷新」用）：
 * 打开下拉 → 展开所有父分组/子分类（防重复点击折叠）→ 读可见选项（分组标题 + 一级/二级带复选框分类）→ 关下拉。
 * 页面没渲染出这个字段时返回 no-field，由调用方提示「请在店铺发布页确认」。
 */
function readShopCategoryOptionsScript() {
  return `(async function(){${NATIVE_SET}${DIALOG_HELPERS}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function norm(t){return String(t||'').replace(/[\\s\\u200b\\u00a0:：*]/g,'');}
  function findLabel(){
    var nodes=xxAll('label,span,div,th,dt');
    for(var i=0;i<nodes.length;i++){
      var n=nodes[i];
      if(!dvis(n))continue;
      var t=norm(dtxt(n));
      if(t==='店铺中分类'||t==='店铺分类')return n;
    }
    return null;
  }
  var label=findLabel();
  if(!label)return JSON.stringify({ok:false,reason:'no-field'});
  var row=label.closest('[class*="info-wrapper-wrap"],[class*="form-item"],[class*="formItem"],tr,li,section')||label.parentElement;
  var trigger=null;
  try{trigger=Array.prototype.slice.call(row.querySelectorAll('[class*="select"],[role="combobox"],input[readonly]')).filter(dvis)[0]||null;}catch(e){}
  if(!trigger)return JSON.stringify({ok:false,reason:'no-trigger'});
  try{
    var o={bubbles:true,cancelable:true,view:window};
    trigger.dispatchEvent(new PointerEvent('pointerdown',o));
    trigger.dispatchEvent(new MouseEvent('mousedown',o));
    trigger.dispatchEvent(new PointerEvent('pointerup',o));
    trigger.dispatchEvent(new MouseEvent('mouseup',o));
    trigger.click();
  }catch(e){}
  await wait(900);
  function isItemPart(n){
    var cls=String((n&&n.className)||'');
    return /(?:^|[-_\s])(?:label|title|text|switcher|indent|icon|arrow|checkbox|content|wrapper)(?:$|[-_\s])/i.test(cls);
  }
  function ownLabel(n){
    try{
      var lbl=n.querySelector('.next-menu-item-text,.next-tree-node-label,[class*="node-title"],[class*="item-text"],[class*="group-label"]');
      if(lbl&&(!lbl.closest||!lbl.closest('.next-tree-node,.next-menu-item,[role="treeitem"],li')||lbl.closest('.next-tree-node,.next-menu-item,[role="treeitem"],li')===n)){
        var lt=String(dtxt(lbl)||'').replace(/\\s+/g,' ').trim();
        if(lt&&lt.length<=40)return lt;
      }
    }catch(e){}
    var out='';
    try{
      var ch=n.childNodes||[];
      for(var i=0;i<ch.length;i++){
        var nd=ch[i];
        if(nd.nodeType===3){out+=nd.nodeValue;}
        else if(nd.nodeType===1){
          var tag=String(nd.tagName||'').toUpperCase();
          var cls=String(nd.className||'');
          if(tag==='UL'||tag==='OL'||/child-tree|sub-menu|tree-node|menu-item/.test(cls))continue;
          if(nd.getAttribute&&nd.getAttribute('role')==='group')continue;
          out+=' '+String(dtxt(nd)||'');
        }
      }
    }catch(e){}
    var cleaned=String(out||'').replace(/\\s+/g,' ').trim();
    return cleaned||String(dtxt(n)||'').replace(/\\s+/g,' ').trim();
  }
  function collectShopCatNodes(){
    var list=[],docs2=xxDocs();
    var sels=['.next-tree-node','.next-menu-item','.next-menu-group-label','[role="treeitem"]','[role="option"]','[role="menuitem"]','li[class*="menu-item"]','li[class*="option"]'];
    for(var d=0;d<docs2.length;d++){
      for(var s=0;s<sels.length;s++){
        var ns;try{ns=docs2[d].querySelectorAll(sels[s]);}catch(e){continue;}
        for(var i=0;i<ns.length;i++){
          var n=ns[i];
          if(!dvis(n))continue;
          if(isItemPart(n)&&!/next-menu-group-label/.test(String(n.className||'')))continue;
          var t=ownLabel(n);
          if(!t||t.length>60)continue;
          if(list.indexOf(n)<0)list.push(n);
        }
      }
    }
    return list.filter(function(n){
      return !list.some(function(m){
        if(m===n||!n.contains||!n.contains(m))return false;
        var inSub=m.closest&&m.closest('.next-tree-child-tree,.next-menu-sub-menu,[role="group"],ul,ol');
        if(inSub&&n.contains(inSub)&&inSub!==n)return false;
        return true;
      });
    });
  }
  function boxOf(n){
    var b=null;
    try{
      var all=n.querySelectorAll('input[type="checkbox"],.next-checkbox,[role="checkbox"]');
      for(var i=0;i<all.length;i++){
        var c=all[i];
        var owner=c.closest?c.closest('.next-tree-node,.next-menu-item,[role="treeitem"],[role="option"],[role="menuitem"],li'):null;
        if(!owner||owner===n){b=c;break;}
      }
    }catch(e){}
    return b;
  }
  function expandCollapsed(){
    var count=0,docs2=xxDocs();
    var swSels=['.next-tree-node-switcher','[class*="switcher"]','[class*="expand"]','[class*="arrow"]','[aria-expanded="false"]'];
    for(var d=0;d<docs2.length;d++){
      for(var ss=0;ss<swSels.length;ss++){
        var sws;try{sws=docs2[d].querySelectorAll(swSels[ss]);}catch(e){continue;}
        for(var si=0;si<sws.length;si++){
          var sw=sws[si];
          if(!dvis(sw))continue;
          if(sw.closest&&sw.closest('.next-select,.next-select-trigger')===trigger)continue;
          if(sw.getAttribute&&sw.getAttribute('data-xx-cat-expanded')==='1')continue;
          if(sw.getAttribute&&sw.getAttribute('aria-expanded')==='true')continue;
          if(/open|expanded/i.test(String(sw.className||''))&&sw.getAttribute('aria-expanded')!=='false')continue;
          try{
            if(sw.setAttribute)sw.setAttribute('data-xx-cat-expanded','1');
            sw.click();
            count++;
          }catch(e){}
          if(count>=24)return count;
        }
      }
    }
    var curNodes=collectShopCatNodes();
    for(var ex=0;ex<curNodes.length&&count<24;ex++){
      var nd=curNodes[ex];
      if(boxOf(nd))continue;
      if(nd.getAttribute&&nd.getAttribute('data-xx-cat-expanded')==='1')continue;
      if(nd.getAttribute&&nd.getAttribute('aria-expanded')==='true')continue;
      if(/open|expanded/i.test(String(nd.className||''))&&nd.getAttribute('aria-expanded')!=='false')continue;
      // 节点内部已经有独立的展开开关（或已经点击过展开开关），绝不再点一次 <li> 本身导致刚打开又折回去
      if(nd.querySelector&&nd.querySelector('.next-tree-node-switcher,[class*="switcher"],[class*="expand"],[class*="arrow"],[data-xx-cat-expanded="1"],[aria-expanded="true"],.next-tree-switcher_open,.next-menu-sub-menu'))continue;
      try{
        if(nd.setAttribute)nd.setAttribute('data-xx-cat-expanded','1');
        nd.click();
        count++;
      }catch(e){}
    }
    return count;
  }
  for(var pass=0;pass<3;pass++){
    var exp=expandCollapsed();
    if(!exp)break;
    await wait(450);
  }
  var nodes=collectShopCatNodes();
  function findAncestorGroup(n){
    var sub=n.closest&&n.closest('.next-menu-sub-menu,.next-tree-child-tree,.next-menu-group,[role="group"],[class*="sub-menu"],[class*="child-tree"]');
    if(sub){
      var grpLbl=sub.querySelector&&sub.querySelector('.next-menu-group-label');
      if(grpLbl&&grpLbl!==n&&(!sub.contains||sub.contains(grpLbl))){
        var gl=ownLabel(grpLbl);
        if(gl&&gl.length<=40&&gl!==ownLabel(n))return gl;
      }
      if(sub.parentElement){
        var parentNode=sub.parentElement.closest('.next-tree-node,.next-menu-sub-menu,[role="treeitem"],li')||sub.parentElement;
        if(parentNode&&parentNode!==n){
          var ht=ownLabel(parentNode);
          if(ht&&ht.length<=40&&ht!==ownLabel(n))return ht;
        }
      }
    }
    return '';
  }
  function rectLeft(n){
    try{
      var tgt=(n.querySelector&&n.querySelector('input[type="checkbox"],.next-checkbox,.next-tree-node-label,.next-menu-item-text'))||n;
      var r=tgt.getBoundingClientRect&&tgt.getBoundingClientRect();
      return r&&r.width>=0?Math.round(r.left):null;
    }catch(e){return null;}
  }
  var items=[],flatGroup='',level1Group='',usedNestedOrIndent=false,baseLeft=null,seen={};
  for(var k=0;k<nodes.length;k++){
    var n=nodes[k],t=ownLabel(n);
    if(!t||t.length>40)continue;
    var lPos=rectLeft(n);
    var hasBox=Boolean(boxOf(n));
    if(!hasBox){
      flatGroup=t;
      usedNestedOrIndent=false;
      continue;
    }
    if(baseLeft===null&&lPos!==null)baseLeft=lPos;
    var anc=findAncestorGroup(n);
    var lvlAttr=n.getAttribute&&n.getAttribute('aria-level');
    var lvl=lvlAttr?Number(lvlAttr):0;
    var indented=Boolean(baseLeft!==null&&lPos!==null&&lPos>baseLeft+8);
    var g='';
    if(anc){
      g=anc;
      usedNestedOrIndent=true;
    }else if(lvl>=2){
      g=level1Group||flatGroup;
      usedNestedOrIndent=true;
    }else if(lvl===1){
      level1Group=t;
      flatGroup='';
      usedNestedOrIndent=false;
      g='';
    }else if(indented&&flatGroup){
      g=flatGroup;
      usedNestedOrIndent=true;
    }else if(usedNestedOrIndent&&!indented){
      // 嵌套分组结束后的顶级兄弟节点，清掉残留的 flatGroup，避免「爆多多」被误挂到前一个父分组下
      flatGroup='';
      g='';
    }else{
      g=flatGroup;
    }
    var key=g+'|'+t;
    if(seen[key])continue;
    seen[key]=1;
    items.push({name:t,group:g,path:g?g+' / '+t:t});
  }
  // 补充：如果 DOM 只拿到了扁平列表，尝试从 __SELL_STATE__ 的店铺分类组件数据源补全父子层级
  try{
    var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
    var propsMap=st&&(st.components||st.models||(st.getState&&st.getState().components));
    var candSources=[];
    if(st&&typeof st.getComponentProps==='function'){
      ['shopcat','shopCat','sellerCat','shopCategories','sellerCids','shopCatList'].forEach(function(key){
        try{var p=st.getComponentProps(key);if(p&&Array.isArray(p.dataSource))candSources.push(p.dataSource);}catch(e){}
      });
    }
    if(propsMap&&typeof propsMap==='object'){
      Object.keys(propsMap).forEach(function(k){
        if(/shopcat|sellercat|sellercid/i.test(k)){
          var ds=propsMap[k]&&(propsMap[k].dataSource||(propsMap[k].props&&propsMap[k].props.dataSource));
          if(Array.isArray(ds))candSources.push(ds);
        }
      });
    }
    if(candSources.length&&(!items.length||!items.some(function(it){return Boolean(it.group);}))){
      var stItems=[],stSeen={};
      var walkDs=function(arr,parentName){
        for(var idx=0;idx<arr.length;idx++){
          var node=arr[idx];if(!node||typeof node!=='object')continue;
          var nm=String(node.label||node.name||node.text||node.title||'').trim();
          var kids=Array.isArray(node.children)?node.children:[];
          if(nm&&!kids.length){
            var grp=parentName||'';
            var sk=grp+'|'+nm;
            if(!stSeen[sk]){stSeen[sk]=1;stItems.push({name:nm,group:grp,path:grp?grp+' / '+nm:nm});}
          }
          if(kids.length)walkDs(kids,nm||parentName);
        }
      };
      walkDs(candSources[0],'');
      if(stItems.length&&(stItems.some(function(it){return Boolean(it.group);})||!items.length)){
        items=stItems;
      }
    }
  }catch(e){}
  // 关下拉：Escape + 点空白，避免遮住后面的字段
  try{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));}catch(e){}
  try{if(document.body)document.body.click();}catch(e){}
  return JSON.stringify({ok:items.length>0,items:items.slice(0,200),
    reason:items.length?'':'empty',triggerText:String(dtxt(trigger)||'').slice(0,60)});
})()`;
}

/* ---- 规格抽屉：打开 / 聚焦值输入 / 确认（值本身用 CDP 真实键盘输入，React 才提交） ---- */
function openSpecDrawerScript() {
  return `(async function(){${NATIVE_SET}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  var rows=xxAll('tr,[class*="skuRow"],[class*="tableRow"]').filter(function(n){return n.querySelector&&n.querySelector('input');});
  if(rows.length>=2)return JSON.stringify({ok:true,reason:'already',rows:rows.length});
  var btn=xxAll('button').find(function(b){return /创建规格|设置规格|规格设置/.test(String(b.textContent||''));});
  if(!btn)return JSON.stringify({ok:false,reason:'no-create-button'});
  btn.click();
  await wait(1600);
  var wraps=xxAll('.next-drawer .next-radio-wrapper');
  var single=wraps.find(function(w){return /单层/.test(String(w.textContent||''))});
  if(single){single.click();await wait(1400);}
  var input=xxAll('.next-drawer input').find(function(i){
    var t=String(i.getAttribute('type')||'text').toLowerCase();
    if(t==='radio'||t==='checkbox'||t==='hidden')return false;
    return vis(i)&&!i.readOnly&&!i.disabled;
  });
  return JSON.stringify({ok:Boolean(input),hasInput:Boolean(input),single:Boolean(single)});
})()`;
}

/**
 * 单层规格抽屉：规格值不是「回车成标签」，而是「一行一个输入框 + 底部 + 按钮」。
 * 所以：填第 i 个输入框 → 点一次 button.add → 再填下一个（用户 2026-11-12 实测）。
 */
function fillSpecValuesScript(values) {
  return `(async function(){${NATIVE_SET}
  var list=${JSON.stringify(Array.isArray(values) ? values.slice(0, 60) : [])};
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function inputs(){return xxAll('.next-drawer input').filter(function(i){
    var t=String(i.getAttribute('type')||'text').toLowerCase();
    if(t==='radio'||t==='checkbox'||t==='hidden')return false;
    if(i.readOnly||i.disabled)return false;
    return (i.offsetWidth||i.offsetHeight);
  });}
  function addBtn(){return xxAll('.next-drawer button.add,.next-drawer button[class*="add"]').filter(function(b){return !b.disabled;})[0]||null;}
  var filled=0;
  for(var i=0;i<list.length;i++){
    var boxes=inputs();
    if(i>=boxes.length){
      var add=addBtn();
      if(!add)break;
      try{add.click();}catch(e){break;}
      await wait(160);
      boxes=inputs();
      if(i>=boxes.length)break;
    }
    var target=boxes[i];
    if(!target)break;
    xxSetNative(target,String(list[i]));
    if(String(target.value||'').trim())filled++;
    await wait(60);
  }
  await wait(200);
  var finalInputs=inputs();
  var values=finalInputs.map(function(i){return String(i.value||'').trim();}).filter(Boolean);
  return JSON.stringify({filled:filled,rows:finalInputs.length,values:values.slice(0,5),valueCount:values.length});
})()`;
}

function focusSpecInputScript() {
  return `(function(){${DOCS_SET}
  var input=xxAll('.next-drawer input').find(function(i){
    var t=String(i.getAttribute('type')||'text').toLowerCase();
    if(t==='radio'||t==='checkbox'||t==='hidden')return false;
    return (i.offsetWidth||i.offsetHeight)&&!i.readOnly&&!i.disabled;
  });
  if(!input)return JSON.stringify({focused:false});
  try{input.focus();}catch(e){}
  try{input.select&&input.select();}catch(e){}
  return JSON.stringify({focused:document.activeElement===input||true});
})()`;
}

function confirmSpecDrawerScript() {
  return `(async function(){${NATIVE_SET}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  var chips=xxAll('.next-drawer .sell-color-item-container li').length;
  var btn=xxAll('.next-drawer button').find(function(b){return /确认创建|确认|确定|保存/.test(String(b.textContent||'').trim());});
  if(!btn)return JSON.stringify({ok:false,reason:'no-confirm',chips:chips});
  btn.click();
  await wait(3200);
  var rows=xxAll('tr,[class*="skuRow"],[class*="tableRow"]').filter(function(n){return n.querySelector&&n.querySelector('input');});
  return JSON.stringify({ok:rows.length>=2,rows:rows.length,chips:chips});
})()`;
}

/** 属性：按「参数名」找发布页字段并写入（返回命中 / 未命中 / 必填缺口） */
function fillAttrsScript(attrs) {
  return `(async function(){${NATIVE_SET}
  var list=${JSON.stringify(Array.isArray(attrs) ? attrs.slice(0, 200) : [])};
  var filled=[],missed=[];
  for(var i=0;i<list.length;i++){
    var a=list[i]||{};
    var name=String(a.name||'').trim();
    var value=String(a.value==null?'':a.value).trim();
    if(!name||!/\\S/.test(value))continue;
    var hit=xxFindByLabel([name]);
    if(!hit){missed.push(name.slice(0,20));continue;}
    try{xxSetNative(hit.input,value);filled.push(name.slice(0,20));}catch(e){missed.push(name.slice(0,20));}
  }
  await new Promise(function(r){setTimeout(r,300);});
  // 必填缺口：页面上标了 * 但还空着的输入框
  var gaps=[];
  xxAll('.next-form-item,[class*="info-wrapper-wrap"]').forEach(function(box){
    var label=box.querySelector('label,.next-form-item-label,.sell-component-info-wrapper-label,[class*="info-wrapper-label"]');
    var text=label?(label.textContent||'').trim():'';
    if(!/\\*/.test(text))return;
    var input=box.querySelector('input:not([type=hidden]):not([disabled]):not([readonly]),textarea');
    if(!input)return;
    if(!String(input.value||'').trim())gaps.push(text.replace(/[:：*\\s]/g,'').slice(0,16));
  });
  return JSON.stringify({filled:filled,missed:missed.slice(0,20),gaps:gaps.slice(0,20)});
})()`;
}

/**
 * 选销售属性（规格值）。发布页只有在选了规格值之后才会生成 SKU 价格行；
 * 不选的话 `[fill-sku]` 必然 0/10（用户 2026-11-12 的日志就是这个现象）。
 */
function selectSkuSpecsScript(props) {
  return `(async function(){${NATIVE_SET}
  var groups=${JSON.stringify(Array.isArray(props) ? props.slice(0, 6) : [])};
  function norm(t){return String(t||'').replace(/[\\s\\u00a0【】\\[\\]()（）:：*·|丨]/g,'').replace(/[\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF\\uFE0F\\u2705\\u2764]/gu,'');}
  var clicked=[],missing=[];
  for(var g=0;g<groups.length;g++){
    var pname=String(groups[g].pname||'').trim();
    var values=(groups[g].values||[]).map(function(v){return String(v.vname||'').trim();}).filter(Boolean);
    if(!values.length)continue;
    var label=null;
    var nodes=xxAll('label,.next-form-item-label,.sell-component-info-wrapper-label,[class*="info-wrapper-label"],th,dt,span').filter(function(n){return norm(n.textContent)===norm(pname);});
    if(nodes.length){label=nodes[0];}
    var scope=(label&&label.closest('.next-form-item,[class*="info-wrapper-wrap"],[class*="form-item"]'))||document.body;
    for(var i=0;i<values.length;i++){
      var want=norm(values[i]);
      if(!want)continue;
      var hit=null;
      var cands=Array.from(scope.querySelectorAll('label,li,span,div,button,a'));
      for(var c=0;c<cands.length;c++){
        var node=cands[c];
        if(node.children.length>1)continue;
        if(norm(node.textContent)!==want)continue;
        if(!(node.offsetWidth||node.offsetHeight))continue;
        hit=node;break;
      }
      if(!hit){missing.push(values[i].slice(0,12));continue;}
      try{
        var box=hit.closest('label')||hit;
        var box2=box.querySelector&&box.querySelector('input[type=checkbox],input[type=radio]');
        if(box2&&!box2.checked)box2.click();else box.click();
        clicked.push(values[i].slice(0,12));
      }catch(e){missing.push(values[i].slice(0,12));}
      await new Promise(function(r){setTimeout(r,120);});
    }
  }
  await new Promise(function(r){setTimeout(r,900);});
  return JSON.stringify({clicked:clicked.slice(0,20),missing:missing.slice(0,8),count:clicked.length});
})()`;
}

/**
 * 创建销售规格（这是新版发布页最关键的一步）：
 * 没建规格时 `.sell-sku-table-wrapper-new` 里只有一个「+ 创建规格」按钮，
 * 点开是右侧抽屉，两种模式：
 *   ① 单层展示·自定义填写规格  ← 我们走这个（和采集到的「商品规格: 27 个值」对得上）
 *   ② 分层展示·选择标准属性构建规格（口味/总净含量…）
 * 流程：点按钮 → 选单层 → 填规格名 → 逐个填规格值（回车）→ 确认创建。
 * 返回每一步的结果，日志能看出卡在哪。
 */
function createSkuSpecsScript(pname, values) {
  return `(async function(){${NATIVE_SET}
  var specName=${JSON.stringify(String(pname || '商品规格'))};
  var list=${JSON.stringify(Array.isArray(values) ? values.slice(0, 60) : [])};
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function drawer(){return xxAll('.next-drawer').filter(vis)[0]||xxAll('.next-drawer')[0]||null;}
  var steps=[];
  if(!list.length)return JSON.stringify({ok:false,reason:'no-values',steps:steps});
  // 已经有 SKU 行就不建了
  var rows=xxAll('tr,[class*="skuRow"],[class*="tableRow"]').filter(function(n){return n.querySelector&&n.querySelector('input');});
  if(rows.length>=2)return JSON.stringify({ok:true,reason:'already',rows:rows.length,steps:steps});
  var btn=xxAll('button').find(function(b){return /创建规格|设置规格|规格设置/.test(String(b.textContent||''));});
  if(!btn)return JSON.stringify({ok:false,reason:'no-create-button',steps:steps});
  btn.click();steps.push('click-create');
  await wait(1500);
  // 单选卡片要点 label（.next-radio-wrapper），点 input 有时不触发 React 切换
  var wraps=xxAll('.next-drawer .next-radio-wrapper');
  var single=null;
  for(var i=0;i<wraps.length;i++){
    if(/单层/.test(String(wraps[i].textContent||''))){single=wraps[i];break;}
  }
  if(single){try{single.click();}catch(e){}steps.push('pick-single');await wait(1500);}
  else steps.push('no-single-radio');
  var dlg=drawer();
  if(!dlg)return JSON.stringify({ok:false,reason:'no-drawer',steps:steps});
  // 单层模式下规格名固定是「商品规格」，没有名字输入框；只有「输入规格」的值输入框。
  var nameInput=xxAll('.next-drawer input').find(function(i){return /^(?:规格名|规格名称)$/.test(String(i.getAttribute('placeholder')||'').trim());});
  if(nameInput){xxSetNative(nameInput,specName);steps.push('set-name');}
  function writableCands(){
    return xxAll('.next-drawer input').filter(function(i){
      var type=String(i.getAttribute('type')||'text').toLowerCase();
      if(type==='checkbox'||type==='radio'||type==='hidden')return false;
      if(i===nameInput||i.readOnly||i.disabled)return false;
      return vis(i);
    });
  }
  function valueInput(){
    var cands=writableCands();
    // 优先「输入规格」这个 placeholder，其次第一个可写输入框
    var byPh=cands.find(function(i){return /输入规格|规格值|请输入/.test(String(i.getAttribute('placeholder')||''));});
    return byPh||cands[0]||null;
  }
  var typed=0;
  for(var v=0;v<list.length;v++){
    var input=valueInput();
    if(!input){steps.push('no-value-input');break;}
    input.focus&&input.focus();
    xxSetNative(input,String(list[v]));
    try{
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    }catch(e){}
    typed++;
    await wait(150);
  }
  steps.push('typed:'+typed);
  // 确认创建
  var confirm=xxAll('.next-drawer button').find(function(b){return /确认创建|确认|确定|保存/.test(String(b.textContent||'').trim());});
  if(confirm){try{confirm.click();steps.push('confirm');}catch(e){steps.push('confirm-fail');}}
  else steps.push('no-confirm-button');
  await wait(3000);
  var rowsAfter=xxAll('tr,[class*="skuRow"],[class*="tableRow"]').filter(function(n){return n.querySelector&&n.querySelector('input');});
  return JSON.stringify({ok:rowsAfter.length>=2,rows:rowsAfter.length,typed:typed,steps:steps});
})()`;
}

/** SKU：按规格名找到行，写价格 / 库存 / 商家编码 */
function fillSkuScript(skus) {
  return `(async function(){${NATIVE_SET}
  var rows=${JSON.stringify(Array.isArray(skus) ? skus.slice(0, 300) : [])};
  var containers=xxAll('tr,.next-table-row,[class*="skuRow"],[class*="SkuRow"],[class*="sku-row"],[class*="skuItem"],[class*="tableRow"]')
    .filter(function(c){return c.querySelector('input');});
  // 规格名匹配：先按前 10 字精确包含，再按「字二元组重合度」兜底（新版表格会把长名字截断成 ...）
  function grams(t){var s=String(t||'').replace(/[^\\u4e00-\\u9fa5a-z0-9]/gi,'');var out={};for(var i=0;i<s.length-1;i++){out[s.slice(i,i+2)]=1;}return out;}
  function overlap(a,b){
    var ga=grams(a),gb=grams(b),hit=0,na=0;
    for(var k in ga){na++;if(gb[k])hit++;}
    return na?hit/na:0;
  }
  var skipped=[];
  function pickBox(name,index){
    function normName(t){return String(t||'').replace(/[\\s\\u00a0【】\\[\\]()（）:：*·|丨]/g,'').replace(/[\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF\\uFE0F\\u2705\\u2764]/gu,'');}
    var want=normName(name);
    if(!want)return null;
    var head=want.slice(0,10);
    var exact=containers.find(function(c){return normName((c.textContent||'').slice(0,200)).indexOf(head)>=0;});
    if(exact)return exact;
    var best=null,bestScore=0,dup=false;
    containers.forEach(function(c){
      var score=overlap(name,(c.textContent||'').slice(0,120));
      if(score>bestScore+0.08){best=c;bestScore=score;dup=false;}
      else if(Math.abs(score-bestScore)<=0.08&&score>=0.5){dup=true;}
    });
    if(!dup&&bestScore>=0.5)return best;
    // 兜底：规格行数与草稿规格数一致时，按顺序对应（天猫表格顺序 = 我们创建规格值的顺序）
    if(containers.length===rows.length&&index>=0)return containers[index]||null;
    return null;
  }
  var done=0,missed=[],gaps=[];
  rows.forEach(function(r,rowIndex){
    if(!r||r.removed)return;
    var name=String(r.name||'').trim();
    if(!name)return;
    var box=pickBox(name,rowIndex);
    if(!box){missed.push(name.slice(0,16));return;}
    var inputs=Array.from(box.querySelectorAll('input:not([type=hidden]):not([readonly])'));
    if(!inputs.length){missed.push(name.slice(0,16));return;}
    var pick=function(re,fallback){return inputs.find(function(i){return re.test(String(i.name||'')+String(i.placeholder||'')+String(i.getAttribute('aria-label')||''));})||inputs[fallback];};
    try{
      if(r.price)xxSetNative(pick(/price|价格/i,0),String(r.price));
      if(r.stock)xxSetNative(pick(/stock|库存|数量/i,1),String(r.stock));
      if(r.outerId)xxSetNative(pick(/outer|商家编码|编码/i,2),String(r.outerId));
      done++;
    }catch(e){missed.push(name.slice(0,16));}
  });
  await new Promise(function(r){setTimeout(r,400);});
  xxAll('.next-form-item').forEach(function(box){
    var label=box.querySelector('label,.next-form-item-label');
    var text=label?(label.textContent||'').trim():'';
    if(/\\*/.test(text)&&/规格|SKU|价格|库存/i.test(text)){
      var input=box.querySelector('input:not([type=hidden]),textarea');
      if(input&&!String(input.value||'').trim())gaps.push(text.replace(/[:：*\\s]/g,'').slice(0,16));
    }
  });
  return JSON.stringify({done:done,missed:missed.slice(0,10),gaps:gaps.slice(0,10),total:rows.length});
})()`;
}

/**
 * 组件感知填充（老软件 form-capture-native-products 的最小可用版）：
 *   同一个「名值」，按发布页实际组件类型分别写：
 *   - <select>          按选项文字选中并派发 change
 *   - 单选组 radio       按 label 文字点击
 *   - 多选组 checkbox    「、,，/」拆成多个值逐个点击
 *   - 日期 date / 文本   原生赋值 + input/change/blur
 *   - 级联 cascader      点开下拉后按文字点选项（最多两层）
 *   - 其它              回落成「找 label 旁边的输入框」
 * 这样保质期（日期）、产地（级联）、包装方式（下拉/单选）这类专用组件也能填。
 */
function fillSmartScript(pairs) {
  return `(async function(){${NATIVE_SET}
  var list=${JSON.stringify(Array.isArray(pairs) ? pairs.slice(0, 40) : [])};
  var filled=[],missed=[];
  function norm(s){return String(s||'').replace(/[:：*\\s（）()【】]/g,'');}
  function visible(el){return !!(el&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length));}
  function clickTexts(scope,values){
    var hit=0;
    var nodes=Array.from(scope.querySelectorAll('label,li,span,div,button'));
    for(var v=0;v<values.length;v++){
      var want=norm(values[v]);
      if(!want)continue;
      for(var i=0;i<nodes.length;i++){
        var node=nodes[i];
        if(node.children.length>2)continue;
        if(norm(node.textContent)!==want)continue;
        if(!visible(node))continue;
        try{node.click();hit++;}catch(e){}
        break;
      }
    }
    return hit;
  }
  async function fillOne(name,value){
    var hit=xxFindByLabel([name]);
    var box=hit&&hit.input?hit.input.closest('.next-form-item,tr,dt,li,div'):null;
    if(hit&&hit.input){
      var input=hit.input;
      // 日期
      if(input.type==='date'||/date/i.test(String(input.className||''))){
        xxSetNative(input,String(value).replace(/[^0-9-]/g,'').slice(0,10)||String(value));return 'date';
      }
      xxSetNative(input,String(value));return 'input';
    }
    // 没找到输入框：在 label 附近找组件（下拉 / 单选 / 多选 / 级联）
    var nodes=xxAll('label,th,dt,span,div').filter(function(n){return n.children.length===0&&n.textContent;});
    var labelNode=null;
    for(var i=0;i<nodes.length;i++){ if(norm(nodes[i].textContent)===norm(name)){labelNode=nodes[i];break;} }
    if(!labelNode)return '';
    var scope=labelNode.closest('.next-form-item,tr,dt,li,section,div')||document.body;
    // select
    var select=scope.querySelector('select');
    if(select){
      var opt=Array.from(select.options).find(function(o){return norm(o.textContent).indexOf(norm(value))>=0||norm(value).indexOf(norm(o.textContent))>=0;});
      if(opt){select.value=opt.value;select.dispatchEvent(new Event('change',{bubbles:true}));return 'select';}
    }
    // 单选 / 多选
    var values=String(value).split(/[、,，\\/]/).map(function(v){return v.trim();}).filter(Boolean);
    var clicked=clickTexts(scope,values);
    if(clicked)return 'choice';
    // 级联：点开再点选项
    var trigger=scope.querySelector('.next-cascader, [class*="cascader"], [class*="Cascader"], .next-select');
    if(trigger){
      try{trigger.click();}catch(e){}
      await new Promise(function(r){setTimeout(r,250);});
      var menus=xxAll('.next-menu, [class*="menu"], [class*="Menu"]');
      for(var m=0;m<menus.length&&clicked===0;m++){clicked=clickTexts(menus[m],values);}
      if(clicked)return 'cascader';
    }
    return '';
  }
  for(var i=0;i<list.length;i++){
    var row=list[i]||{};var name=String(row.name||'').trim();var value=String(row.value==null?'':row.value).trim();
    if(!name||!value)continue;
    try{var kind=await fillOne(name,value);if(kind)filled.push(name+'='+value+'('+kind+')');else missed.push(name);}
    catch(e){missed.push(name);}
  }
  await new Promise(function(r){setTimeout(r,300);});
  return JSON.stringify({filled:filled,missed:missed.slice(0,20)});
})()`;
}

/** SKU 搜索标题（老软件 [fill-sku] SKU搜索标题）：搜索标题 / SKU 标题 / 规格标题 都试一遍。 */
function fillSkuSearchTitleScript(title) {
  return `(async function(){${NATIVE_SET}
  var value=${JSON.stringify(String(title || '').slice(0, 60))};
  if(!value)return JSON.stringify({ok:false});
  var labels=['SKU搜索标题','搜索标题','SKU标题','规格标题','商品搜索词'];
  for(var i=0;i<labels.length;i++){
    var hit=xxFindByLabel([labels[i]]);
    if(hit&&hit.input){try{xxSetNative(hit.input,value);return JSON.stringify({ok:true,label:labels[i]});}catch(e){}}
  }
  return JSON.stringify({ok:false});
})()`;
}

/** 收起「填写助手」面板（老软件 [collapse-assistant]）：挡住发布页按钮时先收起来。 */
function collapseAssistantScript() {
  return `(function(){
  var hit=null;
  var nodes=Array.from(document.querySelectorAll('button,span,div,a')).filter(function(n){return n.children.length===0;});
  for(var i=0;i<nodes.length;i++){
    var t=String(nodes[i].textContent||'').replace(/\\s+/g,'');
    if(/^(收起|收起助手|收起填写助手|关闭助手|收起面板)$/.test(t)){hit=nodes[i];break;}
  }
  if(!hit)return JSON.stringify({ok:false});
  try{hit.click();return JSON.stringify({ok:true});}catch(e){return JSON.stringify({ok:false});}
})()`;
}

/** 多件优惠（老软件 sales Magix 多件优惠 2@9.5）：有「多件优惠」区块就设件数与折扣。 */
function fillMultiBuyScript(rule) {
  return `(async function(){${NATIVE_SET}
  var want=${JSON.stringify(rule && typeof rule === 'object' ? { pieces: String(rule.pieces || ''), discount: String(rule.discount || '') } : {})};
  if(!want.pieces&&!want.discount)return JSON.stringify({ok:false,reason:'no-rule'});
  var label=null;
  var nodes=xxAll('label,span,div').filter(function(n){return n.children.length===0&&/多件优惠|满件优惠|多件折扣/.test(n.textContent||'');});
  if(nodes.length)label=nodes[0];
  if(!label)return JSON.stringify({ok:false,reason:'no-panel'});
  var scope=label.closest('.next-form-item,section,div')||document.body;
  var inputs=Array.from(scope.querySelectorAll('input:not([type=hidden]):not([readonly])'));
  if(!inputs.length)return JSON.stringify({ok:false,reason:'no-input'});
  if(want.pieces&&inputs[0])xxSetNative(inputs[0],want.pieces);
  if(want.discount){
    var target=inputs.find(function(i){return /折扣|discount|off/i.test(String(i.name||'')+String(i.placeholder||''));})||inputs[1];
    if(target)xxSetNative(target,want.discount);
  }
  await new Promise(function(r){setTimeout(r,200);});
  return JSON.stringify({ok:true});
})()`;
}
function fillNamedScript(pairs) {
  return `(async function(){${NATIVE_SET}
  var list=${JSON.stringify(Array.isArray(pairs) ? pairs.slice(0, 20) : [])};
  var filled=[],missed=[];
  for(var i=0;i<list.length;i++){
    var p=list[i]||{};var name=String(p.name||'').trim();var value=String(p.value||'').trim();
    if(!name||!value)continue;
    var hit=xxFindByLabel([name]);
    if(!hit){missed.push(name);continue;}
    try{xxSetNative(hit.input,value);filled.push(name+'='+value);}catch(e){missed.push(name);}
  }
  await new Promise(function(r){setTimeout(r,200);});
  return JSON.stringify({filled:filled,missed:missed});
})()`;
}

/**
 * 必填兜底（对应老软件 `[fill-magix-required] Magix必填兜底`）：
 * 扫描发布页上标了 * 但还空着的输入框，用「草稿参数 + 由参数推出来的值」去填。
 * 不调用 AI、不联网，只做确定性的同义词匹配；填不上的原样报回日志，让用户知道缺什么。
 */
function fillRequiredGapsScript(hints) {
  return `(async function(){${NATIVE_SET}
  var hints=${JSON.stringify(Array.isArray(hints) ? hints.slice(0, 40) : [])};
  var norm=function(s){return String(s||'').replace(/[:：*\\s（）()【】\\[\\]]/g,'').replace(/必填|请选择|请输入/g,'');};
  var filled=[],gaps=[];
  var boxes=xxAll('.next-form-item, tr, .form-item, [class*="formItem"], [class*="info-wrapper-wrap"]');
  boxes.forEach(function(box){
    var labelNode=box.querySelector('label,.next-form-item-label,.form-label');
    var text=labelNode?(labelNode.textContent||''):'';
    if(!/\\*/.test(text))return;
    var key=norm(text);
    if(!key||key.length>20)return;
    var inputs=Array.from(box.querySelectorAll('input:not([type=hidden]):not([readonly]),textarea'));
    var empty=inputs.filter(function(i){return !i.disabled&&!String(i.value||'').trim();});
    if(!empty.length)return;
    // 1) 参数名精确/包含匹配
    var value='';
    for(var i=0;i<hints.length&&!value;i++){
      var h=hints[i]||{};
      var hn=norm(h.name);
      if(hn&&(hn===key||key.indexOf(hn)>=0||hn.indexOf(key)>=0)&&String(h.value||'').trim())value=String(h.value).trim();
    }
    if(!value){gaps.push(text.replace(/[:：*\\s]/g,'').slice(0,16));return;}
    try{xxSetNative(empty[0],value.slice(0,200));filled.push(key+'='+value.slice(0,20));}
    catch(e){gaps.push(key);}
  });
  await new Promise(function(r){setTimeout(r,300);});
  return JSON.stringify({filled:filled,gaps:gaps.slice(0,20)});
})()`;
}

/**
 * 省份必填兜底（[fill-province] / [presubmit-province]）：
 *   1) 找发布页「* 省份」/「产地省份」控件；没有这个字段直接 skipped:true；
 *   2) 已经有合法值（不是「请选择」）直接通过；
 *   3) 打开下拉框，优先匹配采集/参数里的省份（支持下拉内搜索框）；
 *   4) 拿不到省份，或者这个省份在下拉里不存在时，自动选择下拉框里的「其他」并回读校验。
 */
const PROVINCE_COMMON_HELPERS = `
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return dvis(n);}
  function norm(s){return String(s||'').replace(/[:：*\\s\\u200b\\u00a0（）()【】\\[\\]]/g,'').replace(/(?:重要|推荐|热|新|必填)+$/,'');}
  function coreProv(s){return norm(s).replace(/(?:壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市)$/,'');}
  function isPlaceholder(s){var t=norm(s);return !t||/^(?:请选择|请选|选择|选择省份|省份|请输入)$/.test(t);}
  function pt(el){
    if(!el||!el.getBoundingClientRect)return null;
    try{
      var r=el.getBoundingClientRect();
      if(!r||(!r.width&&!r.height))return null;
      var ox=0,oy=0,curDoc=el.ownerDocument;
      while(curDoc&&curDoc!==document&&curDoc.defaultView&&curDoc.defaultView.frameElement){
        var fe=curDoc.defaultView.frameElement;
        var fr=fe.getBoundingClientRect&&fe.getBoundingClientRect();
        if(fr){ox+=fr.left;oy+=fr.top;}
        curDoc=fe.ownerDocument;
      }
      return {x:Math.round(ox+r.left+r.width/2),y:Math.round(oy+r.top+r.height/2)};
    }catch(e){return null;}
  }
  function findProvinceField(){
    var docs=xxDocs();
    var sels='.sell-component-info-wrapper-label,[class*="info-wrapper-label"],label,.next-form-item-label,th,dt,span,div';
    var best=null;
    for(var d=0;d<docs.length;d++){
      var ns;try{ns=docs[d].querySelectorAll(sels);}catch(e){continue;}
      for(var i=0;i<ns.length;i++){
        var n=ns[i];
        if(n.children&&n.children.length>3)continue;
        var t=norm(dtxt(n));
        if(t!=='省份'&&t!=='产地省份'&&t!=='所在省份')continue;
        var row=n.closest('[class*="info-wrapper-wrap"],.next-form-item,[class*="form-item"],[class*="formItem"],tr,li')||n.parentElement;
        var box=n.closest('[class*="label-container"]')||(n.parentElement!==row?n.parentElement:null);
        var comp=(box&&box.nextElementSibling&&(!row||row.contains(box.nextElementSibling))?box.nextElementSibling:null)||(row&&row.querySelector('[class*="component-wrap"],.next-form-item-control'))||row||n.parentElement;
        if(!comp)continue;
        var hasCtrl=Boolean(comp.querySelector('select,.next-select,.next-cascader,[class*="select-trigger"],[role="combobox"],[class*="Select"],input'));
        if(!hasCtrl&&row)comp=row;
        if(vis(n)||vis(comp)){best={label:n,row:row,comp:comp};break;}
        if(!best)best={label:n,row:row,comp:comp};
      }
      if(best&&(vis(best.label)||vis(best.comp)))break;
    }
    return best;
  }
  function readTriggerVal(trig){
    if(!trig)return '';
    var valNode=trig.querySelector&&trig.querySelector('.next-select-values .next-select-value,.next-select-values,.next-select-inner,[class*="select-value"]');
    var t=valNode?dtxt(valNode):'';
    if(!t){
      var inp=trig.querySelector&&trig.querySelector('input:not([type=hidden])');
      if(inp&&String(inp.value||'').trim())t=String(inp.value).trim();
    }
    if(!t)t=dtxt(trig);
    return String(t||'').replace(/\\s+/g,' ').trim();
  }
  function findProvinceOverlays(trig,requireOpts){
    var docs=xxDocs(),out=[];
    var sels=[
      '.next-overlay-wrapper.opened .next-overlay-inner',
      '.next-overlay-wrapper.opened .next-menu',
      '.next-select-popup-wrap',
      '.next-overlay-inner',
      '.next-menu-wrapper',
      '[role="listbox"]',
      '[class*="overlay-inner"]',
      '[class*="dropdown-menu"]',
      '[class*="popup-wrap"]',
      '[class*="select-dropdown"]'
    ];
    for(var d=0;d<docs.length;d++){
      for(var s=0;s<sels.length;s++){
        var ns;try{ns=docs[d].querySelectorAll(sels[s]);}catch(e){continue;}
        for(var i=0;i<ns.length;i++){
          var el=ns[i];
          if(!vis(el)||out.indexOf(el)>=0)continue;
          if(trig&&(el===trig||(el.contains&&el.contains(trig))))continue;
          if(requireOpts&&!el.querySelector('.next-menu-item,[role="option"],li,[class*="option"],[class*="menu-item"],[class*="select-item"]'))continue;
          out.push(el);
        }
      }
    }
    // 兜底：部分新版组件下拉外层只带 popup / dropdown / overlay 类名，选项是普通 <div>
    if(!out.length){
      for(var d2=0;d2<docs.length;d2++){
        var fb;try{fb=docs[d2].querySelectorAll('[class*="overlay"],[class*="popup"],[class*="dropdown"]');}catch(e){continue;}
        for(var j=0;j<fb.length;j++){
          var ov=fb[j];
          if(!vis(ov)||out.indexOf(ov)>=0)continue;
          if(trig&&(ov===trig||(ov.contains&&ov.contains(trig))))continue;
          var r=ov.getBoundingClientRect&&ov.getBoundingClientRect();
          if(r&&(r.width>720||r.height<16))continue;
          var tx=norm(dtxt(ov));
          if(/其他|其它|北京|上海|广东|福建|浙江/.test(tx))out.push(ov);
        }
      }
    }
    var provOverlays=out.filter(function(ov){
      var txt=norm(dtxt(ov));
      return /其他|其它|北京|上海|广东|福建|浙江/.test(txt);
    });
    return provOverlays.length?provOverlays:out;
  }
  function collectProvinceOpts(overlays){
    var out=[],seen=[];
    var optSel='.next-menu-item,[role="option"],li,[class*="option"],[class*="menu-item"],[class*="select-item"]';
    for(var o=0;o<overlays.length;o++){
      var ns=[];
      try{ns=Array.prototype.slice.call(overlays[o].querySelectorAll(optSel));}catch(e){ns=[];}
      if(!ns.length){
        try{
          ns=Array.prototype.slice.call(overlays[o].querySelectorAll('div,span,a')).filter(function(n){
            if(!vis(n)||(n.children&&n.children.length>2))return false;
            if(n.querySelector&&n.querySelector('input'))return false;
            var tx=norm(dtxt(n));
            return Boolean(tx&&tx.length<=24);
          });
        }catch(e){ns=[];}
      }
      for(var i=0;i<ns.length;i++){
        var n=ns[i];
        if(!vis(n))continue;
        if(n.querySelector&&n.querySelector('input'))continue;
        var t=String(dtxt(n)||'').replace(/\\s+/g,' ').trim();
        var nt=norm(t);
        if(!nt||nt.length>30||/^(?:请选择|请输入|搜索|无匹配|暂无数据|加载中)$/.test(nt))continue;
        if(seen.indexOf(n)<0){seen.push(n);out.push({el:n,text:t,norm:nt,core:coreProv(t)});}
      }
    }
    return out;
  }
  function matchProvinceOpts(opts,targets){
    for(var c=0;c<targets.length;c++){
      var wn=norm(targets[c]),wc=coreProv(targets[c]);
      if(!wn)continue;
      var hit=opts.find(function(o){return o.norm===wn;})
        ||opts.find(function(o){return wc&&o.core&&o.core===wc;})
        ||opts.find(function(o){return wc.length>=2&&o.core&&(o.core.indexOf(wc)===0||wc.indexOf(o.core)===0)&&o.core.length<=wc.length+6;});
      if(hit)return hit;
    }
    return null;
  }
  function findOverlaySearchInput(overlays){
    for(var oi=0;oi<overlays.length;oi++){
      try{
        var cand=overlays[oi].querySelector('input:not([type=hidden]):not([readonly]):not([disabled])');
        if(cand&&vis(cand))return cand;
      }catch(e){}
    }
    return null;
  }
`;

function buildEnsureProvinceScript(candidates) {
  const list = JSON.stringify((Array.isArray(candidates) ? candidates : []).map(v => String(v || '').trim()).filter(Boolean).slice(0, 8));
  return `(async function(){${NATIVE_SET}${DIALOG_HELPERS}${PROVINCE_COMMON_HELPERS}
  var wantList=${list};
  var field=findProvinceField();
  if(!field)return JSON.stringify({ok:true,skipped:true,reason:'no-field'});
  var comp=field.comp;
  // 原生 <select>
  var nativeSel=comp.querySelector&&comp.querySelector('select');
  if(nativeSel){
    var curOpt=nativeSel.options&&nativeSel.options[nativeSel.selectedIndex];
    var curTxt=curOpt?String(curOpt.textContent||'').trim():String(nativeSel.value||'').trim();
    if(!isPlaceholder(curTxt))return JSON.stringify({ok:true,already:true,picked:curTxt,via:'native-select'});
    var nOpts=Array.prototype.slice.call(nativeSel.options||[]);
    var pickedOpt=null,usedFallback=false;
    for(var c=0;c<wantList.length&&!pickedOpt;c++){
      var wc=coreProv(wantList[c]),wn=norm(wantList[c]);
      pickedOpt=nOpts.find(function(o){return norm(o.textContent)===wn;})
        ||nOpts.find(function(o){var oc=coreProv(o.textContent);return wc&&oc&&oc===wc;})
        ||nOpts.find(function(o){var oc=coreProv(o.textContent);return wc.length>=2&&oc&&(oc.indexOf(wc)>=0||wc.indexOf(oc)>=0);})||null;
    }
    if(!pickedOpt){
      pickedOpt=nOpts.find(function(o){var t=norm(o.textContent);return t==='其他'||t==='其它';})||null;
      usedFallback=Boolean(pickedOpt);
    }
    if(!pickedOpt)return JSON.stringify({ok:false,reason:'no-option',via:'native-select'});
    nativeSel.value=pickedOpt.value;
    nativeSel.dispatchEvent(new Event('change',{bubbles:true}));
    return JSON.stringify({ok:true,picked:String(pickedOpt.textContent||'').trim(),usedFallback:usedFallback,via:'native-select'});
  }
  // Fusion / Next Select / Combobox
  var trig=(comp.querySelector&&comp.querySelector('.next-select,.next-cascader,[class*="select-trigger"],[role="combobox"],[class*="Select"]'))||comp;
  var initialVal=readTriggerVal(trig);
  if(!isPlaceholder(initialVal)){
    return JSON.stringify({ok:true,already:true,picked:initialVal,via:'existing'});
  }
  function setSearchText(el,v){
    if(!el)return;
    try{
      var desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
      if(desc&&desc.set)desc.set.call(el,v);else el.value=v;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }catch(e){}
  }
  var fireEl=(trig.querySelector&&trig.querySelector('.next-select-trigger,.next-select-inner,.next-select-arrow,input'))||trig;
  try{if(fireEl.scrollIntoView)fireEl.scrollIntoView({block:'center'});}catch(e){}
  var triggerPoint=pt(fireEl)||pt(trig);
  var neutralPoint=pt(field.label);
  var overlays=findProvinceOverlays(trig,true);
  if(!overlays.length||!collectProvinceOpts(overlays).length){
    try{
      var ev={bubbles:true,cancelable:true,view:window};
      fireEl.dispatchEvent(new PointerEvent('pointerdown',ev));
      fireEl.dispatchEvent(new MouseEvent('mousedown',ev));
      fireEl.dispatchEvent(new PointerEvent('pointerup',ev));
      fireEl.dispatchEvent(new MouseEvent('mouseup',ev));
      fireEl.click();
    }catch(e){}
    await wait(450);
    overlays=findProvinceOverlays(trig,true);
    if(!overlays.length&&fireEl!==trig){
      try{trig.click();}catch(e){}
      await wait(350);
      overlays=findProvinceOverlays(trig,true);
    }
  }
  if(!overlays.length){
    return JSON.stringify({ok:false,reason:'no-overlay',overlayOpen:false,point:triggerPoint,neutralPoint:neutralPoint});
  }
  var opts=collectProvinceOpts(overlays);
  var searchInp=findOverlaySearchInput(overlays);
  var searchPoint=pt(searchInp);
  var hit=wantList.length?matchProvinceOpts(opts,wantList):null;
  if(!hit&&wantList.length&&searchInp){
    var qText=coreProv(wantList[0])||wantList[0];
    setSearchText(searchInp,qText);
    await wait(300);
    overlays=findProvinceOverlays(trig,false);
    opts=collectProvinceOpts(overlays);
    hit=matchProvinceOpts(opts,wantList);
    if(!hit){
      setSearchText(searchInp,'');
      await wait(300);
      overlays=findProvinceOverlays(trig,false);
      opts=collectProvinceOpts(overlays);
    }
  }
  var usedFallback=false;
  if(!hit){
    hit=opts.find(function(o){return o.norm==='其他'||o.norm==='其它';})||null;
    if(!hit&&searchInp){
      setSearchText(searchInp,'其他');
      await wait(300);
      overlays=findProvinceOverlays(trig,false);
      opts=collectProvinceOpts(overlays);
      hit=opts.find(function(o){return o.norm==='其他'||o.norm==='其它';})||null;
    }
    usedFallback=Boolean(hit);
  }
  if(!hit){
    try{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));}catch(e){}
    return JSON.stringify({ok:false,reason:'no-other-option',overlayOpen:findProvinceOverlays(trig,false).length>0,point:triggerPoint,searchPoint:searchPoint,neutralPoint:neutralPoint,available:opts.slice(0,10).map(function(o){return o.text;})});
  }
  try{if(hit.el.scrollIntoView)hit.el.scrollIntoView({block:'nearest'});}catch(e){}
  var optPoint=pt(hit.el);
  try{
    var oev={bubbles:true,cancelable:true,view:window};
    hit.el.dispatchEvent(new PointerEvent('pointerdown',oev));
    hit.el.dispatchEvent(new MouseEvent('mousedown',oev));
    hit.el.dispatchEvent(new PointerEvent('pointerup',oev));
    hit.el.dispatchEvent(new MouseEvent('mouseup',oev));
    hit.el.click();
  }catch(e){}
  await wait(350);
  var after=readTriggerVal(trig);
  var ok=!isPlaceholder(after);
  var stillOpen=findProvinceOverlays(trig,false).length>0;
  // 只有选成功且弹窗未自动关闭时才 Escape；选不中时保持下拉打开，方便紧接着用 CDP 真实鼠标点击 optionPoint / searchPoint。
  if(ok&&stillOpen){
    try{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));}catch(e){}
    stillOpen=findProvinceOverlays(trig,false).length>0;
  }
  return JSON.stringify({
    ok:ok,
    picked:ok?after:'',
    target:hit.text,
    usedFallback:usedFallback,
    hadCandidates:wantList.length>0,
    overlayOpen:stillOpen,
    point:triggerPoint,
    optionPoint:optPoint,
    searchPoint:searchPoint,
    neutralPoint:neutralPoint,
    reason:ok?'':'readback-empty'
  });
})()`;
}

/**
 * 只读读取「* 省份」触发框、已打开下拉框及其选项/搜索框视口坐标（绝不主动点开/关触发框，避免来回误切换）。
 */
function locateProvinceOverlayScript(candidates) {
  const list = JSON.stringify((Array.isArray(candidates) ? candidates : []).map(v => String(v || '').trim()).filter(Boolean).slice(0, 8));
  return `(function(){${NATIVE_SET}${DIALOG_HELPERS}${PROVINCE_COMMON_HELPERS}
  var wantList=${list};
  var field=findProvinceField();
  if(!field)return JSON.stringify({ok:true,skipped:true,reason:'no-field',overlayOpen:false});
  var comp=field.comp;
  var trig=(comp.querySelector&&comp.querySelector('.next-select,.next-cascader,[class*="select-trigger"],[role="combobox"],[class*="Select"]'))||comp;
  var fireEl=(trig.querySelector&&trig.querySelector('.next-select-trigger,.next-select-inner,.next-select-arrow,input'))||trig;
  var current=readTriggerVal(trig);
  var overlays=findProvinceOverlays(trig,false);
  var overlayOpen=overlays.length>0;
  if(!isPlaceholder(current)){
    return JSON.stringify({ok:true,already:true,picked:current,overlayOpen:overlayOpen,neutralPoint:pt(field.label)});
  }
  var opts=collectProvinceOpts(overlays);
  var hit=wantList.length?matchProvinceOpts(opts,wantList):null;
  var usedFallback=false;
  if(!hit){
    hit=opts.find(function(o){return o.norm==='其他'||o.norm==='其它';})||null;
    usedFallback=Boolean(hit);
  }
  if(hit){try{if(hit.el.scrollIntoView)hit.el.scrollIntoView({block:'nearest'});}catch(e){}}
  var searchInp=findOverlaySearchInput(overlays);
  return JSON.stringify({
    ok:false,
    picked:'',
    overlayOpen:overlayOpen,
    target:hit?hit.text:(wantList[0]||'其他'),
    usedFallback:usedFallback,
    point:pt(fireEl)||pt(trig),
    optionPoint:hit?pt(hit.el):null,
    searchPoint:pt(searchInp),
    neutralPoint:pt(field.label),
    available:opts.slice(0,10).map(function(o){return o.text;})
  });
})()`;
}

/** 兜底：DOM 与 CDP 都无法提交时，从 __SELL_STATE__ 的省份组件数据源查找对应项（优先候选，否则「其他」）并回读 DOM。 */
function writeProvinceViaStateScript(candidates) {
  const list = JSON.stringify((Array.isArray(candidates) ? candidates : []).map(v => String(v || '').trim()).filter(Boolean).slice(0, 8));
  return `(async function(){${NATIVE_SET}${DIALOG_HELPERS}${PROVINCE_COMMON_HELPERS}
  var wantList=${list};
  var field=findProvinceField();
  if(!field)return JSON.stringify({ok:false,reason:'no-field'});
  var comp=field.comp;
  var trig=(comp.querySelector&&comp.querySelector('.next-select,.next-cascader,[class*="select-trigger"],[role="combobox"],[class*="Select"]'))||comp;
  try{
    var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
    var eng=st&&st.engine;
    if(!st||!eng||typeof st.getComponentProps!=='function')return JSON.stringify({ok:false,reason:'no-engine'});
    var keys=[];
    try{
      var comps=(st.components||st.models||(st.getState&&st.getState().components))||{};
      keys=Object.keys(comps);
    }catch(e){}
    ['province','originProvince','prov'].forEach(function(k){if(keys.indexOf(k)<0)keys.push(k);});
    for(var i=0;i<keys.length;i++){
      var k=keys[i];
      var props=null;
      try{props=st.getComponentProps(k);}catch(e){}
      if(!props||!Array.isArray(props.dataSource)||!props.dataSource.length)continue;
      var labelTxt=norm(props.label||props.title||'');
      var dsText=norm(props.dataSource.slice(0,8).map(function(x){return (x&&(x.label||x.text||x.name))||'';}).join(''));
      if(!/省份/.test(labelTxt)&&!/其他|其它/.test(dsText))continue;
      if(!/北京|上海|广东|福建|浙江/.test(dsText)&&!/省份/.test(labelTxt))continue;
      var normDs=props.dataSource.map(function(d){
        var txt=String((d&&(d.label||d.text||d.name||d.value))||'').trim();
        return {raw:d,text:txt,norm:norm(txt),core:coreProv(txt),val:d&&d.value!==undefined?d.value:txt};
      });
      var hit=null,usedFallback=false;
      for(var c=0;c<wantList.length&&!hit;c++){
        var wn=norm(wantList[c]),wc=coreProv(wantList[c]);
        hit=normDs.find(function(o){return o.norm===wn;})||normDs.find(function(o){return wc&&o.core===wc;})||null;
      }
      if(!hit){
        hit=normDs.find(function(o){return o.norm==='其他'||o.norm==='其它';})||null;
        usedFallback=Boolean(hit);
      }
      if(!hit)continue;
      try{eng.getComponent(k).setProps({value:hit.val});}catch(e){}
      await wait(300);
      var after=readTriggerVal(trig);
      if(!isPlaceholder(after)){
        return JSON.stringify({ok:true,picked:after,usedFallback:usedFallback,via:'sell-state'});
      }
    }
  }catch(e){}
  return JSON.stringify({ok:false,reason:'state-readback-empty'});
})()`;
}

/** 提交：只点一下，不在页面里 await（表单提交会销毁上下文） */
/** 老软件 submitToWarehouse：先确认「放入仓库」radio 真的 checked，没确认就不提交。 */
function confirmWarehouseRadioScript() {
  return `(function(){
  var labels=Array.prototype.slice.call(document.querySelectorAll('.item-label,label,span,div')).filter(function(e){
    return (e.innerText||'').trim()==='放入仓库'||(e.textContent||'').trim()==='放入仓库';
  });
  var wrap=null;
  for(var li=0;li<labels.length&&!wrap;li++){
    var box=labels[li];
    for(var i=0;i<7&&box;i++,box=box.parentElement){
      var w=box.querySelector&&box.querySelector('.next-radio-wrapper');
      if(w){wrap=w;break;}
    }
  }
  if(!wrap){
    // 皮肤兜底：从文字节点往上找包含 input[type=radio] 的最小容器
    for(var lj=0;lj<labels.length&&!wrap;lj++){
      var n=labels[lj];
      for(var up=0;n&&up<6;up++,n=n.parentElement){
        if(n.querySelector&&n.querySelector('input[type=radio]')){wrap=n;break;}
      }
    }
  }
  if(!wrap)return JSON.stringify({ok:false,state:'missing',reason:'找不到放入仓库单选项'});
  var checked=wrap.classList.contains('checked')
    ||(wrap.getAttribute&&wrap.getAttribute('aria-checked')==='true')
    ||Boolean(wrap.querySelector('input[type=radio]:checked'));
  if(!checked){
    var el=wrap.querySelector('input[type=radio]')||wrap;
    try{el.click();}catch(e){}
    checked=wrap.classList.contains('checked')
      ||(wrap.getAttribute&&wrap.getAttribute('aria-checked')==='true')
      ||Boolean(wrap.querySelector('input[type=radio]:checked'));
    // 再往上找一层 checked 标识（有的皮肤把 class 放在父级）
    if(!checked&&wrap.parentElement)checked=/(?:^|\\s)checked(?:\\s|$)/.test(String(wrap.parentElement.className||''));
  }
  return JSON.stringify({ok:checked===true,state:checked?'checked':'unconfirmed'});
})()`;
}

/** 老软件 SUBMIT_STALL_DIAG_SCRIPT：提交后停在发布页时抓弹窗/toast 文字与按钮状态（只读）。 */
function submitStallDiagScript() {
  return `(function(){
  function vis(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';}
  var texts=[];
  Array.prototype.slice.call(document.querySelectorAll('.next-dialog,.next-message,.next-notification,.next-overlay-inner,[role="dialog"],[role="alert"]')).forEach(function(e){
    if(!vis(e))return;
    var t=String(e.innerText||'').replace(/\\s+/g,' ').trim();
    if(t&&texts.indexOf(t)<0&&!texts.some(function(x){return x.indexOf(t)>=0;}))texts.push(t.slice(0,160));
  });
  var b=document.querySelector('button[name="button-submit"]');
  var btn=b?((b.disabled?'disabled ':'')+(/loading/.test(String(b.className||''))?'loading ':'')+String(b.innerText||'').trim().slice(0,12)):'no-button';
  return JSON.stringify({texts:texts.slice(0,5),button:btn.trim(),href:String(location.href).slice(0,220)});
})()`;
}

/**
 * 提交按钮定位（页面内公共逻辑）。
 * 2026-11-20 现场定案：**不能用选择器列表**。`querySelector('button[name=…], button[type=submit], .next-btn-primary')`
 * 是按文档顺序返回第一个匹配项，发布页上方的「切换类目」也带 `.next-btn-primary`，排在真正提交按钮之前，
 * 于是点了三次「切换类目」（日志：按钮「切换类目」· 坐标 670,205），提交当然没有发出，
 * 还每点一次弹一次「选择类目」。现在按优先级分开查，并且一律排除切换类目/取消/预览/存草稿这类按钮。
 */
const SUBMIT_BUTTON_JS = `
  function xxSubmitText(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,'').trim();}
  function xxSubmitVisible(n){try{var r=n.getBoundingClientRect();return !!(r&&r.width>0&&r.height>0);}catch(e){return false;}}
  function xxSubmitButton(){
    var bad=/切换类目|取消|返回|预览|保存|草稿|删除|关闭|重置/;
    var b=null;
    // 1) 老软件原生选择器（必须单独查，原因见上）
    try{b=document.querySelector('button[name="button-submit"]');}catch(e){b=null;}
    if(b&&xxSubmitVisible(b)&&!bad.test(xxSubmitText(b)))return b;
    // 2) type=submit
    try{b=document.querySelector('button[type="submit"]');}catch(e){b=null;}
    if(b&&xxSubmitVisible(b)&&!bad.test(xxSubmitText(b)))return b;
    // 3) 按文字找：只认提交类文案，且取页面最下面那一颗（发布页的提交按钮固定在底部）
    var hits=Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(n){
      if(!xxSubmitVisible(n)||n.disabled)return false;
      var t=xxSubmitText(n);
      if(!t||t.length>8||bad.test(t))return false;
      return /提交|立即发布|发布/.test(t);
    });
    hits.sort(function(a,c){return c.getBoundingClientRect().top-a.getBoundingClientRect().top;});
    return hits[0]||null;
  }
  function xxSubmitBusy(){
    try{
      if(document.readyState==='loading')return true;
      var vw=window.innerWidth||0,vh=window.innerHeight||0;
      // 只认「整页/大块遮罩」：小转圈（局部模块的 loading）不能当成页面还在转，否则永远不敢点提交
      var ns=document.querySelectorAll('.next-loading,[class*="page-loading"],[class*="publish-loading"],[class*="global-loading"]');
      for(var i=0;i<ns.length;i++){
        var r=ns[i].getBoundingClientRect();
        if(!r.width||!r.height)continue;
        if(r.width*r.height>=Math.max(60000,vw*vh*0.25))return true;
      }
    }catch(e){}
    return false;
  }
`;

/**
 * 提交按钮定位（只读，不点）：返回按钮中心坐标与状态。
 * 主进程用 CDP 真实鼠标点这个坐标 —— 比 DOM click 更接近真人操作，也不受合成事件被吞的影响。
 * 「放入仓库」单选项由 confirmWarehouseRadioScript 负责，这里不再顺手点它。
 */
function clickSubmitScript() {
  return `(function(){${SUBMIT_BUTTON_JS}
  var btn=xxSubmitButton();
  if(!btn)return JSON.stringify({ok:false,error:'找不到「提交」按钮（只找到切换类目/取消这类按钮，不点）'});
  try{btn.scrollIntoView({block:'center'});}catch(e){}
  var r=null;try{r=btn.getBoundingClientRect();}catch(e){}
  var text=xxSubmitText(btn);
  var disabled=Boolean(btn.disabled);
  return JSON.stringify({
    ok:!disabled,
    error:disabled?'提交按钮不可用（disabled）':'',
    button:text.slice(0,20),
    loading:/loading/i.test(String(btn.className||'')),
    busy:xxSubmitBusy(),
    visible:Boolean(r&&r.width&&r.height),
    point:r&&r.width&&r.height?{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}:null
  });
})()`;
}

/** CDP 坐标点不了时的兜底：DOM click（等同老软件的 b.click()）。 */
function clickSubmitDomScript() {
  return `(function(){${SUBMIT_BUTTON_JS}
  var btn=xxSubmitButton();
  if(!btn)return JSON.stringify({ok:false,error:'no-button'});
  if(btn.disabled)return JSON.stringify({ok:false,error:'disabled'});
  try{btn.click();return JSON.stringify({ok:true,button:xxSubmitText(btn).slice(0,20)});}catch(e){return JSON.stringify({ok:false,error:String(e&&e.message||e)});}
})()`;
}

/** 提交前：等页面给出成功跳转 / 错误提示（主进程轮询用，执行很快） */
function submitStateScript() {
  return `(function(){
  var href=location.href;
  var m=/[?&]primaryId=(\\d+)/.exec(href)||/[?&]itemId=(\\d+)/.exec(href);
  var q=null;try{q=new URL(href,location.origin).searchParams;}catch(e){}
  var isSuccess=q?q.get('isSuccess'):null, isEdit=q?q.get('isEdit'):null;
  var body=(document.body&&document.body.innerText)||'';
  var errors=[];
  var staticHint=/请使用最新版chrome|功能缺失|欢迎使用万象客服|标题过长可能折叠|TOP问题|商家关心|白皮书|常见问题/;
  // 只认表单自带的报错节点；[class*="help"]/[class*="error"] 这种宽选择器会把右侧「常见问题」面板整段抓进来，
  // 让真正的拦路项被淹没（2026-11-17 实测：提交失败只看到一串「问…」）。
  document.querySelectorAll('.next-form-item-explain, .next-form-item-help, .next-message-error, [class*="errorText"], [class*="error-text"], [class*="error-msg"], [class*="errorMsg"], [class*="error-message"], [class*="error"],[class*="Error"], .sell-component-assistant-error-v2-sub-content, .sell-component-assistant-error-v2-error-content').forEach(function(n){
    var t=(n.textContent||'').trim();
    if(!t||t.length>=100)return;
    if(staticHint.test(t)||/^问/.test(t))return;
    var box=n.closest('[class*="question"],[class*="faq"],[class*="FAQ"],[class*="help-center"],[class*="side-panel"],[class*="assistant-panel"]');
    if(box)return;
    // 「3:4主图仅支持jpg/jpeg，请修改第1张图片」这类图位错误不带「必填」字样，以前被整条漏掉，
    // 提交失败只剩一句「没收到回执」。这里把所有格式/尺寸类提示一并收进来。
    if(!/必填|不能为空|请填写|未填|校验失败|不能超过|字符|填写错误|错误|缺失|过长|请选择|请输入|未上传|请修改|仅支持|不支持|格式|尺寸|像素|比例|不合规|不符合/.test(t))return;
    if(errors.indexOf(t)<0)errors.push(t);
  });
  // 提交后平台又把「选择类目」弹出来 = 类目没被确认，继续等也不会有回执（2026-11-17 现场）
  var categoryDialog=false;
  try{
    Array.prototype.slice.call(document.querySelectorAll('[class*="dialog"],[role="dialog"],[class*="Dialog"]')).some(function(d){
      if(!d.offsetHeight)return false;
      var t=String(d.innerText||'');
      if(/选择类目|类目选择/.test(t)&&/确定|关闭|已选类目/.test(t)){categoryDialog=true;return true;}
      return false;
    });
  }catch(e){}
  // 弹窗抑制器处理过几次（关闭× / 强制隐藏）：数字变大 = 点提交之后平台又弹了「选择类目」，
  // 这次提交多半被它吃掉，主进程据此补点一次提交（用户 2026-11-19：再点一次就能上架）。
  var guard=window.__XX_CATEGORY_GUARD__||null;
  var guardClosed=guard?Number(guard.closed)||0:0,guardHidden=guard?Number(guard.hidden)||0:0;
  // 提交按钮当前状态（补点判断用）：loading / disabled 时说明提交真的在跑，不要重复点
  var subBtn=document.querySelector('button[name="button-submit"]');
  var button=subBtn?((subBtn.disabled?'disabled ':'')+(/loading/.test(String(subBtn.className||''))?'loading ':'')+String(subBtn.innerText||'').trim().slice(0,12)):'no-button';
  // 页面自己弹出的「提交成功 / 已放入仓库」浮层：只有能同时从链接里拿到商品编号才算数，
  // 免得把右侧帮助面板里的「发布成功后…」当成回执。
  var successToast='',idFromDom='',toastNode=null;
  try{
    Array.prototype.slice.call(document.querySelectorAll('.next-message-success,.next-notification-success,[class*="message-success"],[class*="toast-success"],[class*="success-tip"],[class*="successTip"]')).forEach(function(n){
      if(!n.offsetWidth&&!n.offsetHeight)return;
      var t=String(n.innerText||n.textContent||'').replace(/\\s+/g,' ').trim();
      if(t&&t.length<60&&!successToast&&/成功|已放入仓库|已提交/.test(t)){successToast=t;toastNode=n;}
    });
    // 只认浮层自己带的商品链接：右侧帮助面板里也有 itemId 链接，不能拿来冒充回执
    if(toastNode){
      Array.prototype.slice.call(toastNode.querySelectorAll('a[href]')).some(function(a){
        var mm=/[?&](?:itemId|primaryId)=(\\d+)/.exec(String(a.getAttribute('href')||''));
        if(mm&&/^[1-9]\\d*$/.test(mm[1])){idFromDom=mm[1];return true;}
        return false;
      });
    }
  }catch(e){}
  var receiptSuccess=/success\\.htm/.test(href)&&/auctionStatus=-5/.test(href||'')&&isSuccess==='true'&&isEdit!=='true'&&/^[1-9]\\d*$/.test(m?m[1]:'');
  return JSON.stringify({
    href:href.slice(0,300),
    // 老软件 warehouseReceipt：success.htm + auctionStatus=-5 + isSuccess=true + 非编辑 + 合法 itemId
    success:receiptSuccess||Boolean(successToast&&idFromDom),
    primaryId:m?m[1]:idFromDom,
    captcha:/滑动|验证码|访问过快|频繁|punish/.test(href+body),
    categoryDialog:categoryDialog,
    guardClosed:guardClosed,
    guardHidden:guardHidden,
    button:button,
    successToast:successToast,
    errors:errors.slice(0,8)
  });
})()`;
}

/** 页面上的 file input 清单（图片 / 视频上传入口） */
/** 按组点开上传入口：天猫 3:4 / 详情 / SKU 图不点空图位就不会挂 input。 */
function buildOpenImageEntryScript(group, dry) {
  return `(function(){${NATIVE_SET}
  var group=${JSON.stringify(group)};
  var dry=${dry ? 'true' : 'false'};
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function txt(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,' ').trim();}
  var groups={
    square:['#struct-mainImagesGroup','[class*="mainPic"]','[class*="main-pic"]','[class*="mainImage"]','[class*="main-image"]'],
    tall:['#struct-threeToFourImages','[class*="tallPic"]','[class*="tall-pic"]','[class*="vertical"]','[class*="3x4"]','[class*="longPic"]'],
    sku:['#struct-sku .sku-image-container','.sku-image-container','.sell-component-sku-images','[class*="sku-image"]','[class*="skuImage"]'],
    detail:['#struct-descRepublicOfSell','[class*="desc-image"]','[class*="detail-image"]','[class*="description"]','[class*="descEditor"]','[class*="detailEditor"]'],
    // 透明素材图（导购素材 · 800x800）：老软件的选择器就是 #struct-whiteBgImage
    whiteBg:['#struct-whiteBgImage','[class*="whiteBgImage"]','[class*="whiteBg"]','[class*="transparentImage"]','[class*="guideImage"]']
  };
  var scopes=[];
  (groups[group]||[]).forEach(function(sel){scopes=scopes.concat(xxAll(sel).filter(vis));});
  // 3:4 / SKU 图也可能是 tab：先点同名 tab
  if(!scopes.length&&(group==='tall'||group==='sku')){
    var tabWord=group==='tall'?/^3\\s*[:：]\\s*4/:/^SKU\\s*图?$/i;
    var tabs=xxAll('div,span,button,a,li').filter(function(n){return vis(n)&&n.children.length<=1&&tabWord.test(txt(n));});
    if(tabs.length){try{tabs[0].click();}catch(e){}}
  }
  var hit=null,hitScopes=[];
  for(var i=0;i<scopes.length;i++){
    var sc=scopes[i];
    try{sc.scrollIntoView({block:'center'});}catch(e){}
    // 真实空图位是 .empty-container（老软件批量上传就点它）
    var empty=sc.querySelector('.empty-container');
    if(empty&&vis(empty)){hit=empty;hitScopes.push('empty');break;}
    var cands=Array.prototype.slice.call(sc.querySelectorAll('button,span,div,a,label,[class*="empty"],[class*="upload"],[class*="add"]'))
      .filter(function(n){return vis(n)&&n.children.length<=2;});
    var add=cands.find(function(n){var t=txt(n);return /上传|添加图片|点击上传|添加|\\+|替换|更换|重新上传/.test(t)&&t.length<=12;})
      ||cands.find(function(n){return /empty|add|upload/i.test(String(n.className||''));});
    if(add){hit=add;hitScopes.push(txt(sc).slice(0,20));break;}
    if(sc.querySelector('input[type=file]')){hitScopes.push('input-ready');break;}
  }
  if(!hit)return JSON.stringify({ok:false,scopes:scopes.length,samples:scopes.slice(0,3).map(function(s){return txt(s).slice(0,30);})});
  var box=hit.getBoundingClientRect();
  if(!dry){try{hit.click();}catch(e){}}
  return JSON.stringify({ok:true,text:txt(hit).slice(0,20),x:box.left+box.width/2,y:box.top+box.height/2,scopes:scopes.length});
})()`;
}

/**
 * 点开「上传图片」入口（很多类目的图片组件在点击后才把 <input type=file> 挂出来）。
 * 只点主图/图片相关按钮，不点视频与详情编辑器里的按钮，避免误触。
 */
function clickUploadTriggerScript() {
  return `(function(){
  var words=/^(?:上传图片|上传主图|本地上传|点击上传|上传)$/;
  var skip=/视频|详情|描述|资质|证书/;
  var nodes=Array.from(document.querySelectorAll('button,span,div,a,label')).filter(function(n){
    if(n.children.length>1)return false;
    var t=String(n.textContent||'').replace(/\\s+/g,'');
    if(!words.test(t))return false;
    if(skip.test(t))return false;
    var box=n.closest('[class*="video"],[class*="Video"],[class*="desc"],[class*="Desc"]');
    return !box;
  });
  var clicked=0;
  for(var i=0;i<nodes.length&&clicked<3;i++){
    try{nodes[i].click();clicked++;}catch(e){}
  }
  return JSON.stringify({clicked:clicked});
})()`;
}

/** 上传弹窗里的「确定 / 确认 / 保存」（图片组件选完文件通常要点一下才落库） */
function confirmUploadDialogScript() {
  return `(function(){
  var dialogs=Array.from(document.querySelectorAll('.next-dialog,[class*="dialog"],[class*="Dialog"],[class*="modal"]'))
    .filter(function(n){return n.offsetWidth||n.offsetHeight;});
  var clicked=0;
  for(var d=0;d<dialogs.length&&clicked<2;d++){
    var buttons=Array.from(dialogs[d].querySelectorAll('button')).filter(function(b){
      return /^(?:确定|确认|保存|完成|提交)$/.test(String(b.textContent||'').replace(/\\s+/g,''));
    });
    if(buttons.length){try{buttons[buttons.length-1].click();clicked++;}catch(e){}}
  }
  return JSON.stringify({clicked:clicked});
})()`;
}

/** 主图区域里已有几张图（上传后的回读数，用来判断到底有没有上去） */
/* ------------------------------------------------------------------ 驱动 */

/** 按组回读（Magix 组件值优先，DOM 兜底）。known=false 表示页面没有可回读的容器，不能据此判失败。 */
function buildReadImageGroupScript(group) {
  return `(function(){${NATIVE_SET}
  var group=${JSON.stringify(group)};
  var out={count:0,order:[],via:'',known:false};
  var st=null;
  try{st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();}catch(e){}
  var names={
    square:['mainPic','mainImages','itemImages','images'],
    tall:['threeToFourImages','tallPic','tallImages','longPic'],
    sku:['skuImages','skuPics','skuImage'],
    detail:['detailImages','descImages','description'],
    whiteBg:[]
  }[group]||[];
  // 透明素材图：页面图与提交值一起回读；替换旧图时数量可能仍是 1，必须比较 URL 是否变化。
  if(group==='whiteBg'){
    var wb=document.getElementById('struct-whiteBgImage')||document.querySelector('[class*="whiteBgImage"],[class*="transparentImage"]');
    var engineUrls=[];
    try{
      var stW=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
      var gi=stW&&stW.getComponentValue&&stW.getComponentValue('guideImageGroup');
      engineUrls=(gi&&Array.isArray(gi.whiteBgImage)?gi.whiteBgImage:[]).map(function(x){return String(x&&x.url||'');}).filter(function(u){return /^https?:/i.test(u);});
    }catch(e){}
    if(!wb&&!engineUrls.length)return JSON.stringify({count:0,order:[],domCount:0,engineCount:0,via:'dom:whiteBg',known:false,missing:true});
    var wimgs=wb?Array.prototype.slice.call(wb.querySelectorAll('img')).filter(function(im){
      return /^https?:/i.test(String(im.currentSrc||im.src||''))&&(im.offsetWidth||0)>=40;
    }):[];
    var domUrls=wimgs.map(function(im){return String(im.currentSrc||im.src||'');});
    out.order=(domUrls.length?domUrls:engineUrls).slice(0,5);
    out.count=out.order.length;
    out.domCount=domUrls.length;
    out.engineCount=engineUrls.length;
    out.via=domUrls.length?'dom:whiteBg':'magix:guideImageGroup';
    out.known=true;
    out.empty=Boolean(wb&&wb.querySelector('.empty-container'));
    return JSON.stringify(out);
  }
  // 主图以 mainImagesGroup.images 为准（老软件就是这么回读的）：组件存在但为空也要报 0，
  // 否则会掉到下面的深扫兜底，把 3:4/详情 的数组当成主图，出现「回读一致但其实没传上」。
  if(group==='square'&&st){
    try{
      var mg=st.getComponentValue&&st.getComponentValue('mainImagesGroup');
      if(mg&&Array.isArray(mg.images)){
        out.count=mg.images.length;
        out.order=mg.images.map(function(x){return x&&(x.url||x.src)||'';}).filter(Boolean).slice(0,10);
        out.via='magix:mainImagesGroup';out.known=true;
      }
    }catch(e){}
  }
  // 主图只认 mainImagesGroup（提交值）：别的组件名/深扫都可能是 3:4、详情图的数组，
  // 会把「其实没传上」读成「回读一致」（2026-11-17 日志就是这么骗人的）。
  if(st&&group!=='square'){
    for(var ni=0;ni<names.length&&!out.known;ni++){
      try{
        var v=st.getComponentValue&&st.getComponentValue(names[ni]);
        var props=st.getComponentProps&&st.getComponentProps(names[ni]);
        // 组件存在但值是空数组：这是「图位在、还没图」，必须报 known=true / count=0。
        // 旧逻辑把这种情况当成「页面没有可回读的容器」，上传失败也会被当成「已送入」。
        var exists=Boolean(v!=null||props);
        if(!exists)continue;
        var list=Array.isArray(v)?v:((v&&(v.images||v.value))||[]);
        if(Array.isArray(list)){
          out.count=list.length;
          out.order=list.map(function(x){return x&&(x.src||x.url||x.path||x.picture_path)||'';}).filter(Boolean).slice(0,10);
          out.via='magix:'+names[ni];out.known=true;
          out.empty=list.length===0;
          if(list.length)break;
        }
      }catch(e){}
    }
  }
  if(!out.known&&group!=='square'){
    var selectors={
      square:'[class*="mainPic"],[class*="main-pic"],[class*="imageItem"],[class*="ImgItem"],[class*="upload-list"],[class*="main-image"],[class*="mainImage"]',
      tall:'[class*="tallPic"],[class*="tall-pic"],[class*="vertical"],[class*="3x4"],[class*="longPic"]',
      sku:'.sku-image-container,.sell-component-sku-images,[class*="sku-image"],[class*="skuImage"]',
      detail:'[class*="desc-image"],[class*="detail-image"],[class*="detailImages"],[class*="descImages"]'
    };
    var scopes=xxAll(selectors[group]||selectors.square);
    for(var i=0;i<scopes.length;i++){
      var imgs=scopes[i].querySelectorAll('img');
      if(imgs.length>out.count){out.count=imgs.length;out.via='dom';out.known=true;}
    }
  }
  return JSON.stringify(out);
})()`;
}

/**
 * 透明素材图可信回读：不只看「有图」，还要确认页面图和提交值同源、实际加载为 800×800、
 * 不是空图位，也没有过期/冻结提示。当前版本之前只数图片数量，旧冻结素材会被误判成新上传。
 */
function buildVerifyGuideImageScript() {
  return `(async function(){
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function txt(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,' ').trim();}
  function load(url){
    return new Promise(function(resolve){
      if(!url||!/^https?:/i.test(url))return resolve(null);
      var im=new Image();
      var done=false;
      function finish(value){if(done)return;done=true;resolve(value);}
      im.onload=function(){finish({url:url,w:Number(im.naturalWidth||0),h:Number(im.naturalHeight||0)});};
      im.onerror=function(){finish(null);};
      im.src=url;
      setTimeout(function(){finish(null);},8000);
    });
  }
  // 页面/引擎里常是 _220x220 缩略图地址；图位校验看实际像素，必须还原到原图再加载。
  function original(url){
    var clean=String(url||'').split('?')[0].replace(/_\\.webp$/i,'');
    return clean.replace(/_\\d+x\\d+(?:q\\d+)?(?:\\.(?:jpe?g|png|webp))?$/i,'');
  }
  var deadline=Date.now()+12000,last=null;
  while(Date.now()<deadline){
    var root=document.getElementById('struct-whiteBgImage')||document.querySelector('[class*="whiteBgImage"],[class*="transparentImage"]');
    var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
    var gi=st&&st.getComponentValue&&st.getComponentValue('guideImageGroup')||{};
    var engineRows=(Array.isArray(gi.whiteBgImage)?gi.whiteBgImage:[]).filter(function(x){return /^https?:/i.test(String(x&&x.url||''));});
    var imgs=root?Array.prototype.slice.call(root.querySelectorAll('img')).filter(function(im){
      return vis(im)&&/^https?:/i.test(String(im.currentSrc||im.src||''));
    }):[];
    var domUrls=imgs.map(function(im){return String(im.currentSrc||im.src||'');}).filter(Boolean);
    var engineUrls=engineRows.map(function(x){return String(x.url||'');}).filter(Boolean);
    var rawUrls=Array.from(new Set(domUrls.concat(engineUrls))).slice(0,3);
    var urls=Array.from(new Set(rawUrls.concat(rawUrls.map(original)))).slice(0,6);
    var rootText=root?txt(root):'';
    var frozen=/冻结|已冻结|被锁定|素材失效|不可用/i.test(rootText);
    var pageSizeError=/透明素材图[^。]{0,80}(?:图片像素必须|尺寸|800\\s*[*×x]\\s*800|请修改)/i.test(rootText);
    var loaded=[];
    for(var i=0;i<urls.length;i++){
      var row=await load(urls[i]);
      if(row)loaded.push(row);
    }
    var domKeys=domUrls.map(original);
    var engineKeys=engineUrls.map(original);
    var sameAsset=domKeys.some(function(u){return engineKeys.indexOf(u)>=0;});
    var current=loaded.find(function(x){return x.w===800&&x.h===800;})||loaded[0]||null;
    var exact=Boolean(current&&current.w===800&&current.h===800);
    var empty=Boolean(root&&root.querySelector('.empty-container'));
    last={root:Boolean(root),empty:empty,frozen:frozen,pageSizeError:pageSizeError,domUrls:domUrls.slice(0,3),engineUrls:engineUrls.slice(0,3),sameAsset:sameAsset,loaded:loaded,current:current,exact:exact};
    if(root&&!empty&&!frozen&&!pageSizeError&&sameAsset&&exact){
      return JSON.stringify(Object.assign(last,{ok:true,reason:'',pix:current.w+'x'+current.h,url:current.url,original:original(current.url)}));
    }
    if(root&&(frozen||pageSizeError)&&domUrls.length)break;
    await new Promise(function(r){setTimeout(r,350);});
  }
  last=last||{root:false,empty:false,frozen:false,pageSizeError:false,domUrls:[],engineUrls:[],sameAsset:false,loaded:[],current:null,exact:false};
  var reason=!last.root?'no-container'
    :(last.empty?'empty-slot'
      :(last.frozen?'frozen-source'
        :(last.pageSizeError?'platform-size-error'
          :(!last.sameAsset?'page-engine-mismatch'
            :(!last.exact?'not-800x800':'unknown')))));
  return JSON.stringify(Object.assign(last,{ok:false,reason:reason}));
})()`;
}

/** 把页面里刚回填的透明素材 URL 同步回 guideImageGroup，避免页面显示新图、提交值仍是旧图。 */
function buildSyncGuideImageFromDomScript() {
  return `(async function(){
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function original(url){
    var clean=String(url||'').split('?')[0].replace(/_\\.webp$/i,'');
    return clean.replace(/_\\d+x\\d+(?:q\\d+)?(?:\\.(?:jpe?g|png|webp))?$/i,'');
  }
  function load(url){
    return new Promise(function(resolve){
      var im=new Image(),done=false;
      function finish(v){if(done)return;done=true;resolve(v);}
      im.onload=function(){finish({url:url,w:Number(im.naturalWidth||0),h:Number(im.naturalHeight||0)});};
      im.onerror=function(){finish(null);};
      im.src=url;setTimeout(function(){finish(null);},8000);
    });
  }
  var root=null,im=null;
  for(var wait=0;wait<24&&!im;wait++){
    root=document.getElementById('struct-whiteBgImage')||document.querySelector('[class*="whiteBgImage"],[class*="transparentImage"]');
    im=root&&Array.prototype.slice.call(root.querySelectorAll('img')).filter(function(x){
      return vis(x)&&/^https?:/i.test(String(x.currentSrc||x.src||''));
    })[0];
    if(!im)await sleep(350);
  }
  if(!im)return JSON.stringify({ok:false,reason:'no-dom-image'});
  var raw=String(im.currentSrc||im.src||'');
  var cands=[original(raw),raw].filter(function(u,i,a){return /^https?:/i.test(u)&&a.indexOf(u)===i;});
  var picked=null,sizes=[];
  for(var i=0;i<cands.length;i++){
    var row=await load(cands[i]);
    sizes.push([cands[i].slice(-60),row?row.w+'x'+row.h:'fail']);
    if(row&&row.w===800&&row.h===800){picked=row;break;}
  }
  if(!picked)return JSON.stringify({ok:false,reason:'not-800x800',sizes:sizes,url:raw});
  var url=picked.url;
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  var eng=st.engine,guide=Object.assign({},st.getComponentValue('guideImageGroup')||{});
  guide.whiteBgImage=[{url:url,pix:'800x800',name:'uploaded-transparent.png',width:800,height:800}];
  try{
    var comp=eng.getComponent&&eng.getComponent('guideImageGroup');
    if(comp&&comp.setProps)comp.setProps(Object.assign({},st.getComponentProps('guideImageGroup')||{},{value:guide,message:[],itemMessage:[],outerMessage:[]}));
  }catch(e){}
  try{eng.updateModels({formValues:Object.assign({},eng.getModels().formValues||{},{guideImageGroup:guide})});}catch(e){}
  var read=st.getComponentValue('guideImageGroup')||{};
  var got=Array.isArray(read.whiteBgImage)&&read.whiteBgImage[0]&&String(read.whiteBgImage[0].url||'');
  return JSON.stringify({ok:original(got)===original(url),url:url,w:picked.w,h:picked.h,engineUrl:got,sizes:sizes});
})()`;
}

/**
 * 主图「DOM 有图、引擎没值」的桥接：发布页上传成功后，图片有时只落在 DOM，
 * mainImagesGroup.images 仍为空（老软件叫 Magix sticky）。提交读的是引擎值，
 * 不桥接就会出现「日志写上传成功、提交前自检 0 张」。
 * 只搬真实 https 地址，图标/删除按钮那种小图排除。
 */
function buildSyncMainImagesScript() {
  return `(function(){${NATIVE_SET}
  var out={ok:false,reason:'',engineBefore:0,dom:0,engineAfter:0,urls:[]};
  function urlsOf(list){return (list||[]).map(function(x){return String((x&&(x.url||x.src))||'');}).filter(function(u){return /^https?:/i.test(u);});}
  var st=null;
  try{st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();}catch(e){}
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  var eng=st.engine;
  var before=urlsOf((st.getComponentValue('mainImagesGroup')||{}).images);
  out.engineBefore=before.length;out.engineAfter=before.length;out.urls=before;
  var box=document.getElementById('struct-mainImagesGroup');
  if(!box)return JSON.stringify(Object.assign(out,{reason:'no-main-container'}));
  var dom=[];
  if(box){
    Array.prototype.slice.call(box.querySelectorAll('img')).forEach(function(im){
      var u=String(im.currentSrc||im.src||'');
      if(!/^https?:/i.test(u))return;
      var w=Number(im.naturalWidth||im.width||0),h=Number(im.naturalHeight||im.height||0);
      if(w&&h&&w<60&&h<60)return;
      if(/icon|close|delete|del-|arrow|logo/i.test(String(im.className||'')))return;
      if(dom.indexOf(u)<0)dom.push(u);
    });
    // 有些皮肤把已传的图放在 background-image 上，没有 img 标签
    Array.prototype.slice.call(box.querySelectorAll('[style*="background"]')).forEach(function(el){
      var m=/url\\(["']?(https?:[^)"']+)/i.exec(String(el.getAttribute('style')||''));
      if(m&&m[1]&&dom.indexOf(m[1])<0)dom.push(m[1]);
    });
  }
  out.dom=dom.length;
  if(before.length>0&&before.length>=Math.min(dom.length||1,before.length)){out.ok=true;return JSON.stringify(out);}
  if(!dom.length){out.reason='dom-empty';return JSON.stringify(out);}
  var imgs=dom.slice(0,5).map(function(u){return {url:u,src:u};});
  try{
    var comp=eng.getComponent&&eng.getComponent('mainImagesGroup');
    if(comp&&comp.setProps)comp.setProps(Object.assign({},(st.getComponentProps('mainImagesGroup')||{}),{value:{images:imgs},message:[]}));
  }catch(e){}
  try{
    var fv=Object.assign({},eng.getModels().formValues||{});
    fv.mainImagesGroup={images:imgs};
    eng.updateModels({formValues:fv});
  }catch(e){}
  var after=urlsOf((st.getComponentValue('mainImagesGroup')||{}).images);
  out.engineAfter=after.length;out.urls=after;out.ok=after.length>0;
  if(!out.ok)out.reason='engine-reject';
  return JSON.stringify(out);
})()`;
}

/**
 * 素材中心卡片给的是缩略图地址，例如 `a.jpg_220x220.jpg` 或 `a.png_220x220q90.jpg_.webp`。
 * 直接绑定它，透明素材位就会因实际不是 800×800 而拒收。优先还原原图，保留缩略图作为加载失败时的退路。
 */
function materialUrlCandidates(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return [];
  const clean = raw.split('?')[0];
  const withoutWebp = clean.replace(/_\.webp$/i, '');
  const original = withoutWebp.replace(/_\d+x\d+(?:q\d+)?(?:\.(?:jpe?g|png|webp))?$/i, '');
  return [...new Set([original, withoutWebp, clean, raw].filter(u => /^https?:\/\//i.test(u)))];
}

function normalizeMaterialUrl(value) {
  return materialUrlCandidates(value)[0] || '';
}

/** 透明素材图兜底：绑定原图并核验真实尺寸；候选里仍保留缩略图，但不会拿非 800×800 的图凑成功。 */
function buildWriteGuideImageScript(urls) {
  const list = (Array.isArray(urls) ? urls : [urls])
    .flatMap(materialUrlCandidates)
    .filter(Boolean);
  return `(async function(){
  var cands=${JSON.stringify(list)};
  if(!cands.length)return JSON.stringify({ok:false,reason:'bad-url'});
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  var eng=st.engine;
  var comp=eng.getComponent&&eng.getComponent('guideImageGroup');
  if(!comp||!comp.setProps)return JSON.stringify({ok:false,reason:'no-component'});
  function load(u){return new Promise(function(res){var im=new Image();im.onload=function(){res({w:im.naturalWidth,h:im.naturalHeight});};im.onerror=function(){res(null);};im.src=u;setTimeout(function(){res(null);},12000);});}
  var pick=null,sizes=[];
  for(var i=0;i<cands.length;i++){
    var s=await load(cands[i]);
    sizes.push([cands[i].slice(-60),s?s.w+'x'+s.h:'fail']);
    if(s&&s.w===800&&s.h===800){pick={url:cands[i],w:s.w,h:s.h};break;}
    if(s&&!pick)pick={url:cands[i],w:s.w,h:s.h};
  }
  if(!pick)return JSON.stringify({ok:false,reason:'no-loadable',sizes:sizes});
  if(!(pick.w===800&&pick.h===800))return JSON.stringify({ok:false,reason:'size-not-800',sizes:sizes,w:pick.w,h:pick.h});
  var img={url:pick.url,pix:'800x800',name:'guide-800x800.png',width:800,height:800};
  var value=Object.assign({},st.getComponentValue('guideImageGroup')||{},{whiteBgImage:[img]});
  try{comp.setProps(Object.assign({},st.getComponentProps('guideImageGroup')||{},{value:value,message:[],itemMessage:[],outerMessage:[]}));}
  catch(e){return JSON.stringify({ok:false,reason:'setprops-fail'});}
  try{
    var fv=Object.assign({},eng.getModels().formValues||{});
    fv.guideImageGroup=value;
    eng.updateModels({formValues:fv});
  }catch(e){}
  var engineList=(st.getComponentValue('guideImageGroup')||{}).whiteBgImage||[];
  var root=document.getElementById('struct-whiteBgImage');
  var domImgs=root?Array.prototype.slice.call(root.querySelectorAll('img')).filter(function(im){return /^https?:/i.test(String(im.src||''))&&(im.offsetWidth||0)>=40;}).length:0;
  return JSON.stringify({ok:(engineList.length>0||domImgs>0)&&pick.w===800&&pick.h===800,engine:engineList.length,dom:domImgs,
    url:pick.url,pix:pick.w+'x'+pick.h,exact:pick.w===800&&pick.h===800,sizes:sizes});
})()`;
}

/** 透明素材图上传失败时的现场取证：图位在不在、空图位有没有、页面上到底有几个上传框/iframe/弹层。 */
function buildWhiteBgDiagScript() {
  return `(function(){
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\s+/g,' ').trim();}
  var root=document.getElementById('struct-whiteBgImage');
  var r=root?root.getBoundingClientRect():null;
  return JSON.stringify({
    root:!!root,
    rect:r?[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]:null,
    empty:!!(root&&root.querySelector('.empty-container')),
    rootText:root?text(root).slice(0,80):'',
    fileInputs:document.querySelectorAll('input[type=file]').length,
    iframes:Array.prototype.slice.call(document.querySelectorAll('iframe')).filter(vis).map(function(f){return [String(f.src||'').slice(0,60),f.offsetWidth,f.offsetHeight];}).slice(0,4),
    dialogs:Array.prototype.slice.call(document.querySelectorAll('.next-dialog,.next-drawer,.next-overlay-wrapper')).filter(vis).map(function(d){return text(d).slice(0,40);}).slice(0,4)
  });
})()`;
}

/** 按组 + 位序找上传框。 */
function buildFindUploadInputScript(group, slotIndex) {
  return `(function(){${NATIVE_SET}
  var group=${JSON.stringify(group)},slotIndex=${JSON.stringify(slotIndex)};
  var inputs=xxAll('input[type=file]');
  // 透明素材图：优先用 #struct-whiteBgImage 里面的框；页面上只有一个 file 框时也认它
  // （这个图位不弹素材中心，点完空图位就挂一个本地上传框，2026-11-17 现场）
  if(group==='whiteBg'){
    var wbRoot=document.getElementById('struct-whiteBgImage');
    var own=wbRoot?inputs.filter(function(i){return wbRoot.contains(i);}):[];
    var pick=own[0]||(inputs.length===1?inputs[0]:null);
    try{
      for(var q=0;q<inputs.length;q++)inputs[q].removeAttribute('data-xx-upload');
      if(pick)pick.setAttribute('data-xx-upload','1');
    }catch(e){}
    return JSON.stringify({index:pick?inputs.indexOf(pick):-1,ctx:pick?'whiteBg':'',marked:Boolean(pick)});
  }
  var candidates=[];
  for(var i=0;i<inputs.length;i++){
    var box=inputs[i].closest('[class*="upload"],[class*="image"],[class*="pic"],[class*="main"],[class*="tall"],[class*="sku"],[class*="detail"]')||inputs[i].parentElement;
    var text=box?(box.textContent||'').replace(/\\s+/g,' ').slice(0,80):'';
    candidates.push({index:i,ctx:text,accept:String(inputs[i].getAttribute('accept')||'')});
  }
  var filtered=candidates.filter(function(c){
    if(group==='whiteBg')return /透明|素材|whiteBg|guide/i.test(c.ctx);
    if(group==='square'||group==='tall')return /主图|图片|image/i.test(c.ctx)&&!/详情|SKU|sku|视频|video/i.test(c.ctx);
    if(group==='sku')return /SKU|sku|规格/i.test(c.ctx);
    if(group==='detail')return /详情|描述|detail|desc/i.test(c.ctx);
    return true;
  });
  // 主图：优先带「主图」字样、accept 是图片的框（别把主图视频的框当主图）
  if(group==='square'){
    filtered.sort(function(a,b){
      var sa=(/主图/.test(a.ctx)?2:0)+(/image/i.test(a.accept)?1:0);
      var sb=(/主图/.test(b.ctx)?2:0)+(/image/i.test(b.accept)?1:0);
      return sb-sa;
    });
  }
  var target=filtered[slotIndex]||filtered[0]||null;
  // 主图找不到自己的输入框时宁可明确失败，也不能退到“第 N 个框”把图塞进 3:4 / SKU / 详情。
  if(!target&&(group==='square'||group==='tall')&&candidates.length===1)target=candidates[0];
  if(!target&&group!=='square'&&group!=='tall')target=candidates[slotIndex]||candidates[0]||null;
  // 给选中的上传框打标记：CDP 侧的 input 序号会把 iframe 里的框也算进来，靠序号可能塞到别的框（主图传了但页面没有）。
  try{
    for(var k=0;k<inputs.length;k++)inputs[k].removeAttribute('data-xx-upload');
    if(target)inputs[target.index].setAttribute('data-xx-upload','1');
  }catch(e){}
  return JSON.stringify({index:target?target.index:-1,ctx:target?target.ctx:'',marked:Boolean(target)});
})()`;
}

/**
 * 3:4 主图必须是真正的 JPEG，而且必须正好是 3:4。
 * 2026-11-19 现场：① 采集 CDN 的 URL 写着 `.jpg`，实际返回的是 WebP（文件头 RIFF/WEBP），
 * 上传后平台报「3:4主图仅支持 jpg/jpeg，请修改第 1 张图片」；
 * ② 比例差一点的图交给平台，会被平台自己裁成 3:4（用户看到的「偶尔被裁」）。
 * 这里用发布页的 Chromium 解码（WebP/PNG 都支持），白底铺底，统一输出严格 1440×1920。
 */
/**
 * 图片文件头读真实像素与格式（扩展名和 CDN 内容协商都不可信：.jpg 里常是 WebP）。
 * 返回 { fmt, w, h }；解析不出来时 w/h 为 0。
 */
function imageHeaderSize(buf) {
  if (!buf || buf.length < 24) return null;
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      return { fmt: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { fmt: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8L') {
        const bits = buf.readUInt32LE(21);
        return { fmt: 'webp', w: 1 + (bits & 0x3FFF), h: 1 + ((bits >>> 14) & 0x3FFF) };
      }
      if (chunk === 'VP8 ') return { fmt: 'webp', w: buf.readUInt16LE(26) & 0x3FFF, h: buf.readUInt16LE(28) & 0x3FFF };
      return { fmt: 'webp', w: 0, h: 0 };
    }
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i += 1; continue; }
        let marker = buf[i + 1];
        while (marker === 0xFF) { i += 1; marker = buf[i + 1]; }
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { fmt: 'jpg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return { fmt: 'jpg', w: 0, h: 0 };
    }
  } catch { /* 损坏文件按「解析不出来」处理 */ }
  return null;
}

/**
 * 页面 canvas 转 JPEG。
 * fit='3x4' 时输出严格的 1440×1920：整张图等比缩进白底画布（contain），
 * **绝不裁边** —— 平台对不是正好 3:4 的图会自己裁，用户看到的就是「3:4 主图被裁了」。
 */
function buildConvertToJpegScript(b64, mime, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const opt = { fit: '', w: 1440, h: 1920, quality: 0.92, pad: '#ffffff', ...o };
  return `(async function(){
  var raw=${JSON.stringify(String(b64 || ''))};
  var mime=${JSON.stringify(String(mime || 'image/webp'))};
  var opt=${JSON.stringify(opt)};
  function done(v){return JSON.stringify(v);}
  function load(src){return new Promise(function(res,rej){var im=new Image();im.onload=function(){res(im);};im.onerror=function(){rej(new Error('decode-failed'));};im.src=src;});}
  try{
    var im=await load('data:'+mime+';base64,'+raw);
    var nw=Number(im.naturalWidth||0),nh=Number(im.naturalHeight||0);
    if(!nw||!nh)return done({ok:false,reason:'no-size'});
    var maxW=Number(opt.w)||1440,maxH=Number(opt.h)||1920;
    var cw,ch;
    if(opt.fit==='3x4'){cw=maxW;ch=maxH;}
    else{
      var scale=Math.min(maxW/nw,maxH/nh,1);
      cw=Math.max(1,Math.round(nw*scale));ch=Math.max(1,Math.round(nh*scale));
    }
    var c=document.createElement('canvas');c.width=cw;c.height=ch;
    var ctx=c.getContext('2d');
    ctx.fillStyle=opt.pad||'#ffffff';ctx.fillRect(0,0,cw,ch);
    if(opt.fit==='3x4'){
      var s=Math.min(cw/nw,ch/nh);
      var dw=Math.max(1,Math.round(nw*s)),dh=Math.max(1,Math.round(nh*s));
      ctx.drawImage(im,Math.round((cw-dw)/2),Math.round((ch-dh)/2),dw,dh);
    }else{
      ctx.drawImage(im,0,0,cw,ch);
    }
    var data=c.toDataURL('image/jpeg',Number(opt.quality)||0.92);
    if(!/^data:image\\/jpeg/i.test(data))return done({ok:false,reason:'encode-failed'});
    return done({ok:true,b64:data.split(',')[1],w:cw,h:ch,srcW:nw,srcH:nh});
  }catch(e){return done({ok:false,reason:String(e&&e.message||e).slice(0,80)});}
})()`;
}

/**
 * 3:4 主图：老软件实证（drawing-native-submit.js:119）写组件 threeToFourImages 即可，
 * 值形如 {url,width,height,pix,name}，不需要走上传框。顺序 = 数组顺序。
 */
function buildFillTallImagesScript(urls) {
  return `(async function(){
  var urls=${JSON.stringify(urls)};
  function load(u){return new Promise(function(res){var img=new Image();img.onload=function(){res({width:img.naturalWidth,height:img.naturalHeight});};img.onerror=function(){res(null);};img.src=u;setTimeout(function(){res(null);},15000);});}
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  var eng=st.engine;
  var comp=eng.getComponent&&eng.getComponent('threeToFourImages');
  if(!comp||!comp.setProps)return JSON.stringify({ok:false,reason:'no-component'});
  var list=[];
  for(var i=0;i<urls.length;i++){
    var r=await load(urls[i]);
    var w=r&&r.width?r.width:1440,h=r&&r.height?r.height:1920;
    list.push({url:urls[i],width:w,height:h,pix:w+'x'+h,name:'main-'+(i+1)});
  }
  comp.setProps(Object.assign({},st.getComponentProps('threeToFourImages')||{},{value:list,message:[]}));
  eng.updateModels({formValues:Object.assign({},eng.getModels().formValues||{},{threeToFourImages:list})});
  var actual=st.getComponentValue('threeToFourImages')||[];
  return JSON.stringify({ok:actual.length===list.length,count:actual.length,total:list.length,
    order:actual.map(function(x){return x&&x.url||'';})});
})()`;
}

/**
 * 透明素材图：真抠图 + 压到平台限制内（2026-11-18 现场定案）。
 *
 * 上一版只做「等比缩放放进 800×800 画布」，产出的 PNG 实测 alpha 全 255（完全不透明）、
 * 体积 1,281,557 字节。而天猫透明素材图的硬要求是「透明背景 + 不大于 500K」，
 * 所以素材中心能传上去，图位却一直拒收（日志「勾选=1 但回读 0 张」就是这个）。
 *
 * 现在：从画布四边往里漫水，把与边框背景色接近且连通的像素判成背景 → alpha=0，
 * 边缘一像素做半透明羽化；再按 4bit（不够就 3bit）降色深把 PNG 压到 500K 以内。
 * 背景复杂、主体贴边或四角不透明时，退回老软件同款做法：第一张主图等比缩进透明画布，
 * 保留透明边并输出 800×800 RGBA PNG，不再因为抠图判定失败而跳过必填的透明素材图。
 */
function buildMakeSquarePngScript(dataUrl, size) {
  return `(async function(){
  var src=${JSON.stringify(String(dataUrl || ''))};
  var size=${Number(size) > 0 ? Number(size) : 800};
  var MAX=${500 * 1024};
  function load(u){return new Promise(function(res,rej){var im=new Image();im.onload=function(){res(im);};im.onerror=function(){rej(new Error('img-load-failed'));};im.src=u;});}
  try{
    var im=await load(src);
    var w=Number(im.naturalWidth||im.width||0),h=Number(im.naturalHeight||im.height||0);
    if(!w||!h)return JSON.stringify({ok:false,reason:'bad-size'});
    var c=document.createElement('canvas');c.width=size;c.height=size;
    var ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.clearRect(0,0,size,size);
    var s=Math.min(size/w,size/h);
    var dw=Math.max(1,Math.round(w*s)),dh=Math.max(1,Math.round(h*s));
    ctx.imageSmoothingEnabled=true;
    try{ctx.imageSmoothingQuality='high';}catch(e){}
    ctx.drawImage(im,Math.round((size-dw)/2),Math.round((size-dh)/2),dw,dh);
    var img=ctx.getImageData(0,0,size,size),data=img.data,N=size*size;
    // 背景参考色：四边一圈像素的中位数（平均数会被主体像素带偏）
    var rs=[],gs=[],bs=[];
    function push(i){rs.push(data[i*4]);gs.push(data[i*4+1]);bs.push(data[i*4+2]);}
    for(var x=0;x<size;x++){push(x);push((size-1)*size+x);}
    for(var y=0;y<size;y++){push(y*size);push(y*size+size-1);}
    function med(a){a.sort(function(p,q){return p-q;});return a[a.length>>1];}
    var br=med(rs),bg=med(gs),bb=med(bs);
    var dev=0;
    for(var q=0;q<rs.length;q++)dev+=Math.abs(rs[q]-br)+Math.abs(gs[q]-bg)+Math.abs(bs[q]-bb);
    dev=dev/(rs.length*3);
    var tol=Math.max(26,Math.min(60,Math.round(20+dev*3)));
    var mask=new Uint8Array(N),stack=new Int32Array(N),sp=0;
    function near(i){return (Math.abs(data[i*4]-br)+Math.abs(data[i*4+1]-bg)+Math.abs(data[i*4+2]-bb))<=tol*3;}
    for(var x2=0;x2<size;x2++){
      var a1=x2,a2=(size-1)*size+x2;
      if(!mask[a1]&&near(a1)){mask[a1]=1;stack[sp++]=a1;}
      if(!mask[a2]&&near(a2)){mask[a2]=1;stack[sp++]=a2;}
    }
    for(var y2=0;y2<size;y2++){
      var b1=y2*size,b2=y2*size+size-1;
      if(!mask[b1]&&near(b1)){mask[b1]=1;stack[sp++]=b1;}
      if(!mask[b2]&&near(b2)){mask[b2]=1;stack[sp++]=b2;}
    }
    while(sp>0){
      var cur=stack[--sp],cx=cur%size;
      if(cx>0){var l=cur-1;if(!mask[l]&&near(l)){mask[l]=1;stack[sp++]=l;}}
      if(cx<size-1){var r=cur+1;if(!mask[r]&&near(r)){mask[r]=1;stack[sp++]=r;}}
      if(cur>=size){var t=cur-size;if(!mask[t]&&near(t)){mask[t]=1;stack[sp++]=t;}}
      if(cur<N-size){var d=cur+size;if(!mask[d]&&near(d)){mask[d]=1;stack[sp++]=d;}}
    }
    var clear=0;
    for(var k=0;k<N;k++){
      if(!mask[k])continue;
      data[k*4]=0;data[k*4+1]=0;data[k*4+2]=0;data[k*4+3]=0;clear++;
    }
    // 羽化：紧贴背景的一圈给半透明，避免硬锯齿
    for(var k2=0;k2<N;k2++){
      if(mask[k2])continue;
      var x3=k2%size,edge=false;
      if(x3>0&&mask[k2-1])edge=true;
      if(!edge&&x3<size-1&&mask[k2+1])edge=true;
      if(!edge&&k2>=size&&mask[k2-size])edge=true;
      if(!edge&&k2<N-size&&mask[k2+size])edge=true;
      if(edge)data[k2*4+3]=160;
    }
    var ratio=clear/N,cornerOk=true;
    [[2,2],[size-3,2],[2,size-3],[size-3,size-3]].forEach(function(p){
      for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){
        var ix=p[0]+dx,iy=p[1]+dy;
        if(ix>=0&&iy>=0&&ix<size&&iy<size&&!mask[iy*size+ix])cornerOk=false;
      }
    });
    // 老软件的退路：背景复杂、主体贴边时不做危险抠图，把第一张 1:1 主图等比缩进
    // 800×800 透明画布并留出透明边。仍是真实 RGBA PNG，不会因为“抠不干净”直接放弃必填图。
    function finishTransparentPadded(){
      var fb=document.createElement('canvas');fb.width=size;fb.height=size;
      var fx=fb.getContext('2d',{willReadFrequently:true});
      fx.clearRect(0,0,size,size);
      var inset=Math.max(16,Math.round(size*0.025));
      var fs=Math.min((size-inset*2)/w,(size-inset*2)/h);
      var fw=Math.max(1,Math.round(w*fs)),fh=Math.max(1,Math.round(h*fs));
      fx.imageSmoothingEnabled=true;
      try{fx.imageSmoothingQuality='high';}catch(e){}
      fx.drawImage(im,Math.round((size-fw)/2),Math.round((size-fh)/2),fw,fh);
      function encodeFb(){var u=fb.toDataURL('image/png');return {u:u,bytes:Math.round((u.length-u.indexOf(',')-1)*3/4)};}
      var fbOut=encodeFb();
      if(fbOut.bytes>MAX){
        var fbData=fx.getImageData(0,0,size,size),fd=fbData.data;
        for(var bits=4;bits>=3&&fbOut.bytes>MAX;bits--){
          var maskBits=(0xFF<<(8-bits))&0xFF;
          for(var fi=0;fi<N;fi++){if(fd[fi*4+3]===0)continue;fd[fi*4]&=maskBits;fd[fi*4+1]&=maskBits;fd[fi*4+2]&=maskBits;}
          fx.putImageData(fbData,0,0);
          fbOut=encodeFb();
        }
      }
      var alphaPixels=0;
      try{
        var countData=fx.getImageData(0,0,size,size).data;
        for(var ai=3;ai<countData.length;ai+=4)if(countData[ai]<255)alphaPixels++;
      }catch(e){}
      return JSON.stringify({ok:true,data:fbOut.u,w:size,h:size,srcW:w,srcH:h,
        transparent:Number((alphaPixels/N).toFixed(3)),bytes:fbOut.bytes,tol:tol,bg:[br,bg,bb],
        fallback:'transparent-padded',cutout:{ratio:Number(ratio.toFixed(3)),corner:cornerOk,reason:'cutout-failed'},
        overLimit:fbOut.bytes>MAX});
    }
    if(ratio<0.02||ratio>0.88||!cornerOk)return finishTransparentPadded();
    ctx.putImageData(img,0,0);
    function encode(){
      var u=c.toDataURL('image/png');
      var bytes=Math.round((u.length-u.indexOf(',')-1)*3/4);
      return {u:u,bytes:bytes};
    }
    function posterize(bits){
      var m=(0xFF<<(8-bits))&0xFF;
      for(var i=0;i<N;i++){if(mask[i])continue;data[i*4]&=m;data[i*4+1]&=m;data[i*4+2]&=m;}
      ctx.putImageData(img,0,0);
    }
    posterize(4);
    var out=encode();
    if(out.bytes>MAX){posterize(3);out=encode();}
    if(!/^data:image\\/png;base64,/i.test(out.u))return JSON.stringify({ok:false,reason:'encode-failed'});
    return JSON.stringify({ok:true,data:out.u,w:size,h:size,srcW:w,srcH:h,
      transparent:Number(ratio.toFixed(3)),bytes:out.bytes,tol:tol,bg:[br,bg,bb],overLimit:out.bytes>MAX});
  }catch(e){return JSON.stringify({ok:false,reason:String(e&&e.message||e).slice(0,60)});}
})()`;
}

/**
 * 1:1 主图只写本次明确选中的那一组。每个输入位置必须得到一张图，失败就停止，
 * 不能跳过失败项后让后面的图向前挤，也不能保留页面里原有的其他图片。
 */
function buildWriteMainImagesScript(urls) {
  const groups = (Array.isArray(urls) ? urls : []).slice(0, 5).map(materialUrlCandidates);
  return `(async function(){
  var groups=${JSON.stringify(groups)};
  function load(u){return new Promise(function(res){var img=new Image();img.onload=function(){res({width:img.naturalWidth,height:img.naturalHeight});};img.onerror=function(){res(null);};img.src=u;setTimeout(function(){res(null);},15000);});}
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  var eng=st.engine;
  var comp=eng.getComponent&&eng.getComponent('mainImagesGroup');
  if(!comp||!comp.setProps)return JSON.stringify({ok:false,reason:'no-component'});
  var list=[];
  for(var i=0;i<groups.length;i++){
    var found=null;
    for(var j=0;j<groups[i].length;j++){
      var r=await load(groups[i][j]);
      if(r){found={url:groups[i][j],width:r.width,height:r.height,pix:r.width+'x'+r.height,name:'main-'+(i+1)};break;}
    }
    if(!found)return JSON.stringify({ok:false,reason:'no-loadable-url',index:i+1});
    list.push(found);
  }
  if(!list.length)return JSON.stringify({ok:false,reason:'no-loadable-url'});
  comp.setProps(Object.assign({},st.getComponentProps('mainImagesGroup')||{},{value:{images:list},message:[]}));
  eng.updateModels({formValues:Object.assign({},eng.getModels().formValues||{},{mainImagesGroup:{images:list}})});
  var actual=(st.getComponentValue('mainImagesGroup')||{}).images||[];
  var same=actual.length===list.length&&actual.every(function(x,i){return String(x&&x.url||'').split('?')[0]===String(list[i].url||'').split('?')[0];});
  return JSON.stringify({ok:same,count:actual.length,total:list.length,order:actual.map(function(x){return x&&x.url||'';}),expected:list.map(function(x){return x.url;})});
})()`;
}

/**
 * SKU 图：老软件实测「skuMaterialImage 平台保存时不保留」，真正的规格图是
 * customSaleProp / saleProp 每个规格值上的 img（行 props[0].img 同步），SKU 搜索主图是 skuPicture。
 * 直接写图片地址，不上传；顺序 = 规格顺序。
 */
function buildFillSkuImageUrlsScript(items) {
  return `(function(){
  var items=${JSON.stringify(items)};
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  var eng=st.engine;
  function byName(n){return items.find(function(it){return String(it.name||'').trim()===String(n||'').trim();})||null;}
  function image(url){return {url:url,width:800,height:800,pix:'800x800',name:'sku.jpg'};}
  var values={};
  var custom=st.getComponentValue('customSaleProp');
  if(Array.isArray(custom)&&custom.length){
    values.customSaleProp=custom.map(function(g){
      return Object.assign({},g,{items:(g.items||[]).map(function(it,i){var s=byName(it&&it.text)||items[i]||null;return s?Object.assign({},it,{img:s.url}):it;})});
    });
  }
  var sale=st.getComponentValue('saleProp');
  if(sale&&typeof sale==='object'&&!Array.isArray(sale)&&Object.values(sale).some(function(v){return Array.isArray(v)&&v.length;})){
    var nextSale={};
    Object.keys(sale).forEach(function(k){
      var list=sale[k];
      nextSale[k]=Array.isArray(list)?list.map(function(it,i){var s=byName(it&&it.text)||items[i]||null;return s?Object.assign({},it,{img:s.url}):it;}):list;
    });
    values.saleProp=nextSale;
  }
  if(!values.customSaleProp&&!values.saleProp)return JSON.stringify({ok:false,reason:'no-spec-component'});
  var rows=st.getComponentValue('sku')||[];
  var applied=0;
  values.sku=rows.map(function(row,idx){
    var name=(row.props&&row.props[0]&&row.props[0].text)||'';
    // 先按规格名对上；名字被平台截断/改写时按行序兜底（发布页规格行就是按草稿顺序建的）
    var s=byName(name)||items[idx]||null;
    if(!s)return row;
    applied++;
    var next=Object.assign({},row,{props:(row.props||[]).map(function(p,i){return i===0?Object.assign({},p,{img:s.url}):p;})});
    next.skuPicture=[image(s.url)];
    return next;
  });
  var keys=Object.keys(values);
  for(var i=0;i<keys.length;i++){
    var c=eng.getComponent&&eng.getComponent(keys[i]);
    if(!c||!c.setProps)return JSON.stringify({ok:false,reason:'no-component:'+keys[i]});
  }
  keys.forEach(function(key){
    eng.getComponent(key).setProps(Object.assign({},st.getComponentProps(key)||{},{value:values[key],message:[]}));
  });
  eng.updateModels({formValues:Object.assign({},eng.getModels().formValues||{},values)});
  var after=st.getComponentValue('sku')||[];
  var read=0;
  after.forEach(function(row,idx){var n=(row.props&&row.props[0]&&row.props[0].text)||'';var s=byName(n)||items[idx]||null;if(s&&row.props&&row.props[0]&&row.props[0].img===s.url)read++;});
  return JSON.stringify({ok:read>=Math.min(applied,1)&&read>=applied,applied:applied,read:read,total:rows.length});
})()`;
}

/* ---------------- 详情图：平台「源码导入」直接写图片地址（老软件 importDetailUrls 同款） ---------------- */

const DETAIL_PICS_JS = `function(){var v=window.__SELL_STATE__.getState().getComponentValue('descRepublicOfSell')||{};var p=v.descPageCommitParam||{},text=p.templateContent||'',pics=[];try{var doc=JSON.parse(text);(doc.groups||[]).forEach(function(g){(g.components||[]).forEach(function(c){if(c.componentType==='pic'&&c.boxStyle&&c.boxStyle['background-image'])pics.push(String(c.boxStyle['background-image']));});});}catch(e){var re=/<img[^>]+src="([^"]+)"/g,m;while((m=re.exec(text)))pics.push(m[1]);}return {pics:pics,height:p.detailHeight||0,text:text};}`;
const DETAIL_KEY_JS = `function(u){u=String(u||'');var m=u.match(/O1CN[0-9A-Za-z_-]+?(?=[_!.]|$)/);return m?m[0]:u.replace(/^https?:/,'').replace(/_\\d+x\\d+.*$/,'');}`;

/** 详情里现在有几张图 */
function buildDetailCountScript() {
  return `(function(){try{return (${DETAIL_PICS_JS})().pics.length;}catch(e){return -1;}})()`;
}

/** 点平台「清空」并确认（源码导入是追加的，不清空会和原有图混在一起） */
function buildClearDetailScript() {
  return `(async function(){
  var root=document.getElementById('struct-descRepublicOfSell');
  var btn=root&&Array.from(root.querySelectorAll('div,button,span,a')).find(function(e){return !e.children.length&&e.textContent.trim()==='清空';});
  if(!btn)return JSON.stringify({ok:false,reason:'no-clear'});
  btn.click();
  for(var i=0;i<20;i++){await new Promise(function(r){setTimeout(r,250);});var ok=Array.from(document.querySelectorAll('.next-dialog button,.next-overlay-wrapper button,[role=dialog] button')).find(function(b){return b.offsetHeight&&/^(确定|确认|清空)$/.test((b.innerText||'').trim());});if(ok){ok.click();break;}}
  for(var j=0;j<20;j++){await new Promise(function(r){setTimeout(r,250);});var n=(${DETAIL_PICS_JS})().pics.length;if(!n)return JSON.stringify({ok:true});}
  return JSON.stringify({ok:false,reason:'still-has-pics'});
})()`;
}

/** 打开「源码导入」并等 CKEDITOR 实例就绪 */
function buildOpenDetailSourceScript() {
  return `(async function(){
  var root=document.getElementById('struct-descRepublicOfSell');
  if(!root)return JSON.stringify({ok:false,reason:'no-detail-component'});
  var btn=Array.from(root.querySelectorAll('div,button,span,a')).find(function(e){return !e.children.length&&e.textContent.trim()==='源码导入';});
  if(!btn)return JSON.stringify({ok:false,reason:'no-source-import'});
  btn.click();
  for(var i=0;i<30;i++){
    var ed=window.CKEDITOR&&window.CKEDITOR.instances&&window.CKEDITOR.instances['source-import'];
    if(ed&&ed.status==='ready')return JSON.stringify({ok:true});
    await new Promise(function(r){setTimeout(r,300);});
  }
  return JSON.stringify({ok:false,reason:'editor-not-ready'});
})()`;
}

/** 把图片地址按顺序写成详情 HTML（每张一段） */
function buildFillDetailSourceScript(urls) {
  const html = urls.map(url => `<p><img src="${String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" /></p>`).join('\n');
  return `(async function(){
  var editor=window.CKEDITOR&&window.CKEDITOR.instances&&window.CKEDITOR.instances['source-import'];
  if(!editor||editor.status!=='ready')return JSON.stringify({ok:false,reason:'editor-not-ready'});
  await new Promise(function(resolve){editor.setData(${JSON.stringify(html)},{callback:resolve});});
  try{editor.fire('change');}catch(e){}
  return JSON.stringify({ok:true,count:${urls.length}});
})()`;
}

/** 点「导入」 */
function buildConfirmDetailImportScript() {
  return `(async function(){
  for(var i=0;i<16;i++){
    var d=Array.from(document.querySelectorAll('[role="dialog"]')).find(function(x){var h=x.querySelector('[role="heading"]');return h&&(h.innerText||'').trim()==='源码导入';});
    var b=d&&Array.from(d.querySelectorAll('button')).find(function(x){return (x.innerText||'').trim()==='导入'&&!x.disabled;});
    if(b){b.click();return JSON.stringify({ok:true});}
    await new Promise(function(r){setTimeout(r,300);});
  }
  return JSON.stringify({ok:false,reason:'no-import-button'});
})()`;
}

/** 回读详情：页面上的图必须正好是这次这些、顺序一致 */
function buildDetailReadbackScript(urls) {
  return `(function(){
  var read=(${DETAIL_PICS_JS})(),key=${DETAIL_KEY_JS},expected=${JSON.stringify(urls)}.map(key),got=read.pics.map(key);
  var hit=expected.filter(function(k){return got.indexOf(k)>=0;}).length;
  var exact=got.length===expected.length&&got.every(function(k,i){return k===expected[i];});
  return JSON.stringify({ok:exact,count:hit,total:expected.length,pics:got.length,extra:got.filter(function(k){return expected.indexOf(k)<0;}).length,height:read.height});
})()`;
}

/**
 * SKU 表「总净含量」列：键名按类目变（老软件实证 p-147956252 / p-33993，还有 skuParam_p-XXXX），
 * 从 sku 组件 attributes 里按 label 找，单位是 measurement 时要写 {value,text,structItems}。
 * 用户 2026-11-17：所有规格的净含量统一写 1g。
 */
function buildFillSkuNetWeightScript(grams) {
  return `(function(){
  var grams=${JSON.stringify(grams)};
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  var eng=st.engine;
  var props=st.getComponentProps('sku')||{};
  var attrs=props.attributes||{};
  var fields=Array.isArray(attrs)?attrs:Object.values(attrs);
  var keys=[];
  fields.forEach(function(f){
    var n=String(f&&f.name||'');
    if(!/^skuParam_p-\\d+$/.test(n))return;
    var label=String(f.label||'').replace(/[*＊\\s]/g,'');
    if(!/^(?:总|产品|单件)?净含量$/.test(label))return;
    var items=f.structItems||[],num=items.find(function(i){return i&&!i.isUnit;}),unit=items.find(function(i){return i&&i.isUnit;});
    var ds=unit&&unit.dataSource||[];
    var gramOpt=ds.find(function(o){return o&&(o.value===34||/^(g|克)$/i.test(String(o.text||'').trim()));});
    keys.push({key:n.slice(9),name:n,measure:f.uiType==='skuMeasurement'&&num&&unit,
      numName:num&&num.name,unitName:unit&&unit.name,unitText:String(gramOpt&&gramOpt.text||'克')});
  });
  // 兜底：老软件实证的两个通用键（类目没暴露 attributes 时也能写）
  ['p-147956252','p-33993'].forEach(function(k){
    if(!keys.some(function(x){return x.key===k;}))keys.push({key:k,name:'skuParam_'+k,measure:false,unitText:'g'});
  });
  if(!keys.length)return JSON.stringify({ok:false,reason:'no-netweight-key'});
  var seq=0;
  function valueFor(k){
    if(k.measure){
      var t=String(grams),si={};
      si[k.numName||'ts-1']=t;
      si[k.unitName||'ts-2']={text:k.unitText,value:34};
      return {value:-(Date.now()%1e9)-(++seq),text:t+k.unitText,structItems:si,isEmptyItem:false};
    }
    return {value:String(grams),text:grams+'g',unit:34};
  }
  var rows=st.getComponentValue('sku')||[];
  var read=0;
  var next=rows.map(function(row){
    var r=Object.assign({},row);
    var param=Object.assign({},r.skuParam||{});
    keys.forEach(function(k){
      var v=valueFor(k);
      param[k.key]=v;
      r[k.name]=v;
    });
    r.skuParam=param;
    var hit=keys.some(function(k){var v=param[k.key];return v&&String(v.text||'').indexOf(String(grams))===0;});
    if(hit)read++;
    return r;
  });
  var comp=eng.getComponent&&eng.getComponent('sku');
  if(comp&&comp.setProps)comp.setProps(Object.assign({},props,{value:next,message:[]}));
  eng.updateModels({formValues:Object.assign({},eng.getModels().formValues||{},{sku:next})});
  return JSON.stringify({ok:read===rows.length&&rows.length>0,read:read,total:rows.length,
    keys:keys.map(function(k){return k.name+(k.measure?'(measure)':'');})});
})()`;
}

/**
 * 总净含量 DOM 兜底：类目属性里没暴露 skuParam 键时，直接按表格列头「总净含量」定位每一行的输入框写 1。
 * 组件写入无效（回读 0）时才用。
 */
function buildFillSkuNetWeightDomScript(grams) {
  return `(async function(){
  var grams=${JSON.stringify(String(grams))};
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function txt(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,'');}
  var heads=Array.from(document.querySelectorAll('th,td,[class*="header-cell"],[class*="headerCell"]')).filter(function(n){
    return vis(n)&&/^(总净含量|净含量|克重)(重要)?$/.test(txt(n));
  });
  if(!heads.length)return JSON.stringify({ok:false,reason:'no-header'});
  var headRow=heads[0].closest('tr')||heads[0].parentElement;
  var cells=Array.from(headRow.children);
  var col=cells.indexOf(heads[0]);
  if(col<0)return JSON.stringify({ok:false,reason:'no-col'});
  var table=heads[0].closest('table');
  var bodyRows=table?Array.from(table.querySelectorAll('tbody tr')):[];
  if(!bodyRows.length){
    bodyRows=Array.from(document.querySelectorAll('tr')).filter(function(tr){
      return tr!==headRow&&tr.children.length>col&&tr.querySelector('input');
    });
  }
  var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  var wrote=0,total=0;
  for(var i=0;i<bodyRows.length;i++){
    var cell=bodyRows[i].children[col];
    if(!cell){continue;}
    var input=cell.querySelector('input:not([type=hidden])');
    if(!input){continue;}
    total++;
    try{
      input.scrollIntoView({block:'center'});
      input.focus();
      setter.call(input,grams);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      input.blur();
      await wait(80);
      if(String(input.value||'').indexOf(grams)>=0)wrote++;
    }catch(e){}
  }
  await wait(500);
  var read=0;
  for(var j=0;j<bodyRows.length;j++){
    var c=bodyRows[j].children[col];
    var inp=c&&c.querySelector('input');
    if(inp&&String(inp.value||'').indexOf(grams)>=0)read++;
  }
  return JSON.stringify({ok:read>0&&read>=wrote,read:read,wrote:wrote,total:total,rows:bodyRows.length});
})()`;
}

/* ============ SKU「包含产品」 ============
 * 老软件（dist/main/form-capture-native-products.js）实证：搜索框必须用 **真实键盘输入**（CDP Input.insertText）
 * 才会触发远程查询；用 DOM 改 value 只能把下拉点开、里面只有「+新建产品」，搜不到店铺里已有的档案
 * （2026-11-17 现场：日志只到 create-blocked，用户截图里手输「其他」却能出「腾味莱 其他 1g*1包」）。
 * 所以拆成四步：打开抽屉+聚焦 → 真实输入关键词 → 读下拉选项 → 选中(或新建)并把真实产品 id 写给所有行。
 */
const SKU_PRODUCT_SEARCH_MARK = 'data-xx-product-search';

/** 打开第 0 行的包含产品抽屉，把搜索框聚焦并全选（给后面的真实键盘输入用）。 */
function buildOpenSkuProductScript() {
  return `(async function(){
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,' ').trim();}
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  function rows(){return st.getComponentValue('sku')||[];}
  function productsOf(row){var p=row&&row.skuCombineContent;return Array.isArray(p)?p:(p&&p.products)||[];}
  function realId(p){return !!(p&&Number.isSafeInteger(Number(p.id))&&Number(p.id)>0);}
  var existing=rows().map(productsOf);
  if(existing.length&&existing.every(function(p){return p&&p.length&&realId(p[0]);}))return JSON.stringify({ok:true,already:true,count:existing.length});

  // 上次尝试可能把抽屉留在页面上：直接复用它，别再点一次（再点会关掉）
  var preDrawer=Array.prototype.slice.call(document.querySelectorAll('.sell-component-sku-combine-panel-drawer')).filter(vis)[0]||null;
  if(preDrawer){
    window.__XX_PRODUCT_DRAWER__=preDrawer;
    var preInp=Array.prototype.slice.call(preDrawer.querySelectorAll('input')).filter(function(n){return vis(n)&&/条形码|关键词|搜索/.test(String(n.placeholder||''));})[0]||null;
    if(preInp){
      try{preInp.setAttribute('${SKU_PRODUCT_SEARCH_MARK}','1');preInp.scrollIntoView({block:'center'});preInp.click();preInp.focus();preInp.select();}catch(e){}
      return JSON.stringify({ok:true,reused:true,placeholder:String(preInp.placeholder||'')});
    }
  }
  var cell=document.getElementById('0-skuCombineContent')||document.querySelector('[id$="-skuCombineContent"]');
  if(!cell){
    var sc=document.querySelector('#struct-sku .ver-scroll-wrap')||document.querySelector('[class*="ver-scroll-wrap"]');
    if(sc){sc.scrollTop=0;sc.dispatchEvent(new Event('scroll',{bubbles:true}));await wait(600);cell=document.getElementById('0-skuCombineContent')||document.querySelector('[id$="-skuCombineContent"]');}
  }
  if(!cell)return JSON.stringify({ok:false,reason:'no-cell'});
  var btn=cell.querySelector('button')||cell;
  try{btn.scrollIntoView({block:'center'});}catch(e){}
  try{btn.click();}catch(e){return JSON.stringify({ok:false,reason:'click-fail'});}

  var drawer=null;
  for(var i=0;i<40&&!drawer;i++){
    await wait(300);
    drawer=Array.prototype.slice.call(document.querySelectorAll('.sell-component-sku-combine-panel-drawer,.sku-component-sku-detail-drawer')).filter(vis)[0]||null;
    if(!drawer)drawer=Array.prototype.slice.call(document.querySelectorAll('.next-drawer')).filter(function(d){return vis(d)&&/包含产品|选择产品|产品档案/.test(text(d));})[0]||null;
  }
  if(!drawer)return JSON.stringify({ok:false,reason:'no-drawer'});
  window.__XX_PRODUCT_DRAWER__=drawer;

  function searchInput(){return Array.prototype.slice.call(drawer.querySelectorAll('input')).filter(function(n){return vis(n)&&/条形码|关键词|搜索/.test(String(n.placeholder||''));})[0]||null;}
  var inp=searchInput();
  if(!inp){
    var add=Array.prototype.slice.call(drawer.querySelectorAll('button,a,span,div')).filter(function(b){return vis(b)&&!b.children.length&&/^[+＋]?\\s*添加$/.test(text(b));})[0];
    if(add){try{add.click();}catch(e){}}
    for(var a0=0;a0<15&&!inp;a0++){await wait(400);inp=searchInput();}
  }
  if(!inp)return JSON.stringify({ok:false,reason:'no-search',panel:text(drawer).slice(0,120)});
  try{inp.setAttribute('${SKU_PRODUCT_SEARCH_MARK}','1');}catch(e){}
  try{inp.scrollIntoView({block:'center'});inp.click();inp.focus();inp.select();}catch(e){}
  return JSON.stringify({ok:true,placeholder:String(inp.placeholder||'')});
})()`;
}

/** 重新聚焦搜索框并全选（每次换关键词前调用）。 */
function buildFocusSkuProductSearchScript() {
  return `(function(){
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  var d=window.__XX_PRODUCT_DRAWER__;
  var i=document.querySelector('[${SKU_PRODUCT_SEARCH_MARK}="1"]');
  if(!i&&d)i=Array.prototype.slice.call(d.querySelectorAll('input')).filter(function(n){return vis(n)&&/条形码|关键词|搜索/.test(String(n.placeholder||''));})[0]||null;
  if(!i)return 'no-input';
  try{i.scrollIntoView({block:'center'});i.click();i.focus();i.select();}catch(e){return 'focus-fail';}
  return 'ok';
})()`;
}

/** 读下拉：真实输入后出现的候选 + 有没有「+新建产品」。 */
function buildSkuProductOptionsScript() {
  return `(function(){
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,' ').trim();}
  var pops=Array.prototype.slice.call(document.querySelectorAll('.next-select-popup-wrap,.next-select-menu,.next-overlay-wrapper .next-menu,[role="listbox"]')).filter(vis);
  var pop=pops.length?pops[pops.length-1]:null;
  // 候选行的 class 因类目而异（截图里是一行「腾味莱 其他 1g*1包」），按 class 找会得到 0 条。
  // 改成按文字扫：最内层、2~90 字、不是「新建产品」，同文案只留最靠里的一条。
  var opts=[], els=[], seen={};
  function collect(root){
    if(!root)return;
    Array.prototype.slice.call(root.querySelectorAll('*')).forEach(function(el){
      if(!vis(el))return;
      var inner=el.querySelectorAll('*').length;
      if(inner>6)return;
      var t=text(el);
      if(!t||t.length<2||t.length>90)return;
      if(/新建产品|没有找到|暂无数据|无匹配|加载中|请选择/.test(t))return;
      if(seen[t]&&seen[t]<=inner)return;
      var at=opts.indexOf(t);
      if(at>=0){if(inner<seen[t]){seen[t]=inner;els[at]=el;}return;}
      seen[t]=inner;opts.push(t);els.push(el);
    });
  }
  collect(pop);
  if(!opts.length){
    // 弹层不在已知容器里：退一步在整页的可点区域里找含关键词的行
    Array.prototype.slice.call(document.querySelectorAll('.next-overlay-wrapper,[class*="popup"],[class*="Popup"],[class*="dropdown"]')).filter(vis).forEach(collect);
  }
  try{window.__XX_PRODUCT_OPTS__=els;}catch(e){}
  var create=false;
  for(var i=pops.length-1;i>=0&&!create;i--){
    create=!!Array.prototype.slice.call(pops[i].querySelectorAll('a,span,button,div')).filter(function(e){
      return vis(e)&&!e.children.length&&/^[+＋]?\\s*新建产品$/.test(text(e));
    })[0];
  }
  return JSON.stringify({ok:true,options:opts.slice(0,12),count:opts.length,create:create,popup:pop?text(pop).slice(0,100):''});
})()`;
}

/** 点第 index 个候选，然后把真实产品 id 写给所有规格行。 */
function buildPickSkuProductScript(index) {
  return `(async function(){
  var want=${JSON.stringify(Number(index) || 0)};
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,' ').trim();}
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  var eng=st.engine;
  function rows(){return st.getComponentValue('sku')||[];}
  function productsOf(row){var p=row&&row.skuCombineContent;return Array.isArray(p)?p:(p&&p.products)||[];}
  function realId(p){return !!(p&&Number.isSafeInteger(Number(p.id))&&Number(p.id)>0);}
  function applyToAll(baseProduct,picked){
    var one=Object.assign({},baseProduct,{count:1});
    var list=rows().map(function(r){return Object.assign({},r,{skuCombineContent:{products:[one]}});});
    var comp=eng.getComponent&&eng.getComponent('sku');
    if(comp&&comp.setProps)comp.setProps(Object.assign({},st.getComponentProps('sku')||{},{value:list,message:[]}));
    eng.updateModels({formValues:Object.assign({},eng.getModels().formValues||{},{sku:list})});
    var read=(st.getComponentValue('sku')||[]).filter(function(r){var p=productsOf(r);return p.length&&realId(p[0])&&Number(p[0].id)===Number(one.id);}).length;
    return JSON.stringify({ok:read===list.length,read:read,total:list.length,productId:one.id,title:String(one.title||'').slice(0,40),picked:picked||''});
  }
  var opts=(window.__XX_PRODUCT_OPTS__||[]).filter(function(el){return el&&el.isConnected;});
  if(!opts.length)return JSON.stringify({ok:false,reason:'no-option'});
  var pick=opts[Math.min(want,opts.length-1)];
  var pickedText=text(pick).slice(0,40);
  try{pick.click();}catch(e){}
  await wait(1400);
  var drawer=window.__XX_PRODUCT_DRAWER__||Array.prototype.slice.call(document.querySelectorAll('.sell-component-sku-combine-panel-drawer')).filter(vis)[0];
  if(!drawer)return JSON.stringify({ok:false,reason:'no-drawer',picked:pickedText});
  var cnt=Array.prototype.slice.call(drawer.querySelectorAll('input')).filter(function(n){return vis(n)&&String(n.placeholder||'')==='请输入';})[0]||null;
  if(cnt&&String(cnt.value||'')!=='1'){
    try{
      var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      cnt.focus();setter.call(cnt,'1');cnt.dispatchEvent(new Event('input',{bubbles:true}));cnt.dispatchEvent(new Event('change',{bubbles:true}));cnt.blur();
    }catch(e){}
  }
  await wait(300);
  var okBtn=Array.prototype.slice.call(drawer.querySelectorAll('button')).filter(function(b){return vis(b)&&/^(确定|确认|保存)$/.test(text(b))&&!b.disabled;})[0];
  if(!okBtn)return JSON.stringify({ok:false,reason:'no-confirm',picked:pickedText});
  try{okBtn.click();}catch(e){}
  for(var w=0;w<30;w++){await wait(400);if(!vis(drawer))break;}
  await wait(600);
  var base=productsOf(rows()[0]||{});
  if(!base.length)return JSON.stringify({ok:false,reason:'product-not-bound',picked:pickedText});
  if(!realId(base[0]))return JSON.stringify({ok:false,reason:'product-id-missing',picked:pickedText,title:String(base[0]&&base[0].title||'').slice(0,40)});
  return applyToAll(base[0],pickedText);
})()`;
}

/**
 * 新建产品的「保存」阶段：外包装图已经塞进去了，点确定 → 等弹窗关闭 → 把新档案写给所有规格行。
 */
function buildSaveCreateProductScript() {
  return `(async function(){
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,' ').trim();}
  function fire(el){if(!el)return;['mousedown','mouseup','click'].forEach(function(t){try{el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));}catch(e){}});}
  var dlg=Array.prototype.slice.call(document.querySelectorAll('.sku-param-dialog')).filter(vis)[0]||null;
  if(!dlg)return JSON.stringify({ok:false,reason:'no-create-dialog'});
  function isSaveBtn(b){
    if(!b||!vis(b)||b.disabled)return false;
    return /^(确定|确认|保存|保存并关闭|提交)$/.test(text(b).replace(/[\\s*＊]/g,''));
  }
  var layers=[dlg,dlg.closest&&dlg.closest('.next-dialog'),dlg.closest&&dlg.closest('.next-overlay-wrapper')].filter(Boolean);
  var save=null;
  for(var li=0;li<layers.length&&!save;li++){
    save=Array.prototype.slice.call(layers[li].querySelectorAll('button')).filter(isSaveBtn)[0]||null;
    if(!save)save=Array.prototype.slice.call(layers[li].querySelectorAll('.next-dialog-footer button,[class*="footer"] button')).filter(isSaveBtn)[0]||null;
  }
  if(!save)return JSON.stringify({ok:false,reason:'no-create-save',buttons:Array.prototype.slice.call(dlg.querySelectorAll('button')).filter(vis).map(function(b){return text(b).slice(0,6);}).slice(0,8)});
  fire(save);
  var closed=false;
  for(var c=0;c<100;c++){await wait(300);if(!vis(dlg)){closed=true;break;}}
  if(!closed){
    var errs=Array.prototype.slice.call(dlg.querySelectorAll('[class*="error"],[class*="help"]')).filter(vis).map(text).filter(Boolean).slice(0,4);
    return JSON.stringify({ok:false,reason:'create-blocked',errors:errs,panel:text(dlg).slice(0,160)});
  }
  await wait(900);
  var drawer=window.__XX_PRODUCT_DRAWER__||Array.prototype.slice.call(document.querySelectorAll('.sell-component-sku-combine-panel-drawer')).filter(vis)[0];
  if(!drawer)return JSON.stringify({ok:false,reason:'drawer-gone'});
  var cnt=Array.prototype.slice.call(drawer.querySelectorAll('input')).filter(function(n){return vis(n)&&String(n.placeholder||'')==='请输入';})[0]||null;
  if(cnt&&String(cnt.value||'')!=='1'){
    try{var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;cnt.focus();s.call(cnt,'1');cnt.dispatchEvent(new Event('input',{bubbles:true}));cnt.dispatchEvent(new Event('change',{bubbles:true}));cnt.blur();}catch(e){}
    await wait(300);
  }
  var ok=Array.prototype.slice.call(drawer.querySelectorAll('button')).filter(function(b){return vis(b)&&/^(确定|确认|保存)$/.test(text(b))&&!b.disabled;})[0];
  if(ok)fire(ok);
  for(var w=0;w<30;w++){await wait(400);if(!vis(drawer))break;}
  await wait(600);
  var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
  if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
  var eng=st.engine;
  function rows(){return st.getComponentValue('sku')||[];}
  function productsOf(row){var p=row&&row.skuCombineContent;return Array.isArray(p)?p:(p&&p.products)||[];}
  var base=productsOf(rows()[0]||{});
  if(!base.length)return JSON.stringify({ok:false,reason:'product-not-bound'});
  var one=Object.assign({},base[0],{count:1});
  var list=rows().map(function(r){return Object.assign({},r,{skuCombineContent:{products:[one]}});});
  var comp=eng.getComponent&&eng.getComponent('sku');
  if(comp&&comp.setProps)comp.setProps(Object.assign({},st.getComponentProps('sku')||{},{value:list,message:[]}));
  eng.updateModels({formValues:Object.assign({},eng.getModels().formValues||{},{sku:list})});
  var read=(st.getComponentValue('sku')||[]).filter(function(r){var p=productsOf(r);return p.length&&Number(p[0].id)===Number(one.id);}).length;
  return JSON.stringify({ok:read===list.length,read:read,total:list.length,productId:one.id,title:String(one.title||'').slice(0,40),created:true});
})()`;
}

/**
 * 没有可用档案时新建：照老软件填 品名/单件净含量(数字+单位)/包装规格(1+单位)/条形码，再保存。
 * 单位必须选 —— 2026-11-17 现场：只填数字，平台报「输入值“80请选单位”错误」。
 */
function buildCreateSkuProductScript(fact, phase) {
  const f = (fact && typeof fact === 'object') ? fact : {};
  const want = String(f.name || '').trim();
  const grams = Number(f.grams) > 0 ? Number(f.grams) : 0;
  const unit = String(f.unit || '袋').trim() || '袋';
  const stage = phase === 'save' ? 'save' : 'fill';
  return `(async function(){
  var STAGE=${JSON.stringify(stage)};
  var want=${JSON.stringify(want)};
  var grams=${JSON.stringify(grams)};
  var unit=${JSON.stringify(unit)};
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
  function text(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,' ').trim();}
  function fire(el){if(!el)return;['mousedown','mouseup','click'].forEach(function(t){try{el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));}catch(e){}});}
  var pops=Array.prototype.slice.call(document.querySelectorAll('.next-select-popup-wrap,.next-select-menu,.next-overlay-wrapper,[role="listbox"]')).filter(vis);
  var link=null;
  for(var i=pops.length-1;i>=0&&!link;i--){
    link=Array.prototype.slice.call(pops[i].querySelectorAll('a,span,button,div')).filter(function(e){
      return vis(e)&&!e.children.length&&/^[+＋]?\\s*新建产品$/.test(text(e));
    })[0]||null;
  }
  if(!link)return JSON.stringify({ok:false,reason:'no-create-link'});
  fire(link);
  var dlg=null;
  for(var d=0;d<40&&!dlg;d++){await wait(300);dlg=Array.prototype.slice.call(document.querySelectorAll('.sku-param-dialog')).filter(vis)[0]||null;}
  if(!dlg)return JSON.stringify({ok:false,reason:'no-create-dialog'});
  var manual=Array.prototype.slice.call(dlg.querySelectorAll('button')).filter(function(b){return vis(b)&&/^手动填写$/.test(text(b));})[0];
  if(manual){fire(manual);await wait(700);}
  function labelOf(item){
    var l=item.querySelector('label,.name-label,[class*=label]');
    return String((l&&l.textContent)||'').replace(/[\\s*＊:：]/g,'');
  }
  function itemBy(re){
    return Array.prototype.slice.call(dlg.querySelectorAll('.sell-catProp-item,[id^="struct-"]')).filter(function(e){return vis(e)&&re.test(labelOf(e));})[0]||null;
  }
  function setVal(el,val){
    if(!el)return false;
    try{
      var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      el.focus();s.call(el,String(val));
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.blur();
    }catch(e){}
    return String(el.value||'')===String(val);
  }
  /** 这一项的单位下拉：点开 → 点想要的单位。文案可能是「g」「克」「克(g)」，按包含匹配。 */
  async function chooseUnit(item,wants){
    if(!item)return false;
    function trigger(){
      var s=item.querySelector('.sell-o-measurement-select,.next-select,[class*="measurement-select"],[class*="MeasurementSelect"]');
      if(s&&vis(s))return s;
      return Array.prototype.slice.call(item.querySelectorAll('*')).filter(function(e){
        return vis(e)&&/请选择单位/.test(text(e));
      }).sort(function(a,b){return a.querySelectorAll('*').length-b.querySelectorAll('*').length;})[0]||null;
    }
    function current(t){
      var s=String(t.getAttribute&&t.getAttribute('title')||'')+' '+text(t);
      return s.replace(/\s+/g,'');
    }
    function hitIn(list){
      for(var i=0;i<list.length;i++){
        var s=String(list[i].getAttribute&&list[i].getAttribute('title')||text(list[i])).trim();
        if(!s)continue;
        for(var w=0;w<wants.length;w++){
          var want=wants[w];
          if(s===want||s.indexOf(want)>=0){
            if(want==='g'&&/kg|千克|公斤/i.test(s))continue;
            return list[i];
          }
        }
      }
      return null;
    }
    for(var round=0;round<3;round++){
      var t=trigger();
      if(!t)return false;
      var cur=current(t);
      if(cur.indexOf('请选择')<0&&wants.some(function(w){return cur.indexOf(w)>=0;}))return true;
      fire(t);
      try{t.querySelector('.next-select-arrow,[class*="arrow"]')&&fire(t.querySelector('.next-select-arrow,[class*="arrow"]'));}catch(e){}
      await wait(600);
      var hit=null;
      for(var i=0;i<20&&!hit;i++){
        var os=Array.prototype.slice.call(document.querySelectorAll('.next-select-menu [role="option"],.next-select-menu .next-menu-item,.next-menu-item,[role="option"],.next-menu li')).filter(vis);
        hit=hitIn(os);
        if(!hit&&i===8){
          // 下拉没开：键盘也能打开 NextUI Select
          try{
            t.focus();
            ['keydown','keyup'].forEach(function(k){t.dispatchEvent(new KeyboardEvent(k,{key:'ArrowDown',code:'ArrowDown',keyCode:40,bubbles:true}));});
          }catch(e){}
        }
        if(!hit)await wait(250);
      }
      if(hit){
        fire(hit);
        await wait(500);
        var after=current(trigger()||t);
        if(after.indexOf('请选择')<0)return true;
      }
    }
    return false;
  }
  var nameEl=dlg.querySelector('input[itemlabel="品名"]')||Array.prototype.slice.call(dlg.querySelectorAll('input')).filter(function(n){return vis(n)&&/品名/.test(String(n.placeholder||'')+String(n.getAttribute&&n.getAttribute('itemlabel')||''));})[0]||null;
  setVal(nameEl,want);
  await wait(250);
  // 单件净含量：数字 + 单位 g
  var netItem=itemBy(/^(?:单件|产品)?净含量$/)||dlg.querySelector('[id="struct-p-227143751"],[id="struct-p-147956252"],[id="struct-p-33993"]');
  if(netItem&&grams){
    setVal(netItem.querySelector('input[placeholder="数字"]')||netItem.querySelector('input'),grams);
    await wait(300);
    await chooseUnit(netItem,['g','克','G']);
  }
  // 包装规格：1 + 单位（袋/个/件/包）
  var packItem=itemBy(/^包装规格$/)||itemBy(/^包装数量$/)||dlg.querySelector('[id="struct-p-186832700"]');
  if(packItem){
    setVal(packItem.querySelector('input[placeholder="数字"]')||packItem.querySelector('input'),'1');
    await wait(300);
    await chooseUnit(packItem,[unit,'个','件','包','袋','盒','瓶']);
  }
  // 产品净含量：平台会按 包装规格×单件净含量 算；单位空着也补一下
  var totalItem=itemBy(/^产品净含量$/);
  if(totalItem){await chooseUnit(totalItem,['g','克','G']);}
  // 条形码：没有就按平台提示填 13 个 0
  var barEl=Array.prototype.slice.call(dlg.querySelectorAll('input')).filter(function(n){return vis(n)&&/条形码/.test(String(n.placeholder||''));})[0]||null;
  if(barEl&&!String(barEl.value||'').trim())setVal(barEl,'0000000000000');
  await wait(400);
  // 13 个 0 = 没有有效条码，平台强制要一张外包装图（截图红框）。
  // 这里只把上传框点开、打上标记，文件由主进程通过 CDP 塞进去，然后再跑 save 阶段。
  if(STAGE==='fill'){
    var slot=Array.prototype.slice.call(dlg.querySelectorAll('.empty-container,[class*="upload"],[class*="Upload"]')).filter(function(e){return vis(e)&&/上传图片|外包装/.test(text(e)||'')||vis(e)&&e.className&&/empty/.test(String(e.className));})[0]||null;
    if(!slot){
      slot=Array.prototype.slice.call(dlg.querySelectorAll('div,span')).filter(function(e){return vis(e)&&!e.children.length&&/^上传图片$/.test(text(e));})[0]||null;
    }
    if(slot){try{slot.scrollIntoView({block:'center'});fire(slot);}catch(e){}}
    var marked=false;
    for(var pi=0;pi<20&&!marked;pi++){
      await wait(300);
      var fis=Array.prototype.slice.call(dlg.querySelectorAll('input[type=file]')).filter(vis);
      var f0=fis[0]||null;
      if(f0){try{f0.setAttribute('data-xx-upload','1');marked=true;}catch(e){}}
    }
    return JSON.stringify({ok:true,stage:'filled',needPackaging:marked,barcode:String(barEl&&barEl.value||''),units:{
      net:String(netItem&&text(netItem).slice(0,20)||''),
      pack:String(packItem&&text(packItem).slice(0,20)||'')
    }});
  }
  function isSaveBtn(b){
    if(!b||!vis(b)||b.disabled)return false;
    return /^(确定|确认|保存|保存并关闭|提交)$/.test(text(b).replace(/[\\s*＊]/g,''));
  }
  var layers=[dlg,dlg.closest&&dlg.closest('.next-dialog'),dlg.closest&&dlg.closest('.next-overlay-wrapper')].filter(Boolean);
  var save=null;
  for(var li=0;li<layers.length&&!save;li++){
    save=Array.prototype.slice.call(layers[li].querySelectorAll('button')).filter(isSaveBtn)[0]||null;
    if(!save)save=Array.prototype.slice.call(layers[li].querySelectorAll('.next-dialog-footer button,[class*="footer"] button')).filter(isSaveBtn)[0]||null;
  }
  if(!save){
    save=Array.prototype.slice.call(document.querySelectorAll('.next-dialog button,.next-overlay-wrapper button')).filter(function(b){
      if(!isSaveBtn(b))return false;
      var box=b.closest('.next-dialog,.next-overlay-wrapper');
      return !!(box&&box.querySelector('input[itemlabel="品名"],input[placeholder*="品名"]'));
    })[0]||null;
  }
  if(!save)return JSON.stringify({ok:false,reason:'no-create-save',buttons:Array.prototype.slice.call(dlg.querySelectorAll('button')).filter(vis).map(function(b){return text(b).slice(0,6);}).slice(0,8)});
  fire(save);
  for(var c=0;c<90;c++){
    await wait(300);
    if(!vis(dlg)){
      // 保存成功：回到抽屉，等新档案出现后再点抽屉确定
      await wait(900);
      var drawer=window.__XX_PRODUCT_DRAWER__||Array.prototype.slice.call(document.querySelectorAll('.sell-component-sku-combine-panel-drawer')).filter(vis)[0];
      if(!drawer)return JSON.stringify({ok:false,reason:'drawer-gone'});
      var cnt2=Array.prototype.slice.call(drawer.querySelectorAll('input')).filter(function(n){return vis(n)&&String(n.placeholder||'')==='请输入';})[0]||null;
      if(cnt2&&String(cnt2.value||'')!=='1'){
        try{var s2=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;cnt2.focus();s2.call(cnt2,'1');cnt2.dispatchEvent(new Event('input',{bubbles:true}));cnt2.dispatchEvent(new Event('change',{bubbles:true}));cnt2.blur();}catch(e){}
        await wait(300);
      }
      var ok2=Array.prototype.slice.call(drawer.querySelectorAll('button')).filter(function(b){return vis(b)&&/^(确定|确认|保存)$/.test(text(b))&&!b.disabled;})[0];
      if(ok2)fire(ok2);
      for(var w2=0;w2<30;w2++){await wait(400);if(!vis(drawer))break;}
      await wait(600);
      var st=window.__SELL_STATE__&&window.__SELL_STATE__.getState&&window.__SELL_STATE__.getState();
      if(!st||!st.engine)return JSON.stringify({ok:false,reason:'no-engine'});
      var eng=st.engine;
      function rows(){return st.getComponentValue('sku')||[];}
      function productsOf(row){var p=row&&row.skuCombineContent;return Array.isArray(p)?p:(p&&p.products)||[];}
      var base=productsOf(rows()[0]||{});
      if(!base.length)return JSON.stringify({ok:false,reason:'product-not-bound'});
      var one=Object.assign({},base[0],{count:1});
      var list=rows().map(function(r){return Object.assign({},r,{skuCombineContent:{products:[one]}});});
      var comp=eng.getComponent&&eng.getComponent('sku');
      if(comp&&comp.setProps)comp.setProps(Object.assign({},st.getComponentProps('sku')||{},{value:list,message:[]}));
      eng.updateModels({formValues:Object.assign({},eng.getModels().formValues||{},{sku:list})});
      var read=(st.getComponentValue('sku')||[]).filter(function(r){var p=productsOf(r);return p.length&&Number(p[0].id)===Number(one.id);}).length;
      return JSON.stringify({ok:read===list.length,read:read,total:list.length,productId:one.id,title:String(one.title||'').slice(0,40),created:true});
    }
  }
  var errs=Array.prototype.slice.call(dlg.querySelectorAll('[class*="error"],[class*="help"]')).filter(vis).map(text).filter(Boolean).slice(0,4);
  return JSON.stringify({ok:false,reason:'create-blocked',errors:errs,panel:text(dlg).slice(0,160)});
})()`;
}

/**
 * 发布页 JS 弹窗守卫（2026-11-21）。
 * 平台在素材中心/提交时会用 alert/confirm 问「图片已被使用，是否继续」这类问题；
 * Electron 里这种原生 JS 弹窗会**阻塞渲染进程**，此时任何 executeJavaScript 都不返回，
 * 表现就是「上架卡在这一步，时间一直走、日志不动」。
 * 这里把三个弹窗函数换成自动确认 + 记录文本，由 drainPageDialogs 写进执行日志。
 */
const PAGE_DIALOG_GUARD_SCRIPT = `(function(){
  try{
    if(window.__XX_DIALOG_GUARD__)return 'exists';
    window.__XX_DIALOG_GUARD__=1;
    window.__XX_DIALOGS__=[];
    function note(kind,text){
      try{window.__XX_DIALOGS__.push({kind:kind,text:String(text==null?'':text).slice(0,200),at:Date.now()});}catch(e){}
      try{window.__XX_DIALOGS__=window.__XX_DIALOGS__.slice(-20);}catch(e){}
    }
    window.alert=function(m){note('alert',m);};
    window.confirm=function(m){note('confirm',m);return true;};
    window.prompt=function(m,d){note('prompt',m);return d==null?'':String(d);};
    return 'installed';
  }catch(e){return 'failed';}
})()`;

function createPublishDriver({ electron, partitionForStore, log, pictureSpace, dataDir } = {}) {
  const { BrowserWindow } = electron;
  let activeLog = null;
  const emit = message => { try { (typeof activeLog === 'function' ? activeLog : log)?.(String(message)); } catch { /* */ } };

  /* ------------------------------------------------------------------
   * 手动停止 / 步骤标记 / 脚本超时（用户 2026-11-21 现场反馈）
   *
   * 1)「正在上架的产品没有办法停止」：以前停止只置一个 stopRequested，执行循环要等
   *    driver.publish 自己跑完才看得到。现在 cancel() 直接销毁发布窗口，
   *    挂在页面上的 executeJavaScript 立刻失败，当前这件商品当场中断。
   * 2)「上架卡在素材中心不动」：页面被平台弹窗（alert/confirm）或重渲染卡住时，
   *    executeJavaScript 是**永不返回**的。evalJs 给每次调用加超时，
   *    step() 记录最后一步，配合服务端看门狗给出可读原因，而不是无限等待。
   * ------------------------------------------------------------------ */
  let activePublishWindow = null;
  let activeStep = '';
  let cancelState = { stopped: false, reason: '' };

  function cancel(reason = '已手动停止') {
    cancelState.stopped = true;
    cancelState.reason = String(reason || '已手动停止');
    const win = activePublishWindow;
    activePublishWindow = null;
    if (win && !win.isDestroyed?.()) {
      try { win.destroy(); } catch { /* 窗口可能已在关闭中 */ }
      return { ok: true, aborted: true, step: activeStep };
    }
    return { ok: true, aborted: false, step: activeStep };
  }

  const currentStep = () => activeStep;

  function checkCancel() {
    if (cancelState.stopped) throw Object.assign(new Error(cancelState.reason || '已停止上架'), { code: 'STOPPED' });
  }

  /** 带超时的页面脚本：页面被弹窗/重渲染卡住时按失败处理，绝不让整件商品无限等。 */
  let lastScriptTimeoutNoteAt = 0;
  async function evalJs(win, script, timeoutMs = 15000) {
    if (!win || win.isDestroyed?.()) return null;
    const limit = Math.max(1000, Number(timeoutMs) || 15000);
    const run = Promise.resolve()
      .then(() => win.webContents.executeJavaScript(script, true))
      .catch(() => null);
    const value = await Promise.race([run, sleep(limit).then(() => '__xx_timeout__')]);
    if (value === '__xx_timeout__') {
      // 同一段卡顿会连续触发多次（很多调用点都在等同一个卡住的页面），20 秒内只记一行
      if (Date.now() - lastScriptTimeoutNoteAt > 20000) {
        lastScriptTimeoutNoteAt = Date.now();
        emit(`[guard] 页面脚本 ${Math.round(limit / 1000)} 秒没有响应（平台弹窗或页面卡住），这一步按失败处理`);
      }
      return null;
    }
    return value;
  }

  /** 页面还活着吗：正常时 1+1 立刻返回；平台卡死时 3 秒读不到。 */
  async function pageAlive(win) {
    const value = await evalJs(win, '1+1', 3000);
    return Number(value) === 2;
  }

  /**
   * 图片/提交这类重步骤开跑前先确认页面没卡死（用户 2026-11-24 现场：
   * 素材中心点一下卡片后整个发布页无响应，队列白等 3 分钟）。
   * 连续两次 ping 不通就直接抛 PAGE_HUNG，让这件商品快速失败，不拖死整批。
   */
  async function assertPageAlive(win, where) {
    if (await pageAlive(win)) return true;
    await sleep(800);
    if (await pageAlive(win)) return true;
    throw Object.assign(
      new Error(`平台页面无响应${where ? `（${where}）` : ''}：已停止这件商品，避免整批卡住；可直接重新上架或人工处理`),
      { code: 'PAGE_HUNG' },
    );
  }

  /** 页面里被自动确认掉的 alert/confirm：读出来写进日志，别让平台提示悄悄消失。 */
  async function drainPageDialogs(win) {
    const raw = await evalJs(win, `(function(){
      var list=(window.__XX_DIALOGS__||[]).slice();
      window.__XX_DIALOGS__=[];
      return JSON.stringify(list.slice(0,5));
    })()`, 6000);
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch { list = []; }
    for (const row of (Array.isArray(list) ? list : []).slice(0, 3)) {
      emit(`[dialog] 平台弹窗「${String(row?.text || '').slice(0, 120)}」已自动确认（${row?.kind || 'alert'}），不会卡住队列`);
    }
    return list;
  }

  /**
   * 必填兜底用的「名值表」：草稿参数 + 由参数推导出来的常见必填项。
   * 全部是确定性的（不调 AI、不联网），推不出来的就不推 —— 缺什么由日志说明。
   */
  function requiredHints(draft, detail) {
    const rows = [];
    const push = (name, value) => {
      const n = String(name || '').trim();
      const v = String(value == null ? '' : value).trim();
      if (n && v && !rows.some(r => r.name === n)) rows.push({ name: n, value: v });
    };
    for (const a of (Array.isArray(draft?.attrs) ? draft.attrs : [])) push(a?.name, a?.value);
    for (const a of (Array.isArray(detail?.attributes) ? detail.attributes : [])) push(a?.name, a?.value);
    const get = name => (rows.find(r => r.name === name) || {}).value || '';
    const PROVINCE_RE = /(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)(?:省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)?/;
    const origin = get('产地') || get('省份') || '';
    // 产地「中国大陆」→ 无明确省份；「中国大陆/福建省/泉州市」→ 福建省；「内蒙古自治区呼和浩特市」→ 内蒙古自治区
    const matchedProv = (origin.match(PROVINCE_RE) || [])[0] || '';
    const province = get('省份') || matchedProv;
    if (province) { push('省份', province); push('产地省份', province); }
    const city = get('城市');
    if (city) push('城市', city);
    const weight = get('净含量') || get('单件净含量');
    if (weight) { push('总净含量', weight); push('净含量', weight); }
    const shelf = get('保质期') || get('保质期（天）');
    if (shelf) push('保质期', shelf);
    push('包装方式', get('包装方式'));
    push('是否进口', /进口/.test(get('国产/进口') + get('是否进口')) ? '进口' : (get('国产/进口') || get('是否进口') || (origin ? '国产' : '')));
    // 食品安全常用项（采集参数里常带）
    for (const name of ['生产许可证编号', '产品标准号', '厂名', '厂址', '配料表', '储存方法', '食用方式']) push(name, get(name));
    return rows;
  }

  /**
   * 「80g」「净含量：80 克」「1.5kg」→ {grams:80, unit:'g'}。
   * 总净含量 / 产品档案的单件净含量都要用它，别再写死 1g（2026-11-17 用户现场反馈）。
   */
  function parseNetWeight(raw) {
    const s = String(raw || '').replace(/\s+/g, '');
    const m = s.match(/(\d+(?:\.\d+)?)(kg|千克|公斤|g|克|ml|毫升|升|l)?/i);
    if (!m) return { grams: 0, unit: 'g' };
    let grams = Number(m[1]);
    const u = String(m[2] || '').toLowerCase();
    if (/kg|千克|公斤/.test(u)) grams *= 1000;
    else if (u === 'l' || u === '升') grams *= 1000;
    else if (u === 'ml' || u === '毫升') grams *= 1;
    return { grams: Math.round(grams * 100) / 100, unit: 'g' };
  }

  /**
   * 包含产品用的「真实产品档案」事实：品名 + 单件净含量 + 单位 + 条码。
   * 老软件按 SKU 各自的参数建档；这里 27 条规格共用一份（平台只要一个真实 id，件数 1）。
   */
  function skuProductFact(draft, detail, hints) {
    const pool = [
      ...(Array.isArray(draft?.attrs) ? draft.attrs : []),
      ...(Array.isArray(detail?.attributes) ? detail.attributes : []),
      ...(Array.isArray(detail?.listing?.attributes) ? detail.listing.attributes : []),
      ...(Array.isArray(detail?.snapshot?.attributes) ? detail.snapshot.attributes : []),
      ...(Array.isArray(hints) ? hints : []),
    ].filter(a => a && a.name && String(a.value || '').trim());
    const normName = s => String(s || '').replace(/[*＊\s]/g, '').replace(/[（(][^）)]*[）)]/g, '').replace(/[:：].*$/, '');
    const get = re => String((pool.find(a => re.test(normName(a.name)) && String(a.value).trim()) || {}).value || '').trim();
    const netRaw = get(/^(?:总)?净含量$/) || get(/单件净含量|净重|规格$/) || get(/净含量/);
    const { grams } = parseNetWeight(netRaw);
    let name = get(/^(?:品名|产品名称|商品名称)$/);
    if (!name) {
      const skuName = String((Array.isArray(draft?.skus) ? draft.skus.find(s => s && s.name && !s.removed)?.name : '') || '');
      name = skuName.replace(/[【\[（(][^】\]）)]*[】\]）)]/g, '').replace(/\d+(?:\.\d+)?\s*(?:g|克|kg|千克|ml|毫升)/gi, '').trim();
    }
    if (!name) name = String(draft?.title || detail?.title || '').replace(/[【\[（(][^】\]）)]*[】\]）)]/g, '').slice(0, 12);
    const unitRaw = get(/^(?:净含量单位|包装单位|销售单位)$/);
    const unit = /^(袋|盒|瓶|包|罐|个|件|支|条|片|枚|块|只|斤|克|g)$/.test(unitRaw) ? unitRaw : '袋';
    const barcode = (get(/条形码|条码/) || '').replace(/\D/g, '');
    return { name: String(name || '').trim().slice(0, 24), grams: grams || 0, unit, barcode: barcode.length >= 8 ? barcode : '' };
  }

  /**
   * 图片保序解析（2026-11-16）：slotImages 按下标覆盖采集图，空位保留。
   * 没调整过就回落到采集顺序。返回 {square, tall, sku, detail}。
   */
  function resolveImagePlan(draft, detail) {
    const norm = u => {
      const raw = String(u || '').trim();
      if (/^https:\/\//i.test(raw)) return raw;
      if (raw.startsWith('local:')) return raw;
      // 草稿里的 AI 成品是相对 dataDir 的路径，不是浏览器 URL。以前这里直接丢掉，
      // 结果 useSquare=ai 也被悄悄换成采集原图，造成“1:1 主图串组”。
      if (raw.startsWith('selectionpool/drawing/') && !raw.includes('..')) {
        return dataDir ? `local:${pathModule.join(dataDir, ...raw.split('/'))}` : raw;
      }
      return '';
    };
    const merge = (group, base, limit, ai, savedList) => {
      const fromBase = (base || []).slice(0, limit).map(norm);
      const saved = (savedList || draft?.slotImages?.[group] || []).map(norm);
      const fromAi = (ai || []).map(norm);
      const out = [];
      for (let i = 0; i < limit; i++) out.push(saved[i] || fromAi[i] || fromBase[i] || '');
      while (out.length && !out[out.length - 1]) out.pop();
      return out;
    };
    // 与编辑器当前显示的一组严格一致：没有 AI 成品时编辑器实际使用采集原图。
    // 绝不在 square 与 squareSrc 之间交叉兜底，否则上一次在另一组换过的图会混进本次 1:1 主图。
    const squareAi = (draft?.squareAiImages || []).map(norm).filter(Boolean).slice(0, 5);
    const useSquareSrc = draft?.useSquare === 'src' || !squareAi.length;
    const squareGroup = useSquareSrc ? 'squareSrc' : 'square';
    const squareSaved = draft?.slotImages?.[squareGroup] || [];
    const square = merge(
      squareGroup,
      useSquareSrc ? (detail?.images || detail?.main_images || []) : [],
      5,
      useSquareSrc ? [] : squareAi,
      squareSaved,
    );
    const tall = merge('tall', detail?.tallImages || detail?.tall_images || [], 5, draft?.tallAiImages);
    const sku = [];
    const skus = Array.isArray(draft?.skus) ? draft.skus : [];
    if (skus.length) {
      for (let i = 0; i < skus.length; i++) {
      const img = norm(skus[i]?.image || detail?.skus?.[i]?.image || (detail?.skuImages || detail?.sku_images || [])[i] || '');
      sku.push({ index: i, name: skus[i]?.name || '', source: img });
    }
  } else {
    (detail?.skuImages || detail?.sku_images || []).slice(0, 30).forEach((img, i) => sku.push({ index: i, name: '', source: norm(img) }));
    }
    const detailList = (Array.isArray(draft?.detailImages) && draft.detailImages.length
      ? draft.detailImages : (detail?.description?.images || []))
      .map(norm).filter(Boolean).slice(0, 40);
    return { square, tall, sku, detail: detailList };
  }

  /** 按位准备文件（保序）：本机图直读，https 下载；失败占位，不往后挤。 */
  async function prepareImageFiles(sources, workDir, tag) {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const dir = path.join(workDir, tag);
    await fs.mkdir(dir, { recursive: true });
    const out = [];
    for (let i = 0; i < sources.length; i++) {
      const src = String(sources[i] || '').trim();
      if (!src) { out.push({ slot: i + 1, file: null, error: 'empty' }); continue; }
      try {
        let file = null;
        if (src.startsWith('local:')) {
          file = src.slice(6);
          await fs.access(file);
        } else if (src.startsWith('selectionpool/drawing/') && dataDir && !src.includes('..')) {
          file = pathModule.join(dataDir, ...src.split('/'));
          await fs.access(file);
        } else {
          const downloaded = await downloadImages([src], dir);
          file = downloaded[0] || null;
        }
        if (file) out.push({ slot: i + 1, file, source: src });
        else out.push({ slot: i + 1, file: null, error: 'download-failed', source: src });
      } catch (error) {
        out.push({ slot: i + 1, file: null, error: String(error?.message || error).slice(0, 80), source: src });
      }
    }
    return out;
  }

  /**
   * 3:4 主图统一成「严格 1440×1920 的 JPEG」（平台只收 jpg/jpeg/heic）。
   * 2026-11-19 现场两件事：
   *  ① 采集 CDN 的 URL 是 `.jpg`，文件内容其实是 WebP，平台报「仅支持jpg/jpeg，请修改第 1 张」；
   *  ② 只做等比缩小、不补齐画布，比例差一点的图（1086×1448 / 3000×4000 之外的）交给平台后
   *     会被平台自动裁成 3:4 —— 用户看到的就是「3:4 主图偶尔被裁了一块」。
   * 现在：比例正好 3:4 的只缩放；不是正好 3:4 的按 contain 放进白底 1440×1920 画布，
   * 整张图完整保留（宁可两边留白，也不让平台裁掉内容）。
   */
  async function convertTallToJpeg(win, items, dir) {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const crypto = require('node:crypto');
    await fs.mkdir(dir, { recursive: true });
    const isExact34 = info => Boolean(info && info.w && info.h && Math.abs(info.w / info.h - 0.75) <= 0.004);
    // 优先用主进程 nativeImage（不受发布页 CSP 限制）；WebP 解不了再退回页面 canvas
    const viaNative = buffer => {
      try {
        const nativeImage = electron?.nativeImage;
        if (!nativeImage?.createFromBuffer) return null;
        const image = nativeImage.createFromBuffer(buffer);
        if (!image || image.isEmpty?.()) return null;
        const size = image.getSize();
        if (!size?.width || !size?.height) return null;
        const scale = Math.min(1440 / size.width, 1920 / size.height, 1);
        const width = Math.max(1, Math.round(size.width * scale));
        const height = Math.max(1, Math.round(size.height * scale));
        const resized = scale < 1 ? image.resize({ width, height, quality: 'best' }) : image;
        const jpeg = resized.toJPEG(92);
        if (!jpeg?.length) return null;
        return { buf: jpeg, w: width, h: height, srcW: size.width, srcH: size.height, fit: '' };
      } catch { return null; }
    };
    const out = [];
    for (const item of items) {
      if (!item?.file) { out.push(item); continue; }
      try {
        const buf = await fs.readFile(item.file);
        const info = imageHeaderSize(buf);
        const jpeg = buf[0] === 0xFF && buf[1] === 0xD8;
        // 已经是 JPEG、正好 3:4、且尺寸在平台要求区间（≥750×1000、≤1440×1920）：原样用，不重新编码
        if (jpeg && isExact34(info) && info.w >= 750 && info.h >= 1000 && info.w <= 1440 && info.h <= 1920) { out.push(item); continue; }
        let converted = null;
        if (isExact34(info)) converted = viaNative(buf);
        if (!converted) {
          const mime = info?.fmt === 'png' ? 'image/png' : info?.fmt === 'webp' ? 'image/webp' : 'image/jpeg';
          const got = asJson(await win.webContents.executeJavaScript(
            buildConvertToJpegScript(buf.toString('base64'), mime, { fit: '3x4', w: 1440, h: 1920 }), true,
          ).catch(() => null));
          if (got?.ok && got.b64) converted = { buf: Buffer.from(got.b64, 'base64'), w: got.w, h: got.h, srcW: got.srcW, srcH: got.srcH, fit: '3x4' };
        }
        if (!converted) { out.push(item); continue; }
        const file = path.join(dir, `${crypto.createHash('sha1').update(converted.buf).digest('hex')}.jpg`);
        await fs.writeFile(file, converted.buf);
        out.push({
          ...item, file,
          jpegFrom: info?.fmt || (jpeg ? 'jpg' : 'unknown'),
          jpegPix: `${converted.w}x${converted.h}`,
          jpegSrc: `${converted.srcW}x${converted.srcH}`,
          jpegPadded: converted.fit === '3x4',
        });
      } catch (error) {
        emit(`[fill-images] 3:4主图第 ${item.slot || '?'} 位统一尺寸失败（${String(error?.message || error).slice(0, 60)}），按原文件上传`);
        out.push(item);
      }
    }
    return out;
  }

  /** 按组回读（实现见模块级 buildReadImageGroupScript，便于自测）。 */
  function readImageGroupScript(group) { return buildReadImageGroupScript(group); }

  /** 按组 + 位序找上传框（实现见模块级 buildFindUploadInputScript，便于自测）。 */
  function findUploadInputScript(group, slotIndex) { return buildFindUploadInputScript(group, slotIndex); }

  /**
   * 按图位保序上传：
   *  · square / tall / detail 通常共用一个多选上传框 → 一次性按图位顺序送入（逐张传会被覆盖，顺序也会丢）；
   *  · SKU 图每行一个上传框 → 按 SKU 行顺序逐行送入。
   * 回读 known=false 时标记「已送入、待人工确认」，不谎报失败。
   */
  async function uploadImageGroupSerially(win, group, files, opts = {}) {
    const results = [];
    const label = opts.label || group;
    if (!files.length) return results;
    const usable = files.filter(f => f.file);
    for (const item of files) {
      if (!item.file) {
        results.push({ slot: item.slot, ok: false, reason: item.error || 'no-file' });
        emit(`[fill-images] ${label} 第 ${item.slot} 位：${item.error || '无图'}，跳过`);
      }
    }
    if (!usable.length) return results;

    const findInput = async slotIndex => {
      let target = asJson(await win.webContents.executeJavaScript(findUploadInputScript(group, slotIndex), true).catch(() => null));
      if (!target || target.index < 0) {
        // 先点当前图片组自己的入口；只有该组不存在时才试通用按钮。
        // 不能先把页面上的多个“上传图片”都点一遍，否则主图文件可能落进随后打开的别组弹窗。
        const entry = asJson(await win.webContents.executeJavaScript(buildOpenImageEntryScript(group), true).catch(() => null));
        if (group !== 'whiteBg' && !entry?.ok) {
          asJson(await win.webContents.executeJavaScript(clickUploadTriggerScript(), true).catch(() => null));
        }
        if (entry && entry.scopes === 0 && !entry.ok) emit(`[fill-images] ${group}：页面未找到该组图位容器`);
        for (let wait = 0; wait < 12; wait++) {
          await sleep(500);
          target = asJson(await win.webContents.executeJavaScript(findUploadInputScript(group, slotIndex), true).catch(() => null));
          if (target && target.index >= 0) break;
        }
      }
      return target && target.index >= 0 ? target : null;
    };
    const confirmDialog = async () => {
      const confirmed = asJson(await win.webContents.executeJavaScript(confirmUploadDialogScript(), true).catch(() => null));
      if (confirmed?.clicked) await sleep(1000);
    };
    const readback = async () => asJson(await win.webContents.executeJavaScript(readImageGroupScript(group), true).catch(() => null));

    if (group !== 'sku') {
      // 一次性按图位顺序上传，文件数组顺序 = 页面顺序
      let uploaded = false, unverified = false;
      for (let attempt = 0; attempt < 2 && !uploaded; attempt++) {
        const target = await findInput(0);
        if (!target) { emit(`[fill-images] ${label}：找不到上传框`); break; }
        const r = await setFileOnInput(win, target.index, usable.map(x => x.file));
        if (!r.ok) { emit(`[fill-images] ${label} 上传失败：${r.error}`); continue; }
        await sleep(1800);
        await confirmDialog();
        // 图片上传是异步的；而且要「连续两次都读到 https 图」才算成功——
        // 只在模型里闪一下就被平台回滚的占位图，会骗出「上传成功」（2026-11-17 反复踩）。
        let read = null, urlsReal = false, stable = 0;
        for (let t = 0; t < 25; t++) {
          await sleep(800);
          read = await readback();
          urlsReal = !Array.isArray(read?.order) || !read.order.length || read.order.every(u => /^https?:\/\//i.test(String(u)));
          // via=dom 只说明页面画出了图，引擎（提交值）可能还是空 —— 不能算「回读一致」
          if (read && read.known && read.via !== 'dom' && read.count >= usable.length && urlsReal) { stable += 1; if (stable >= 2) break; }
          else stable = 0;
        }
        if (read && read.known && read.via !== 'dom' && read.count >= usable.length && urlsReal && stable >= 2) { uploaded = true; break; }
        if (read && read.via === 'dom' && read.count >= usable.length) { uploaded = true; unverified = true; break; }
        if (read && !read.known) {
          // 组件不存在、DOM 也没找到该组图位：文件可能塞进了别组的输入框。
          // 以前这里直接当「已送入」，日志很漂亮但 3:4 实际是空的（2026-11-19 现场）。
          if (opts.allowUnverified) { uploaded = true; unverified = true; break; }
          emit(`[fill-images] ${label}：页面没有该组图位（组件与 DOM 都未找到），无法确认上传`);
          break;
        }
        if (attempt === 0) emit(`[fill-images] ${label} 回读不足（应有 ${usable.length} 张，当前 ${read?.count || 0} 张），按原顺序重试一次`);
      }
      for (const item of usable) results.push({ slot: item.slot, ok: uploaded, unverified, reason: uploaded ? '' : 'readback-failed' });
      emit(uploaded
        ? `[fill-images] ${label}：${unverified ? `已按图位顺序送入 ${usable.length} 张（页面未提供回读，需人工确认）` : `按图位顺序上传成功 ${usable.length} 张（回读一致）`}`
        : `[fill-images] ${label}：上传失败（${usable.length} 张，回读未通过）`);
      return results;
    }

    // SKU 图：按规格行逐行上传
    let expected = 0;
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (!item.file) continue;
      expected += 1;
      let uploaded = false, unverified = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const target = await findInput(i);
        if (!target) { emit(`[fill-images] ${label} 第 ${item.slot} 行：找不到上传框`); break; }
        const payload = attempt === 0 ? [item.file] : files.slice(0, i + 1).filter(x => x.file).map(x => x.file);
        const r = await setFileOnInput(win, target.index, payload);
        if (!r.ok) { emit(`[fill-images] ${label} 第 ${item.slot} 行上传失败：${r.error}`); continue; }
        await sleep(1500);
        await confirmDialog();
        const read = await readback();
        if (read && read.known && read.count >= expected) { uploaded = true; break; }
        if (read && !read.known) { uploaded = true; unverified = true; break; }
        if (attempt === 0) emit(`[fill-images] ${label} 第 ${item.slot} 行回读不足（应有 ${expected} 张，当前 ${read?.count || 0} 张），重试一次`);
      }
      results.push({ slot: item.slot, ok: uploaded, unverified, reason: uploaded ? '' : 'readback-failed' });
      emit(`[fill-images] ${label} 第 ${item.slot} 行：${uploaded ? (unverified ? '已送入（页面未提供回读，需人工确认）' : '成功') : '失败（回读未通过）'}`);
      if (!uploaded && opts.stopOnFail) break;
    }
    return results;
  }

  /**
   * 主图上传最稳的一条路：打开文件选择器拦截，真实点一下「上传图片」，
   * 平台自己要弹哪个 input 就把文件塞给它（不再猜 input 序号）。
   */
  async function uploadMainViaChooser(win, files) {
    const dbg = win.webContents.debugger;
    try { dbg.attach('1.3'); } catch { /* 已附着 */ }
    try {
      const point = JSON.parse((await win.webContents.executeJavaScript(`(function(){
        function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
        var root=document.getElementById('struct-mainImagesGroup');
        if(!root)return '';
        var nodes=Array.prototype.slice.call(root.querySelectorAll('.empty-container,button,span,div,a')).filter(function(n){
          if(!vis(n)||n.children.length>1)return false;
          if(n.closest('[class*="video"],[class*="Video"]'))return false;
          return /^(上传图片|点击上传|添加图片|上传)$/.test(String((n.innerText||n.textContent)||'').trim());
        });
        var t=nodes[0]||root.querySelector('.empty-container');
        if(!t)return '';
        try{t.scrollIntoView({block:'center'});}catch(e){}
        var r=t.getBoundingClientRect();
        if(!r.width||!r.height)return '';
        return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});
      })()`, true).catch(() => 'null')) || 'null');
      if (!point) return { ok: false, reason: 'no-upload-point' };
      const before = fileChooserGuard?.recent(60000) || 0;
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      let fed = false;
      for (let i = 0; i < 24 && !fed; i++) {
        if ((fileChooserGuard?.recent(60000) || 0) > before) fed = (await fileChooserGuard.feed(files)).ok;
        if (!fed) await sleep(250);
      }
      if (!fed) return { ok: false, reason: 'no-file-chooser' };
      await sleep(1500);
      // 回读：必须是真实 https 地址（blob/占位不算），并且稳定 3 秒
      let stable = 0;
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const read = asJson(await win.webContents.executeJavaScript(readImageGroupScript('square'), true).catch(() => null));
        const urls = Array.isArray(read?.order) ? read.order : [];
        const real = urls.length > 0 && urls.every(u => /^https?:\/\//i.test(String(u)));
        if (read?.known && read.count > 0 && real) { stable += 1; if (stable >= 3) return { ok: true, count: read.count }; }
        else stable = 0;
      }
      return { ok: false, reason: 'readback-unstable' };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error).slice(0, 80) };
    }
  }
  /* ------------------------------------------------------------------
   * 素材中心（图片空间选择器 sucai-selector-ng）上传 —— 按老软件实证链路重写
   *
   * 老软件（form-capture-publish-core.js:waitSucaiFrame、form-capture-publish-images.js:fillMainImage）：
   *  1) 跨域 iframe 用 Electron WebFrameMain（webContents.mainFrame.framesInSubtree）取，取到直接
   *     frame.executeJavaScript；不挂 CDP target —— 新内核里 Target.attachToTarget 经常拿不到 session，
   *     整条链就断在「两条路都没通」。
   *  2) 「本地上传」只在 iframe 里发合成 click，绝不用 CDP 可信鼠标点它：可信点击会弹出原生文件选择框，
   *     发布窗在后台/离屏时框一出来整页就像卡死（用户现场「上传被冻结了」）。文件用 DataTransfer 灌进
   *     iframe 自己的 input[type=file]，等价人工选文件，走 plupload 原生队列。
   *  3) 传完点「完成」回到素材列表，按文件名勾选卡片，再用父页 CDP 坐标把可信点击转发进 iframe（穿透 OOPIF）。
   *  4) 只认父页图组回读（引擎值）张数增长；失败也把弹层关掉，绝不留着挡后面的图位。
   * ------------------------------------------------------------------ */
  const SUCAI_SRC_RE = /sucai-selector|sucai\.wangpu\.taobao\.com/i;

  /** 父页里判断素材中心有没有弹出来（iframe 可见）。 */
  const MEDIA_PRESENT_SCRIPT = `(function(){
    return Array.prototype.slice.call(document.querySelectorAll('iframe')).some(function(f){
      return (/sucai-selector/.test(f.src||'')||/sucai\\.wangpu\\.taobao\\.com/.test(f.src||''))&&f.offsetWidth>100&&f.offsetHeight>100;});})()`;
  /** 素材中心 iframe 在父页里的矩形（帧内坐标 + 这个矩形 = 父页 CDP 坐标）。 */
  const MEDIA_BOX_SCRIPT = `(function(){
    var f=Array.prototype.slice.call(document.querySelectorAll('iframe')).find(function(x){
      return x.offsetWidth>100&&x.offsetHeight>100&&(/sucai-selector/.test(x.src||'')||/sucai\\.wangpu\\.taobao\\.com/.test(x.src||''));});
    if(!f)return 'null';
    var r=f.getBoundingClientRect();
    return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height});})()`;
  /** 关弹层：父页抽屉/对话框上的 × 或「取消」（老软件 CLOSE_MEDIA_SCRIPT）。 */
  const MEDIA_CLOSE_SCRIPT = `(function(){
    var f=Array.prototype.slice.call(document.querySelectorAll('iframe')).find(function(x){return (/sucai-selector/.test(x.src||'')||/sucai\\.wangpu\\.taobao\\.com/.test(x.src||''))&&x.offsetWidth>100;});
    var root=f&&f.closest&&f.closest('.next-dialog,.next-drawer,.next-overlay-wrapper');
    if(!root)return false;
    var close=root.querySelector('.next-dialog-close,.next-drawer-close,[aria-label="Close"],[aria-label="关闭"]');
    if(!close)close=Array.prototype.slice.call(root.querySelectorAll('button')).find(function(b){return /^(取消|关闭)$/.test(String(b.innerText||'').trim());});
    if(close){try{close.click();}catch(e){}return true;}
    root.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
    return false;})()`;
  const MEDIA_CLOSE_FRAME_SCRIPT = `(function(){
    var close=Array.prototype.slice.call(document.querySelectorAll('.qn_close_blod,[aria-label="关闭"],[aria-label="Close"]')).find(function(e){return e.offsetWidth&&e.offsetHeight;});
    if(!close)return false;try{close.click();}catch(e){}return true;})()`;
  /** 帧内点「本地上传」→ 等它把 input[type=file] 挂出来（合成就不会弹原生框）。
   *  2026-11-18：每传完一批平台会把本地上传框收回去，所以这里要能被反复调用；
   *  同时给选中的框打 data-xx-media-input 标记，注入时只认这一颗（不再盲目取第一个 input）。 */
  const MEDIA_OPEN_LOCAL_SCRIPT = `(async function(){
    function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
    function txt(e){return String((e&&(e.innerText||e.textContent))||'').trim();}
    function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
    function inputs(){return Array.prototype.slice.call(document.querySelectorAll("input[type='file']"));}
    function pick(before){
      var all=inputs();
      if(!all.length)return null;
      var panel=document.querySelector('[class*="UploadPanel"],[class*="upload-panel"],[class*="uploadPanel"]');
      var fresh=all.filter(function(i){return before.indexOf(i)<0;});
      var pool=fresh.length?fresh:(panel?all.filter(function(i){return panel.contains(i);}):[]);
      if(!pool.length)pool=all.filter(vis);
      if(!pool.length)pool=all;
      var el=pool[pool.length-1]||null;
      try{
        for(var i=0;i<all.length;i++)all[i].removeAttribute('data-xx-media-input');
        if(el)el.setAttribute('data-xx-media-input','1');
      }catch(e){}
      return el;
    }
    var before=inputs();
    var marked=document.querySelector("input[type='file'][data-xx-media-input='1']");
    if(marked&&!marked.disabled)return JSON.stringify({ok:true,reused:true,multiple:marked.multiple!==false,total:before.length});
    var tab=null;
    for(var i=0;i<30&&!tab;i++){
      tab=Array.prototype.slice.call(document.querySelectorAll('button,[role=button],a,span,div')).find(function(e){
        return e.offsetHeight&&txt(e)==='本地上传'&&e.children.length<=1;});
      if(!tab)await sleep(300);
    }
    if(!tab)return JSON.stringify({ok:false,reason:'no-local-tab',inputs:before.length});
    ['mousedown','mouseup','click'].forEach(function(t){try{tab.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));}catch(e){}});
    for(var j=0;j<25;j++){
      var hit=pick(before);
      if(hit)return JSON.stringify({ok:true,fresh:before.indexOf(hit)<0,multiple:hit.multiple!==false,total:inputs().length});
      await sleep(300);
    }
    return JSON.stringify({ok:false,reason:'no-file-input',inputs:inputs().length});
  })()`;
  /** 把一张或多张图（base64）灌进帧里的 file input。
   *  2026-11-18 现场：旧实现 `document.querySelector("input[type='file']")` 取的是帧里第一个框，
   *  详情素材中心里第一个框并不是「本地上传」用的那一颗，第三张就灌丢了。
   *  现在只认 MEDIA_OPEN_LOCAL_SCRIPT 打过标记的框；标记没了就退回「上传面板内 / 可见的最后一个框」，
   *  并且一次可以灌多张（input 支持 multiple 时），失败把真实原因带回日志。 */
  function mediaInjectScript(files, single) {
    const list = Array.isArray(files) ? files : [{ name: files, b64: single }];
    const payload = list
      .map(row => ({ name: String(row?.name || 'image.jpg'), b64: String(row?.b64 || '') }))
      .filter(row => row.b64);
    return `(async function(){
    function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
    function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
    var files=${JSON.stringify(payload)};
    function pick(){
      var marked=document.querySelector("input[type='file'][data-xx-media-input='1']");
      if(marked&&!marked.disabled)return marked;
      var all=Array.prototype.slice.call(document.querySelectorAll("input[type='file']"));
      if(!all.length)return null;
      var panel=document.querySelector('[class*="UploadPanel"],[class*="upload-panel"],[class*="uploadPanel"]');
      var pool=panel?all.filter(function(i){return panel.contains(i);}):[];
      if(!pool.length)pool=all.filter(vis);
      if(!pool.length)pool=all;
      var el=pool[pool.length-1]||null;
      try{if(el)el.setAttribute('data-xx-media-input','1');}catch(e){}
      return el;
    }
    if(!files.length)return JSON.stringify({ok:false,reason:'no-file'});
    var input=null,waited=0;
    for(var i=0;i<20&&!input;i++){input=pick();if(!input){await sleep(300);waited+=300;}}
    if(!input)return JSON.stringify({ok:false,reason:'no-input',inputs:document.querySelectorAll("input[type='file']").length,waited:waited});
    var multi=input.multiple!==false;
    var use=files.slice(0,multi?30:1);
    var dt=new DataTransfer();
    for(var f=0;f<use.length;f++){
      var bin=atob(use[f].b64),bytes=new Uint8Array(bin.length);
      for(var j=0;j<bin.length;j++)bytes[j]=bin.charCodeAt(j);
      var name=use[f].name;
      var mime=/\\.png$/i.test(name)?'image/png':(/\\.webp$/i.test(name)?'image/webp':(/\\.jpe?g$/i.test(name)?'image/jpeg':'application/octet-stream'));
      dt.items.add(new File([bytes],name,{type:mime,lastModified:Date.now()}));
    }
    if(!dt.files||!dt.files.length)return JSON.stringify({ok:false,reason:'data-transfer-empty'});
    try{
      input.files=dt.files;
    }catch(e){
      return JSON.stringify({ok:false,reason:'set-files-failed',message:String(e&&e.message||e).slice(0,80)});
    }
    try{input.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}
    return JSON.stringify({ok:true,count:dt.files.length,multiple:multi,waited:waited,total:files.length});
  })()`;
  }
  /** 这一张传完没有（上传面板里按文件名对行，成功看图标/文案）。 */
  function mediaUploadStateScript(needle) {
    return `(function(){
    var needle=${JSON.stringify(String(needle))};
    var items=Array.prototype.slice.call(document.querySelectorAll('[class*="UploadPanel_fileItem"],[class*="upload-file-item"],[class*="fileItem"],[class*="upload-item"]'));
    if(!items.length)return JSON.stringify({st:'no-items'});
    var hit=items.filter(function(e){return String(e.textContent||'').indexOf(needle)>=0;});
    if(!hit.length)return JSON.stringify({st:'waiting',got:0,total:items.length});
    if(hit.some(function(e){return /上传失败|上传出错|文件过大|格式不支持/.test(String(e.textContent||''));}))return JSON.stringify({st:'failed',got:hit.length});
    var done=hit.every(function(e){
      return Boolean(e.querySelector('[class*="icon-success"],.next-icon-success,[class*="success"]'))||/成功|完成/.test(String(e.textContent||''));
    });
    return JSON.stringify({st:done?'uploaded':'uploading',got:hit.length,text:String(hit[0].textContent||'').replace(/\\s+/g,' ').slice(0,70)});
  })()`;
  }
  /** 上传面板底部「完成」：回到素材列表。 */
  const MEDIA_FINISH_SCRIPT = `(function(){
    var panel=document.querySelector('[class*="UploadPanel"],[class*="upload-panel"],[class*="uploadPanel"]');
    var btns=Array.prototype.slice.call(document.querySelectorAll('button,.next-btn')).filter(function(b){
      return b.offsetHeight&&!b.disabled&&/^(完成|确定|确认)$/.test(String(b.innerText||'').replace(/\\s+/g,''));
    });
    var target=panel?btns.filter(function(b){return panel.contains(b);})[0]:null;
    // 面板结构变了也别卡住：退回任意「完成」（确定可能属于外层抽屉，不能乱点）
    if(!target)target=btns.filter(function(b){return /^完成$/.test(String(b.innerText||'').replace(/\\s+/g,''));})[0]||null;
    if(!target)return JSON.stringify({clicked:false});
    try{target.click();}catch(e){return JSON.stringify({clicked:false});}
    return JSON.stringify({clicked:true,text:String(target.innerText||'').trim()});
  })()`;
  /** 按文件名找到刚上传的卡片：勾选 checkbox，并把卡片主图矩形带回来（父页坐标要用）。 */
  function mediaCardScript(needle) {
    return `(function(){
    var needle=${JSON.stringify(String(needle))};
    var labels=Array.prototype.slice.call(document.querySelectorAll('span,div,p,a,label')).filter(function(e){
      return !e.children.length&&e.offsetParent!==null&&String(e.textContent||'').indexOf(needle)>=0;});
    for(var i=0;i<labels.length;i++){
      var card=labels[i];
      for(var d=0;d<8&&card;d++,card=card.parentElement){
        var imgs=card.querySelectorAll('img');
        if(imgs.length>1)break;
        var cb=card.querySelector('input[type=checkbox]');
        if(imgs.length===1&&cb){
          if(cb.disabled)return JSON.stringify({ok:false,reason:'disabled'});
          var checked=cb.checked===true;
          if(!checked){try{cb.click();}catch(e){}}
          var r=imgs[0].getBoundingClientRect();
          return JSON.stringify({ok:true,checked:checked||cb.checked===true,src:String(imgs[0].currentSrc||imgs[0].src||''),img:{x:r.x,y:r.y,w:r.width,h:r.height}});
        }
      }
    }
    return JSON.stringify({ok:false,reason:'card-not-found'});
  })()`;
  }
  /**
   * 素材卡按文件名读地址（宽松版）：3:4 / 透明素材图的素材器是单选卡片，没有 checkbox，
   * mediaCardScript 会因为「找不到多选框」返回 card-not-found。这里只要有同名卡片 + 图片就取地址。
   */
  function buildFindAssetCardScript(needle) {
    return `(function(){
  var needle=${JSON.stringify(String(needle))};
  function usable(im){
    var u=String(im&&(im.currentSrc||im.src)||'');
    if(!/^https?:/i.test(u))return false;
    var w=Number(im.naturalWidth||im.width||0),h=Number(im.naturalHeight||im.height||0);
    return !(w>0&&h>0&&w<40&&h<40);
  }
  var labels=Array.prototype.slice.call(document.querySelectorAll('span,div,p,a,label')).filter(function(e){
    return !e.children.length&&e.offsetParent!==null&&String(e.textContent||'').indexOf(needle)>=0;});
  for(var i=0;i<labels.length;i++){
    var card=labels[i];
    for(var d=0;d<10&&card;d++,card=card.parentElement){
      var imgs=Array.prototype.slice.call(card.querySelectorAll('img')).filter(usable);
      if(imgs.length>4)break;
      if(imgs.length){
        var im=imgs[0],r=im.getBoundingClientRect();
        return JSON.stringify({ok:true,url:String(im.currentSrc||im.src||'').split('?')[0],
          img:{x:r.x,y:r.y,w:r.width,h:r.height},name:String(card.textContent||'').trim().slice(0,60)});
      }
    }
  }
  return JSON.stringify({ok:false,reason:'card-not-found'});
})()`;
  }
  /** 帧内「确定/完成」（裁剪框、素材列表底部都可能要再点一次）。 */
  const MEDIA_FRAME_CONFIRM_SCRIPT = `(function(){
    var btns=Array.prototype.slice.call(document.querySelectorAll('button,.next-btn')).filter(function(b){
      return b.offsetHeight&&!b.disabled&&/^(确定|确认|完成裁剪|完成|使用|添加|选用)$/.test(String(b.innerText||'').replace(/\\s+/g,''));
    });
    if(!btns.length)return JSON.stringify({ok:false,reason:'no-btn'});
    btns.sort(function(a,b){return b.getBoundingClientRect().y-a.getBoundingClientRect().y;});
    var b=btns[0],r=b.getBoundingClientRect();
    return JSON.stringify({ok:true,text:String(b.innerText||'').trim(),x:r.x,y:r.y,w:r.width,h:r.height});
  })()`;
  /** 父页抽屉底部「确定」（realtime 素材器没有这个按钮，返回 no-parent-ok 就跳过）。 */
  const MEDIA_PARENT_OK_SCRIPT = `(function(){
    var roots=Array.prototype.slice.call(document.querySelectorAll('.next-drawer,.next-dialog,.next-overlay-wrapper.opened,[class*="sucai"],[class*="material"]')).filter(function(el){return el.offsetHeight;});
    if(!roots.length)roots=[document.body];
    var btns=[];
    roots.forEach(function(root){
      Array.prototype.slice.call(root.querySelectorAll('button,.next-btn')).forEach(function(b){
        if(!b.offsetHeight||b.disabled)return;
        var t=String(b.innerText||'').replace(/\\s+/g,'').trim();
        if(/^(确定|确认|完成|使用|添加|选用)$/.test(t)){var r=b.getBoundingClientRect();btns.push({t:t,x:r.x,y:r.y,w:r.width,h:r.height,y2:r.bottom});}
      });
    });
    if(!btns.length)return JSON.stringify({ok:false,reason:'no-parent-ok'});
    btns.sort(function(a,b){return b.y2-a.y2;});
    return JSON.stringify({ok:true,text:btns[0].t,x:btns[0].x,y:btns[0].y,w:btns[0].w,h:btns[0].h});
  })()`;

  /** 图位的所有可点候选（空图位 / 上传图片按钮）：合成 click 打不开素材中心，得用真实鼠标一个个试。 */
  function buildImageEntryPointsScript(group) {
    return `(async function(){${NATIVE_SET}
    var group=${JSON.stringify(group)};
    function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
    function vis(n){return !!(n&&(n.offsetWidth||n.offsetHeight||n.getClientRects().length));}
    function txt(n){return String((n&&(n.innerText||n.textContent))||'').replace(/\\s+/g,' ').trim();}
    var groups={
      square:['#struct-mainImagesGroup','[class*="mainPic"]','[class*="main-pic"]','[class*="mainImage"]','[class*="main-image"]'],
      tall:['#struct-threeToFourImages','[class*="tallPic"]','[class*="tall-pic"]','[class*="vertical"]','[class*="3x4"]','[class*="longPic"]'],
      sku:['#struct-sku .sku-image-container','.sku-image-container','.sell-component-sku-images','[class*="sku-image"]','[class*="skuImage"]'],
      detail:['#struct-descRepublicOfSell','[class*="desc-image"]','[class*="detail-image"]','[class*="description"]','[class*="descEditor"]','[class*="detailEditor"]'],
      whiteBg:['#struct-whiteBgImage','[class*="whiteBgImage"]','[class*="whiteBg"]','[class*="transparentImage"]','[class*="guideImage"]']
    };
    var scopes=[];
    (groups[group]||[]).forEach(function(sel){scopes=scopes.concat(xxAll(sel).filter(vis));});
    var pts=[],seen=[];
    async function add(el,label){
      if(!el||!vis(el))return;
      try{el.scrollIntoView({block:'center'});}catch(e){}
      await wait(200);
      var r=el.getBoundingClientRect();
      if(!r.width||!r.height)return;
      var key=Math.round(r.left)+','+Math.round(r.top);
      if(seen.indexOf(key)>=0)return;
      seen.push(key);
      pts.push({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),label:label,text:txt(el).slice(0,12)});
    }
    for(var i=0;i<scopes.length&&pts.length<6;i++){
      await add(scopes[i].querySelector('.empty-container'),'empty');
      var cands=Array.prototype.slice.call(scopes[i].querySelectorAll('button,span,div,a,label')).filter(function(n){return vis(n)&&n.children.length<=1;});
      for(var j=0;j<cands.length&&pts.length<6;j++){
        var t=txt(cands[j]);
        if(/^(上传图片|点击上传|添加图片|上传|替换|更换|重新上传|\\+)$/.test(t))await add(cands[j],'button');
      }
    }
    return JSON.stringify({ok:pts.length>0,count:pts.length,points:pts});
  })()`;
  }

  /** 用真实鼠标把素材中心点开（老软件 realClickAt 同款；多个候选依次试）。 */
  async function openMediaDrawer(win, group, maxPoints = 5) {
    const raw = asJson(await evalJs(win, buildImageEntryPointsScript(group), 12000));
    if (!raw?.ok) return { ok: false, reason: 'no-entry-point' };
    for (const pt of raw.points.slice(0, Math.max(1, maxPoints))) {
      await cdpXY(win, pt.x, pt.y);
      for (let i = 0; i < 8; i++) {
        await sleep(300);
        if (await mediaPopupOpen(win)) return { ok: true, point: pt };
      }
    }
    return { ok: false, reason: 'drawer-not-open', points: raw.count };
  }

  /* ------------------------------------------------------------------
   * 文件选择框全局拦截（窗口生命周期）
   *
   * 为什么必须全局：CDP 的 Page.setInterceptFileChooserDialog 只对「发出它的那个 session」有效。
   * 素材中心的 <input type=file> 在跨域 iframe（OOPIF）里，chooser 事件走 iframe 自己的
   * session；以前在主 session 上临时开一下、点完就关，iframe 里的 chooser 根本拦不住，
   * 于是 Windows 原生「打开」框直接弹到用户桌面（2026-11-18 现场截图）。
   *
   * 这里在发布窗口创建时就 attach，对主 session 和所有子 iframe session 全部开拦截，
   * 一直保持到发布结束。任何 chooser 都被 CDP 接住，不会变成系统框；调用方需要传文件时
   * 从 guard 取一个未消费的 chooser，用它的 sessionId + backendNodeId 回喂。
   * ------------------------------------------------------------------ */
  let fileChooserGuard = null;
  function installFileChooserGuard(win) {
    const dbg = win.webContents.debugger;
    const guard = { dbg, choosers: [], armed: new Set(), onMessage: null };
    try { dbg.attach('1.3'); } catch { /* 已附着 */ }
    // 2026-11-18 11:13 现场：install() 里的 Target.setAutoAttach / getTargets / attachToTarget
    // 任何一个不返回就会永久挂住，日志停在「打开发布页」、进度 0/1。
    // 现在：每一步都带超时，整个安装最多 3 秒，失败也照常继续加载页面；
    // 拦截装不上只是退化成没有 chooser 守卫，绝不能卡死上架。
    const cdp = (method, params = {}, sessionId = undefined, ms = 1200) => Promise.race([
      (async () => {
        try { return await dbg.sendCommand(method, params, sessionId); } catch { return null; }
      })(),
      sleep(ms).then(() => null),
    ]);
    const arm = async sessionId => {
      await cdp('Page.enable', {}, sessionId, 1200);
      await cdp('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId, 1200);
      if (sessionId) guard.armed.add(sessionId);
    };
    guard.arm = arm;
    guard.onMessage = (evt, method, params, sessionId) => {
      if (method === 'Page.fileChooserOpened') {
        guard.choosers.push({ params: params || {}, sessionId: sessionId || '', used: false, at: Date.now() });
        if (guard.choosers.length > 16) guard.choosers.shift();
      } else if (method === 'Target.attachedToTarget' && params?.sessionId) {
        arm(params.sessionId);
      }
    };
    try { dbg.on('message', guard.onMessage); } catch { /* */ }
    guard.install = async () => {
      const installOnce = async () => {
        await arm();
        // setAutoAttach 只是锦上添花：新的 iframe 后面由 waitMediaFrame 找到时再补 arm
        await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, undefined, 1200);
        const infos = await cdp('Target.getTargets', {}, undefined, 1200);
        const targets = (infos?.targetInfos || []).filter(t => /^(page|iframe)$/.test(String(t.type || ''))).slice(0, 8);
        for (const t of targets) {
          const r = await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, undefined, 900);
          if (r?.sessionId) await arm(r.sessionId);
        }
      };
      await Promise.race([installOnce(), sleep(3000)]).catch(() => null);
      guard.installed = true;
    };
    /** 从一个未消费的 chooser 回喂文件；返回 {ok, sessionId}。 */
    guard.feed = async (files, maxAgeMs = 30000) => {
      const now = Date.now();
      for (const c of guard.choosers) {
        if (c.used || c.at < now - maxAgeMs || !c.params?.backendNodeId) continue;
        c.used = true;
        try {
          await dbg.sendCommand('DOM.setFileInputFiles', {
            backendNodeId: c.params.backendNodeId, files: files.slice(0, 30),
          }, c.sessionId || undefined);
          return { ok: true, sessionId: c.sessionId };
        } catch { /* 这个 chooser 对应的帧可能已经没了，试下一个 */ }
      }
      return { ok: false };
    };
    guard.recent = (maxAgeMs = 6000) => {
      const now = Date.now();
      return guard.choosers.filter(c => !c.used && c.at >= now - maxAgeMs).length;
    };
    guard.dispose = () => {
      try { dbg.removeListener('message', guard.onMessage); } catch { /* */ }
      try { dbg.sendCommand('Target.setAutoAttach', { autoAttach: false, flatten: true }); } catch { /* */ }
    };
    return guard;
  }

  /** 老软件 UPLOAD_CHALLENGE_STATE_SCRIPT：平台上传限流/滑块检测（在素材器 iframe 内跑）。 */
  const MEDIA_CHALLENGE_SCRIPT = `(function(){
  function vis(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0;}
  var slider=Array.prototype.slice.call(document.querySelectorAll('iframe')).some(function(f){
    return vis(f)&&/_____tmd_____|\\/punish(?:[/?]|$)/.test(f.src||'');
  })||Array.prototype.slice.call(document.querySelectorAll('.baxia-dialog,.baxia-dialog-content,#baxia-dialog-content')).some(vis);
  var rows=Array.prototype.slice.call(document.querySelectorAll('[class*="UploadPanel_fileItem"]')).filter(function(e){
    return !e.hasAttribute||!e.hasAttribute('data-ytp-verified');
  });
  var limited=rows.some(function(e){return /操作过于频繁|滑动验证码|验证.*重新上传/.test(e.innerText||'');});
  return JSON.stringify({slider:slider,limited:limited});
})()`;

  /** 页面上当前可见的平台提示条（素材中心拒收、像素不符这类话都在这里）。
   *  以前失败只报「回读未通过」，看不到平台到底说了什么，等于靠猜。 */
  const READ_TOAST_SCRIPT = `(function(){
    var sels=['.next-message','[class*="next-message"]','[class*="toast"]','[class*="Toast"]','[class*="notify"]','[class*="Notify"]'];
    var out=[];
    for(var i=0;i<sels.length;i++){
      var nodes=[];
      try{nodes=Array.prototype.slice.call(document.querySelectorAll(sels[i]));}catch(e){continue;}
      for(var j=0;j<nodes.length;j++){
        var n=nodes[j];
        if(!(n.offsetWidth||n.offsetHeight))continue;
        var t=String(n.innerText||n.textContent||'').replace(/\\s+/g,' ').trim();
        if(t&&t.length<=120&&out.indexOf(t)<0)out.push(t);
      }
    }
    return JSON.stringify(out.slice(0,5));
  })()`;

  /** 老软件 waitSucaiFrame：framesInSubtree 能拿到跨源 iframe，CDP frameTree 不一定看得到。 */
  function findMediaFrame(win) {
    try {
      const main = win.webContents.mainFrame;
      const list = main && main.framesInSubtree;
      if (!list || !list.length) return null;
      const arr = Array.from(list).reverse();
      for (const frame of arr) {
        try {
          if (!frame || frame.detached) continue;
          if (SUCAI_SRC_RE.test(String(frame.url || ''))) return frame;
        } catch { /* 帧已销毁 */ }
      }
    } catch { /* */ }
    return null;
  }
  async function waitMediaFrame(win, timeoutMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const frame = findMediaFrame(win);
      if (frame) return frame;
      await sleep(300);
    }
    return null;
  }
  /** 在跨域帧里跑脚本（带超时，帧被平台重载时当次算失败，不拖垮整条链）。 */
  async function evalFrame(frame, script, timeoutMs = 25000) {
    try {
      if (!frame || frame.detached) return null;
      const run = frame.executeJavaScript(script, true).catch(() => null);
      const value = await Promise.race([run, sleep(timeoutMs).then(() => '__frame-timeout__')]);
      if (value === '__frame-timeout__') return null;
      // 帧内脚本有的 return JSON.stringify，有的直接 return 对象：统一成字符串，
      // 调用方一律可以 JSON.parse（2026-11-18 "[object Object]" is not valid JSON 事故）。
      if (value && typeof value === 'object') {
        try { return JSON.stringify(value); } catch { return null; }
      }
      return value;
    } catch { return null; }
  }
  async function mediaPopupOpen(win) {
    // 2026-11-21：页面卡住时 executeJavaScript 会永不返回，这里必须有上限
    return Boolean(await evalJs(win, MEDIA_PRESENT_SCRIPT, 8000));
  }
  /** 父页坐标的可信点击（CDP 真实鼠标）。 */
  async function cdpXY(win, x, y) {
    try {
      const dbg = win.webContents.debugger;
      try { dbg.attach('1.3'); } catch { /* 已附着 */ }
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) });
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      return true;
    } catch { return false; }
  }
  /** 帧内坐标 → 父页 CDP 可信点击（Chromium 会把落在 iframe 矩形内的点击转发进去，穿透 OOPIF）。 */
  async function clickMediaFramePoint(win, rect) {
    if (!rect) return false;
    const box = asJson(await evalJs(win, MEDIA_BOX_SCRIPT, 8000));
    if (!box || !box.w) return false;
    return cdpXY(win, box.x + Number(rect.x || 0) + Number(rect.w || 0) / 2, box.y + Number(rect.y || 0) + Number(rect.h || 0) / 2);
  }
  /** 关掉素材中心弹层（失败也关，否则它会一直盖在发布页上挡后面的图位）。 */
  async function closeMediaPopup(win) {
    if (!await mediaPopupOpen(win)) return true;
    // 老软件 P4e：先只用 Escape（软关 / remove 会把刚回填的图回滚），关不掉再点 ×/取消
    try {
      const dbg = win.webContents.debugger;
      try { dbg.attach('1.3'); } catch { /* 已附着 */ }
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    } catch { /* */ }
    await sleep(700);
    if (!await mediaPopupOpen(win)) return true;
    await evalJs(win, MEDIA_CLOSE_SCRIPT, 8000);
    await sleep(600);
    if (!await mediaPopupOpen(win)) return true;
    const frame = findMediaFrame(win);
    if (frame) { await evalFrame(frame, MEDIA_CLOSE_FRAME_SCRIPT, 6000); await sleep(600); }
    for (let i = 0; i < 6; i++) {
      if (!await mediaPopupOpen(win)) return true;
      await sleep(400);
    }
    return false;
  }

  /**
   * 1:1 主图 / 透明素材图：走发布页「素材中心」整条链。
   * 返回 { ok, count, picked, reason, diag }；失败前会把弹层关掉。
   */
  async function uploadMainViaSucai(win, files, label, group = 'square', opts = {}) {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const read = async () => asJson(await evalJs(win, readImageGroupScript(group), 15000));
    const before = await read();
    const baseCount = Number(before?.count || 0);
    const baseOrder = (Array.isArray(before?.order) ? before.order : []).map(u => String(u || '').split('?')[0]);
    const accepted = (state, via) => {
      if (!state?.known) return null;
      const order = (Array.isArray(state.order) ? state.order : []).map(u => String(u || '').split('?')[0]);
      const real = order.filter(u => /^https?:\/\//i.test(u));
      if (!real.length) return null;
      const grew = Number(state.count || 0) > baseCount;
      const changed = !baseOrder.length || real[0] !== baseOrder[0] || JSON.stringify(real) !== JSON.stringify(baseOrder);
      // 透明图位最多 1 张：替换旧冻结图时数量不变，必须凭 URL 变化才算本次上传成功。
      if (!grew && !changed) return null;
      return {
        ok: true,
        count: Number(state.count || real.length),
        picked: files.length,
        uploaded: files.length,
        via,
        changed,
        grew,
        urls: real.slice(0, 3),
      };
    };
    if (await mediaPopupOpen(win)) await closeMediaPopup(win);
    // 图位必须用「真实鼠标」点：合成 click 打不开素材中心（2026-11-18 现场 no-media-frame）。
    // 老软件 fillMainImage 就是 realClickAt(dbg, slotSelector)；这里同时挂文件选择框拦截：
    // 文件选择框由窗口级的 fileChooserGuard 全程拦截（含跨域 iframe），
    // 这里绝不能再局部 setInterceptFileChooserDialog(false)——那会把全局拦截关掉，
    // 下一次真实点击就直接弹 Windows「打开」框。
    const dbg = win.webContents.debugger;
    try { dbg.attach('1.3'); } catch { /* 已附着 */ }
    const chooserBefore = fileChooserGuard?.recent(60000) || 0;
    // 空图位 / 上传图片按钮，逐个真实点，直到素材中心弹出来
    const drawer = await openMediaDrawer(win, group, Number(opts.maxPoints) || 5);
    // 少数类目的图位是「直接选文件」型：chooser 已被全局 guard 接住，把图回喂给它
    if ((fileChooserGuard?.recent(60000) || 0) > chooserBefore) {
      const fed = await fileChooserGuard.feed(files);
      if (fed.ok) {
        emit(`[fill-images] ${label}：图位直接挂本地上传，已回喂文件（未弹系统框）`);
        for (let k = 0; k < 10; k++) {
          await sleep(700);
          const r0 = await read();
          const hit = accepted(r0, 'chooser');
          if (hit) return hit;
        }
      }
    }
    const frame = drawer.ok ? await waitMediaFrame(win, Number(opts.frameWaitMs) || 12000) : null;
    if (!frame) {
      await closeMediaPopup(win);
      return { ok: false, reason: drawer.reason || 'no-media-frame', points: drawer.points || 0 };
    }
    // 帧内点「本地上传」并等 input[type=file] 挂出来（合成事件，不会弹原生框）
    let ready = null;
    for (let i = 0; i < 5 && !ready?.ok; i++) {
      if (i) await sleep(700);
      ready = JSON.parse((await evalFrame(frame, MEDIA_OPEN_LOCAL_SCRIPT)) || 'null');
    }
    if (!ready?.ok) { await closeMediaPopup(win); return { ok: false, reason: ready?.reason || 'no-local-tab' }; }
    // 批量灌进上传面板（和详情图同一条已跑通的链路：一次 ≤8 张，多选面板一次吃完）。
    // 2026-11-19 现场：3:4 图逐张灌，第一张传完后平台把本地上传面板收回，
    // 第二张起全部丢失（日志只到 1/5），必须「注入失败就重开面板再灌」。
    const ensureInput = async () => {
      let ready = null;
      for (let i = 0; i < 3 && !ready?.ok; i++) {
        if (i) await sleep(700);
        ready = JSON.parse((await evalFrame(frame, MEDIA_OPEN_LOCAL_SCRIPT)) || 'null');
      }
      return ready;
    };
    const waitState = async needle => {
      let st = null, blank = 0;
      for (let t = 0; t < 50; t++) {
        await sleep(700);
        // 老软件 checkImageVerification：平台限流/滑块时立刻停，不能傻等或假报成功
        const challenge = asJson(await evalFrame(frame, MEDIA_CHALLENGE_SCRIPT));
        if (challenge?.slider || challenge?.limited) return { st: 'verification-required' };
        st = JSON.parse((await evalFrame(frame, mediaUploadStateScript(needle))) || 'null');
        if (st?.st === 'uploaded' || st?.st === 'failed') return st;
        if (st?.st === 'no-items' || st?.st === 'waiting') {
          blank += 1;
          if (blank >= 8) return st;
          continue;
        }
        blank = 0;
      }
      return st;
    };
    const payload = [];
    for (const file of files) {
      const name = path.basename(String(file || ''));
      let b64 = '';
      try { b64 = (await fs.readFile(String(file))).toString('base64'); } catch { emit(`[fill-images] ${label}：读不到本机文件 ${name}，跳过`); continue; }
      payload.push({ name, b64, needle: name.replace(/\.[^.]+$/, '') });
    }
    if (!payload.length) { await closeMediaPopup(win); return { ok: false, reason: 'no-readable-file' }; }
    const inject = async list => {
      const body = list.map(row => ({ name: row.name, b64: row.b64 }));
      let injected = JSON.parse((await evalFrame(frame, mediaInjectScript(body), 120000)) || 'null');
      if (!injected?.ok) {
        await ensureInput();
        injected = JSON.parse((await evalFrame(frame, mediaInjectScript(body), 120000)) || 'null');
      }
      return injected;
    };
    const needles = [];
    let unconfirmed = 0;
    const CHUNK = 8;
    for (let start = 0; start < payload.length; start += CHUNK) {
      const chunk = payload.slice(start, start + CHUNK);
      const injected = await inject(chunk);
      if (!injected?.ok) {
        emit(`[fill-images] ${label}：素材中心没接住第 ${start + 1}–${start + chunk.length} 张（${injected?.reason || 'no-input'}）`);
        continue;
      }
      const rows = injected.multiple === false ? chunk.slice(0, 1) : chunk;
      for (const row of rows) {
        const st = await waitState(row.needle);
        if (st?.st === 'verification-required') {
          emit(`[fill-images] ${label}：⚠ 平台要求人工验证（滑块/限流），已停止本次上传，请在发布窗口处理后重试`);
          await closeMediaPopup(win);
          return { ok: false, reason: 'verification-required', needle: row.needle };
        }
        if (st?.st === 'failed') { emit(`[fill-images] ${label}：${row.name} 平台报上传失败`); continue; }
        needles.push(row.needle);
        if (st?.st !== 'uploaded') unconfirmed += 1;
        emit(`[fill-images] ${label}：素材中心已上传 ${needles.length}/${payload.length}（${row.needle}）`);
      }
      // 单文件面板：这一批剩下的逐张重开「本地上传」再灌，不能直接丢
      if (injected.multiple === false) {
        for (const row of chunk.slice(1)) {
          await ensureInput();
          const again = await inject([row]);
          if (!again?.ok) { emit(`[fill-images] ${label}：${row.name} 没送进素材中心（${again?.reason || 'no-input'}）`); continue; }
          const st = await waitState(row.needle);
          if (st?.st === 'verification-required') {
            emit(`[fill-images] ${label}：⚠ 平台要求人工验证（滑块/限流），已停止本次上传`);
            await closeMediaPopup(win);
            return { ok: false, reason: 'verification-required', needle: row.needle };
          }
          if (st?.st === 'failed') { emit(`[fill-images] ${label}：${row.name} 平台报上传失败`); continue; }
          needles.push(row.needle);
          if (st?.st !== 'uploaded') unconfirmed += 1;
          emit(`[fill-images] ${label}：素材中心已上传 ${needles.length}/${payload.length}（${row.needle}）`);
        }
      }
    }
    if (!needles.length) { await closeMediaPopup(win); return { ok: false, reason: 'no-upload' }; }
    // 回素材列表
    for (let i = 0; i < 2; i++) {
      const fin = JSON.parse((await evalFrame(frame, MEDIA_FINISH_SCRIPT)) || 'null');
      if (!fin?.clicked) break;
      await sleep(1200);
    }
    // 勾选刚传的那几张（复选框合成就够，realtime 素材器认组件事件）
    const pickedSet = new Set();
    const assetSrc = new Map();
    for (const needle of needles) {
      // 先按文件名读卡片地址（不要求多选框）：3:4 / 透明素材图的素材器是单选卡片，没有 checkbox。
      const card = JSON.parse((await evalFrame(frame, buildFindAssetCardScript(needle))) || 'null');
      if (card?.ok && /^https?:/i.test(String(card.url || ''))) {
        assetSrc.set(needle, normalizeMaterialUrl(card.url));
        pickedSet.add(needle);
        continue;
      }
      // 兼容多选素材器：点一下复选框，顺便拿地址
      const loc = JSON.parse((await evalFrame(frame, mediaCardScript(needle))) || 'null');
      if (loc?.ok) {
        pickedSet.add(needle);
        // 记下素材中心里这张图自己的地址：万一「勾选成功但图位没回填」，
        // 上层可以直接拿这个本店素材地址写进组件（比空手重试靠谱）
        if (loc.src && /^https?:/i.test(String(loc.src))) assetSrc.set(needle, normalizeMaterialUrl(loc.src));
      } else emit(`[fill-images] ${label}：素材列表里没找到 ${needle}（${card?.reason || loc?.reason || 'unknown'}）`);
    }
    // 逐步骤留证：这次是勾选、点图、裁剪还是确定失败，日志直接看得见（不再只报「回读未通过」）
    emit(`[fill-images] ${label}：素材器步骤 上传=${needles.length} 勾选=${pickedSet.size}`);
    emit(`[fill-images] ${label}：素材器步骤 勾选完成，开始回填图位（点图 → 回读 → 确定）`);
    const assets = Array.from(assetSrc.values());
    // 只要本店地址（3:4 主图）：不点卡片、不点确定，直接按上传顺序返回地址。
    // 图位由调用方用 buildFillTallImagesScript 写入，避免平台把这张图联动到 1:1 图位。
    if (opts.addressOnly) {
      const ordered = needles.map(n => assetSrc.get(n)).filter(u => /^https?:\/\//i.test(String(u)));
      await closeMediaPopup(win);
      return {
        ok: ordered.length === needles.length && needles.length > 0,
        uploaded: needles.length,
        picked: pickedSet.size,
        unconfirmed,
        assets: ordered,
        reason: ordered.length === needles.length && needles.length > 0 ? '' : `asset-address-${ordered.length}/${needles.length}`,
      };
    }
    // 回读必须“稳”：2026-11-18 现场出现过「素材中心上传成功，回读 5 张」紧接着又变回 1 张 ——
    // 那是抽屉开着时的瞬时状态，不是真的落库。多等 0.9 秒再读一次，两次都对才算成功。
    const confirmHit = async hit => {
      if (!hit) return null;
      await sleep(900);
      const again = await read();
      const second = accepted(again, `${hit.via}-stable`);
      if (!second) {
        emit(`[fill-images] ${label}：回读是瞬时状态（读到 ${Number(hit.count || 0)} 张，1 秒后 ${Number(again?.count || 0)} 张），不当作成功`);
        return null;
      }
      return { ...second, picked: pickedSet.size, uploaded: needles.length, assets };
    };
    // realtime 素材器（主图）点图就回填，先点图；点图不行再走「父页确定 → 帧内确定」。
    // 顺序很重要：先把父页抽屉关掉会把没回填的选中丢掉，所以确定永远放最后。
    // skipCardClick（透明素材图）：点卡片图片会让平台发布页整页无响应（2026-11-24 现场），
    // 这条流改成「只回读 + 直接写素材地址」，不点卡片。
    let nullReads = 0;
    const maxRounds = opts.skipCardClick ? 2 : 4;
    for (let round = 0; round < maxRounds; round++) {
      if (!opts.skipCardClick && (round === 0 || round === 3)) {
        for (const needle of needles) {
          const loc = JSON.parse((await evalFrame(frame, mediaCardScript(needle))) || 'null');
          if (loc?.ok && loc.img) { await clickMediaFramePoint(win, loc.img); await sleep(1000); }
        }
      }
      let after = await read();
      // 页面读不到（弹窗卡住 / 正在重渲染）：明确记一行，别让日志看起来「死」在这里；
      // 连续两次读不到说明页面真卡死了，立刻收摊交给上面的兜底，别耗到看门狗。
      if (after == null) {
        nullReads += 1;
        emit(`[fill-images] ${label}：素材器步骤 第 ${round + 1} 轮回读时页面没有响应（可能被平台弹窗卡住）`);
        if (nullReads >= 2) {
          await closeMediaPopup(win);
          return { ok: false, reason: 'page-no-response', picked: pickedSet.size, uploaded: needles.length, assets };
        }
        continue;
      }
      nullReads = 0;
      let hit = accepted(after, 'sucai');
      const stable = await confirmHit(hit);
      if (stable) { await closeMediaPopup(win); return stable; }
      if (round === 0) continue;
      // 弹层已经被平台自己关掉了：不要再乱点页面上的「确定」（可能点到别的弹窗）
      if (!await mediaPopupOpen(win)) break;
      // 主图没回填（或这个图位是「选完点确定」型）：先帧内确定（可能是裁剪框），再父页确定
      const crop = JSON.parse((await evalFrame(frame, MEDIA_FRAME_CONFIRM_SCRIPT)) || 'null');
      if (crop?.ok) {
        emit(`[fill-images] ${label}：点帧内确定「${crop.text || '确定'}」`);
        await clickMediaFramePoint(win, crop);
        await sleep(1200);
        after = await read();
        hit = accepted(after, 'sucai-crop');
        const stableCrop = await confirmHit(hit);
        if (stableCrop) { await closeMediaPopup(win); return stableCrop; }
      }
      const okBtn = asJson(await evalJs(win, MEDIA_PARENT_OK_SCRIPT, 8000));
      if (okBtn?.ok) {
        emit(`[fill-images] ${label}：点父页确定「${okBtn.text || '确定'}」`);
        await cdpXY(win, okBtn.x + Number(okBtn.w || 0) / 2, okBtn.y + Number(okBtn.h || 0) / 2);
        await sleep(1200);
      }
      after = await read();
      hit = accepted(after, 'sucai-confirm');
      const stableConfirm = await confirmHit(hit);
      if (stableConfirm) { await closeMediaPopup(win); return stableConfirm; }
      // 页面没有可回读的容器（known=false）：勾选过就先算「已送入，待确认」，别谎报失败
      if (!opts.requireVerified && after && after.known === false && pickedSet.size >= needles.length) {
        return { ok: true, unverified: true, count: Number(after.count || 0), picked: pickedSet.size, uploaded: needles.length, assets };
      }
    }
    const diag = await evalJs(win, `(function(){
      var f=Array.prototype.slice.call(document.querySelectorAll('iframe')).find(function(x){return /sucai/i.test(x.src||'')&&x.offsetWidth>100;});
      return JSON.stringify({frame:!!f,frameSize:f?[f.offsetWidth,f.offsetHeight]:null,
        dialogs:Array.prototype.slice.call(document.querySelectorAll('.next-dialog,.next-drawer')).filter(function(d){return d.offsetHeight;}).map(function(d){return String(d.innerText||'').replace(/\\s+/g,' ').slice(0,50);}).slice(0,3)});})()`, 8000);
    await closeMediaPopup(win);
    const last = await read();
    return {
      ok: false,
      // 页面读不到 ≠ 回读为空：前者是页面被弹窗/重渲染卡住，要让人知道不是「没选上」
      reason: last == null ? 'page-no-response' : 'readback-empty',
      picked: pickedSet.size,
      uploaded: needles.length,
      assets,
      diag,
      before: { count: baseCount, order: baseOrder.slice(0, 3) },
      after: { count: Number(last?.count || 0), order: (Array.isArray(last?.order) ? last.order : []).slice(0, 3), empty: last?.empty === true },
    };
  }

  /** 在指定坐标真实点一下，拦住原生文件选择框并把文件塞进去（不依赖素材中心 iframe）。 */
  async function uploadViaChooserAt(win, point, files) {
    const dbg = win.webContents.debugger;
    try { dbg.attach('1.3'); } catch { /* 已附着 */ }
    const before = fileChooserGuard?.recent(60000) || 0;
    try {
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      for (let i = 0; i < 32; i++) {
        if ((fileChooserGuard?.recent(60000) || 0) > before) {
          const fed = await fileChooserGuard.feed(files);
          if (fed.ok) return { ok: true };
        }
        await sleep(250);
      }
      return { ok: false, reason: 'no-file-chooser' };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error).slice(0, 80) };
    }
  }
  /** 关掉「批量导入」弹窗（透明素材图兜底上传时会被误开，留着会挡住提交）。 */
  async function closeBatchImportDialog(win) {
    const closed = await evalJs(win, `(function(){
      var n=0;
      Array.prototype.slice.call(document.querySelectorAll('.next-dialog,.next-overlay-wrapper')).filter(function(d){
        return d.offsetHeight&&/批量导入/.test(String(d.innerText||''));
      }).forEach(function(d){
        var b=Array.prototype.slice.call(d.querySelectorAll('button')).filter(function(x){return x.offsetHeight&&/^(取消|关闭)$/.test(String(x.innerText||'').trim());})[0];
        if(b){b.click();n++;}
      });
      return n;
    })()`, 8000);
    if (closed) await sleep(500);
    return closed;
  }

  /**
   * 店铺中分类：按保存的分类名勾选（可多选），并回读确认。
   * 平台下拉是 Magix 组件，合成点击有时打不开 —— 打不开就用 CDP 真实鼠标点一次坐标。
   * 返回 { ok, selected, missing, reason }；没有配置时 skipped:true（选填项，不拦提交）。
   */
  async function fillShopCategory(win, names) {
    const wanted = (Array.isArray(names) ? names : []).map(v => String(v || '').trim()).filter(Boolean).slice(0, 20);
    if (!wanted.length) return { ok: true, skipped: true, selected: [], missing: [] };
    const read = async () => asJson(await evalJs(win, readShopCategoryScript(), 10000));
    const pick = async () => {
      const opened = asJson(await evalJs(win, openShopCategoryScript(), 10000));
      if (!opened?.ok) return { opened, picked: null };
      await sleep(700);
      let picked = asJson(await evalJs(win, pickShopCategoryScript(wanted), 12000));
      // 合成点击没打开下拉：用真实鼠标点一次字段坐标，再勾
      if (!picked?.found && opened.point && Number.isFinite(Number(opened.point.x))) {
        await cdpXY(win, Number(opened.point.x), Number(opened.point.y));
        await sleep(800);
        picked = asJson(await evalJs(win, pickShopCategoryScript(wanted), 12000));
      }
      return { opened, picked };
    };
    let state = await read();
    if (!state?.ok) return { ok: false, reason: state?.reason || 'no-field', selected: [], missing: wanted };
    // 已选状态的两种来源都要认：标签 chip（selected）或控件本身显示的文字（text）
    const isSelected = name => {
      const tags = Array.isArray(state?.selected) ? state.selected : [];
      const text = String(state?.text || '');
      return tags.some(v => String(v) === name || String(v).includes(name)) || (text.includes(name) && !/请选择|选择分类/.test(text));
    };
    const hasAll = () => wanted.every(isSelected);
    if (hasAll()) return { ok: true, selected: state.selected || [], missing: [] };
    let attempt = await pick();
    await sleep(500);
    state = await read();
    if (!hasAll()) {
      // 第一次可能只展开分组：再点一次补齐
      attempt = await pick();
      await sleep(500);
      state = await read();
    }
    // 收下拉（有遮罩会挡住后面的上传/提交）
    try {
      const dbg = win.webContents.debugger;
      try { dbg.attach('1.3'); } catch { /* 已附着 */ }
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    } catch { /* */ }
    const selected = Array.isArray(state?.selected) ? state.selected : [];
    const missing = wanted.filter(name => !isSelected(name));
    return {
      ok: missing.length === 0,
      selected: selected.length ? selected : (missing.length ? [] : wanted),
      missing,
      reason: missing.length ? `未勾上：${missing.join('、')}` : '',
      available: attempt?.picked?.all || attempt?.picked?.sample || [],
    };
  }

  /**
   * 从草稿/详情/必填提议中提取候选省份（不含「中国大陆」这类国家地区）。
   */
  function provinceCandidatesFor(draft, detail, hints) {
    const PROVINCE_RE = /(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)(?:省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)?/;
    const pool = [
      ...(Array.isArray(draft?.attrs) ? draft.attrs : []),
      ...(Array.isArray(detail?.attributes) ? detail.attributes : []),
      ...(Array.isArray(detail?.listing?.attributes) ? detail.listing.attributes : []),
      ...(Array.isArray(detail?.snapshot?.attributes) ? detail.snapshot.attributes : []),
      ...(Array.isArray(hints) ? hints : []),
    ];
    const out = [];
    const add = v => {
      const s = String(v || '').trim();
      if (!s || /^(?:请选择|无|空|中国大陆|中国)$/.test(s) || out.includes(s)) return;
      out.push(s);
    };
    if (detail?.snapshot?.province) {
      add(detail.snapshot.province);
      const m = String(detail.snapshot.province).match(PROVINCE_RE);
      if (m && m[0]) add(m[0]);
    }
    if (detail?.shipping?.province) {
      add(detail.shipping.province);
      const m = String(detail.shipping.province).match(PROVINCE_RE);
      if (m && m[0]) add(m[0]);
    }
    for (const a of pool) {
      const n = String(a?.name || '').replace(/[:：*\s]/g, '');
      if (/^(?:省份|产地省份|所在省份|所在省|省|生产省份|产区)$/.test(n)) {
        add(a?.value);
        const m = String(a?.value || '').match(PROVINCE_RE);
        if (m && m[0]) add(m[0]);
      }
    }
    for (const a of pool) {
      const n = String(a?.name || '').replace(/[:：*\s]/g, '');
      if (/^(?:产地|原产地|原料产地|发货地)$/.test(n)) {
        const m = String(a?.value || '').match(PROVINCE_RE);
        if (m && m[0]) add(m[0]);
      }
    }
    return out;
  }

  /**
   * 省份下拉（* 省份）：优先选匹配省份；获取不到省份或下拉里没有该省份时，选择下拉框里的「其他」。
   * DOM 点击未生效时，改用只读坐标探测 + CDP 真实鼠标点击（绝不再调回 mutating script 来回切换触发器）。
   */
  async function ensureProvince(win, candidates = []) {
    const readOverlayState = async () => asJson(await evalJs(win, locateProvinceOverlayScript(candidates), 8000));
    const closeStrayOverlay = async state => {
      if (state && !state.overlayOpen) return;
      try {
        const dbg = win.webContents.debugger;
        try { dbg.attach('1.3'); } catch { /* */ }
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
        await sleep(180);
      } catch { /* */ }
      if (state?.neutralPoint && Number.isFinite(Number(state.neutralPoint.x))) {
        const check = await readOverlayState();
        if (check?.overlayOpen) {
          await cdpXY(win, Number(state.neutralPoint.x), Number(state.neutralPoint.y));
          await sleep(150);
        }
      }
    };

    let res = asJson(await evalJs(win, buildEnsureProvinceScript(candidates), 12000));
    if (!res) return { ok: false, reason: 'eval-failed' };
    if (res.ok || res.skipped) return res;

    let st = await readOverlayState();
    if (st?.ok) {
      await closeStrayOverlay(st);
      return st;
    }

    // 1) 若下拉尚未打开，仅用 CDP 点一次 triggerPoint，然后用只读脚本测量列表和搜索框坐标
    if (!st?.overlayOpen && (st?.point || res.point)) {
      const tp = st?.point || res.point;
      if (Number.isFinite(Number(tp?.x))) {
        await cdpXY(win, Number(tp.x), Number(tp.y));
        await sleep(500);
        st = await readOverlayState();
        if (st?.ok) {
          await closeStrayOverlay(st);
          return st;
        }
      }
    }

    // 2) 下拉已打开且拿到选项坐标（如「其他」）：直接 CDP 真实鼠标点击 optionPoint，并用只读脚本回读
    const optPt = st?.optionPoint || res.optionPoint;
    if (st?.overlayOpen && optPt && Number.isFinite(Number(optPt.x))) {
      await cdpXY(win, Number(optPt.x), Number(optPt.y));
      await sleep(450);
      const afterClick = await readOverlayState();
      if (afterClick?.ok) {
        await closeStrayOverlay(afterClick);
        return afterClick;
      }
      st = afterClick || st;
    }

    // 3) 若有下拉搜索框：输入目标省份或「其他」，过滤后按**重新测得**的 filtered optionPoint 点击（兜底才 ArrowDown+Enter）
    const sp = st?.searchPoint || res.searchPoint;
    if (!st?.ok && sp && Number.isFinite(Number(sp.x))) {
      const trySearch = async text => {
        try {
          if (!st?.overlayOpen && st?.point && Number.isFinite(Number(st.point.x))) {
            await cdpXY(win, Number(st.point.x), Number(st.point.y));
            await sleep(400);
            st = (await readOverlayState()) || st;
          }
          const boxPt = st?.searchPoint || sp;
          if (!boxPt || !Number.isFinite(Number(boxPt.x))) return null;
          await cdpXY(win, Number(boxPt.x), Number(boxPt.y));
          await sleep(120);
          const dbg = win.webContents.debugger;
          try { dbg.attach('1.3'); } catch { /* 已附着 */ }
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
          await dbg.sendCommand('Input.insertText', { text });
          await sleep(450);
          const filtered = await readOverlayState();
          if (filtered?.ok) return filtered;
          if (filtered?.optionPoint && Number.isFinite(Number(filtered.optionPoint.x))) {
            await cdpXY(win, Number(filtered.optionPoint.x), Number(filtered.optionPoint.y));
            await sleep(450);
            const afterFilterClick = await readOverlayState();
            if (afterFilterClick?.ok) return afterFilterClick;
          }
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
          await sleep(400);
          return await readOverlayState();
        } catch {
          return null;
        }
      };

      const firstQuery = String(st?.target || res.target || '其他').trim() || '其他';
      let searchRes = await trySearch(firstQuery);
      if (searchRes?.ok) {
        await closeStrayOverlay(searchRes);
        return searchRes;
      }
      if (firstQuery !== '其他') {
        st = (await readOverlayState()) || st;
        searchRes = await trySearch('其他');
        if (searchRes?.ok) {
          await closeStrayOverlay(searchRes);
          return searchRes;
        }
      }
      if (searchRes) st = searchRes;
    }

    // 4) 最后兜底：从 __SELL_STATE__ 组件数据源中写入候选/「其他」并回读 DOM
    if (!st?.ok) {
      const viaState = asJson(await evalJs(win, writeProvinceViaStateScript(candidates), 6000));
      if (viaState?.ok) {
        await closeStrayOverlay(await readOverlayState());
        return viaState;
      }
    }

    const finalState = await readOverlayState();
    await closeStrayOverlay(finalState);
    if (finalState?.ok) return finalState;
    return res || { ok: false, reason: 'province-not-selected' };
  }

  /**
   * 透明素材图（导购素材 · 800×800，必填）：
   * 用第一张 1:1 主图做**真抠图**（背景透明化）→ 800×800 PNG → 压到 500K 以内，再走素材中心上传。
   * 草稿指定了本机图（transSource=local）就优先用那张。
   *
   * 2026-11-18 现场定案：上一版只是把主图等比缩放，产出的 PNG alpha 全 255（完全不透明）、
   * 1,281,557 字节，与平台「透明背景 + 不大于 500K」的硬要求正相反 —— 素材中心能传上去，
   * 图位却始终是空图位，日志只剩「勾选=1 但回读 0 张」这句看起来像玄学的话。
   * 现在抠不干净 / 压不进 500K 会直接返回失败并写明原因，不拿不透明的图去凑成功。
   */
  async function uploadWhiteBg(win, sources, workDir) {
    await closeMediaPopup(win);
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const dir = path.join(workDir, 'whitebg');
    try { await fs.mkdir(dir, { recursive: true }); } catch { /* */ }
    const prepared = await prepareImageFiles(sources, workDir, 'whitebg-src');
    const src = prepared.find(x => x && x.file);
    if (!src) return { ok: false, reason: 'no-source' };
    let buf = null;
    try { buf = await fs.readFile(src.file); } catch { return { ok: false, reason: 'read-failed' }; }
    const mime = /\.png$/i.test(src.file) ? 'image/png' : (/\.webp$/i.test(src.file) ? 'image/webp' : 'image/jpeg');
    const made = JSON.parse((await win.webContents.executeJavaScript(
      buildMakeSquarePngScript(`data:${mime};base64,${buf.toString('base64')}`, 800), true).catch(() => 'null')) || 'null');
    if (!made?.ok) {
      emit(`[fill-images] 透明素材图：800×800 PNG 生成失败（${made?.reason || 'png-failed'}），本张不上传`);
      return { ok: false, reason: `png:${made?.reason || 'png-failed'}`, cutout: made || null, file: '' };
    }
    emit(`[fill-images] 透明素材图：${made.fallback ? '原图等比缩进透明画布（保留透明边）' : '抠图'}完成（透明区 ${Math.round(Number(made.transparent || 0) * 100)}% · ${made.w}×${made.h} · ${Math.round(Number(made.bytes || 0) / 1024)}KB · 背景 rgb(${(made.bg || []).join(',')}) · 容差 ${made.tol}）`);
    if (Number(made.bytes || 0) > 500 * 1024) {
      emit(`[fill-images] 透明素材图：⚠ 体积 ${Math.round(Number(made.bytes) / 1024)}KB 超过平台 500K 限制，图位可能拒收`);
    }
    const pngPath = path.join(dir, `white-bg-${Date.now()}.png`);
    try {
      await fs.writeFile(pngPath, Buffer.from(String(made.data).replace(/^data:image\/png;base64,/, ''), 'base64'));
    } catch { return { ok: false, reason: 'write-failed' }; }
    const readState = async () => JSON.parse((await evalJs(win, buildReadImageGroupScript('whiteBg'), 15000)) || 'null');
    const before = await readState();
    const beforeOrder = (Array.isArray(before?.order) ? before.order : []).map(u => String(u || '').split('?')[0]);
    const changedFromBefore = state => {
      const order = (Array.isArray(state?.order) ? state.order : []).map(u => String(u || '').split('?')[0]).filter(u => /^https?:\/\//i.test(u));
      return Boolean(order.length && (!beforeOrder.length || order[0] !== beforeOrder[0] || JSON.stringify(order) !== JSON.stringify(beforeOrder)));
    };
    let done = { ok: false, reason: 'no-file', cutout: { transparent: made.transparent, bytes: made.bytes, tol: made.tol, bg: made.bg } };
    const acceptVerified = async (via, detail = {}) => {
      const synced = JSON.parse((await evalJs(win, buildSyncGuideImageFromDomScript(), 12000)) || 'null');
      const verified = JSON.parse((await evalJs(win, buildVerifyGuideImageScript(), 12000)) || 'null');
      if (verified?.ok) {
        try {
          await win.webContents.executeJavaScript(
            `window.__XX_GUIDE_UPLOAD__=${JSON.stringify({ url: verified.url, pix: verified.pix, via, at: Date.now() })}`,
            true,
          );
        } catch { /* marker 只用于诊断 */ }
        done = {
          ok: true,
          count: 1,
          via,
          picked: 1,
          uploaded: 1,
          changed: changedFromBefore(await readState()),
          url: verified.url,
          pix: verified.pix,
          sync: synced,
          verified,
          ...detail,
        };
        return true;
      }
      done = {
        ...done,
        reason: `verify:${verified?.reason || 'unknown'}`,
        verify: verified || null,
        sync: synced || null,
      };
      return false;
    };
    // 0) 老软件实证：透明素材图也走素材中心（点空图位 → 本地上传 → 勾选 → 确定），
    //    这条路不弹原生文件框，也不会误开「批量导入」弹窗。
    {
      // 透明素材图只有 1 张：不点卡片（点卡片会让平台发布页整页无响应），
      // 直接按上传后拿到的本店素材地址回填 + 核验。
      const wb = await uploadMainViaSucai(win, [pngPath], '透明素材图', 'whiteBg', {
        frameWaitMs: 5000,
        maxPoints: 3,
        requireVerified: true,
        skipCardClick: true,
      });
      if (wb.ok && await acceptVerified('sucai', { changed: wb.changed })) {
        await closeMediaPopup(win);
        return { ...done, file: pngPath, srcW: made.srcW, srcH: made.srcH };
      }
      const wbVerifyReason = done.verify?.reason ? ` / 核验：${done.verify.reason}` : '';
      done = {
        ok: false,
        reason: `${wb.reason || (wb.ok ? 'sucai-verified-failed' : 'sucai-failed')}${wbVerifyReason}`,
        diag: [wb.diag, `素材中心回读 before=${JSON.stringify(wb.before || {})} after=${JSON.stringify(wb.after || {})}`].filter(Boolean).join(' | '),
        before: wb.before,
        after: wb.after,
        verify: done.verify,
      };
      // 勾选成功但图位没回填：这张图已经进了本店素材库，直接把它自己的地址写进 guideImageGroup。
      // 既是一条兜底，也能反证「抽屉到底有没有绑到这个图位」——日志会写明用的是哪个地址。
      const assetUrl = (Array.isArray(wb.assets) ? wb.assets : [])
        .map(u => String(u).split('?')[0])
        .find(u => /^https?:\/\//i.test(u));
      if (assetUrl) {
        const written = JSON.parse((await evalJs(win, buildWriteGuideImageScript([assetUrl]), 12000)) || 'null');
        if (written?.ok && await acceptVerified('sucai-asset', { asset: assetUrl })) {
          emit(`[fill-images] 透明素材图：图位没回填，已用本店素材地址直接写入并核验（…${assetUrl.slice(-28)}）`);
          await closeMediaPopup(win);
          return { ...done, file: pngPath, srcW: made.srcW, srcH: made.srcH };
        }
        done.assetWrite = written || null;
        emit(`[fill-images] 透明素材图：改用素材地址直写也没通过（${written?.reason || 'unknown'}）`);
      }
    }
    // 1) 原生选择框（已开拦截，直接把 PNG 塞给它）
    if (!done.ok) {
      const loc = asJson(await evalJs(win, buildOpenImageEntryScript('whiteBg', true), 12000));
      if (loc?.ok && Number.isFinite(Number(loc.x))) {
        const ch = await uploadViaChooserAt(win, { x: Number(loc.x), y: Number(loc.y) }, [pngPath]);
        if (ch.ok) {
          for (let k = 0; k < 12; k++) {
            await sleep(700);
            const read = await readState();
            if (changedFromBefore(read) && await acceptVerified('chooser')) {
              await closeMediaPopup(win);
              return { ...done, file: pngPath, srcW: made.srcW, srcH: made.srcH };
            }
          }
        }
      }
    }
    // 2) 点空图位后挂出来的本地上传框
    if (!done.ok) {
      const opened = asJson(await evalJs(win, buildOpenImageEntryScript('whiteBg'), 12000));
      if (opened?.ok) {
        for (let t = 0; t < 10; t++) {
          await sleep(500);
          const target = asJson(await evalJs(win, buildFindUploadInputScript('whiteBg', 0), 12000));
          if (target && target.index >= 0) {
            const r = await setFileOnInput(win, target.index, [pngPath]);
            if (r.ok) {
              await sleep(1800);
              await win.webContents.executeJavaScript(confirmUploadDialogScript(), true).catch(() => null);
              for (let k = 0; k < 10; k++) {
                await sleep(700);
                const read = await readState();
                if (changedFromBefore(read) && await acceptVerified('file-input')) {
                  await closeMediaPopup(win);
                  return { ...done, file: pngPath, srcW: made.srcW, srcH: made.srcH };
                }
              }
              break;
            }
          }
        }
      }
    }
    if (!done.ok) {
      await uploadImageGroupSerially(win, 'whiteBg', [{ slot: 1, file: pngPath }], { label: '透明素材图', stopOnFail: false });
      const read = await readState();
      if (changedFromBefore(read) && await acceptVerified('upload-input')) {
        await closeMediaPopup(win);
        return { ...done, file: pngPath, srcW: made.srcW, srcH: made.srcH };
      }
    }
    await closeBatchImportDialog(win);
    // 3) 素材中心漏图时改走本店图片空间；上传的是本次生成的 PNG，拿到新地址后再写表单。
    if (!done.ok && pictureSpace?.uploadOne) {
      try {
        const up = await pictureSpace.uploadOne(pngPath, `透明素材图-${Date.now()}`);
        if (up?.ok && /^https?:\/\//i.test(String(up.url || ''))) {
          const written = JSON.parse((await evalJs(win, buildWriteGuideImageScript([up.url]), 12000)) || 'null');
          if (written?.ok && await acceptVerified('picture-space', { uploadUrl: up.url })) {
            await closeMediaPopup(win);
            return { ...done, file: pngPath, srcW: made.srcW, srcH: made.srcH };
          }
          done.pictureSpace = { written, uploadUrl: up.url, verify: done.verify };
        } else {
          done.pictureSpace = { ok: false, code: up?.code || '', message: up?.message || '' };
          if (up?.message) done.reason = `${done.reason || 'upload-failed'} / 图片空间：${String(up.message).slice(0, 120)}`;
        }
      } catch (error) {
        done.pictureSpace = { ok: false, message: String(error?.message || error).slice(0, 160) };
        done.reason = `${done.reason || 'upload-failed'} / 图片空间：${done.pictureSpace.message}`;
      }
    }
    if (!done.ok) {
      const diag = await evalJs(win, buildWhiteBgDiagScript(), 10000);
      if (diag) done.diag = diag;
      // 平台到底说了什么（图位拒收/像素不符/必填提示）—— 以前只能猜，现在写进日志
      const toast = asJson(await evalJs(win, READ_TOAST_SCRIPT, 8000));
      if (Array.isArray(toast) && toast.length) {
        done.toast = toast;
        emit(`[fill-images] 透明素材图：平台提示 ${toast.join(' / ').slice(0, 160)}`);
      }
      const verified = JSON.parse((await evalJs(win, buildVerifyGuideImageScript(), 12000)) || 'null');
      done.verify = verified;
      if (!done.reason || done.reason === 'no-file') done.reason = `upload-not-verified:${verified?.reason || 'unknown'}`;
    }
    return { ...done, file: pngPath, srcW: made.srcW, srcH: made.srcH };
  }

  /** CDP 真实键盘输入：Node 侧改 value 不会触发平台的远程搜索（2026-11-17 现场）。 */
  async function cdpInsertText(win, text) {
    const dbg = win.webContents.debugger;
    try { dbg.attach('1.3'); } catch { /* 已附着 */ }
    try { await dbg.sendCommand('Input.insertText', { text: String(text) }); return true; } catch { return false; }
  }

  /**
   * 包含产品：打开抽屉 → 逐个关键词**真实输入** → 有候选就选 → 全都没有才新建。
   * 关键词顺序：品名+克重 → 品名 → 其他（用户截图实证能搜到）→ 克重。
   */
  async function assignSkuProducts(win, fact, packagingFile) {
    const opened = asJson(await win.webContents.executeJavaScript(buildOpenSkuProductScript(), true).catch(() => null));
    if (!opened) return { ok: false, reason: 'open-null' };
    if (opened.already) return { ok: true, already: true, count: opened.count };
    if (!opened.ok) return opened;
    const kws = Array.from(new Set([
      fact.grams ? `${fact.name} ${fact.grams}g` : fact.name,
      fact.name,
      '其他',
      fact.grams ? `${fact.grams}g` : '',
    ].map(v => String(v || '').trim()).filter(Boolean)));
    const tried = [];
    for (const kw of kws) {
      const focused = await win.webContents.executeJavaScript(buildFocusSkuProductSearchScript(), true).catch(() => '');
      if (focused !== 'ok') break;
      await cdpInsertText(win, kw);
      tried.push(kw);
      await sleep(1600);
      const opt = asJson(await win.webContents.executeJavaScript(buildSkuProductOptionsScript(), true).catch(() => null));
      if (!opt?.count) continue;
      const head = kw.slice(0, 4);
      const gramTag = fact.grams ? `${fact.grams}g` : '';
      const withBoth = (opt.options || []).findIndex(t => (!gramTag || t.indexOf(gramTag) >= 0 || t.indexOf(`${fact.grams}克`) >= 0) && t.indexOf(head) >= 0);
      const withName = (opt.options || []).findIndex(t => t.indexOf(head) >= 0);
      const idx = withBoth >= 0 ? withBoth : (withName >= 0 ? withName : 0);
      const picked = asJson(await win.webContents.executeJavaScript(buildPickSkuProductScript(idx), true).catch(() => null));
      if (picked?.ok) return { ...picked, keyword: kw, tried };
    }
    // 没有可用档案才新建：先填表（含单位/条码），把外包装图塞进去，再保存
    const filled = asJson(await win.webContents.executeJavaScript(buildCreateSkuProductScript(fact, 'fill'), true).catch(() => null));
    if (filled?.stage === 'filled') {
      let injected = false;
      if (filled.needPackaging) {
        if (packagingFile) {
          injected = await setFileOnInput(win, 0, [packagingFile]);
          if (injected) {
            await sleep(2600);
            await win.webContents.executeJavaScript(confirmUploadDialogScript(), true).catch(() => null);
            await sleep(1200);
          }
        }
        if (!injected) {
          return { ok: false, reason: 'need-packaging-image', keyword: tried[0] || '', tried };
        }
      }
      const saved = asJson(await win.webContents.executeJavaScript(buildSaveCreateProductScript(), true).catch(() => null));
      return { ...(saved || { ok: false, reason: 'save-null' }), keyword: tried[0] || '', tried, packaging: injected };
    }
    return { ...(filled || { ok: false, reason: 'create-null' }), keyword: tried[0] || '', tried };
  }

  /** 用 CDP 直接给 <input type=file> 塞本机文件（Electron 里唯一可靠的上传方式）。 */
  async function setFileOnInput(win, inputIndex, files) {
    const dbg = win.webContents.debugger;
    try { dbg.attach('1.3'); } catch { /* 已附着 */ }
    try {
      await dbg.sendCommand('DOM.enable');
      const doc = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      // 优先用打标记的那个框：页面里的 input 序号和 CDP 看到的（含 iframe）不一定一致
      let nodeId = 0;
      try {
        const marked = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[data-xx-upload="1"]' });
        nodeId = marked?.nodeIds?.[0] || 0;
      } catch { /* 标记查询失败就退回序号 */ }
      if (!nodeId) {
        const inputs = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
        nodeId = inputs?.nodeIds?.[inputIndex];
      }
      if (!nodeId) return { ok: false, error: `没有第 ${inputIndex + 1} 个上传输入框` };
      await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: files.slice(0, 30) });
      return { ok: true, count: files.length };
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 160) };
    }
  }

  /** 下载图片到临时目录（发布页只能吃本机文件）。 */
  async function downloadImages(urls, dir) {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const crypto = require('node:crypto');
    await fs.mkdir(dir, { recursive: true });
    const out = [];
    for (const url of urls) {
      try {
        const response = await fetch(url, { redirect: 'follow' });
        if (!response.ok) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length || buffer.length > 20 * 1024 * 1024) continue;
        const ext = /\.png(?:$|\?)/i.test(url) ? '.png' : /\.webp(?:$|\?)/i.test(url) ? '.webp' : '.jpg';
        const file = path.join(dir, `${crypto.createHash('sha1').update(buffer).digest('hex')}${ext}`);
        await fs.writeFile(file, buffer);
        out.push(file);
      } catch { /* 单张失败继续 */ }
    }
    return out;
  }

  /** 详情编辑器里的「图片」入口（老软件 [data-publish-detail-upload="1"]，点它弹素材器）。 */
  function buildOpenDetailImageEntryScript() {
    return `(function(){${NATIVE_SET}
  var root=document.getElementById('struct-descRepublicOfSell');
  if(!root)return JSON.stringify({ok:false,reason:'no-detail-component'});
  var btn=root.querySelector('[data-type="pic"]')
    ||Array.prototype.slice.call(root.querySelectorAll('div,button,span')).find(function(e){
      return !e.children.length&&String(e.textContent||'').trim()==='图片';});
  if(!btn)return JSON.stringify({ok:false,reason:'no-image-entry'});
  btn.setAttribute('data-publish-detail-upload','1');
  try{btn.scrollIntoView({block:'center'});}catch(e){}
  var r=btn.getBoundingClientRect();
  btn.click();
  return JSON.stringify({ok:true,x:r.left+r.width/2,y:r.top+r.height/2});
})()`;
  }
  /** 从素材卡按文件名前缀读回本店图片空间 URL；个别卡片缺失时保留已读到的，不整组丢弃。 */
  function buildReadNamedAssetsScript(needles) {
    return `(function(){
  var needles=${JSON.stringify(needles.map(n => String(n).replace(/\.[^.]+$/, '').slice(0, 16)))};
  var out=[],missing=[];
  function usable(im){
    var u=String(im&&(im.currentSrc||im.src)||'');
    if(!/^https?:/i.test(u))return false;
    var w=Number(im.naturalWidth||im.width||0),h=Number(im.naturalHeight||im.height||0);
    return !(w>0&&h>0&&w<40&&h<40);
  }
  for(var i=0;i<needles.length;i++){
    var needle=needles[i];
    var labels=Array.prototype.slice.call(document.querySelectorAll('span,div,p,a')).filter(function(e){
      return !e.children.length&&e.offsetParent!==null&&String(e.textContent||'').indexOf(needle)>=0;});
    var asset=null;
    for(var j=0;j<labels.length&&!asset;j++){
      var card=labels[j];
      for(var d=0;d<8&&card;d++,card=card.parentElement){
        var imgs=Array.prototype.slice.call(card.querySelectorAll('img')).filter(usable);
        if(imgs.length>6)break;
        if(imgs.length){
          asset={url:String(imgs[0].currentSrc||imgs[0].src||'').split('?')[0].replace(/_\\d+x\\d+.*$/,''),name:String(card.textContent||'').trim().slice(0,60)};
          break;
        }
      }
    }
    if(!asset||!/^https?:/i.test(asset.url)){missing.push(needle);continue;}
    out.push(asset);
  }
  return JSON.stringify({ok:missing.length===0,images:out,missing:missing.slice(0,3).join('、'),missingNeedles:missing});
})()`;
  }

  /**
   * 详情图：老软件 fillDetailImages 同款 —— 采集图（别人的 URL）必须先下载下来，
   * 上传到本店素材中心，拿回本店图片空间 URL，再交给源码导入。
   * 直接把采集 URL 写进详情会被平台判成外链/防盗链图，提交时随时被拦。
   *
   * 2026-11-18 现场修复（日志实证）：
   *   ①「上传到本店素材中心 1–16 / 16」之后马上「详情图没送进素材中心（第 3 张）」——
   *     前两张灌进去后平台把本地上传框收回去了，旧实现只在批次开头点一次「本地上传」，
   *     之后干等 12 秒找不到 input[type=file]，注入失败，于是 16 张全丢。
   *   ② 旧实现把 st==='no-items'（平台压根没回这个文件）也当成功塞进 needles，
   *     日志先「已上传」再「读不到本店地址」，看起来像平台吞图。
   * 现在：可多选就一次灌一批（每批 ≤8 张，避免单脚本过大），灌之前确保上传框在；
   * 状态只做旁证，最终以素材卡回读为准，失败原因逐张写进日志。
   */
  async function uploadDetailImages(win, urls, workDir) {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const dir = path.join(workDir, 'detail');
    try { await fs.mkdir(dir, { recursive: true }); } catch { /* */ }
    const out = [];
    const lost = [];
    let unconfirmed = 0;
    const BATCH = 20;
    const CHUNK = 8;
    for (let start = 0; start < urls.length; start += BATCH) {
      const batch = urls.slice(start, start + BATCH);
      const files = [];
      for (const source of batch) {
        const value = String(source || '').trim();
        let ready = null;
        try {
          if (value.startsWith('local:')) {
            ready = value.slice(6);
            await fs.access(ready);
          } else if (value.startsWith('selectionpool/drawing/') && dataDir && !value.includes('..')) {
            ready = pathModule.join(dataDir, ...value.split('/'));
            await fs.access(ready);
          } else if (/^https?:\/\//i.test(value)) {
            const got = await downloadImages([value], dir);
            ready = got[0] || null;
          }
        } catch { ready = null; }
        files.push(ready);
      }
      if (files.length !== batch.length || files.some(f => !f)) {
        emit(`[fill-detail] 详情图下载不完整（第 ${start + 1}–${start + batch.length} 张：${files.filter(Boolean).length}/${batch.length}），本批跳过`);
        continue;
      }
      emit(`[fill-detail] 详情图上传到本店素材中心 ${start + 1}–${start + files.length} / ${urls.length}`);
      const opened = asJson(await win.webContents.executeJavaScript(buildOpenDetailImageEntryScript(), true).catch(() => null));
      if (!opened?.ok) { emit(`[fill-detail] 找不到详情图片入口（${opened?.reason || 'unknown'}）`); break; }
      const frame = await waitMediaFrame(win, 12000);
      if (!frame) { await closeMediaPopup(win); emit('[fill-detail] 详情素材中心未打开'); break; }
      const ensureInput = async () => {
        let ready = null;
        for (let i = 0; i < 3 && !ready?.ok; i++) {
          if (i) await sleep(800);
          ready = JSON.parse((await evalFrame(frame, MEDIA_OPEN_LOCAL_SCRIPT)) || 'null');
        }
        return ready;
      };
      const waitState = async (needle, limit = 40) => {
        let st = null, blank = 0;
        for (let t = 0; t < limit; t++) {
          await sleep(700);
          const challenge = asJson(await evalFrame(frame, MEDIA_CHALLENGE_SCRIPT));
          if (challenge?.slider || challenge?.limited) return { st: 'verification-required' };
          st = JSON.parse((await evalFrame(frame, mediaUploadStateScript(needle))) || 'null');
          if (st?.st === 'uploaded' || st?.st === 'failed') return st;
          if (st?.st === 'no-items' || st?.st === 'waiting') {
            blank += 1;
            if (blank >= 8) return st;
            continue;
          }
          blank = 0;
        }
        return st;
      };
      const sendChunk = async payload => {
        let injected = JSON.parse((await evalFrame(frame, mediaInjectScript(payload), 120000)) || 'null');
        if (!injected?.ok) {
          await ensureInput();
          injected = JSON.parse((await evalFrame(frame, mediaInjectScript(payload), 120000)) || 'null');
        }
        return injected;
      };
      if (!(await ensureInput())?.ok) {
        await closeMediaPopup(win);
        emit('[fill-detail] 素材中心本地上传入口不可用，本批跳过');
        break;
      }
      const needles = [];
      for (let offset = 0; offset < files.length; offset += CHUNK) {
        const slice = files.slice(offset, offset + CHUNK);
        const payload = [];
        for (const file of slice) {
          try {
            payload.push({ name: path.basename(file), b64: (await fs.readFile(file)).toString('base64') });
          } catch {
            lost.push({ file, reason: 'read-failed' });
          }
        }
        if (!payload.length) continue;
        const injected = await sendChunk(payload);
        if (!injected?.ok) {
          emit(`[fill-detail] 详情图没送进素材中心（${payload.length} 张 · ${injected?.reason || 'no-frame-answer'}${injected?.inputs != null ? ` · 帧内文件框 ${injected.inputs} 个` : ''}）`);
          for (const row of payload) lost.push({ name: row.name, reason: injected?.reason || 'inject-failed' });
          continue;
        }
        // 多选：一次灌一批；单选（或平台只吃 files[0]）：剩下的逐张重新点「本地上传」再灌
        const first = injected.multiple === false ? payload.slice(0, 1) : payload;
        const seenStates = [];
        for (const row of first) {
          seenStates.push({ row, st: await waitState(row.name.replace(/\.[^.]+$/, '')) });
        }
        const verif = seenStates.find(x => x.st?.st === 'verification-required');
        if (verif) {
          emit('[fill-detail] ⚠ 详情图上传触发平台验证，已停止，请人工处理后重试');
          await closeMediaPopup(win);
          return { ok: false, reason: 'verification-required', urls: out, expected: urls.length, lost };
        }
        // 回读只认到 1 张、其余全是 no-items：说明这颗框其实只吃一个文件，
        // 整批的其余文件要逐张重灌，否则会被平台静默丢掉（旧版本就是这么丢 14 张的）。
        const uploadedCount = seenStates.filter(x => x.st?.st === 'uploaded').length;
        const blankCount = seenStates.filter(x => !x.st || x.st.st === 'no-items' || x.st.st === 'waiting').length;
        const singleOnly = first.length > 1 && uploadedCount <= 1 && blankCount >= first.length - 1;
        if (singleOnly) emit(`[fill-detail] 素材中心一次只收 1 张（回读 ${uploadedCount}/${first.length}），其余改为逐张上传`);
        for (const item of seenStates) {
          if (singleOnly) {
            // 这一批里真有传上去的那张要留下，其余走下面的逐张重灌
            if (item.st?.st === 'uploaded') needles.push(item.row.name.replace(/\.[^.]+$/, ''));
            continue;
          }
          if (item.st?.st === 'failed') {
            lost.push({ name: item.row.name, reason: 'platform-failed' });
            continue;
          }
          needles.push(item.row.name.replace(/\.[^.]+$/, ''));
          if (item.st?.st !== 'uploaded') unconfirmed += 1;
        }
        if (injected.multiple === false || singleOnly) {
          const uploadedNames = new Set(seenStates.filter(x => x.st?.st === 'uploaded').map(x => x.row.name));
          const rest = injected.multiple === false
            ? payload.slice(1)
            : (singleOnly ? first.filter(row => !uploadedNames.has(row.name)) : []);
          for (const row of rest) {
            const needle = row.name.replace(/\.[^.]+$/, '');
            let st = null;
            for (let attempt = 0; attempt < 2 && st?.st !== 'uploaded'; attempt++) {
              await ensureInput();
              const again = await sendChunk([row]);
              if (!again?.ok) { st = { st: again?.reason || 'inject-failed' }; continue; }
              st = await waitState(needle);
            }
            if (st?.st === 'verification-required') {
              emit('[fill-detail] ⚠ 详情图上传触发平台验证，已停止，请人工处理后重试');
              await closeMediaPopup(win);
              return { ok: false, reason: 'verification-required', urls: out, expected: urls.length, lost };
            }
            if (st?.st === 'failed') {
              lost.push({ name: row.name, reason: st?.st || 'not-accepted' });
              emit(`[fill-detail] 详情图未被素材中心接收：${row.name.slice(0, 16)}…（${st?.st || 'unknown'}）`);
              continue;
            }
            needles.push(needle);
            if (st?.st !== 'uploaded') unconfirmed += 1;
          }
        }
      }
      if (!needles.length) {
        const toast = asJson(await win.webContents.executeJavaScript(READ_TOAST_SCRIPT, true).catch(() => null));
        emit(`[fill-detail] 本批一张都没进素材中心${Array.isArray(toast) && toast.length ? ` · 平台提示：${toast.join(' / ').slice(0, 120)}` : ''}`);
        await closeMediaPopup(win);
        break;
      }
      // 详情图只需要“上传到本店素材库并拿地址”，不能逐张点卡片：实时素材器点第一张就可能关抽屉，
      // 后面的卡片随之消失。先按 needles 顺序读地址；个别缺失只补那一张，已读到的继续导入。
      const fileByNeedle = new Map(files.map(file => [path.basename(file).slice(0, 16), file]));
      const finishMedia = async () => {
        for (let i = 0; i < 2; i++) {
          const fin = JSON.parse((await evalFrame(frame, MEDIA_FINISH_SCRIPT)) || 'null');
          if (!fin?.clicked) break;
          await sleep(1000);
        }
      };
      await finishMedia();
      const readAssets = async (limit = 10) => {
        let got = null;
        for (let t = 0; t < limit; t++) {
          got = JSON.parse((await evalFrame(frame, buildReadNamedAssetsScript(needles))) || 'null');
          if (got?.ok || got?.images?.length) break;
          await sleep(600);
        }
        return got;
      };
      let assets = await readAssets(12);
      const missingAssets = Array.isArray(assets?.missingNeedles) ? assets.missingNeedles.slice() : [];
      if (missingAssets.length && (assets.images?.length || 0) + missingAssets.length === needles.length) {
        emit(`[fill-detail] 详情图有 ${missingAssets.length} 张没出现在素材列表，逐张补传：${missingAssets.slice(0, 3).join('、')}`);
        let retried = 0;
        for (const short of missingAssets) {
          const file = fileByNeedle.get(short);
          if (!file) continue;
          try {
            const row = { name: path.basename(file), b64: (await fs.readFile(file)).toString('base64') };
            await ensureInput();
            const again = await sendChunk([row]);
            if (!again?.ok) continue;
            const st = await waitState(short, 20);
            if (st?.st === 'verification-required') {
              emit('[fill-detail] ⚠ 详情图补传触发平台验证，已停止读取');
              break;
            }
            if (st?.st === 'uploaded' || st?.st === 'no-items' || st?.st === 'waiting') retried += 1;
          } catch { /* 单张补传失败，已读到的详情图照常导入 */ }
        }
        if (retried) {
          await finishMedia();
          assets = await readAssets(12);
        }
      }
      const gotUrls = (assets?.images || []).map(i => normalizeMaterialUrl(i.url)).filter(Boolean);
      if (gotUrls.length) out.push(...gotUrls);
      if (assets?.ok) {
        emit(`[fill-detail] 本批 ${gotUrls.length} 张已读回本店图片空间地址`);
      } else if (gotUrls.length) {
        emit(`[fill-detail] 本批只读回 ${gotUrls.length}/${needles.length} 张本店地址，先导入已读到的，缺 ${assets?.missing || '未知'}`);
      } else {
        const toast = asJson(await win.webContents.executeJavaScript(READ_TOAST_SCRIPT, true).catch(() => null));
        emit(`[fill-detail] 本批详情图没能从素材中心读回本店地址（${needles.slice(0, 3).join('、')}${needles.length > 3 ? ` 等 ${needles.length} 张` : ''}${assets?.missing ? ` · 缺 ${String(assets.missing).slice(0, 48)}` : ''}${Array.isArray(toast) && toast.length ? ` · 平台提示：${toast.join(' / ').slice(0, 120)}` : ''}）`);
      }
      await closeMediaPopup(win);
      await sleep(400);
    }
    if (unconfirmed) emit(`[fill-detail] 详情图有 ${unconfirmed} 张没等到平台「上传完成」状态，以素材卡回读为准`);
    if (lost.length) emit(`[fill-detail] 详情图丢失 ${lost.length} 张（${Array.from(new Set(lost.map(x => x.reason))).slice(0, 3).join(' / ')}）`);
    return { ok: out.length === urls.length && out.length > 0, urls: out, expected: urls.length, lost };
  }

  async function publish(input = {}) {
    activeLog = typeof input.log === 'function' ? input.log : null;
    let win = null;
    /** 屏幕上只允许存在一个发布页窗口：关掉其它，保留 keep（用户 2026-11-12）。 */
    const closeOtherPublishWindows = keep => {
      try {
        for (const other of BrowserWindow.getAllWindows()) {
          if (!other || other === keep || other.isDestroyed?.()) continue;
          const current = (() => { try { return String(other.webContents.getURL() || ''); } catch { return ''; } })();
          if (/sell\.publish\.tmall\.com|sell\.tmall\.com\/.*publish|\/publish\.htm/i.test(current)) {
            try { other.destroy(); } catch { /* */ }
          }
        }
      } catch { /* */ }
    };
    /** 必填类错误优先展示，别让「标题过长可能折叠」这种静态提示盖住真正的拦路项。 */
    const rankErrors = arr => (Array.isArray(arr) ? arr.slice() : []).sort((a, b) => {
      const wa = /必填|不能为空|未填|缺失|填写错误|未选择|未上传|不能超过|字符|校验失败|请填写/.test(String(a)) ? 0 : 1;
      const wb = /必填|不能为空|未填|缺失|填写错误|未选择|未上传|不能超过|字符|校验失败|请填写/.test(String(b)) ? 0 : 1;
      return wa - wb;
    });
    const transparentIssue = pre => Boolean(pre && (
      pre.whiteBgMissing
      || pre.whiteBgVerified !== true
      || (Array.isArray(pre.blockers) && pre.blockers.some(line => /透明素材图/.test(String(line))))
    ));
    /** 老软件实证：Magix 下拉 / 单选的 DOM click 经常不生效，必要时用 CDP 真实鼠标点一下。 */
    const cdpClick = async (x, y) => {
      try {
        const dbg = win.webContents.debugger;
        try { dbg.attach('1.3'); } catch { /* 已附着 */ }
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        return true;
      } catch { return false; }
    };
    /**
     * 是否为样品：只有「页面明确读到样品已选中」才去点正装，而且每次都用当次刚测的坐标，
     * 最多点 2 轮。页面默认正装时一下都不点 —— 2026-11-19 现场：多点一下就把正装点成了样品。
     * 返回最后一次回读结果（sample/sampleOk/uiKnown/points…）。
     */
    const ensureRegularSample = async () => {
      const read = async () => asJson(await win.webContents.executeJavaScript(readSampleScript(), true).catch(() => null));
      let cur = await read();
      for (let round = 0; round < 2 && String(cur?.sample || '') === '样品'; round++) {
        const pts = []
          .concat(cur?.points || [], [cur?.regularPoint])
          .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && String(p.text || '') !== '样品');
        const seen = new Set();
        for (const pt of pts) {
          const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (seen.size > 2) break;
          if (await cdpClick(pt.x, pt.y)) await sleep(700);
          cur = await read();
          if (String(cur?.sample || '') !== '样品') return cur;
        }
        cur = await read();
      }
      return cur;
    };
    /** 「选择类目」弹窗收尾：DOM 点过确定还开着，就用 CDP 真实坐标强点（老软件 STALE disabled 实证），
     *  再用 × 兜底。返回是否真的关掉 —— 不关掉就明确报，绝不假装已确认。 */
    const settleCategoryDialog = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const st = asJson(await win.webContents.executeJavaScript(readCategoryDialogScript(), true).catch(() => null));
        if (!st?.open) return { closed: true, rounds: attempt };
        if (st.confirmPoint && Number.isFinite(st.confirmPoint.x) && Number.isFinite(st.confirmPoint.y)) {
          await cdpClick(st.confirmPoint.x, st.confirmPoint.y);
          await sleep(800);
        }
        const cd = asJson(await win.webContents.executeJavaScript(closeCategoryDialogScript(), true).catch(() => null));
        if (cd?.closed) return { closed: true, rounds: attempt + 1, via: cd.via || 'confirm' };
      }
      return { closed: false };
    };
    /** 上架失败 / 需要人工时统一出口（日志14）：先把「选择类目」弹窗关掉并常驻抑制，
     *  再把发布窗口亮出来。否则平台提交校验弹出的弹窗会盖住整张发布页，人没法手动补图。
     *  guard 是幂等的：重复调用只是复用已有监听器，不会叠加定时器。 */
    const leaveWindowForManual = async tag => {
      let guard = null;
      try {
        const g = await evalJs(win, suppressCategoryDialogScript(), 6000);
        guard = typeof g === 'string' ? JSON.parse(g || 'null') : g;
      } catch { /* 窗口可能已被销毁，仍要把窗口亮出来 */ }
      emit(`[dialog-guard] ${tag}：已关闭「选择类目」弹窗并持续抑制 · 发布窗口可直接手动填写`
        + (guard?.closed || guard?.hidden ? `（× ${guard.closed || 0} 次 · 强制隐藏 ${guard.hidden || 0} 次）` : ''));
      closeOtherPublishWindows(win);
      try { win.show(); } catch { /* */ }
    };
    try {
      // 每次上架重新开始：清掉上一次的停止标记，并记录「当前步骤」，
      // 停止/看门狗/超时都靠它告诉用户卡在哪里。
      // 注意：清标记前先看本次是否已经被要求停止（停止按钮可能正好卡在建窗口那一下）。
      const stopAsked = typeof input.shouldStop === 'function' && input.shouldStop() === true;
      cancelState = { stopped: stopAsked, reason: stopAsked ? '已手动停止' : '' };
      activeStep = '准备上架';
      const step = label => {
        activeStep = String(label || '');
        if (cancelState.stopped) throw Object.assign(new Error(cancelState.reason || '已停止上架'), { code: 'STOPPED' });
        if (typeof input.shouldStop === 'function' && input.shouldStop()) {
          cancelState.stopped = true;
          cancelState.reason = '已手动停止';
          throw Object.assign(new Error('已手动停止'), { code: 'STOPPED' });
        }
        emit(`[step] ${activeStep}`);
        void drainPageDialogs(win);
      };
      const storeId = String(input.storeId || '');
      if (!storeId) throw Object.assign(new Error('缺少上架目标店铺'), { code: 'NO_SHOP' });
      // 店铺中分类：本次页面读到的真实选项（上架后回写给设置页，下次不用再开窗口）
      let shopCategoryState = null;
      const categoryId = String(input.categoryId || '').trim();
      if (!/^\d+$/.test(categoryId)) throw Object.assign(new Error('缺少上架类目 ID'), { code: 'MISSING_CATEGORY' });
      const detail = input.detail || {};
      const draft = input.draft || null;
      const listing = detail.listing || {};
      const title = String(draft?.title || detail.product?.title || '').trim().slice(0, 60);
      if (!title) throw Object.assign(new Error('该选品缺少标题'), { code: 'INVALID_ITEM' });
      const workDir = require('node:path').join(input.tempDir || require('node:os').tmpdir(), 'xx-publish', String(detail.itemId || Date.now()));

      const url = new URL(`${PUBLISH_HOST}/tmall/publish.htm`);
      url.searchParams.set('catId', categoryId);
      url.searchParams.set('fromAICategory', 'true');
      url.searchParams.set('fromAIPublish', 'true');
      url.searchParams.set('newRouter', '1');

      emit(`打开发布页 catId=${categoryId} 直达 fastpath`);
      // 只留一个发布窗口：先关掉工作台里已经打开的发布页窗口，再建本次驱动的窗口
      // （用户 2026-11-12「还是会弹出两个窗口让我填写」）。
      closeOtherPublishWindows(null);
      win = new BrowserWindow({
        show: false, width: 1500, height: 1000,
        webPreferences: {
          partition: partitionForStore ? partitionForStore(storeId) : undefined,
          contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
        },
      });
      // 发布页挂了 beforeunload「未保存修改」拦截：点提交跳 success.htm 时会被它拦回原页，
      // 表现就是「点完提交没有任何跳转、等 60 秒报没收到入仓回执」，人再点一次提交却能成功
      // （2026-11-19 现场：停留现场里提交按钮仍是「提交」、href 没变）。
      // 老软件 runFormCapturePublish 一开始就 preventDefault 放行；这里同样从窗口建立起就允许离开。
      try { win.webContents.on('will-prevent-unload', event => { try { event.preventDefault(); } catch { /* */ } }); } catch { /* */ }
      // 发布页会挂 beforeunload 拦关闭；点 × 必须能关（用户 2026-11-12：有一个窗口关不掉）
      {
        let forceClosing = false;
        win.on('close', event => {
          if (forceClosing) return;
          forceClosing = true;
          try { event.preventDefault(); } catch { /* */ }
          setTimeout(() => { try { win.destroy(); } catch { /* */ } }, 30);
        });
      }
      // 文件选择框拦截必须在页面开始加载前装好：素材中心的 input 在跨域 iframe 里，
      // 事后在主 session 上补拦截挡不住 iframe 的 chooser，会弹 Windows 原生「打开」框。
      fileChooserGuard = installFileChooserGuard(win);
      // 页面 JS 弹窗（alert/confirm）会阻塞渲染进程 → 所有 executeJavaScript 永不返回。
      // 主框架、已有子框架、后续新建的框架都装上自动确认守卫（素材中心就在跨域 iframe 里）。
      {
        activePublishWindow = win;
        activeStep = '打开发布页';
        const injectDialogGuard = target => {
          try { target.executeJavaScript(PAGE_DIALOG_GUARD_SCRIPT, true).catch(() => undefined); } catch { /* 帧已销毁 */ }
        };
        const injectAllFrames = () => {
          try { injectDialogGuard(win.webContents); } catch { /* */ }
          try {
            for (const frame of (win.webContents.mainFrame?.framesInSubtree || [])) {
              if (frame && frame !== win.webContents.mainFrame) injectDialogGuard(frame);
            }
          } catch { /* */ }
        };
        win.webContents.on('dom-ready', injectAllFrames);
        try {
          win.webContents.on('frame-created', (_event, details) => {
            const frame = details?.frame;
            if (!frame) return;
            frame.on('dom-ready', () => injectDialogGuard(frame));
          });
        } catch { /* 旧版本 Electron 没有 frame-created */ }
      }
      await fileChooserGuard.install();
      emit('[open] 文件选择框拦截已就绪，开始加载发布页');

      await Promise.race([win.loadURL(url.toString()), sleep(45000).then(() => { throw new Error('发布页打开超时'); })]);
      step('等待发布页渲染');

      // 等表单真正渲染完：标题先出来，属性/SKU/图片模块是异步挂载的。
      // 老软件日志里的「直达发布页就绪 itemProp.ds=10 keyProp.ds=1 (+5.5s)」就是在等这个。
      // 用户 2026-11-12：只等标题就开填 → 属性 0/20、SKU 0/10、主图回读 0 张。
      let probe = null;
      let stable = 0;
      let lastItems = -1;
      const started = Date.now();
      let waitTick = 0;
      while (Date.now() - started < 90000) {
        await sleep(1200);
        probe = await win.webContents.executeJavaScript(probeScript(), true).catch(() => null);
        // 每 ~6 秒打一次心跳，避免页面慢时日志看起来「卡死不动」
        if (++waitTick % 5 === 0) {
          emit(`[open] 发布页加载中 ${Math.round((Date.now() - started) / 1000)}s · 表单项 ${Number(probe?.formItems) || 0} · 输入框 ${Number(probe?.inputs) || 0} · ready=${probe?.ready ? 'yes' : 'no'}`);
        }
        if (probe && (probe.login || probe.blocked || probe.denied)) break;
        const items = Number(probe?.formItems) || 0;
        // 新版发布页没有 .next-form-item，字段是 .sell-component-info-wrapper-wrap，
        // 所以「渲染完成」按「可见输入框数量」判断（之前按表单项判断 → 一直为 0，白等 90 秒）。
        const fields = Number(probe?.inputs) || items;
        if (probe?.ready && probe?.hasTitle && fields >= 6) {
          if (fields === lastItems) stable += 1; else stable = 0;
          lastItems = fields;
          if (stable >= 1) break;   // 连续两次字段数量一致，认为渲染完成
        } else if (probe?.ready && probe?.hasTitle) {
          lastItems = fields;
        }
      }
      if (!probe) throw Object.assign(new Error('发布页没有响应'), { code: 'PAGE_MISMATCH' });
      if (probe.login) throw Object.assign(new Error('店铺登录已失效，请先在客户端登录该店'), { code: 'LOGIN' });
      if (probe.blocked) throw Object.assign(new Error('平台要求安全验证，请在发布窗口完成验证后重试'), { code: 'NEEDS_MANUAL_VERIFICATION' });
      if (probe.denied) throw Object.assign(new Error('该店铺没有这个类目的发布权限'), { code: 'CATEGORY_NOT_AUTHORIZED' });
      if (!probe.ready) throw Object.assign(new Error('发布页未就绪（标题输入框与提交按钮都没出现）'), { code: 'PAGE_MISMATCH' });
      emit(`发布页就绪（${Math.round((Date.now() - started) / 1000)}s）engine=${probe.engine ? 'yes' : 'no'} 表单项=${Number(probe.formItems) || 0} 输入框=${Number(probe.inputs) || 0} 上传框=${Number(probe.fileInputs) || 0}`);
      if ((Number(probe.formItems) || 0) < 6) emit('⚠ 表单项偏少，属性/SKU 模块可能还没挂出来，后面的未命中属于页面没渲染完');
      // 真实控件结构快照：日志12「系列找到 0 个输入框」说明定位假设有误，
      // 无条件先记一份，后续任何一步失败都能对照真实 id/name/readonly 修，不用再靠截图猜。
      {
        const diag = await win.webContents.executeJavaScript(fieldDiagnosticsScript(), true).catch(() => null);
        if (diag) emit(`[field-diagnostic] ${String(diag).slice(0, 3000)}`);
      }

      step('填写品牌与系列');
      // ① 品牌 + 系列必须「一起」写：老软件 P6 fastpath（navigation.js:2019-2106）实证，
      //    p-20000 和 p-20000~1 是同一个 keyProp，同一次 engine.updateModels 原生写入。
      //    采集来的竞品品牌（燕山神）不该写进自己店铺；用页面「授权品牌列表」里的第一个（腾味莱）。
      const brand = String(draft?.brand || '').trim();
      let pickedBrand = '';
      let seriesMain = '', seriesFallback = '';
      {
        // series 留空：脚本内已拿到页面授权品牌文本，由它拼「品牌+时间戳」，避免用到竞品品牌
        let r = asJson(await win.webContents.executeJavaScript(selectBrandFirstScript(brand), true).catch(() => null));
        // 弹窗里品牌下拉还是「请选择」→ 用真实鼠标点授权品牌选项（老软件 navigation.js:1281）
        if (r?.dialogPresent && !r?.uiPicked && r?.clickPoint && Number.isFinite(r.clickPoint.x) && Number.isFinite(r.clickPoint.y)) {
          await cdpClick(r.clickPoint.x, r.clickPoint.y);
          await sleep(800);
          const dg = asJson(await win.webContents.executeJavaScript(readCategoryDialogScript(), true).catch(() => null));
          if (dg?.brandText && !/请选择|没找到对应品牌/.test(dg.brandText)) {
            r = { ...r, uiPicked: true, ok: true, picked: dg.brandText, via: '真实鼠标/弹窗品牌选项' };
          }
        }
        // 老软件 P5-brand-info-content-ui：DOM click 不稳，回读没选上就用真实鼠标再点一次
        if (!r?.ok && r?.clickPoint && Number.isFinite(r.clickPoint.x) && Number.isFinite(r.clickPoint.y)) {
          const clicked = await cdpClick(r.clickPoint.x, r.clickPoint.y);
          if (clicked) {
            await sleep(700);
            const rr = asJson(await win.webContents.executeJavaScript(readBrandScript(), true).catch(() => null));
            if (rr?.ok) r = { ...r, ok: true, picked: rr.text || r.clickPoint.text, via: `真实鼠标/${rr.via}` };
          }
        }
        // 弹窗收尾：即使确定按钮 STALE disabled，也用 CDP 真实坐标强点；关不掉就如实报
        if (r?.dialogPresent) {
          const settled = await settleCategoryDialog();
          emit(settled.closed
            ? `[fill-brand] 「选择类目」弹窗已确认关闭（${settled.via || '确定'}）`
            : '[fill-brand] ⚠ 「选择类目」弹窗仍未关闭，提交前会再试（弹窗会挡住提交按钮）');
        }
        pickedBrand = String(r?.picked || r?.auth || '').trim();
        // 脚本内部拼「授权品牌+时间戳」；若品牌脚本整体失败，用纯时间戳兜底，保证系列仍有值
        seriesMain = String(r?.series || '').trim() || `商品${Date.now()}`;
        seriesFallback = (seriesMain.match(/\d{13}$/) || [String(Date.now())])[0];
        emit(`[fill-series] 系列「${seriesMain}」已与品牌同一次 keyProp 原生写入 · keyProp 回读${r?.seriesOk ? '一致' : '不一致（' + String(r?.seriesReadback || '空') + '）'} · itemProp 镜像${r?.seriesEngineWrite ? '已写' : '未写'} · DOM nudge ${r?.seriesNudge || '无'}`);
        if (r?.ok) {
          emit(`[fill-brand] 品牌：已选中「${pickedBrand}」${r.uiPicked ? '（弹窗 UI 真实选中）' : '（引擎原生写入）'}${r.engineWrite ? ' · keyProp 同步' : ''}${r.auth ? ` · 授权项 ${r.auth}` : ''}`);
          // 老软件：选品牌会触发 schema 重置，字段会短暂归 0，必须重新等表单渲染完再填
          await sleep(1200);
          for (let t = 0; t < 8; t++) {
            const p2 = await win.webContents.executeJavaScript(probeScript(), true).catch(() => null);
            if (p2?.ready && p2?.hasTitle && (Number(p2.inputs) || 0) >= 6) break;
            await sleep(600);
          }
        } else {
          emit(`[fill-brand] 品牌：⚠ 未能在 UI 里确认（${r?.reason || 'unknown'}）· 授权项 ${r?.auth || '无'}（${r?.authCount ?? 0} 个）· 引擎写入 ${r?.engineWrite ? '是' : '否'} · 下拉可见项 ${(r?.options || []).join('、') || '无'}`);
        }
      }

      // ② 系列：老软件 P6 实证——系列不是普通 DOM 表单字段，而是与品牌同一个 keyProp 的引擎原生值。
      //    ① 已同一次 updateModels 写入；但选品牌会触发 schema 重置，这里在表单稳定后补写一次并回读，
      //    只有引擎回读不一致才退到 DOM 兜底（日志13 的 0/42 就是把它当普通输入框找，找到 0 个）。
      {
        const wr = asJson(await win.webContents.executeJavaScript(writeBrandSeriesScript(seriesMain), true).catch(() => null));
        emit(wr?.ok
          ? `[fill-series] 系列：引擎回读一致「${wr.readback}」· 品牌+系列同一次 keyProp 写入（${(wr.steps || []).join('+')}）· 品牌 ${wr.brand ? String(wr.brand.text || '') : '未变'}`
          : `[fill-series] 系列：⚠ 引擎回读不一致（${wr?.reason || 'unknown'} · 回读 ${wr?.readback || '空'}）`);
        if (!wr?.ok) {
          const r = await (async () => {
            let first = asJson(await win.webContents.executeJavaScript(fillSeriesScript(seriesMain, seriesFallback), true).catch(() => null));
            // 灰色 readonly 展示框：DOM click 常被拦，用 CDP 真实鼠标点开平台自带的编辑层，再填一次
            if (!first?.ok && Array.isArray(first?.lockedPoints) && first.lockedPoints.length) {
              for (const pt of first.lockedPoints.slice(0, 2)) {
                if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
                await cdpClick(pt.x, pt.y);
                await sleep(500);
              }
              first = asJson(await win.webContents.executeJavaScript(fillSeriesScript(seriesMain, seriesFallback), true).catch(() => null));
            }
            return first;
          })();
          emit(r?.ok
            ? `[fill-series] 系列：DOM 兜底写入成功「${r.value}」· ${r.found} 个控件 · ${(r.via || []).join('+')}`
            : `[fill-series] 系列：⚠ DOM 兜底也未写入（${r?.reason || 'unknown'} · 找到 ${r?.found || 0} 个控件）`);
          if (!r?.ok) {
            const diag = await win.webContents.executeJavaScript(fieldDiagnosticsScript(), true).catch(() => null);
            let brief = String(diag || '诊断脚本无返回');
            try {
              const o = JSON.parse(brief);
              brief = JSON.stringify({ series: o.fields && o.fields['系列'], keyControls: (o.keyControls || []).slice(0, 8) });
            } catch { /* 保持原文 */ }
            emit(`[field-diagnostic] 系列未写入时的真实控件结构：${brief.slice(0, 1400)}`);
          }
        }
      }

      step('填写商品标题与导购标题');
      // ③ 标题（商品标题 30 汉字/60 字符；导购标题 10–15 汉字 = 20–30 字符，汉字算 2）
      const rawTitle = String(title || '');
      const safeTitle = [...rawTitle].slice(0, 30).join('');
      const promoTitle = [...rawTitle].slice(0, 15).join('');
      const sellPoint = [...rawTitle].slice(0, 16).join('');
      const titleRes = asJson(await win.webContents.executeJavaScript(fillTitleScript(safeTitle), true).catch(() => null));
      emit(`[fill-title] 标题：${titleRes?.ok ? '已填入并回读一致' : '回读不一致，继续后续步骤'}（${String(titleRes?.read || '').slice(0, 30)}）`);
      {
        // 两个 tab 各有一份导购标题输入框，必须全部写入并逐个回读（截图 2 合规 / 截图 4 仍 32/30）
        const tr = asJson(await win.webContents.executeJavaScript(fillTitlesAllScript(promoTitle, sellPoint), true).catch(() => null));
        emit(`[fill-title] 导购标题：${tr?.ok
          ? `已写入 ${tr.guide?.found || 0} 个实例并逐个回读一致（${promoTitle.length} 汉字 / 30 字符）`
          : `⚠ 回读不一致（${(tr?.guide?.after || []).join('|') || '空'}）`}；商品卖点 ${tr?.sell?.found || 0} 个实例${tr?.sell?.allOk ? '已回读' : '未全部写入'}`);
        if (tr?.errors?.length) emit(`[fill-title] 页面校验提示：${rankErrors(tr.errors).slice(0, 3).join(' / ')}`);
      }

      step('填写属性');
      // ③ 属性 + 组件填充：一次走 fillFormScript（纯文本 / next-select / 单选多选 都能落）
      const skusForBase = (Array.isArray(draft?.skus) ? draft.skus : Array.isArray(listing.skus) ? listing.skus : [])
        .filter(s => s && s.name && !s.removed);
      const attrs = [
        ...(Array.isArray(draft?.attrs) ? draft.attrs : []),
        ...(Array.isArray(listing.attributes) ? listing.attributes : []),
      ].filter((a, i, all) => a && a.name && a.value
        && !/^(?:品牌|品牌名称|brand|商标)$/i.test(String(a.name).trim())
        && all.findIndex(x => x && x.name === a.name) === i);
      const formPairs = [
        ...attrs,
        // 单 SKU 维度的必填：一口价/商品数量/商家编码（新版页面就这几项是纯文本必填）
        ...(skusForBase.length ? [
          { name: '一口价', value: String(skusForBase[0].price || '').replace(/[^\d.]/g, '') },
          { name: '商品数量', value: '1000' },
        ].filter(x => x.value) : []),
        ...(Array.isArray(input.hints) ? input.hints.map(h => ({ name: h.name, value: h.value })) : []),
      ].filter((a, i, all) => a && a.name && a.value && all.findIndex(x => x && x.name === a.name) === i);
      if (formPairs.length) {
        const r = asJson(await win.webContents.executeJavaScript(fillFormScript(formPairs), true).catch(() => null));
        const kinds = r?.kinds || {};
        emit(`[fill-attrs] 填充属性：命中 ${r?.filled?.length || 0}/${formPairs.length}（文本 ${kinds.input || 0} · 下拉 ${kinds.select || 0} · 单选/多选 ${kinds.choice || 0}）${r?.missed?.length ? '，未命中 ' + r.missed.slice(0, 5).join('、') : ''}`);
      } else {
        emit('[fill-attrs] 草稿里没有参数，跳过');
      }
      const provinceCandidates = provinceCandidatesFor(draft, detail, input.hints);
      {
        const pv = await ensureProvince(win, provinceCandidates);
        if (!pv?.skipped) {
          if (pv?.ok && pv.already) emit(`[fill-province] 省份：页面已选「${pv.picked}」`);
          else if (pv?.ok && pv.usedFallback) emit(`[fill-province] 省份：${provinceCandidates.length ? `未匹配到「${provinceCandidates[0]}」` : '采集参数无省份'}，已选择下拉框「${pv.picked || '其他'}」`);
          else if (pv?.ok) emit(`[fill-province] 省份：已选择「${pv.picked}」`);
          else emit(`[fill-province] ⚠ 省份未选上（${pv?.reason || 'unknown'}），提交前会再补选`);
        }
      }

      step('填写保质期');
      // ④ 保质期：按采集值填「数字 + 单位」。通用填充只写数字，单位会停在「请选择单位」，
      // 而 React 受控数字框还会把直接赋值回退成空 —— 这里单独用真实输入 + 回读处理。
      {
        const shelfCandidates = [
          ...(Array.isArray(draft?.attrs) ? draft.attrs : []),
          ...(Array.isArray(detail?.attributes) ? detail.attributes : []),
          ...(Array.isArray(detail?.listing?.attributes) ? detail.listing.attributes : []),
          ...(Array.isArray(detail?.snapshot?.attributes) ? detail.snapshot.attributes : []),
          ...(Array.isArray(input.hints) ? input.hints : []),
        ];
        const shelfRaw = String((shelfCandidates.find(a => a && /^保质期|shelf.?life/i.test(String(a.name || '')) && String(a.value || '').trim()) || {}).value || '').trim();
        if (shelfRaw) {
          const sr = asJson(await win.webContents.executeJavaScript(fillShelfLifeScript(shelfRaw), true).catch(() => null));
          emit(sr?.ok
            ? `[fill-shelf] 保质期：按采集值「${shelfRaw}」已写入（数字 ${sr.num} · 单位 ${sr.unit || '页面自带'}），回读一致`
            : `[fill-shelf] 保质期：采集值「${shelfRaw}」未写全（数字 ${sr?.num || '空'} · 单位 ${sr?.unit || '空'} · ${sr?.reason || 'unknown'}），请在发布页手动补`);
          // 食品安全 tab 里还有一格独立的「保质期」（老软件 #struct-foodPeriod / foodPeriod）。
          // 截图 3 里它空着并报「保质期是必填项，不能为空」，用同一个采集值补上（单位页面固定为天）。
          const food = asJson(await win.webContents.executeJavaScript(fillFoodSafetyScript(shelfRaw), true).catch(() => null));
          emit(food?.ok
            ? `[fill-food] 食品安全保质期：按采集值写入 ${food.num} 天（${(food.via || []).join('+')} · 找到 ${food.rows} 个输入框）`
            : `[fill-food] 食品安全保质期：未写入（找到 ${food?.rows ?? 0} 个输入框 · ${food?.reason || 'unknown'}），请手动补`);
        } else {
          emit('[fill-shelf] 保质期：采集参数里没有保质期，跳过');
        }
      }

      step('创建规格');
      // ⑤ SKU：新版发布页的 SKU 表要先「创建规格」才会出现行
      const skuProps = (Array.isArray(detail?.skuProperties) ? detail.skuProperties : [])
        .filter(p => p && p.pname && Array.isArray(p.values) && p.values.length);
      const specNames = (Array.isArray(draft?.skus) ? draft.skus : []).filter(s => s && s.name && !s.removed).map(s => s.name);
      {
        // 先试「页面已有规格值 → 选中」；页面没有就「创建规格」把 27 个值建出来
        const sel = asJson(await win.webContents.executeJavaScript(selectSkuSpecsScript(skuProps), true).catch(() => null));
        if (sel?.count) {
          emit(`[fill-sku] 规格值：已选 ${sel.count} 个（${sel.clicked.slice(0, 3).join('、')}…）`);
        } else {
          const pname = skuProps[0]?.pname || '商品规格';
          const values = (skuProps[0]?.values || []).map(v => v.vname).filter(Boolean);
          const targets = (values.length ? values : specNames).slice(0, 60);
          // 1) 打开抽屉 + 选「单层展示」
          const opened = asJson(await win.webContents.executeJavaScript(openSpecDrawerScript(), true).catch(() => null));
          if (!opened?.ok) {
            emit(`[fill-sku] 创建规格：未打开（${opened?.reason || 'unknown'}）`);
          } else if (opened.reason === 'already') {
            emit(`[fill-sku] 创建规格：页面已有 ${opened.rows} 行 SKU，跳过创建`);
          } else {
            // 2) 一行一个输入框 + 底部「+」按钮：填一个、点一次 +，直到全部填完
            const filledRes = asJson(await win.webContents.executeJavaScript(fillSpecValuesScript(targets), true).catch(() => null));
            const done = asJson(await win.webContents.executeJavaScript(confirmSpecDrawerScript(), true).catch(() => null));
            emit(`[fill-sku] 创建规格「${pname}」：填写 ${filledRes?.filled || 0}/${targets.length} 个值（输入框 ${filledRes?.rows || 0} 个）→ ${done?.ok ? `成功，SKU 行 ${done.rows} 条（抽屉识别 ${done.chips} 个值）` : `未成功（${done?.reason || 'rows'}；抽屉识别 ${done?.chips ?? '?'} 个值）`}`);
          }
        }
        await sleep(1500);
      }
      step('填写 SKU 价格与库存');
      // ⑥ SKU（价格 / 库存 / 商家编码）
      const skus = skusForBase;
      if (skus.length) {
        const r = asJson(await win.webContents.executeJavaScript(fillSkuScript(skus), true).catch(() => null));
        emit(`[fill-sku] 填充 SKU ${r?.done || 0}/${r?.total || skus.length} 条${r?.missed?.length ? '，未命中 ' + r.missed.slice(0, 3).join('、') : ''}${r?.gaps?.length ? `；必填缺口 ${r.gaps.slice(0, 4).join('、')}` : ''}`);
        if (!r?.done) emit('[fill-sku] 提示：SKU 行还没生成，可在发布窗口手动点「创建规格」后重试');
      } else {
        emit('[fill-sku] 草稿与采集都没有规格，跳过');
      }

      step('必填项兜底');
      // ⑥ 必填兜底：用「服务端提议（参数/标题推算/类目默认/记忆）+ 本地推导」
      let remainingGaps = [];
      let requiredFilled = [];
      {
        const hints = Array.isArray(input.hints) && input.hints.length ? input.hints : requiredHints(draft, detail);
        const r5 = asJson(await win.webContents.executeJavaScript(fillRequiredGapsScript(hints), true).catch(() => null));
        remainingGaps = Array.isArray(r5?.gaps) ? r5.gaps : [];
        requiredFilled = Array.isArray(r5?.filled) ? r5.filled : [];
        const sourceNote = Array.isArray(input.hints) && input.hints.length
          ? `（${[...new Set(input.hints.map(h => h.source).filter(Boolean))].join('/')}）`
          : '';
        emit(`[fill-required] 必填兜底${sourceNote}：补填 ${requiredFilled.length} 项${requiredFilled.length ? `（${requiredFilled.slice(0, 6).join('、')}）` : ''}${remainingGaps.length ? `；仍缺 ${remainingGaps.slice(0, 6).join('、')}` : '；没有必填缺口'}`);
      }

      step('填写物流与发货地');
      // ⑦ 物流 / 发货地（用组件感知填充，级联/下拉也能写）
      const logistics = [];
      if (Array.isArray(draft?.logistics)) logistics.push(...draft.logistics);
      if (draft?.deliveryFrom || detail.shipping?.from) logistics.push({ name: '发货地', value: String(draft?.deliveryFrom || detail.shipping?.from).slice(0, 40) });
      if (draft?.deliveryMethod) logistics.push({ name: '提取方式', value: String(draft.deliveryMethod).slice(0, 20) });
      if (logistics.length) {
        const r = asJson(await win.webContents.executeJavaScript(fillFormScript(logistics), true).catch(() => null));
        emit(`[fill-logistics] 物流必填项核对 ${r?.filled?.length ? `已填 ${r.filled.join('、')}` : '未命中字段'}${r?.missed?.length ? `，未命中 ${r.missed.join('、')}` : ''}`);
      }

      step('填写店铺中分类');
      // ⑧ 店铺中分类（卖家自定义分类，可多选）：按「上架设置」里为该店铺保存的分类勾选。
      // 选填项：没配置就跳过；配置了但勾不上只告警，不拦提交（否则整件商品白跑）。
      {
        const names = Array.isArray(input.config?.shopCategoryNames?.[storeId])
          ? input.config.shopCategoryNames[storeId]
          : (Array.isArray(input.shopCategories) ? input.shopCategories : []);
        const sc = await fillShopCategory(win, names);
        shopCategoryState = sc;
        if (sc.skipped) emit('[fill-shopcat] 店铺中分类：这次没有为这家店铺保存分类，按平台默认（不选）');
        else if (sc.ok) emit(`[fill-shopcat] 店铺中分类：已勾选并回读「${(sc.selected || []).join('、') || (names || []).join('、')}」`);
        else emit(`[fill-shopcat] ⚠ 店铺中分类没勾上（${sc.reason || 'unknown'}${Array.isArray(sc.available) && sc.available.length ? ` · 下拉可见：${sc.available.slice(0, 6).join('、')}` : ''}），可在发布窗口手动补选`);
      }

      step('填写多件优惠与正装');
      // ⑧ SKU 搜索标题 + 是否为样品（选「正装」）+ 多件优惠（启用 + 9.5 折）
      {
        const sr = asJson(await win.webContents.executeJavaScript(fillSkuSearchTitleScript(title), true).catch(() => null));
        if (sr?.ok) emit(`[fill-sku] SKU搜索标题：已写入（${sr.label}）`);
        const rule = draft?.multiBuy || input.multiBuy || { pieces: '2', discount: '9.5' };
        const discount = String(rule.discount || '9.5');
        const sm = asJson(await win.webContents.executeJavaScript(fillSampleAndMultiBuyScript({ sample: '正装', discount }), true).catch(() => null));
        // 样品只认 radio 的 checked / aria-checked；只有明确读到「样品」才补选正装（每轮现测坐标，最多 2 轮）。
        // 默认就是正装时一下都不点：2026-11-19 现场，多点的那一下就把正装点成了样品。
        let checkedSample = await ensureRegularSample();
        if (sm) {
          sm.sample = checkedSample?.sample || '';
          sm.sampleOk = checkedSample?.sampleOk === true;
          sm.sampleUiKnown = checkedSample?.uiKnown === true;
        }
        const sampleStateNow = String(checkedSample?.sample || '');
        // 现场诊断：每个候选的 文字/是否可见/是否有原生控件/是否 checked，一眼看出读到的是哪一颗。
        const sampleDiag = Array.isArray(checkedSample?.structure) && checkedSample.structure.length
          ? ` · 候选 ${JSON.stringify(checkedSample.structure).slice(0, 220)}` : '';
        if (sm && !sm.sampleOk && sampleStateNow === '样品') {
          // 样品必须填对应正装商品ID，不能这样提交
          emit(`[fill-extra] ⛔ 页面当前是「样品」，已停止（样品必须填对应正装商品ID，不能这样提交）${sampleDiag}`);
        } else if (sm && !sm.sampleOk) {
          emit(`[fill-extra] 是否为样品：按平台默认「正装」继续（页面回读 ${sampleStateNow || '未选中'}${checkedSample?.uiKnown ? '' : ' · 控件态不可读'}），不做点击${sampleDiag}`);
        } else if (sm) {
          emit(`[fill-extra] 是否为样品=正装（radio 回读一致）${sampleDiag}`);
        }
        // 页面没接受 9.5 折（React 把直接赋值回退成默认 9 折）→ 用 CDP 真实键盘再输一次
        if (sm && !sm.multiBuyOk) {
          const focused = asJson(await win.webContents.executeJavaScript(focusDiscountScript(), true).catch(() => null));
          if (focused?.ok) {
            try {
              const dbg = win.webContents.debugger;
              try { dbg.attach('1.3'); } catch { /* 已附着 */ }
              await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
              await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
              await dbg.sendCommand('Input.insertText', { text: discount });
              await sleep(500);
              const reread = asJson(await win.webContents.executeJavaScript(readExtraScript(), true).catch(() => null));
              if (reread?.multiBuy === discount) {
                sm.multiBuy = discount; sm.multiBuyOk = true;
                emit(`[fill-extra] 折扣已用真实键盘补写为 ${discount} 折`);
              }
            } catch (error) {
              emit(`[fill-extra] 折扣键盘补写失败：${String(error?.message || error).slice(0, 80)}`);
            }
          }
        }
        if (sm) {
          emit(`[fill-extra] 是否为样品=${sm.sample || '未选中'}${sm.sampleOk ? '（radio 真实选中态=正装）' : `（⚠ 未确认正装${sm.sampleUiKnown ? '' : ' · 控件态不可读'}）`} · 多件优惠=${sm.multiBuy ? `${sm.multiBuy}折` : '未启用'}${sm.multiBuyOk ? '（已回读）' : `（⚠ 应为 ${discount} 折，请手动改）`}`);
        }
      }

      step('上传 1:1 主图');
      await assertPageAlive(win, '上传主图前');
      // ⑦ 图片：1:1 主图 + 3:4 + 详情 + SKU 图，全部按图位保序上传（本轮不用接口，直接页面上传）
      const imagePlan = resolveImagePlan(draft, detail);
      const workDirImages = require('node:path').join(input.tempDir || require('node:os').tmpdir(), 'xx-images', String(detail.itemId || Date.now()));
      let detailSpacePictures = [];
      let mainBoundSources = [];
      // 自动透明素材只认当前 1:1 主图组的第一张；人工明确指定的本机图仍优先。
      // 不把第 2–5 张、3:4、SKU 或详情图追加进来，避免第一张失败时悄悄换别组图片。
      const transparentSources = [];
      const customTransFile = String(draft?.transFile || '').trim();
      if (draft?.transSource === 'local' && customTransFile) {
        transparentSources.push(/^(?:local:|[a-zA-Z]:[\\/]|\/)/.test(customTransFile)
          ? (customTransFile.startsWith('local:') ? customTransFile : `local:${customTransFile}`)
          : customTransFile);
      }
      if (imagePlan.square[0]) transparentSources.push(imagePlan.square[0]);

      // 1:1 主图：先文件选择器拦截，再素材中心，最后主文档 input；这一段异常不拖累后面三类图
      let packagingFile = '';
      if (imagePlan.square.length) {
        try {
          const files = await prepareImageFiles(imagePlan.square, workDirImages, 'square');
          packagingFile = (files.find(f => f && f.file) || {}).file || '';
          const localFiles = files.filter(f => f.file).map(f => f.file);
          emit(`[fill-images] 1:1主图：按图位准备 ${files.length} 张（${localFiles.length} 张可上传）`);
          let done = { ok: false, reason: 'no-file' };
          if (localFiles.length) {
            // 老软件主图就是走素材中心（点空图位 → 本地上传 → 勾选 → 确定）；
            // 先走它，原生选择框只做兜底 —— 反过来会白等 8 秒，还可能把原生框弹出来。
            done = await uploadMainViaSucai(win, localFiles, '1:1主图');
            if (done.ok) emit(`[fill-images] 1:1主图：素材中心上传成功，回读 ${done.count} 张（勾选 ${done.picked} 个${done.unverified ? ' · 页面未提供回读' : ''}）`);
            else {
              emit(`[fill-images] 1:1主图：素材中心未通过（${done.reason}），改用文件选择器`);
              done = await uploadMainViaChooser(win, localFiles);
              if (done.ok) emit(`[fill-images] 1:1主图：文件选择器上传成功，回读 ${done.count} 张（https 且稳定）`);
            }
          }
          if (!done.ok) {
            emit(`[fill-images] 1:1主图：两条路都没通（${done.reason}）${done.diag ? ` · 现场：${String(done.diag).slice(0, 200)}` : ''}，改用主文档上传框`);
            await uploadImageGroupSerially(win, 'square', files, { label: '1:1主图', stopOnFail: false });
          }
          // 素材中心已经按本次文件名回到卡片时，用这些卡片地址整组覆盖主图组件。
          // 不把 DOM / 引擎里原有的图合并进来；数组数量或顺序不一致就视为失败。
          let sync = null;
          const ownAssets = Array.isArray(done.assets) ? done.assets.filter(u => /^https?:\/\//i.test(String(u))) : [];
          if (done.ok && ownAssets.length === localFiles.length && localFiles.length > 0) {
            const exact = asJson(await win.webContents.executeJavaScript(buildWriteMainImagesScript(ownAssets), true).catch(() => null));
            if (exact?.ok) {
              sync = { ok: true, engineAfter: exact.count, dom: exact.count, engineBefore: 0, exactAssets: true };
              mainBoundSources = ownAssets.slice();
            } else sync = { ok: false, reason: exact?.reason || 'exact-assets-rejected', dom: 0 };
          } else {
            sync = asJson(await win.webContents.executeJavaScript(buildSyncMainImagesScript(), true).catch(() => null));
          }
          if (sync?.ok) {
            if (!mainBoundSources.length && Array.isArray(sync.urls)) {
              mainBoundSources = sync.urls.filter(u => /^https?:\/\//i.test(String(u))).slice(0, 5);
            }
            emit(`[fill-images] 1:1主图：${sync.exactAssets ? '已按本次上传素材整组重绑' : '引擎回读'} ${sync.engineAfter} 张（DOM ${sync.dom} 张${sync.engineBefore ? ` · 原本 ${sync.engineBefore} 张` : ''}）`);
          }
          else {
            emit(`[fill-images] 1:1主图：引擎仍是 0 张（DOM ${sync?.dom || 0} 张，${sync?.reason || 'unknown'}），改为直接写主图地址`);
            const urls = imagePlan.square.filter(u => /^https?:\/\//i.test(String(u))).slice(0, 5);
            const w = urls.length ? asJson(await win.webContents.executeJavaScript(buildWriteMainImagesScript(urls), true).catch(() => null)) : null;
            if (w?.ok) {
              mainBoundSources = urls.slice();
              emit(`[fill-images] 1:1主图：已把 ${w.count} 张主图地址写入引擎（没走素材中心，以平台提交回执为准）`);
            } else emit(`[fill-images] 1:1主图：地址直写也没成（${w?.reason || 'no-url'}），提交前会再补救一次`);
          }
        } catch (error) {
          emit(`[fill-images] 1:1主图异常：${String(error?.message || error).slice(0, 120)}（继续上传 3:4/详情/SKU）`);
        }
      }

      step('上传透明素材图');
      await assertPageAlive(win, '上传透明素材图前');
      // 透明素材图（导购素材 · 800×800 · 必填）：方案 A —— 用第一张 1:1 主图转 800×800 PNG 先占位
      {
        const transFile = String(draft?.transFile || '').trim();
        const transCode = String(draft?.transCode || '').trim();
        const sources = [...transparentSources];
        if (!sources.length) {
          emit('[fill-images] 透明素材图：没有主图也没有本机素材图，跳过（必填项，提交前会再拦一次）');
        } else {
          if (transCode) emit(`[fill-images] 透明素材图：草稿填的编码「${transCode}」暂未接入取图接口，先用主图转 800×800 PNG`);
          const wb = await uploadWhiteBg(win, sources, workDirImages);
          const cut = wb.cutout || {};
          const cutText = cut.transparent != null ? ` · 透明区 ${Math.round(Number(cut.transparent) * 100)}% · ${Math.round(Number(cut.bytes || 0) / 1024)}KB` : '';
          if (wb.ok) emit(`[fill-images] 透明素材图：已重新上传并核验 ${wb.pix || '800×800'}（${wb.via} · ${wb.srcW || '?'}×${wb.srcH || '?'} 原图 → 800×800 PNG${cutText}${draft?.transSource === 'local' && transFile ? ' · 用本机指定图' : ''}）`);
          else emit(`[fill-images] 透明素材图：上传未成功（${wb.reason || 'unknown'}${cutText}${Array.isArray(wb.sizes) && wb.sizes.length ? ` · 试过 ${wb.sizes.map(x => `${x[0]}→${x[1]}`).join(' / ')}` : ''}）${Array.isArray(wb.toast) && wb.toast.length ? ` · 平台提示：${wb.toast.join(' / ').slice(0, 120)}` : ''}${wb.diag ? ` · 现场：${String(wb.diag).slice(0, 200)}` : ''}，提交前会再补救一次`);
        }
      }

      step('上传 3:4 主图');
      await assertPageAlive(win, '上传 3:4 主图前');
      // 3:4 主图：先转存本店素材中心，再写 threeToFourImages。
      // 不能直接写采集图 URL：那只是“引用别人的图片”，没有进入本店图片空间。
      let tallBoundUrls = [];
      if (imagePlan.tall.length) {
        try {
          const prepared = await prepareImageFiles(imagePlan.tall, workDirImages, 'tall');
          // 平台 3:4 图只收 jpg/jpeg/heic：CDN 常见「扩展名 .jpg、内容 WebP」，先统一转真正的 JPEG
          const files = await convertTallToJpeg(win, prepared, pathModule.join(workDirImages, 'tall'));
          const localFiles = files.filter(f => f.file).map(f => f.file);
          const converted = files.filter(f => f.jpegFrom);
          const padded = files.filter(f => f.jpegPadded);
          emit(`[fill-images] 3:4主图：按图位准备 ${files.length} 张（${localFiles.length} 张可上传${converted.length ? ` · ${converted.length} 张 ${Array.from(new Set(converted.map(f => f.jpegFrom))).join('/')} 已转 JPEG` : ''}${padded.length ? ` · ${padded.length} 张原比例非 3:4，已按 1440×1920 留白补齐（不裁边：${padded.map(f => f.jpegSrc).join('、')}）` : ''}）`);
          let ownUrls = [];
          let via = '';
          if (localFiles.length) {
            // ① 素材中心批量上传，只取本店地址（不点卡片/不点确定，避免平台把 3:4 联动进 1:1）
            const up = await uploadMainViaSucai(win, localFiles, '3:4主图', 'tall', {
              maxPoints: 6, frameWaitMs: 12000, addressOnly: true,
            });
            const assets = Array.isArray(up.assets)
              ? up.assets.map(normalizeMaterialUrl).filter(u => /^https?:\/\//i.test(u))
              : [];
            if (up.ok && assets.length === localFiles.length) {
              ownUrls = assets;
              via = '素材中心';
            } else {
              emit(`[fill-images] 3:4主图：素材中心只拿到 ${assets.length}/${localFiles.length} 个本店地址（${up.reason || 'unknown'}），改用图位上传`);
            }
          }
          if (!ownUrls.length && localFiles.length) {
            await uploadImageGroupSerially(win, 'tall', files, { label: '3:4主图', stopOnFail: false });
            const read = asJson(await win.webContents.executeJavaScript(buildReadImageGroupScript('tall'), true).catch(() => null));
            const order = (Array.isArray(read?.order) ? read.order : [])
              .map(normalizeMaterialUrl)
              .filter(u => /^https?:\/\//i.test(u));
            if (read?.known && order.length === localFiles.length) {
              ownUrls = order;
              via = '图位上传';
            } else {
              emit(`[fill-images] 3:4主图：图位回读 ${Number(read?.count) || 0}/${localFiles.length} 张（${read?.known ? `组件 ${read?.via || 'magix'}` : '组件与 DOM 都没值'}），不写空值`);
            }
          }
          if (ownUrls.length) {
            const r = asJson(await win.webContents.executeJavaScript(buildFillTallImagesScript(ownUrls), true).catch(() => null));
            const sameOrder = JSON.stringify((r?.order || []).map(u => String(u).split('?')[0]))
              === JSON.stringify(ownUrls.map(u => String(u).split('?')[0]));
            emit(r?.ok
              ? `[fill-images] 3:4主图：已转存本店${via}并写入 ${r.count}/${r.total} 张（顺序${sameOrder ? '一致' : '需复核'}）`
              : `[fill-images] 3:4主图：转存成功但组件写入失败（${r?.reason || 'unknown'}）`);
            if (r?.ok) tallBoundUrls = ownUrls.slice();
          } else if (localFiles.length) {
            emit('[fill-images] 3:4主图：没能转存到本店素材中心，本组不写外链，保留仓库原 3:4 图');
          } else {
            emit('[fill-images] 3:4主图：本机文件准备失败，本组不提交');
          }
        } catch (error) {
          emit(`[fill-images] 3:4主图异常：${String(error?.message || error).slice(0, 120)}，本组不写外链`);
        }
        // 平台可能在写入 3:4 后自动带一张裁剪图到 1:1 图位；等页面完成这次联动后，再按本次 1:1 素材整组覆盖。
        if (mainBoundSources.length) {
          await sleep(1200);
          let finalMain = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            finalMain = asJson(await win.webContents.executeJavaScript(buildWriteMainImagesScript(mainBoundSources), true).catch(() => null));
            if (finalMain?.ok) break;
            await sleep(800);
          }
          const mainRead = asJson(await win.webContents.executeJavaScript(buildReadImageGroupScript('square'), true).catch(() => null));
          emit(finalMain?.ok && Number(mainRead?.count || 0) === mainBoundSources.length
            ? `[fill-images] 1:1主图：3:4写入后已最终校准为 ${mainBoundSources.length} 张，清掉平台自动带入的其他图`
            : `[fill-images] 1:1主图：3:4写入后最终校准失败（${finalMain?.reason || `回读 ${mainRead?.count || 0} 张`}）`);
        }
        // 复核 3:4：平台的 1:1 重绑有可能把 3:4 组一起重算（现场出现过写完就空）。
        if (tallBoundUrls.length) {
          await sleep(800);
          let tallRead = asJson(await win.webContents.executeJavaScript(buildReadImageGroupScript('tall'), true).catch(() => null));
          if (Number(tallRead?.count || 0) !== tallBoundUrls.length) {
            const again = asJson(await win.webContents.executeJavaScript(buildFillTallImagesScript(tallBoundUrls), true).catch(() => null));
            tallRead = asJson(await win.webContents.executeJavaScript(buildReadImageGroupScript('tall'), true).catch(() => null));
            emit(again?.ok && Number(tallRead?.count || 0) === tallBoundUrls.length
              ? `[fill-images] 3:4主图：写入后被平台清空，已重写并回读 ${tallRead.count}/${tallBoundUrls.length} 张`
              : `[fill-images] 3:4主图：写入后被平台清空，重写后回读 ${Number(tallRead?.count) || 0}/${tallBoundUrls.length} 张`);
          } else {
            emit(`[fill-images] 3:4主图：最终回读 ${tallRead.count}/${tallBoundUrls.length} 张（组件值一致）`);
          }
        }
      }

      step('上传详情图');
      await assertPageAlive(win, '上传详情图前');
      // 详情图：老软件 fillDetailImages 同款 —— 先下载采集图、上传本店素材中心，
      // 用本店图片空间地址源码导入。直接写别人的 URL 是外链图，平台随时判无效。
      if (imagePlan.detail.length) {
        const sourceUrls = imagePlan.detail.slice(0, 40);
        if (sourceUrls.length) {
          emit(`[fill-detail] 详情图：待上传 ${sourceUrls.length} 张（采集图与本机图均先转存本店素材中心）`);
          const uploaded = await uploadDetailImages(win, sourceUrls, workDirImages);
          detailSpacePictures = uploaded.urls.slice();
          const urls = uploaded.urls;
          if (!urls.length) {
            emit(`[fill-detail] ⚠ 详情图一张都没能上传本店素材中心（${uploaded.reason || `0/${uploaded.expected}`}${Array.isArray(uploaded.lost) && uploaded.lost.length ? ` · 失败原因：${Array.from(new Set(uploaded.lost.map(x => x.reason))).slice(0, 2).join(' / ')}` : ''}），不写采集外链，请在发布窗口手动补详情图`);
          } else {
            // 部分成功也要用：16 张里拿到 12 张，比详情页 0 张强；缺的明确写进日志，不谎报全成功
            if (!uploaded.ok) emit(`[fill-detail] ⚠ 详情图只拿到 ${urls.length}/${sourceUrls.length} 张本店地址，先把这些导入，缺的请看上面的失败行`);
            emit(`[fill-detail] 详情图：本店地址 ${urls.length}/${sourceUrls.length} 张，开始源码导入`);
            const before = Number(await win.webContents.executeJavaScript(buildDetailCountScript(), true).catch(() => 0)) || 0;
            if (before > 0) {
              const cleared = asJson(await win.webContents.executeJavaScript(buildClearDetailScript(), true).catch(() => null));
              emit(cleared?.ok ? `[fill-detail] 详情里原有 ${before} 张图，已清空` : `[fill-detail] 详情里原有 ${before} 张图，清空未成功（${cleared?.reason || 'unknown'}），导入后按顺序核对`);
            }
            const opened = asJson(await win.webContents.executeJavaScript(buildOpenDetailSourceScript(), true).catch(() => null));
            if (opened?.ok) {
              const filled = asJson(await win.webContents.executeJavaScript(buildFillDetailSourceScript(urls), true).catch(() => null));
              if (filled?.ok) {
                const confirmed = asJson(await win.webContents.executeJavaScript(buildConfirmDetailImportScript(), true).catch(() => null));
                if (confirmed?.ok) {
                  let read = null;
                  for (let t = 0; t < 40; t++) {
                    await sleep(500);
                    read = asJson(await win.webContents.executeJavaScript(buildDetailReadbackScript(urls), true).catch(() => null));
                    if (read?.ok) break;
                  }
                  emit(read?.ok
                    ? `[fill-detail] 详情图：已导入并逐张核对 ${read.count}/${read.total} 张（顺序一致 · 本店图片空间）`
                    : `[fill-detail] 详情图：导入后回读不一致（本次 ${read?.total || urls.length} 张 · 页面 ${read?.pics || 0} 张 · 多余 ${read?.extra || 0}）`);
                } else emit(`[fill-detail] 详情图：源码导入「导入」按钮不可用（${confirmed?.reason || 'unknown'}）`);
              } else emit(`[fill-detail] 详情图：源码填充失败（${filled?.reason || 'unknown'}）`);
            } else emit(`[fill-detail] 详情图：打不开源码导入（${opened?.reason || 'unknown'}）`);
          }
        } else {
          emit('[fill-detail] 详情图：没有可用的图片地址，跳过');
        }
        // 详情为空在发布页是硬拦路项：这里明确报一句，别让提交失败后只剩一句「未入仓」
        const finalDetail = Number(await win.webContents.executeJavaScript(buildDetailCountScript(), true).catch(() => -1));
        if (finalDetail === 0) emit('[fill-detail] ⚠ 详情页仍是 0 张图（详情为必填，提交大概率被拦）');
      }
      step('写入 SKU 图');
      // SKU 图：写 customSaleProp/saleProp 的规格值 img + 行 props[0].img + skuPicture（不上传，顺序=规格顺序）
      if (imagePlan.sku.length) {
        const items = imagePlan.sku
          .filter(s => /^https?:\/\//i.test(String(s.source || '')))
          .map(s => ({ name: String(s.name || '').trim(), url: String(s.source) }));
        const missing = imagePlan.sku.length - items.length;
        emit(`[fill-images] SKU图：按规格顺序 ${items.length} 张（直接写图片地址${missing ? ` · ${missing} 条无地址跳过` : ''}）`);
        if (items.length) {
          const r = asJson(await win.webContents.executeJavaScript(buildFillSkuImageUrlsScript(items), true).catch(() => null));
          if (r?.ok) emit(`[fill-images] SKU图：已写入并回读 ${r.read}/${r.applied} 条（规格图+SKU搜索主图）`);
          else if (r?.reason === 'no-spec-component') emit('[fill-images] SKU图：页面没有规格图组件，跳过');
          else emit(`[fill-images] SKU图：写入未通过（${r?.reason || `回读 ${r?.read || 0}/${r?.applied || 0}`}）`);
        }
      }

      step('填写总净含量');
      // SKU 表必填列：总净含量按采集到的净含量写（80g 就写 80，不再写死 1g）
      const netFact = skuProductFact(draft, detail, input.hints);
      const netGrams = netFact.grams || 0;
      if (netGrams) {
        let nw = asJson(await win.webContents.executeJavaScript(buildFillSkuNetWeightScript(netGrams), true).catch(() => null));
        if (!nw?.ok) {
          const dom = asJson(await win.webContents.executeJavaScript(buildFillSkuNetWeightDomScript(netGrams), true).catch(() => null));
          if (dom?.read) { nw = { ok: true, read: dom.read, total: dom.rows, keys: ['DOM列'] }; }
          else emit(`[fill-sku] 总净含量：组件写入未通过（${nw?.reason || `回读 ${nw?.read || 0}/${nw?.total || 0}`}），DOM 兜底也失败（${dom?.reason || 'no-header'}）`);
        }
        if (nw?.ok) emit(`[fill-sku] 总净含量：${nw.read}/${nw.total} 条已写 ${netGrams}g（采集值${netFact.name ? ` · 品名 ${netFact.name}` : ''}${(nw.keys || []).length ? ` · ${(nw.keys || []).join('、')}` : ''}）`);
      } else {
        emit('[fill-sku] 总净含量：采集参数里没有可用的净含量，跳过（避免写错值）');
      }

      step('关联包含产品');
      // SKU 表必填列：包含产品 —— 走真实产品档案（搜索→选中/新建→确定），再按件数 1 写给所有规格行
      {
        const fact = skuProductFact(draft, detail, input.hints);
        emit(`[fill-sku] 包含产品：按真实档案关联（品名 ${fact.name || '空'} · ${fact.grams || 0}g · ${fact.unit}${fact.barcode ? ` · 条码 ${fact.barcode}` : ''}）`);
        const pr = await assignSkuProducts(win, fact, packagingFile);
        if (pr?.ok && pr.already) emit(`[fill-sku] 包含产品：${pr.count} 行原本已关联真实产品，跳过`);
        else if (pr?.ok) emit(`[fill-sku] 包含产品：${pr.read}/${pr.total} 行已关联「${pr.title || pr.picked || ''}」(id=${pr.productId})${pr.created ? `（新建档案${pr.packaging ? ' · 已传外包装图' : ''}）` : `（关键词「${pr.keyword || ''}」）`}`);
        else emit(`[fill-sku] 包含产品：未完成（${pr?.reason || 'unknown'}${pr?.keyword ? ` · 关键词「${pr.keyword}」` : ''}${Array.isArray(pr?.tried) && pr.tried.length ? ` · 试过 ${pr.tried.join(' / ')}` : ''}${pr?.picked ? ` · 选中 ${pr.picked}` : ''}）${Array.isArray(pr?.errors) && pr.errors.length ? ` · 平台提示：${pr.errors.join(' / ')}` : ''}${Array.isArray(pr?.buttons) && pr.buttons.length ? ` · 弹窗按钮：${pr.buttons.join('、')}` : ''}${pr?.panel ? ` · 现场：${String(pr.panel).slice(0, 160)}` : ''}，请在发布窗口手动选`);
      }

      // 提交前最后确认 1:1 组：后续 SKU/详情操作也可能触发平台联动，数量不符就按本次素材再整组写一次。
      if (mainBoundSources.length) {
        const mainNow = asJson(await win.webContents.executeJavaScript(buildReadImageGroupScript('square'), true).catch(() => null));
        if (Number(mainNow?.count || 0) !== mainBoundSources.length) {
          const fixed = asJson(await win.webContents.executeJavaScript(buildWriteMainImagesScript(mainBoundSources), true).catch(() => null));
          emit(fixed?.ok
            ? `[presubmit] 1:1主图数量曾变为 ${mainNow?.count || 0} 张，已在提交前校正为 ${mainBoundSources.length} 张`
            : `[presubmit] 1:1主图提交前校正失败（${fixed?.reason || 'unknown'}）`);
        }
      }

      // ⑧.5 素材中心弹层必须关掉：它整层盖住发布页，提交按钮点不到
      //（2026-11-17 现场：弹窗一直开着 → 提交后 75 秒没有入仓回执）
      if (await mediaPopupOpen(win)) {
        const closed = await closeMediaPopup(win);
        emit(closed ? '[fill-images] 素材中心弹层已关闭（不然会挡住提交按钮）' : '[fill-images] ⚠ 素材中心弹层关不掉，提交可能被它挡住');
        const sq = asJson(await win.webContents.executeJavaScript(readImageGroupScript('square'), true).catch(() => null));
        if (sq?.known && !Number(sq.count || 0)) {
          // 关弹层偶尔会把刚回填的主图一起撤掉：先把页面上还看得见的图桥接回引擎
          const sync = asJson(await win.webContents.executeJavaScript(buildSyncMainImagesScript(), true).catch(() => null));
          emit(sync?.ok
            ? `[fill-images] 关弹层后主图回读 0 张，已用页面上现存的 ${sync.engineAfter} 张桥接回引擎`
            : '[fill-images] ⚠ 关弹层后主图回读 0 张，提交前会按原图重传一次');
        }
      }

      // ⑨ 收起填写助手面板（老软件 [collapse-assistant]，挡住提交按钮时先收起来）
      {
        const c = asJson(await win.webContents.executeJavaScript(collapseAssistantScript(), true).catch(() => null));
        if (c?.ok) emit('[collapse-assistant] 收起填写助手面板');
      }
      // 「选择类目」弹窗可能在表单重渲染后又弹出来，提交前再确认一次，别让它挡住提交按钮
      {
        const settled = await settleCategoryDialog();
        if (settled.closed && settled.rounds) emit('[submit] 提交前确认「选择类目」弹窗已关闭');
        if (!settled.closed) emit('[submit] ⚠ 「选择类目」弹窗仍在，会挡住提交按钮');
      }

      step('提交前自检');
      // ⑩ 提交前自检：把真正拦路项列成人话并就地补救，不再让静态提示冒充失败原因
      // [presubmit-province] 提交前再核对一次 * 省份（防止重渲染被清空或未触发）：无省份/无匹配时选「其他」
      {
        const pv2 = await ensureProvince(win, provinceCandidates);
        if (!pv2?.skipped && !pv2?.already) {
          emit(pv2?.ok
            ? `[presubmit-province] 省份已补选「${pv2.picked || '其他'}」${pv2.usedFallback ? '（下拉兜底）' : ''}`
            : `[presubmit-province] ⚠ 省份仍未选中（${pv2?.reason || 'unknown'}）`);
          await sleep(300);
        }
      }
      // 先把可能被我们误开的「批量导入」弹窗关掉，否则它会压在页面上挡住提交（2026-11-17 现场）
      if (await closeBatchImportDialog(win)) emit('[presubmit] 已关闭残留的「批量导入」弹窗');
      let pre = asJson(await win.webContents.executeJavaScript(preSubmitCheckScript(imagePlan.tall.length), true).catch(() => null));
      // 透明素材图核实：图本身是 800×800 时，页面常只显示 320 缩略图。
      // 这里把「引擎里的提交值 / 页面显示的尺寸」写进日志，并在提交值是缩略图时还原原图重写一次。
      if (pre?.whiteBgNote) emit(`[presubmit] ${pre.whiteBgNote}`);
      if (pre?.whiteBgThumb) {
        const fixed = asJson(await win.webContents.executeJavaScript(buildWriteGuideImageScript(pre.whiteBgUrls || []), true).catch(() => null));
        emit(fixed?.ok
          ? `[presubmit] 透明素材图提交值原为缩略图地址，已还原原图并重写（${fixed.pix || '800×800'}）`
          : `[presubmit] 透明素材图提交值含缩略图，原图还原未成功（${fixed?.reason || 'unknown'}），按平台提交回执为准`);
      }
      if (pre && !pre.ok) {
        emit(`[presubmit] ⚠ 拦路项 ${pre.blockers.length} 个：${pre.blockers.join(' / ')}`);
        if (pre.dialogOpen) {
          const s = await settleCategoryDialog();
          emit(s.closed ? '[presubmit] 弹窗已补关' : '[presubmit] 弹窗补关失败');
        }
        if (pre.seriesEmpty && seriesMain) {
          // 系列是 keyProp 原生属性：先按老软件 P6 三件套补写，DOM 只作最后兜底
          const ws = asJson(await win.webContents.executeJavaScript(writeBrandSeriesScript(seriesMain), true).catch(() => null));
          if (ws?.ok) {
            emit(`[presubmit] 系列已按品牌+系列 keyProp 原生补写「${ws.readback}」（${(ws.steps || []).join('+')}）`);
          } else {
            const rs = asJson(await win.webContents.executeJavaScript(fillSeriesScript(seriesMain, seriesFallback), true).catch(() => null));
            emit(rs?.ok ? `[presubmit] 系列已用 DOM 兜底补写「${rs.value}」` : '[presubmit] 系列补写仍失败（发布页可手动填）');
          }
        }
        if (pre.guideOver) {
          const rt = asJson(await win.webContents.executeJavaScript(fillTitlesAllScript(promoTitle, sellPoint), true).catch(() => null));
          emit(rt?.ok ? `[presubmit] 导购标题已重写为 ${promoTitle.length} 汉字（${rt.guide?.found || 0} 个实例回读一致）` : '[presubmit] 导购标题重写仍不一致');
        }
        // 只有页面明确是「样品」才补选正装；默认正装/读不到选中态时按平台默认继续，
        // 绝不点击（2026-11-19：点歪一次就会把默认的正装切成样品）。
        if (!pre.sampleOk && pre.sampleText === '样品') {
          // 不在这里先跑一遍只读脚本：ensureRegularSample 每轮都用当次刚测的坐标点，最多 2 轮
          const recheck = await ensureRegularSample();
          if (recheck?.sampleOk) emit('[presubmit] 是否为样品已补选「正装」（radio 回读一致）');
          else if (String(recheck?.sample || '') === '未找到') emit('[presubmit] 页面没有「正装/样品」控件，按平台默认（正装）继续');
          else emit(`[presubmit] ⚠ 正装补选仍未通过（控件态${recheck?.uiKnown ? '已识别' : '无法识别'} · 页面「${recheck?.sample || '未知'}」），请在发布窗口手动点一次正装`);
        }
        if (!pre.mainImages) {
          // 先桥接：上传其实成功过、只是引擎没拿到值的情况最多
          const sync = asJson(await win.webContents.executeJavaScript(buildSyncMainImagesScript(), true).catch(() => null));
          if (sync?.ok) {
            emit(`[presubmit] 主图 0 张：已把页面上的 ${sync.engineAfter} 张桥接回引擎（回读一致）`);
          } else {
            // 真没传上 → 整条上传链路再走一遍（素材中心 → 文件选择器 → 主文档上传框）
            const files = await prepareImageFiles(imagePlan.square, workDirImages, 'square');
            const localFiles = files.filter(f => f.file).map(f => f.file);
            let retry = { ok: false, reason: 'no-file' };
            if (localFiles.length) {
              retry = await uploadMainViaSucai(win, localFiles, '1:1主图');
              if (!retry.ok) retry = await uploadMainViaChooser(win, localFiles);
              if (!retry.ok) await uploadImageGroupSerially(win, 'square', files, { label: '1:1主图', stopOnFail: false });
            }
            const retryAssets = Array.isArray(retry.assets) ? retry.assets.filter(u => /^https?:\/\//i.test(String(u))) : [];
            const sync2 = retry.ok && retryAssets.length === localFiles.length && localFiles.length > 0
              ? asJson(await win.webContents.executeJavaScript(buildWriteMainImagesScript(retryAssets), true).catch(() => null))
              : asJson(await win.webContents.executeJavaScript(buildSyncMainImagesScript(), true).catch(() => null));
            if (sync2?.ok) {
              emit(`[presubmit] 主图 0 张：重传后引擎回读 ${sync2.engineAfter ?? sync2.count} 张（${retry.ok ? '上传成功' : `上传未确认：${retry.reason || 'unknown'}`}）`);
            } else {
              const urls = imagePlan.square.filter(u => /^https?:\/\//i.test(String(u))).slice(0, 5);
              const w = urls.length ? asJson(await win.webContents.executeJavaScript(buildWriteMainImagesScript(urls), true).catch(() => null)) : null;
              if (w?.ok) emit(`[presubmit] 主图 0 张：重传失败，已把 ${w.count} 张主图地址直写进引擎（提交以平台回执为准）`);
              else emit(`[presubmit] 主图 0 张且重传未成功（${retry.reason || 'unknown'}），已停止自动提交，请在发布窗口手动补图`);
            }
          }
        }
        if (pre.tallExpected > 0 && pre.tallKnown && Number(pre.tallCount || 0) < pre.tallExpected && tallBoundUrls.length) {
          // 详情/SKU 写入后平台重渲染可能把 3:4 组清空：按本次已转存的本店地址补写一次
          const again = asJson(await win.webContents.executeJavaScript(buildFillTallImagesScript(tallBoundUrls), true).catch(() => null));
          const re = asJson(await win.webContents.executeJavaScript(buildReadImageGroupScript('tall'), true).catch(() => null));
          emit(again?.ok && Number(re?.count || 0) === tallBoundUrls.length
            ? `[presubmit] 3:4主图已补写并回读 ${re.count}/${tallBoundUrls.length} 张`
            : `[presubmit] 3:4主图补写后仍只有 ${Number(re?.count) || 0}/${tallBoundUrls.length} 张`);
        }
        if (transparentIssue(pre)) {
          // 空图位、旧冻结图、页面/提交值不一致或像素不通过：重新生成并重新上传 800×800 PNG
          const wb = await uploadWhiteBg(win, transparentSources, workDirImages);
          const cut2 = wb.cutout || {};
          emit(wb.ok
            ? `[presubmit] 透明素材图已重新上传并核验 ${wb.pix || '800×800'}（${wb.via} → 800×800 PNG${cut2.transparent != null ? ` · 透明区 ${Math.round(Number(cut2.transparent) * 100)}%` : ''}${cut2.bytes ? ` · ${Math.round(Number(cut2.bytes) / 1024)}KB` : ''}）`
            : `[presubmit] 透明素材图补传仍未通过核验（${wb.reason || 'unknown'}${Array.isArray(wb.toast) && wb.toast.length ? ` · 平台提示：${wb.toast.join(' / ').slice(0, 120)}` : ''}）`);
        }
        if (pre.skuProductsRequired && pre.skuProductsMissing) {
          // 必填的「包含产品」没关联上：再走一次真实档案（搜索/新建），还不行就留在窗口给人选
          const fact = skuProductFact(draft, detail, input.hints);
          const retryPr = await assignSkuProducts(win, fact, packagingFile);
          emit(retryPr?.ok
            ? `[presubmit] 包含产品补关联成功：${retryPr.read}/${retryPr.total} 行「${retryPr.title || retryPr.picked || ''}」(id=${retryPr.productId})`
            : `[presubmit] 包含产品补关联未成功（${retryPr?.reason || 'unknown'}${retryPr?.panel ? ` · 现场：${String(retryPr.panel).slice(0, 120)}` : ''}）`);
        }
        await sleep(1200);
        // 补救流程可能又把素材中心弹层打开（补传主图/透明图）：重读自检前先关掉，否则提交点不动
        if (await mediaPopupOpen(win)) {
          const closedAgain = await closeMediaPopup(win);
          emit(closedAgain ? '[presubmit] 补救后已关闭素材中心弹层' : '[presubmit] ⚠ 素材中心弹层仍在，提交可能被挡住');
        }
        pre = asJson(await win.webContents.executeJavaScript(preSubmitCheckScript(imagePlan.tall.length), true).catch(() => null));
        emit(pre?.ok ? '[presubmit] 补救后拦路项已清空' : `[presubmit] 补救后仍剩：${(pre?.blockers || []).join(' / ')}`);
      } else if (pre?.ok) {
        emit('[presubmit] 自检通过：弹窗已关 · 系列已填 · 导购标题合规 · 正装已选 · 主图已上传 · 透明素材图已上传');
      }

      // 提交前核对：probeScript 直接返回对象，**不能**再 JSON.parse（否则抛 "[object Object]" is not valid JSON）
      const before = await win.webContents.executeJavaScript(probeScript(), true).catch(() => null);
      if (before?.errorText?.length) emit(`提交前页面提示：${rankErrors(before.errorText).slice(0, 5).join(' / ')}`);
      emit(`[presubmit] 表单项 ${Number(before?.formItems) || 0} · 上传框 ${Number(before?.fileInputs) || 0} · engine=${before?.engine ? 'yes' : 'no'}`);

      // 是否为样品：页面没渲染这组控件时按平台默认（正装）放行，只有「确实是样品」才拦。
      // 以前的写法是 !pre.sampleOk 一律停，等于把「读不到控件」当成「是样品」，整件商品永远上不去。
      const sampleBlocked = Boolean(pre && (pre.sampleText === '样品'
        || (Array.isArray(pre.blockers) && pre.blockers.some(line => /正装|样品/.test(String(line))))));
      if (pre?.sampleNote) emit(`[presubmit] ${pre.sampleNote}`);
      // 关键字段校验失败时禁止盲点提交（会再次弹出关键属性窗口，还可能重置整张表）。
      // 主图 0 张也在这里停：图片是必填，盲点提交只会白等 75 秒入仓回执（2026-11-17 现场）。
      if (!pre || pre.seriesEmpty || pre.dialogOpen || pre.guideOver || sampleBlocked || !pre.mainImages
        || transparentIssue(pre) || (pre.skuProductsRequired && pre.skuProductsMissing)) {
        await leaveWindowForManual('关键字段校验未通过');
        const diag = await win.webContents.executeJavaScript(fieldDiagnosticsScript(), true).catch(() => null);
        if (diag) emit(`[field-diagnostic] ${typeof diag === 'string' ? diag : JSON.stringify(diag)}`);
        throw Object.assign(new Error(`关键字段校验未通过，已停止自动提交：${(pre?.blockers || ['页面自检无返回']).join(' / ')}`), { code: 'NEEDS_MANUAL_VERIFICATION' });
      }
      if (input.autoSubmit === false) {
        await leaveWindowForManual('按配置停在提交前');
        throw Object.assign(new Error('已填完，按配置停在提交前；请在发布窗口确认后手工提交'), { code: 'NEEDS_MANUAL_VERIFICATION' });
      }

      // 日志14：点击提交会让平台重新弹出「选择类目」弹窗。从这一刻起常驻抑制，
      // 保证提交后无论成功失败，发布窗口都不会再被这个弹窗盖住（失败时人要手动补图）。
      let guardBase = 0;
      {
        const g = asJson(await win.webContents.executeJavaScript(suppressCategoryDialogScript(), true).catch(() => null));
        guardBase = (Number(g?.closed) || 0) + (Number(g?.hidden) || 0);
        emit(`[dialog-guard] 已接管「选择类目」弹窗：提交后不再弹出，失败留窗口时可直接手动补图`
          + (guardBase ? `（立即处理 ${guardBase} 个）` : ''));
      }

      step('提交入仓');
      // ⑩ 提交（勾「放入仓库」）
      if (await mediaPopupOpen(win)) {
        const closedLast = await closeMediaPopup(win);
        emit(closedLast ? '[submit] 提交前已关闭素材中心弹层' : '[submit] ⚠ 素材中心弹层仍在，提交可能被挡住');
      }
      // 老软件 submitToWarehouse：先确认「放入仓库」radio 真的 checked，没确认就停，
      // 否则提交的是「直接上架」而不是「入仓」，等再久也不会有 auctionStatus=-5 回执。
      {
        const wh = asJson(await win.webContents.executeJavaScript(confirmWarehouseRadioScript(), true).catch(() => null));
        emit(wh?.ok
          ? '[submit] 已确认「放入仓库」单选项选中'
          : `[submit] ⚠ 无法确认「放入仓库」选中（${wh?.reason || wh?.state || '未知'}），停止提交以免提交到错误流程`);
        if (!wh?.ok) {
          await leaveWindowForManual('放入仓库未确认');
          throw Object.assign(new Error('无法确认「放入仓库」选中，已停止提交（避免提交到非入仓流程）'), { code: 'NEEDS_MANUAL_VERIFICATION' });
        }
      }
      // 真实鼠标点提交（CDP 坐标优先，DOM click 兜底）。返回是否真的点到了。
      // 两条铁律：① 只点文字是「提交」的那一颗（绝不点切换类目）；② 页面在转（busy/loading）时绝不点。
      const submitClick = async (tag, quiet) => {
        const info = asJson(await win.webContents.executeJavaScript(clickSubmitScript(), true).catch(() => null));
        if (!info?.ok) {
          if (!quiet) emit(`[submit] ⚠ ${info?.error || '提交按钮不可用'}，无法${tag}`);
          return false;
        }
        if (info.busy || info.loading) {
          if (!quiet) emit(`[submit] 页面还在转（${info.busy ? '页面加载中' : '按钮 loading'}），先不点，等它转完`);
          return false;
        }
        emit(`[submit] 定位到提交按钮「${info.button || ''}」${info.point ? ` · 坐标 ${Math.round(info.point.x)},${Math.round(info.point.y)}` : ''}`);
        let ok = false;
        if (info.point) ok = await cdpClick(info.point.x, info.point.y);
        if (!ok) ok = Boolean(asJson(await win.webContents.executeJavaScript(clickSubmitDomScript(), true).catch(() => null))?.ok);
        if (ok) emit(`[submit] ${tag}（按钮「${info.button || '提交'}」）`);
        return ok;
      };
      emit('[submit] 点击提交');
      let firstClicked = await submitClick('已点击提交');
      if (!firstClicked) {
        // 页面可能还在跑上一段校验/保存：先等它转完再点（最多等 15 秒），不要立刻判失败
        for (let i = 0; i < 10 && !firstClicked; i++) {
          await sleep(1500);
          const st = asJson(await win.webContents.executeJavaScript(clickSubmitScript(), true).catch(() => null));
          if (!st || st.ok === false) break;      // 真的找不到提交按钮 → 不白等
          if (st.busy || st.loading) continue;    // 还在转 → 继续等
          firstClicked = await submitClick('页面转完后点击提交');
        }
      }
      if (!firstClicked) {
        await leaveWindowForManual('找不到提交按钮');
        throw Object.assign(new Error('提交按钮不可用（找不到「提交」或页面还在转）'), { code: 'PUBLISH_FAILED' });
      }
      step('等待入仓回执');
      // ⑪ 轮询回执（老软件 submitToWarehouse 同款：每秒读、错误稳定 2 次即停、超时抓弹窗留证）
      // 2026-11-20 现场：点提交之后平台要转一会儿才跳 success.htm，这期间按钮可能还是「提交」，
      // 千万别急着补点（上一版 6 秒就补点，越点越乱）。现在：至少等 20 秒、页面不忙、没有报错、
      // 按钮不在 loading，才允许补点一次（总共最多 2 次），整体等 90 秒。
      const deadline = Date.now() + 90000;
      let last = null, pollTick = 0, prevErrors = '', stableErrors = 0, stallDiag = '';
      let attempts = 1, lastClickAt = Date.now(), guardTotalPrev = guardBase, lastRetryAt = 0, hrefAtClick = '';
      const RETRY_GAP_MS = 20000;
      const MAX_CLICKS = 2;
      while (Date.now() < deadline) {
        await sleep(1000);
        // 先读状态再抑制：反过来的话，「选择类目」刚弹出来就被关掉，永远看不到它在拦提交
        last = asJson(await win.webContents.executeJavaScript(submitStateScript(), true).catch(() => null));
        // 页面正在跳转 / 上下文被销毁时读不到状态：这时候绝不能补点，等它转完再说
        if (!last) continue;
        // 记下点击后的落地地址：地址一旦变了（哪怕还没到 success.htm）说明页面在走流程，绝不补点
        if (!hrefAtClick) hrefAtClick = String(last.href || '');
        const sameHref = String(last.href || '') === hrefAtClick;
        if (!last.categoryDialog && ++pollTick % 11 === 0) {
          await win.webContents.executeJavaScript(suppressCategoryDialogScript(), true).catch(() => null);
        }
        if (last?.success && last.primaryId) {
          emit(`[submit] 已入仓 #${last.primaryId}${last.successToast ? `（页面提示：${last.successToast}）` : ''}`);
          try { win.close(); } catch { /* */ }
          return {
            ok: true, warehouseItemId: last.primaryId, url: last.href,
            required: { filled: requiredFilled, gaps: remainingGaps },
            spacePictures: detailSpacePictures.length,
            shopCategories: Array.isArray(shopCategoryState?.available) ? shopCategoryState.available : [],
          };
        }
        if (last?.captcha) {
          await leaveWindowForManual('平台要求安全验证');
          throw Object.assign(new Error('平台要求安全验证，请在发布窗口完成验证后重试'), { code: 'NEEDS_MANUAL_VERIFICATION' });
        }
        // 提交后弹窗抑制器又有动作 = 平台重弹了「选择类目」，这一次提交被它吃掉了 → 等页面转完再补点一次
        const guardTotal = (Number(last?.guardClosed) || 0) + (Number(last?.guardHidden) || 0);
        // 页面重渲染会把挂在 window 上的 guard 冲掉重注入，计数会从 0 重来：这种情况按「重置」处理
        if (guardTotal < guardTotalPrev) guardTotalPrev = guardTotal;
        const guardHitNew = guardTotal > guardTotalPrev;
        guardTotalPrev = guardTotal;
        const sinceClick = Date.now() - lastClickAt;
        const busy = Boolean(last?.button && /loading|disabled/i.test(String(last.button)));
        if (guardHitNew && sameHref && !busy && sinceClick >= RETRY_GAP_MS && attempts < MAX_CLICKS && Date.now() - lastRetryAt > RETRY_GAP_MS) {
          lastRetryAt = Date.now();
          emit(`[submit] 「选择类目」被平台重弹过（这次提交被它打断了），等页面稳定后补点一次`);
          await sleep(600);
          if (await submitClick(`第 ${attempts + 1} 次点击提交`)) {
            attempts += 1;
            lastClickAt = Date.now();
            continue;
          }
        }
        if (last?.categoryDialog) {
          if (sameHref && !busy && sinceClick >= RETRY_GAP_MS && attempts < MAX_CLICKS && Date.now() - lastRetryAt > RETRY_GAP_MS) {
            lastRetryAt = Date.now();
            await sleep(600);
            if (await submitClick(`弹窗已关，第 ${attempts + 1} 次点击提交`)) {
              attempts += 1;
              lastClickAt = Date.now();
              continue;
            }
          }
          if (sinceClick < RETRY_GAP_MS) continue; // 页面还在转/弹窗刚关，先等
          emit('[submit] ⚠ 提交后平台持续弹「选择类目」：类目未被确认，提交没有真正发出');

          await leaveWindowForManual('提交后平台要求重新选择类目');
          throw Object.assign(new Error('提交后平台弹出「选择类目」（类目未确认），请在发布窗口确认类目后手动提交'), { code: 'NEEDS_MANUAL_VERIFICATION' });
        }
        // 校验错误连续两次一致 → 立刻停，把具体字段报出来，不再白等到超时
        const sig = Array.isArray(last?.errors) ? rankErrors(last.errors).slice(0, 4).join(' / ') : '';
        stableErrors = sig && sig === prevErrors ? stableErrors + 1 : (sig ? 1 : 0);
        prevErrors = sig;
        if (sig) emit(`[submit] 页面校验错误：${sig}`);
        if (stableErrors >= 2) break;
        // 点了之后 20 秒还没跳转、按钮也没在 loading、地址没变、页面没有报错：多半这一下被浮层吃掉，补点一次
        const idle = !last?.button || !/loading|disabled/i.test(String(last.button));
        if (!sig && idle && sameHref && sinceClick >= RETRY_GAP_MS && attempts < MAX_CLICKS && Date.now() - lastRetryAt > RETRY_GAP_MS) {
          lastRetryAt = Date.now();
          emit('[submit] 提交后 20 秒页面没有跳转、也没有报错，补点一次提交');
          await sleep(300);
          if (await submitClick(`上一次没有跳转，第 ${attempts + 1} 次点击提交`)) {
            attempts += 1;
            lastClickAt = Date.now();
          }
        }
      }
      // 超时/错误停下：在关弹窗之前先抓现场（老软件 SUBMIT_STALL_DIAG_SCRIPT），
      // 否则 leaveWindowForManual 会把弹窗全关掉，日志只剩「没收到回执」。
      stallDiag = JSON.stringify((await win.webContents.executeJavaScript(submitStallDiagScript(), true).catch(() => null)) || null);
      emit(`[submit] 停留现场：${stallDiag.slice(0, 400)}`);
      await leaveWindowForManual('提交后未收到入仓回执');
      const blockersNote = Array.isArray(pre?.blockers) && pre.blockers.length
        ? ` · 提交前自检仍剩：${pre.blockers.slice(0, 4).join(' / ')}` : '';
      const diagNote = stallDiag && stallDiag !== 'null' ? ` · 页面现场 ${stallDiag.slice(0, 240)}` : '';
      const reason = (prevErrors
        ? `提交后仍未入仓，页面提示：${prevErrors}`
        : `提交 ${attempts} 次仍未收到入仓回执（发布页已留在窗口里，可人工确认后重试）`) + blockersNote + diagNote;
      throw Object.assign(new Error(reason), { code: 'PUBLISH_FAILED' });
    } catch (error) {
      // 手动停止/超时中断：窗口已经被 cancel() 销毁，不再弹窗打扰用户
      const stopped = String(error?.code || '') === 'STOPPED' || cancelState.stopped;
      const hung = String(error?.code || '') === 'PAGE_HUNG';
      try {
        if (hung && win && !(typeof win.isDestroyed === 'function' && win.isDestroyed())) {
          // 页面已经无响应：弹窗也没法用，直接销毁，避免下一件商品又被它挡住
          try { win.destroy(); } catch { /* */ }
        } else if (!stopped && win && !(typeof win.isDestroyed === 'function' && win.isDestroyed())) {
          await leaveWindowForManual(`上架中断：${String(error?.message || error).slice(0, 40)}`);
        }
      } catch { /* */ }
      if (stopped && String(error?.code || '') !== 'STOPPED') {
        throw Object.assign(new Error(cancelState.reason || '已手动停止'), { code: 'STOPPED' });
      }
      throw error;
    } finally {
      activeLog = null;
      activePublishWindow = null;
      activeStep = '';
      // 全局文件选择框拦截随发布窗口一起结束；成功入仓时窗口已关，dispose 只需清监听
      if (fileChooserGuard) {
        try { fileChooserGuard.dispose(); } catch { /* */ }
        fileChooserGuard = null;
      }
      if (win && typeof win.isDestroyed === 'function' && win.isDestroyed()) win = null;
    }
  }

  /**
   * 回填（老软件「入仓后再把图片/详情写进仓库商品」那一段）。
   * 走开放平台接口：taobao.picture.upload → taobao.item.joint.img / taobao.item.update(desc)，
   * 最后用 taobao.item.seller.get 回读 item_imgs 做一致性校验 —— **只信回读**。
   * 凭证未填时明确返回 DRIVER_NOT_READY 并列出要申请哪个接口，不谎报成功。
   */
  async function backfill(input = {}) {
    activeLog = typeof input.log === 'function' ? input.log : null;
    try {
      const detail = input.detail || {};
      const draft = input.draft || {};
      const numIid = String(input.numIid || detail.warehouseItemId || '').trim();
      if (!/^\d+$/.test(numIid)) {
        return { ok: false, code: 'NOT_LANDED', message: '该选品还没有仓库商品编号，无法回填' };
      }
      const space = input.pictureSpace || pictureSpace;
      const ready = space ? await space.readiness() : { configured: false, note: '图片空间模块未接入' };
      if (!ready.configured) {
        return {
          ok: false, code: 'DRIVER_NOT_READY',
          message: `回填需要接口凭证：${ready.note}。需要申请：taobao.picture.upload（图片空间）/ taobao.item.joint.img（关联主图）/ taobao.item.update（写详情）/ taobao.item.seller.get（回读校验）`,
        };
      }
      const slots = [];
      const imagePlan = resolveImagePlan(draft, detail);
      // 1) 1:1 主图：与发布页共用同一个图位解析结果，只提交当前选中的 square 或 squareSrc 组。
      const squares = imagePlan.square.slice(0, 5);
      let mainFilled = 0;
      if (squares.length) {
        const up = await space.uploadMany(squares, { titlePrefix: `主图-${numIid}`, onLog: line => emit(String(line).slice(0, 200)) });
        // 主图整组替换：少一张就不关联，避免把部分新图和外来的旧图混在同一组。
        if (up.uploaded.length === squares.length) {
          const joint = await space.jointImages(numIid, up.uploaded, { major: true });
          mainFilled = joint.applied;
          emit(`[backfill] 主图已关联到商品 ${joint.applied}/${squares.length} 张${joint.failures?.length ? `（失败 ${joint.failures.slice(0, 2).map(f => f.message).join('、')}）` : ''}`);
        } else {
          emit(`[backfill] 主图只上传成功 ${up.uploaded.length}/${squares.length} 张，本次不关联，保留仓库原主图`);
        }
        slots.push({ id: 'main', kind: 'main', label: '1:1 主图', imageUrl: squares[0], state: mainFilled >= squares.length ? 'filled' : mainFilled ? 'filling' : 'failed', readbackCount: mainFilled, expectedCount: squares.length });
      }
      // 2) 详情图：写入商品描述
      const detailImages = imagePlan.detail.slice(0, 40);
      if (detailImages.length) {
        const up = await space.uploadMany(detailImages, { titlePrefix: `详情-${numIid}`, onLog: line => emit(String(line).slice(0, 200)) });
        const urls = up.uploaded.map(row => row.url);
        const complete = urls.length === detailImages.length;
        const upd = urls.length
          ? await space.updateDescription(numIid, urls, { text: '' })
          : { ok: false, message: '没有上传成功的详情图', count: 0 };
        emit(`[backfill] 详情图写入商品描述 ${upd.ok ? `${upd.count} 张` : `失败：${upd.message}`}${complete ? '' : ` · 仅 ${urls.length}/${detailImages.length} 张上传成功`}`);
        slots.push({ id: 'detail', kind: 'detail', label: '详情页', imageUrl: detailImages[0], state: upd.ok && complete ? 'filled' : 'failed', readbackCount: upd.ok ? upd.count : 0, expectedCount: detailImages.length });
      }
      // 3) 素材图（透明/白底）：本机文件先上传图片空间，再按详情图同一条路写进描述末尾
      const materialFiles = [draft.transFile, draft.whiteFile].filter(f => f && /\.(?:jpe?g|png|webp)$/i.test(String(f)));
      if (materialFiles.length) {
        const up = await space.uploadMany(materialFiles.map(f => String(f).startsWith('local:') ? String(f) : `local:${f}`), { titlePrefix: `素材-${numIid}`, onLog: line => emit(String(line).slice(0, 200)) });
        slots.push({ id: 'material', kind: 'white', label: '素材图', state: up.uploaded.length ? 'filled' : 'failed', readbackCount: up.uploaded.length, expectedCount: materialFiles.length });
      }
      // 4) 回读校验（只信回读）
      const readback = await space.readItemImages(numIid);
      if (!readback.ok) {
        emit(`[backfill] 回读失败：${readback.code || ''} ${readback.message || ''}`);
      } else {
        const actual = readback.images.length;
        const mainSlot = slots.find(s => s.kind === 'main');
        if (mainSlot) mainSlot.readbackCount = actual;
        emit(`[backfill] 回读商品图片 ${actual} 张${readback.title ? `（${String(readback.title).slice(0, 20)}）` : ''}；详情描述长度 ${String(readback.desc || '').length}`);
      }
      const allMatched = slots.length > 0 && slots.every(s => s.state === 'filled');
      return { ok: allMatched, slots, readback: readback.ok ? { images: readback.images.length } : { error: readback.message }, message: allMatched ? '回填完成并已回读一致' : '回填未完全一致，请到商家后台核对' };
    } finally {
      activeLog = null;
    }
  }

  /** 自测用：素材中心相关脚本同样是字符串，只 `node --check` 驱动本身查不出来。 */
  const __mediaScripts = {
    MEDIA_PRESENT_SCRIPT, MEDIA_OPEN_LOCAL_SCRIPT, MEDIA_FINISH_SCRIPT,
    MEDIA_FRAME_CONFIRM_SCRIPT, MEDIA_PARENT_OK_SCRIPT, MEDIA_BOX_SCRIPT,
    MEDIA_CLOSE_SCRIPT, MEDIA_CLOSE_FRAME_SCRIPT,
    mediaInjectScript, mediaCardScript, buildFindAssetCardScript, mediaUploadStateScript, buildImageEntryPointsScript, MEDIA_CHALLENGE_SCRIPT,
    buildOpenDetailImageEntryScript, buildReadNamedAssetsScript,
  };
  return { publish, backfill, cancel, currentStep, __mediaScripts, __resolveImagePlan: resolveImagePlan };
}

module.exports = {
  createPublishDriver, PUBLISH_HOST, materialUrlCandidates, normalizeMaterialUrl, imageHeaderSize,
  // 店铺中分类：设置页「刷新」用只读探测窗口读选项，跑的就是同一段页面脚本
  readShopCategoryOptionsScript,
  // 自测用：注入到发布页里的脚本必须能编译（`node --check` 只查驱动本身，不查这些字符串）。
  __scripts: {
    probeScript, fillTitleScript, fillBrandScript, fillAttrsScript, fillSkuScript,
    fillNamedScript, fillRequiredGapsScript, fillSmartScript, fillFormScript, fillSkuSearchTitleScript, selectSkuSpecsScript,
    collapseAssistantScript, fillMultiBuyScript, createSkuSpecsScript, selectBrandFirstScript, fillSampleAndMultiBuyScript,
    fillShelfLifeScript, focusDiscountScript, readExtraScript,
    openShopCategoryScript, readShopCategoryScript, pickShopCategoryScript, readShopCategoryOptionsScript,
    readBrandScript, readSampleScript, fillFoodSafetyScript,
    fillGuideTitleScript, fillSeriesScript, fillSampleItemScript, closeCategoryDialogScript,
    fillTitlesAllScript, readCategoryDialogScript, preSubmitCheckScript, fieldDiagnosticsScript, writeBrandSeriesScript,
    suppressCategoryDialogScript,
    openSpecDrawerScript, fillSpecValuesScript, focusSpecInputScript, confirmSpecDrawerScript, clickSubmitScript, clickSubmitDomScript, submitStateScript,
    confirmWarehouseRadioScript, submitStallDiagScript,
    clickUploadTriggerScript, confirmUploadDialogScript,
    buildReadImageGroupScript, buildFindUploadInputScript, buildOpenImageEntryScript,
    buildSyncMainImagesScript, buildWriteMainImagesScript, buildMakeSquarePngScript, buildConvertToJpegScript, buildWhiteBgDiagScript, buildWriteGuideImageScript,
    buildVerifyGuideImageScript, buildSyncGuideImageFromDomScript,
    buildFillTallImagesScript, buildFillSkuImageUrlsScript,
    buildFillSkuNetWeightScript, buildFillSkuNetWeightDomScript,
    buildOpenSkuProductScript, buildFocusSkuProductSearchScript, buildSkuProductOptionsScript, buildPickSkuProductScript, buildCreateSkuProductScript, buildSaveCreateProductScript,
    buildDetailCountScript, buildClearDetailScript, buildOpenDetailSourceScript,
    buildFillDetailSourceScript, buildConfirmDetailImportScript, buildDetailReadbackScript,
    buildEnsureProvinceScript, locateProvinceOverlayScript, writeProvinceViaStateScript,
  },
};
