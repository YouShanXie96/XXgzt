'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const defaultPurchase=require('../connectors/internal-purchase-taobao-connector');
const defaultQualification=require('../connectors/qualification-tmall-publisher');
const {within,assertNoLinks,atomicWrite}=require('../lib/storage');

function field(row,names){for(const name of names){const v=row[name];if(v!=null&&String(v).trim())return String(v).trim();}return '';}
function productsFromRows(rows){
  if(!Array.isArray(rows)||rows.length>20000||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('商品表需为有效数组且不超过20000行');
  const products=new Map();
  for(const row of rows){const id=field(row,['商品ID','商品id','宝贝ID','itemId','productId','id']);if(!/^\d{6,22}$/.test(id))throw new Error('每行需要完整的商品ID（6–22位数字），请在表格中设为文本，避免科学计数法');
    products.set(id,{id,itemId:id,productId:id,title:field(row,['商品标题','商品名称','标题','title','name'])||id,imageUrl:field(row,['图片链接','主图','imageUrl']),...row.itemId?{itemId:id}:{}});
  }return [...products.values()];
}
function validatePlan(input,storeId){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('活动草稿格式不正确');
  if(input.id!=null&&(typeof input.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(input.id)))throw new Error('活动草稿ID格式不正确');
  const name=String(input.name||'').trim();if(!name||name.length>100)throw new Error('活动名称需为1–100个字符');
  const startsAt=input.startsAt||input.startTime,endsAt=input.endsAt||input.endTime;
  if(!Number.isFinite(Date.parse(startsAt))||!Number.isFinite(Date.parse(endsAt))||Date.parse(endsAt)<=Date.parse(startsAt))throw new Error('请填写有效的开始和结束时间');
  const list=input.scope?.products||input.products||[];
  if(!Array.isArray(list)||list.length>2000||list.some(product=>!product||!['string','object'].includes(typeof product)))throw new Error('活动商品需为数组且不超过2000个');
  const products=list.map(p=>typeof p==='string'?{id:p,title:p}:{id:String(p.id||p.itemId||p.productId||''),title:String(p.title||p.name||p.id||'')});
  if(products.some(p=>!/^\d{6,22}$/.test(p.id)))throw new Error('商品ID必须是数字（6–22 位）');
  if(new Set(products.map(p=>p.id)).size!==products.length)throw new Error('商品ID重复');
  const otherSkus=Number(input.skuDiscountRule?.otherSkus??input.otherSkus??input.discount??9.5);
  const lastSku=Number(input.skuDiscountRule?.lastSku??input.lastSku??otherSkus);
  for(const d of [otherSkus,lastSku])if(!Number.isFinite(d)||d<0.1||d>9.9||Math.abs(d*10-Math.round(d*10))>1e-8)throw new Error('折扣需为0.1–9.9的一位小数');
  // 参考同类工作台：门槛 / 优惠形式 / 叠加券 / 说明 都是方案的一部分（当前淘宝单件宝按“折扣”提交 SKU 优惠，SKU 折扣以 skuDiscountRule 为准）。
  const thresholdSource=input.threshold&&typeof input.threshold==='object'?input.threshold:{};
  const thresholdKind=['none','amount','quantity'].includes(thresholdSource.kind)?thresholdSource.kind:'none';
  const thresholdValue=Number(thresholdSource.value);
  if(thresholdKind!=='none'&&(!Number.isFinite(thresholdValue)||thresholdValue<=0))throw new Error('请填写有效的门槛数值');
  const discountSource=input.discount&&typeof input.discount==='object'&&!Array.isArray(input.discount)?input.discount:{};
  const legacyDiscount=typeof input.discount==='number'&&Number.isFinite(input.discount)?Number(input.discount):null;
  const discountKind=['percentage','amount-off','fixed-price'].includes(discountSource.kind)?discountSource.kind:'percentage';
  const discountValue=discountSource.value!==undefined?Number(discountSource.value):(legacyDiscount??otherSkus);
  if(!Number.isFinite(discountValue)||discountValue<=0)throw new Error('请填写有效的优惠数值');
  if(thresholdKind==='amount'&&discountKind==='amount-off'&&discountValue>=thresholdValue)throw new Error('优惠金额必须小于金额门槛');
  if(input.audience!==undefined&&input.audience!=='fans')throw new Error('当前内购会只支持粉丝人群');
  const stackingSource=input.stacking&&typeof input.stacking==='object'?input.stacking:{};
  const description=String(input.description||'').trim().slice(0,120);
  const plan={id:input.id||randomUUID(),storeProfileId:storeId,name,description,startsAt,endsAt,audience:'fans',scope:{kind:'selected-products',products},products,skuDiscountRule:{otherSkus,lastSku},threshold:{kind:thresholdKind,value:thresholdKind==='none'?0:thresholdValue},discount:{kind:discountKind,value:discountValue},stacking:{storeCoupon:stackingSource.storeCoupon===true,platformCoupon:stackingSource.platformCoupon===true,memberDiscount:stackingSource.memberDiscount===true},status:'draft',executionStatus:'draft',updatedAt:new Date().toISOString()};
  if(input.attention)plan.attention=input.attention;
  return plan;
}
function createOperationsService(ctx,options={}){
  const purchase=options.purchase||defaultPurchase,qualification=options.qualification||defaultQualification;
  const tokens=new Map(),busy=new Set(),tasks=new Set(),activeStores=new Set();let disposed=false;
  const key=(module,id)=>`${module}/${id}.json`;
  const empty=module=>module==='purchase'?{plans:[],logs:[]}:{products:[],logs:[]};
  const load=async(module,id)=>{const snapshot=await ctx.readJson(key(module,id),empty(module));if(!Array.isArray(snapshot.logs)||!Array.isArray(snapshot[module==='purchase'?'plans':'products']))throw new Error('本地业务数据格式错误，请从备份恢复');return snapshot;};
  async function save(module,id,snapshot){await ctx.writeJson(key(module,id),snapshot);return snapshot;}
  function log(s,message,status='info',extra={}){s.logs.unshift({id:randomUUID(),at:new Date().toISOString(),message,status,...extra});s.logs=s.logs.slice(0,1000);}
  function alive(){if(disposed)throw new Error('程序正在退出或恢复数据');}
  async function guard(module,id,fn){alive();const k=module+id;if(busy.has(k))throw new Error('该店铺已有任务正在运行，请等待完成');busy.add(k);activeStores.add(id);const task=Promise.resolve().then(()=>{alive();return fn();});tasks.add(task);try{return await task;}finally{busy.delete(k);tasks.delete(task);if(![...busy].some(value=>value.endsWith(id)))activeStores.delete(id);}}
  function progress(module,storeId){return p=>{alive();ctx.emit?.({module,storeId,...p,message:p.message||[p.title,p.detail].filter(Boolean).join('：')});};}
  function invalidate(id,planId){for(const[t,value]of tokens)if(value.storeId===id&&value.planId===planId)tokens.delete(t);}
  async function imageFile(id,product){const relative=String(product.imagePath||'').replace(/\\/g,'/');if(!relative.startsWith(`qualification/images/${id}/`))throw new Error('标签图片路径不属于当前店铺');return assertNoLinks(ctx.dataDir,relative);}
  async function handlePurchase(action,p={}){
    if(disposed)throw new Error('程序正在退出或恢复数据');
    const store=ctx.getStore(p.storeId),id=store.id;
    if(!['load','template','import','save','delete','prepare','create','close','resolveCheck','activities'].includes(action))throw new Error('不支持的内购会操作');
    if(action==='load')return load('purchase',id);
    if(action==='template')return ctx.files.exportRows('内购会商品导入模板.xlsx',[],[{key:'商品ID',label:'商品ID'},{key:'商品标题',label:'商品标题'}]);
    if(action==='import'){const file=await ctx.files.pickImport();if(file.canceled)return file;return {products:productsFromRows(file.rows),path:file.path};}
    if(action==='delete')return guard('purchase',id,async()=>{
      const s=await load('purchase',id),plan=s.plans.find(x=>x.id===(p.id||p.planId));if(!plan)throw new Error('任务不存在，请刷新后重试');
      if(['creating','prepared','needs-check'].includes(plan.status))throw new Error('任务正在执行或等待核对，请先处理完再删除');
      s.plans=s.plans.filter(x=>x.id!==plan.id);invalidate(id,plan.id);log(s,'已删除任务：'+plan.name,'warning');return save('purchase',id,s);
    });
    if(action==='save')return guard('purchase',id,async()=>{
      const s=await load('purchase',id),plan=validatePlan(p.plan,id),old=s.plans.find(x=>x.id===plan.id);
      if(['created','creating','needs-check','ended'].includes(old?.status))throw new Error(old?.status==='needs-check'||old?.status==='creating'?'创建结果尚未核对，不能修改或重新准备；请先核对后台活动。':'已创建或结束的活动不能覆盖成草稿，请新建任务');
      s.plans=[plan,...s.plans.filter(x=>x.id!==plan.id)];for(const[t,v]of tokens)if(v.storeId===id&&v.planId===plan.id)tokens.delete(t);
      log(s,'保存活动草稿：'+plan.name);return save('purchase',id,s);
    });
    return guard('purchase',id,async()=>{
      const s=await load('purchase',id),plan=s.plans.find(x=>x.id===(p.id||p.planId));if(!plan)throw new Error('请选择已保存的活动草稿');
      if(action==='prepare'){
        if(['needs-check','creating'].includes(plan.status))throw new Error('上次创建结果尚未核对，禁止重新准备；请先核对后台活动并确认未创建。');
        if(plan.scope.products.length<3)throw new Error('淘宝内购会至少需要 3 个商品');
        if(Date.parse(plan.endsAt)<=Date.now())throw new Error('活动结束时间已过，请修改草稿');
        if(['created','ended'].includes(plan.status))throw new Error('该任务已创建或结束，请勿重复创建');
        invalidate(id,plan.id);alive();
        // 用户反馈“点创建后要等很久才有反应”：先把“正在打开页面”的进度立刻推给界面，再去读店铺页面。
        progress('purchase',id)({phase:'prepare',stage:'open',title:'打开淘宝内购会页面',detail:'正在使用本机店铺会话打开淘宝页面并检查登录状态',status:'running'});
        const wc=await ctx.browser.page(id,'purchase');alive();
        try{
          // 参考同类工作台的“处理”机制：遇到登录/安全验证/需要人工选文件时，记录一条提示并把店铺页面显示出来，
          // 用户处理完点“我已处理，继续”再重跑准备（软件不会自己绕过验证）。
          const markAttention=(kind,detail,extra)=>{
            alive();
            plan.attention={kind,detail:String(detail||''),at:new Date().toISOString(),...(extra||{})};
            ctx.emit?.({module:'purchase-attention',storeId:id,planId:plan.id,kind,message:plan.attention.detail});
          };
          const visibility=kind=>async(visible,filePath,totalSkuCount)=>{
            if(!visible)return;
            alive();
            if(kind==='security-challenge')markAttention(kind,'淘宝返回访问被拒绝或安全验证，已停止自动操作；请点击“处理”，在店铺页面完成验证后点“我已处理，继续”。');
            else if(kind==='manual-product-selection')markAttention(kind,'SKU 管理页需要人工确认（搜索/展开/读取）；点击“处理”回到店铺的 SKU 管理页，处理完点“我已处理，继续”。');
            else markAttention(kind,`需要人工在店铺页面选择本机 SKU 文件：${filePath||''}（共 ${totalSkuCount||0} 行）；选完等页面校验通过后点“我已处理，继续”。`,{filePath,totalSkuCount});
            await ctx.browser.show(id,'purchase');
          };
          plan.attention=null;
          const preparation=await purchase.prepareInternalPurchaseActivity(wc,plan,store.name,progress('purchase',id),visibility('security-challenge'),visibility('manual-product-selection'),async(products,rule)=>{
            alive();
            const template=await fs.readFile(path.join(ctx.resourceDir,'internal-purchase-batch-template.xlsx'));
            const bytes=purchase.buildInternalPurchaseBatchWorkbook(template,products,rule);
            const target=within(ctx.dataDir,`purchase/imports/${randomUUID()}.xlsx`);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);return target;
          },visibility('manual-batch-upload'));
          if(!preparation||!['prepared','blocked','login-required'].includes(preparation.status)||typeof preparation.message!=='string')throw new Error('平台准备结果格式异常，不能进入确认创建');
          plan.preparation=preparation;plan.status=preparation.status;plan.executionStatus=preparation.status;
          if(preparation.status==='prepared')plan.attention=null;
          let requestId;
          if(preparation.status==='prepared'){
            const selected=(preparation.products||[]).filter(product=>product.status==='selected');const requested=new Set(plan.scope.products.map(product=>product.id));
            if(selected.length<3||selected.some(product=>!requested.has(String(product.id)))||new Set(selected.map(product=>product.id)).size!==selected.length)throw new Error('平台准备的商品范围异常，不能创建活动');
            const effective={...plan,name:preparation.activityName||plan.name,startsAt:preparation.startsAt||plan.startsAt,endsAt:preparation.endsAt||plan.endsAt,products:selected.map(({id,title})=>({id,title})),scope:{kind:'selected-products',products:selected.map(({id,title})=>({id,title}))}};
            validatePlan(effective,id);alive();
            requestId=randomUUID();tokens.set(requestId,{storeId:id,planId:plan.id,plan:effective,expires:Date.now()+5*60*1000,wcId:wc.id});
          }
          log(s,preparation.message,preparation.status);await save('purchase',id,s);return {...s,preparation,requestId};
        }catch(e){plan.status='failed';log(s,e.message,'failed');await save('purchase',id,s);throw e;}
      }
      if(action==='create'){
        const token=tokens.get(p.requestId);
        if(p.confirmed!==true||!token||token.storeId!==id||token.planId!==plan.id||token.expires<Date.now()||plan.status!=='prepared')throw new Error('确认已失效，请重新准备并核对活动后创建');
        tokens.delete(p.requestId);alive();
        progress('purchase',id)({phase:'create',stage:'open',title:'准备正式提交',detail:'正在打开淘宝内购会页面并核对页面状态',status:'running'});
        const wc=await ctx.browser.page(id,'purchase');alive();
        if(token.wcId!==wc.id)throw new Error('确认已失效，店铺页面已变化，请重新准备');
        plan.status='creating';plan.executionStatus='creating';plan.attemptedActivityName=token.plan.name;log(s,'开始创建：'+token.plan.name);await save('purchase',id,s);
        try{
          const result=await purchase.createInternalPurchaseActivity(wc,token.plan,progress('purchase',id));
          if(!result||typeof result.activityName!=='string'||!result.activityName.trim()||!Number.isFinite(Date.parse(result.createdAt))||typeof result.message!=='string')throw new Error('平台未返回创建结果');
          // 2026-10-14 修复：确认创建时淘宝可能按“当前时间”校准活动开始时间，活动名会带新的时间后缀；
          // 不再用“名称必须与准备阶段完全一致”判定失败，改为在平台活动列表里独立核对同名活动是否存在。
          const activities=await purchase.listInternalPurchaseActivities(wc);
          const created=Array.isArray(activities)?activities.filter(activity=>activity.name===result.activityName):[];
          if(created.length!==1)throw new Error(`淘宝活动列表里没有唯一确认到「${result.activityName}」（匹配 ${created.length} 条）`);
          const card=created[0];
          Object.assign(plan,token.plan,{name:result.activityName,status:'created',executionStatus:'created',platformActivityName:result.activityName,platformStartsAt:card.startsAt||undefined,platformEndsAt:card.endsAt||undefined,qrCodeDataUrl:/^data:image\/(?:png|jpeg);base64,/.test(result.qrCodeDataUrl||'')?result.qrCodeDataUrl:undefined,createdAt:result.createdAt});
          const startsAt=String(card.startsAt||'').replace(' ','T').slice(0,16),endsAt=String(card.endsAt||'').replace(' ','T').slice(0,16);
          if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAt))plan.startsAt=startsAt;
          if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endsAt))plan.endsAt=endsAt;
          log(s,`${result.message}（后台活动：${result.activityName}${card.startsAt?` · ${card.startsAt} 至 ${card.endsAt}`:''}）`,'success');
          return save('purchase',id,s);
        }
        catch(e){plan.status='needs-check';plan.executionStatus='needs-check';log(s,'创建结果需要核对：'+e.message,'failed');await save('purchase',id,s);throw new Error(e.message+'。请先查看后台活动列表核对，确认未创建后解除核对状态再重试。');}
      }
      if(action==='close'){
        if(p.confirmed!==true)throw new Error('请确认要结束的活动');if(plan.status!=='created'||!plan.platformActivityName)throw new Error('没有已确认创建的后台活动名称');
        alive();const wc=await ctx.browser.page(id,'purchase');alive();
        const activities=await purchase.listInternalPurchaseActivities(wc);if(!Array.isArray(activities)||activities.filter(activity=>activity.name===plan.platformActivityName&&activity.status==='running').length!==1)throw new Error('后台没有唯一对应的运行中活动，已停止结束操作');
        const result=await purchase.closeInternalPurchaseActivity(wc,plan.platformActivityName);if(result?.status!=='ended'||result.activity?.name!==plan.platformActivityName||result.activity?.status!=='ended')throw new Error('后台未确认指定活动已经结束，请人工核对');plan.status='ended';plan.executionStatus='ended';log(s,'已核对活动结束：'+plan.platformActivityName,'success');return save('purchase',id,s);
      }
      if(action==='resolveCheck'){
        if(!['needs-check','creating'].includes(plan.status)||p.confirmed!==true||!['not-created','created'].includes(p.resolution))throw new Error('请先人工核对后台活动列表，并明确确认上次活动未创建');
        alive();const wc=await ctx.browser.page(id,'purchase');alive();const activities=await purchase.listInternalPurchaseActivities(wc);
        // 2026-10-14 新增：确认创建时淘宝会按当前时间校准活动名（如 荣锦初宇10141159 → 荣锦初宇1014033），
        // 旧版本因此在“待核对”里卡住。用户可以读取后台活动列表，认领确实已经创建的那一条。
        if(p.resolution==='created'){
          const wanted=String(p.activityName||'').trim();
          if(!wanted)throw new Error('请选择要认领的后台活动');
          const hit=Array.isArray(activities)?activities.filter(activity=>activity.name===wanted&&activity.status==='running'):[];
          if(hit.length!==1)throw new Error('后台没有唯一对应的运行中活动：'+wanted);
          const card=hit[0];
          Object.assign(plan,{name:card.name,status:'created',executionStatus:'created',platformActivityName:card.name,platformStartsAt:card.startsAt||undefined,platformEndsAt:card.endsAt||undefined,createdAt:new Date().toISOString()});
          const startsAt=String(card.startsAt||'').replace(' ','T').slice(0,16),endsAt=String(card.endsAt||'').replace(' ','T').slice(0,16);
          if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAt))plan.startsAt=startsAt;
          if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endsAt))plan.endsAt=endsAt;
          log(s,`已认领后台活动：${card.name}${card.startsAt?`（${card.startsAt} 至 ${card.endsAt}）`:''}`,'success');
          return save('purchase',id,s);
        }
        const expected=plan.attemptedActivityName||plan.preparation?.activityName||plan.name;
        if(!Array.isArray(activities)||activities.some(activity=>activity.name===expected))throw new Error('后台仍有同名活动或列表无法确认，不能解除核对状态');
        plan.status='draft';plan.executionStatus='draft';delete plan.preparation;invalidate(id,plan.id);plan.checkedNotCreatedAt=new Date().toISOString();log(s,'人工确认未创建，已解除核对状态：'+expected,'warning');return save('purchase',id,s);
      }
      if(action==='activities'){
        alive();const wc=await ctx.browser.page(id,'purchase');alive();
        const activities=await purchase.listInternalPurchaseActivities(wc);
        if(!Array.isArray(activities))throw new Error('淘宝活动列表没有返回可识别的活动');
        return {activities};
      }
      throw new Error('不支持的内购会操作');
    });
  }
  async function handleQualification(action,p={}){
    if(disposed)throw new Error('程序正在退出或恢复数据');
    const store=ctx.getStore(p.storeId),id=store.id;
    if(!['load','preview','import','export','addImage','upload'].includes(action))throw new Error('不支持的标签图操作');
    if(action==='load')return load('qualification',id);
    if(action==='preview'){
      const s=await load('qualification',id),product=s.products.find(x=>x.id===String(p.itemId));if(!product?.imagePath)throw new Error('请先选择标签图片');
      const bytes=await fs.readFile(await imageFile(id,product));const image=ctx.nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw new Error('图片无法读取');
      const size=image.getSize();const small=size.width>1000?image.resize({width:1000}):image;return {dataUrl:'data:image/jpeg;base64,'+small.toJPEG(85).toString('base64'),name:product.imageName};
    }
    if(action==='import')return guard('qualification',id,async()=>{
      const file=await ctx.files.pickImport();if(file.canceled)return file;const incoming=productsFromRows(file.rows),s=await load('qualification',id),existing=new Map(s.products.map(x=>[x.id,x]));
      for(const product of incoming)existing.set(product.id,{...existing.get(product.id),...product,status:existing.get(product.id)?.status||'待选择图片'});s.products=[...existing.values()];log(s,`已导入${incoming.length}个商品`);return save('qualification',id,s);
    });
    if(action==='export'){const s=await load('qualification',id);return ctx.files.exportRows('商品标签图记录.xlsx',s.products.map(({imagePath,...r})=>r));}
    return guard('qualification',id,async()=>{
      const s=await load('qualification',id);
      if(action==='addImage'){
        const product=s.products.find(x=>x.id===String(p.itemId));if(!product)throw new Error('请先导入商品表');
        const file=await ctx.files.pickImage();if(file.canceled)return file;
        alive();if((await fs.stat(file.path)).size>20_000_000)throw new Error('原始图片超过20MB，请先调整图片尺寸');
        let bytes=await fs.readFile(file.path),native=ctx.nativeImage.createFromBuffer(bytes);if(native.isEmpty())throw new Error('图片无法解码，请选择有效的PNG或JPG');
        if(bytes.length>=3_000_000){for(const quality of [95,90,85,75,65,55,40]){bytes=native.toJPEG(quality);if(bytes.length<3_000_000)break;}}
        if(bytes.length>=3_000_000)throw new Error('图片压缩后仍超过3MB，请先调整图片尺寸');
        const png=bytes[0]===137&&bytes[1]===80;const mediaType=png?'image/png':'image/jpeg';
        if(!png&&!(bytes[0]===255&&bytes[1]===216)){bytes=native.toJPEG(90);if(bytes.length>=3_000_000)throw new Error('转换后的图片超过3MB');}
        if(ctx.nativeImage.createFromBuffer(bytes).isEmpty())throw new Error('转换后的图片无法解码，尚未保存');
        const relative=`qualification/images/${id}/${product.id}-${randomUUID()}.${png?'png':'jpg'}`;const target=within(ctx.dataDir,relative);alive();await atomicWrite(ctx.dataDir,relative,bytes);
        Object.assign(product,{imagePath:path.relative(ctx.dataDir,target),imageName:path.basename(file.path),mediaType,imageHash:createHash('sha256').update(bytes).digest('hex'),status:'待确认上传'});log(s,'已选择标签图片：'+product.id);return save('qualification',id,s);
      }
      if(action==='upload'){
        if(p.confirmed!==true)throw new Error('请确认商品ID、店铺及所选真实标签图片');
        const selection=p.itemIds||[p.itemId];if(!Array.isArray(selection)||!selection.length||selection.length>2000||selection.some(value=>!/^\d{6,22}$/.test(String(value))))throw new Error('请选择有效的商品ID，单次不超过2000个');
        const ids=Array.from(new Set(selection.map(String)));const products=ids.map(itemId=>s.products.find(x=>x.id===itemId));
        if(!products.length||products.some(x=>!x?.imagePath))throw new Error('请选择已有本地标签图片的商品');
        // Validate every local asset before opening any merchant page.
        for(const product of products){const bytes=await fs.readFile(await imageFile(id,product));if(bytes.length>=3_000_000||!['image/png','image/jpeg'].includes(product.mediaType)||createHash('sha256').update(bytes).digest('hex')!==product.imageHash||ctx.nativeImage.createFromBuffer(bytes).isEmpty())throw new Error('标签图片已改变或格式无效，请重新选择和确认');}
        alive();const wc=await ctx.browser.page(id,'qualification');alive();
        for(const product of products){
          try{
            alive();const bytes=await fs.readFile(await imageFile(id,product));if(createHash('sha256').update(bytes).digest('hex')!==product.imageHash)throw new Error('本地图片已改变，请重新选择和确认');
            const result=await qualification.uploadTmallQualificationLabel(wc,{itemId:product.id,bytes,mediaType:product.mediaType},{navigate:url=>wc.loadURL(url),onProgress:progress('qualification',id),allowRequiredFieldRepair:false});
            if(result?.payload?.confirmed!==true||result.payload.code!==200||String(result.payload.itemId)!==product.id||result.payload.field!=='预包装标签图1')throw new Error('未收到指定商品标签图的明确成功确认');product.status=result.payload.skippedExisting?'后台已有图片':'上传已确认';product.message=result.payload.detail;log(s,`${product.id}：${product.message}`,'success');
          }catch(e){product.status='失败/待核对';product.message=e.platformResponse?.message||e.message;log(s,`${product.id}：${product.message}`,'failed');if(/LOGIN|SECURITY|TOKEN|登录|验证/.test(e.code||e.message)){await save('qualification',id,s);throw e;}}
          await save('qualification',id,s);alive();
        }return s;
      }
      throw new Error('不支持的标签图操作');
    });
  }
  return {handlePurchase,handleQualification,dispose:async()=>{disposed=true;tokens.clear();for(const id of activeStores)ctx.browser.closeStore?.(id);await Promise.allSettled([...tasks]);}};
}
module.exports={createOperationsService,productsFromRows,validatePlan};
