'use strict';

// 趋势选品（参考同类工作台）：每月上品推荐 / 品线看板 / 关键词列表 / 上品日历 / 过滤规则。
// 数据全部来自本机已保存的“趋势关键词”批次（生意参谋流量解析），页面不访问平台、不补造缺失值。
(() => {
  const DAY=86400000;
  const MONTHS=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const GRADE_ORDER={S:3,A:2,B:1,'':0};
  const fmtNum=value=>value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:0});
  const fmtPct=value=>value==null||!Number.isFinite(Number(value))?'<span class="tb-na">—</span>':`<span class="tb-${value>=0?'up':'down'}">${value>=0?'↑':'↓'}${(Math.abs(Number(value))*100).toFixed(1)}%</span>`;
  const gradeBadge=grade=>grade?`<span class="tb-grade g${grade}">${grade}</span>`:'<span class="tb-na">—</span>';
  const statusBadge=status=>{
    const map={'旺季中':'hot','该上品了':'now','准备中':'prep','还早':'early','常年在售':'flat','已剔除':'removed'};
    return `<span class="tb-status ${map[status]||''}">${status||'—'}</span>`;
  };
  const monthDay=value=>{if(!value)return '—';const d=new Date(`${value}T00:00:00Z`);return Number.isNaN(d.getTime())?String(value):`${d.getUTCMonth()+1}月${d.getUTCDate()}日`;};
  const monthOf=value=>{if(!value)return null;const d=new Date(`${String(value).slice(0,10)}T00:00:00Z`);return Number.isNaN(d.getTime())?null:d.getUTCMonth()+1;};
  const heatLevel=value=>value>=0.8?4:value>=0.6?3:value>=0.4?2:value>0?1:0;
  const currentMonth=()=>new Date().getMonth()+1;
  function heatStrip(heat=[],current=currentMonth()){
    return `<div class="tb-heat" role="img" aria-label="1–12 月走势色谱">${Array.from({length:12},(_,index)=>{
      const value=Number(heat[index])||0;
      return `<i class="h${heatLevel(value)}${index+1===current?' now':''}" title="${index+1}月 · 相对热度 ${(value*100).toFixed(0)}%"><span>${index+1}</span></i>`;
    }).join('')}</div>`;
  }
  function pctCell(value){return `<span class="tb-pct">${fmtPct(value)}</span>`;}
  function tabHeader(s){
    const tabs=[['monthly','每月上品推荐'],['lines','品线看板'],['keywords','关键词列表'],['calendar','上品日历'],['filters','过滤规则']];
    return `<nav class="tb-subnav" aria-label="趋势选品板块">${tabs.map(([id,label])=>`<button type="button" class="tb-tab${s.tbTab===id?' on':''}" data-action="insights:tb-tab" data-insights-page="trends" data-value="${id}">${label}</button>`).join('')}</nav>`;
  }
  function axisMonths(){
    const today=new Date();
    return Array.from({length:12},(_,offset)=>{
      const date=new Date(today.getFullYear(),today.getMonth()+offset,1);
      return {month:date.getMonth()+1,year:date.getFullYear()};
    });
  }
  function axisLabel(axis){
    const first=axis[0],last=axis[axis.length-1];
    const yearChange=first.year!==last.year;
    return `1–12月${yearChange?` · ${first.year}年${first.month}月–${last.year}年${last.month}月`:''}`;
  }
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function timeline(row,axis){
    const start=Date.UTC(axis[0].year,axis[0].month-1,1);
    const end=Date.UTC(axis[11].year,axis[11].month,1);
    // 用 SVG 的 x/width 属性绘制：应用启用了 CSP，行内 style 会被拦截（宽度会变成 0）。
    const position=ms=>clamp((ms-start)/(end-start)*1000,0,1000);
    const bars=[];
    if(row.listDate&&row.burstDate){
      const list=Date.parse(`${row.listDate}T00:00:00Z`),burst=Date.parse(`${row.burstDate}T00:00:00Z`);
      if(Number.isFinite(list)&&Number.isFinite(burst)&&burst>list)bars.push(`<rect class="bar prep" x="${position(list).toFixed(1)}" y="4" width="${Math.max(1,position(burst)-position(list)).toFixed(1)}" height="18" rx="3"/>`);
    }
    if(row.windowStart!=null&&row.windowEnd!=null){
      const left=position(row.windowStart),right=position(row.windowEnd);
      if(right>left)bars.push(`<rect class="bar hot" x="${left.toFixed(1)}" y="4" width="${Math.max(1,right-left).toFixed(1)}" height="18" rx="3"/>`);
    }
    if(row.windowEnd!=null){
      const fallStart=position(row.windowEnd);
      bars.push(`<rect class="bar fall" x="${fallStart.toFixed(1)}" y="4" width="60" height="18" rx="3"/>`);
    }
    const now=Date.now();
    if(now>=start&&now<=end)bars.push(`<line class="today" x1="${position(now).toFixed(1)}" y1="0" x2="${position(now).toFixed(1)}" y2="26"/>`);
    return `<svg class="tb-cal-svg" viewBox="0 0 1000 26" preserveAspectRatio="none" aria-hidden="true">${bars.join('')}</svg>`;
  }
  function miniChart(record){
    const rows=(record.daily||[]).slice(-90).filter(row=>Number.isFinite(Number(row.impressionIndex)));
    if(!rows.length)return '<p class="inline-note">没有可用于绘图的日数据。</p>';
    const values=rows.map(row=>Number(row.impressionIndex)),min=Math.min(...values),max=Math.max(...values),span=max-min||1;
    const points=rows.map((row,index)=>`${20+index*6},${120-(row.impressionIndex-min)/span*90}`).join(' ');
    return `<svg class="tb-mini-chart" viewBox="0 0 580 150" role="img" aria-label="近90天展现指数"><polyline points="${points}"/><text x="6" y="146">${rows[0].date}</text><text x="500" y="146">${rows.at(-1).date}</text></svg>`;
  }
  function paginateRows(list,state,key,pageSize){
    const total=Math.max(1,Math.ceil(list.length/pageSize));
    const page=Math.min(total,Math.max(1,Number(state[key])||1));
    state[key]=page;
    return {rows:list.slice((page-1)*pageSize,page*pageSize),footer:`<div class="table-footer"><span>共 ${list.length} 条 · 每页 ${pageSize} 条</span><div class="actions">${hButtons.page(state,key,page,total)}</div></div>`};
  }
  let hButtons=null;
  window.XXInsights.register('trends',h=>{
    const page='trends',data=h.moduleData(page)||{},state=h.ui(page);
    hButtons={page:(st,key,pageNo,total)=>[h.button(page,'上一页','paginate',{small:true,disabled:pageNo===1,attrs:`data-step="-1" data-key="${key}"`}),`<span class="tb-page-no">${pageNo} / ${total}</span>`,h.button(page,'下一页','paginate',{small:true,disabled:pageNo===total,attrs:`data-step="1" data-key="${key}"`})].join('')};
    const board=state.tbBoard||data.board||null;
    state.tbTab=state.tbTab||'monthly';
    state.leadDays=Number(state.leadDays)||Number(data.trendFilters?.settings?.leadDays)||60;
    state.tbMonth=state.tbMonth||String(currentMonth());
    state.tbMonthView=state.tbMonthView||'sub';
    state.tbMonthGrade=state.tbMonthGrade||'all';
    state.tbLineView=state.tbLineView||'big';
    state.tbLineStatus=state.tbLineStatus||'all';
    state.tbLineMonth=state.tbLineMonth||'';
    state.tbLineSort=state.tbLineSort||'due';
    state.tbKwStatus=state.tbKwStatus||'ok';
    state.tbKwMetric=state.tbKwMetric||'impressionIndex';
    state.tbKwCells=state.tbKwCells||'heat';
    state.tbCalGrade=state.tbCalGrade||'all';
    state.tbCalHorizon=Number(state.tbCalHorizon)||60;
    state.tbCalOrder=state.tbCalOrder||'list';
    state.tbFilterKind=state.tbFilterKind||'brand';
    const actions=h.button(page,'数据维护','tb-maint',{small:true,icon:'folder'})+h.button(page,'刷新','refresh',{small:true,icon:'refresh'});
    const heading=h.heading('趋势选品','按本机已保存的趋势关键词批次生成：每月上品推荐、品线看板、关键词列表、上品日历与过滤规则。',actions);
    const maintenance=state.tbMaint?`<section class="panel tb-maint"><div class="panel-head"><div><h2>数据维护</h2><p>趋势选品只使用本机保存的批次；当前显示 ${h.esc(String(board?.datasetUsed||data.datasets?.length||0))} 个批次${board?.truncated?'（只取最近 300 个）':''}。</p></div></div><div class="panel-body">${h.captureBar(page,'traffic','在后台查询关键词，选择“过去13个月”和对应类目。当前页只保存已经取得的实际数据。',`<div class="tb-maint-fields">${h.field(page,'keyword','当前查询的关键词',{placeholder:'与流量解析当前查询保持一致',maxlength:200})}${h.field(page,'captureCategory','当前查询的类目',{placeholder:'填写完整类目，便于后续分析',maxlength:500})}</div>`)}<div class="actions tb-maint-actions">${h.button(page,'导入关键词数据','import-data',{icon:'folder'})}${h.button(page,'原始数据模板','raw-template')}${h.button(page,'导出已选批次','export',{disabled:!state.selected?.size,icon:'export'})}</div></div></section>`:'';
    if(!board||!board.stats?.keywords){
      return heading+tabHeader(state)+maintenance+h.panel('还没有可用的趋势数据',data.boardError?`看板计算失败：${h.esc(data.boardError)}`:'先在“数据维护”里保存/导入趋势关键词批次，保存后这里会自动生成 5 个板块。',`<div class="panel-body"><div class="tb-empty-actions">${h.button(page,'打开数据维护','tb-maint',{primary:true,icon:'folder'})}</div></div>`);
    }
    const leadControl=`<section class="tb-card tb-lead"><div class="tb-lead-main"><span class="tb-lead-label" title="从上线到打爆需要的时间，所有日期按爆发日往前倒推">上线节奏</span><span class="tb-dim">爆发前</span><div class="tb-seg">${[30,45,60,75,90].map(days=>`<button type="button" class="${Number(state.leadDays)===days?'on':''}" data-action="insights:tb-lead" data-insights-page="${page}" data-value="${days}">${days===30?'1 个月':days===45?'1.5 个月':days===60?'2 个月':days===75?'2.5 个月':'3 个月'}</button>`).join('')}</div><label class="tb-custom">自定义<input type="number" min="15" max="180" step="1" value="${h.esc(String(state.leadDays))}" data-tb-lead-input aria-label="自定义上线节奏天数"><span>天</span><button type="button" class="tb-btn small" data-action="insights:tb-lead-apply" data-insights-page="${page}">应用</button></label></div><p class="tb-note">上线日 = 爆发日往前倒推；爆发日按最近一年起量日推算，一年起量两次的细分会出现在两个月份里。</p></section>`;

    // ---------- 每月上品推荐 ----------
    function monthlyView(){
      const month=Number(state.tbMonth)||currentMonth();
      const source=state.tbMonthView==='big'?board.bigLines:board.subLines;
      const monthlyBase=source.filter(line=>(monthOf(line.listDate)||line.peakMonth)===month);
      const monthlyGradeCounts={S:monthlyBase.filter(line=>line.grade==='S').length,A:monthlyBase.filter(line=>line.grade==='A').length,B:monthlyBase.filter(line=>line.grade==='B').length};
      const filtered=monthlyBase.filter(line=>state.tbMonthGrade==='all'||line.grade===state.tbMonthGrade)
        .sort((a,b)=>GRADE_ORDER[b.grade]-GRADE_ORDER[a.grade]||(a.daysToBurst??9999)-(b.daysToBurst??9999));
      const paged=paginateRows(filtered,state,'tbPageMonthly',30);
      const groups=['S','A','B',''].map(grade=>{
        const rows=paged.rows.filter(line=>line.grade===grade);
        if(!rows.length)return '';
        const label=grade||'未评级';
        return `<tr class="tb-group"><td colspan="8"><b>${label} 级</b><span>${rows.length} 个${state.tbMonthView==='big'?'大品线':'细分品线'}</span></td></tr>`+rows.map(line=>`<tr>
          <td class="tb-line-cell"><button type="button" class="tb-link" data-action="insights:tb-detail" data-insights-page="${page}" data-kind="line" data-id="${h.esc(line.name)}">${h.esc(line.name)}</button>${line.mainKeywords.length?`<span class="tb-sub">主推词：${h.esc(line.mainKeywords.join('、'))}</span>`:''}</td>
          <td>${gradeBadge(line.grade)}</td><td class="nowrap">${h.esc(monthDay(line.listDate))}</td><td class="nowrap">${h.esc(monthDay(line.burstDate))}</td><td class="nowrap">${line.daysToBurst==null?'—':`${line.daysToBurst}天`}</td><td class="nowrap">${line.strength==null?'—':`${Number(line.strength).toFixed(1)}× ${line.durationDays} 天`}</td><td class="tb-main-keywords">${h.esc(line.mainKeywords.join('、')||'—')}</td><td>${h.button(page,'趋势 ›','tb-detail',{small:true,attrs:`data-kind="line" data-id="${h.esc(line.name)}"`})}</td></tr>`).join('');
      }).join('');
      const gradeChips=[['all','全部'],['S','S'],['A','A'],['B','B']].map(([id,label])=>`<button type="button" class="tb-chip${state.tbMonthGrade===id?' on':''}" data-action="insights:tb-month-grade" data-insights-page="${page}" data-value="${id}">${label}${id==='all'?` ${monthlyBase.length}`:` ${monthlyGradeCounts[id]||0}`}</button>`).join('');
      return `<div class="tb-month-cards">${board.months.map(item=>`<button type="button" class="tb-month-card${Number(state.tbMonth)===item.month?' on':''}" data-action="insights:tb-month" data-insights-page="${page}" data-value="${item.month}"><b>${item.month}月</b><span>${item.count} 个</span></button>`).join('')}</div>
        ${leadControl}
        <section class="tb-card"><header class="tb-card-head"><div><h2>${h.esc(String(state.tbMonth))}月推荐上品</h2><p>${monthlyBase.length} 个品线 · 按上线节奏倒推</p></div><div class="tb-toolbar-inline"><div class="tb-seg">${[['big','大品线'],['sub','细分']].map(([id,label])=>`<button type="button" class="${state.tbMonthView===id?'on':''}" data-action="insights:tb-month-view" data-insights-page="${page}" data-value="${id}">${label}</button>`).join('')}</div><div class="tb-chips">${gradeChips}</div></div></header>
        <div class="tb-table-wrap"><table class="tb-table"><thead><tr><th>品线</th><th>等级</th><th>上线日</th><th>爆发日</th><th>距爆发</th><th>旺季强度</th><th>主推词</th><th></th></tr></thead><tbody>${groups||'<tr><td colspan="8"><div class="tb-empty">这个月份还没有推荐品线；换个月份或在“数据维护”里补充趋势数据。</div></td></tr>'}</tbody></table></div>${filtered.length?paged.footer:''}</section>`;
    }

    // ---------- 品线看板 ----------
    function linesView(){
      const view=state.tbLineView;
      const pool=view==='kw'||view==='excl'?board.keywords:view==='big'?board.bigLines:board.subLines;
      const query=String(state.tbLineQ||'').trim().toLowerCase();
      const status=state.tbLineStatus||'all';
      let rows=pool.filter(item=>{
        if(view==='excl'){if(!item.removed)return false;}
        else if(item.removed)return false;
        if(query&&!`${item.keyword||item.name} ${(item.mainKeywords||[]).join(' ')} ${(item.categories||[]).join(' ')}`.toLowerCase().includes(query))return false;
        if(view==='kw'&&state.tbLineMonth&&String(monthOf(item.listDate)||item.peakMonth)!==String(state.tbLineMonth))return false;
        if(view!=='kw'&&state.tbLineMonth&&String(monthOf(item.listDate)||item.peakMonth)!==String(state.tbLineMonth))return false;
        if(status!=='all'&&item.status!==status)return false;
        return true;
      });
      const sort=state.tbLineSort;
      rows=[...rows].sort((a,b)=>sort==='last30'?(b.last30||0)-(a.last30||0):sort==='yoy'?(b.yoy??-9)-(a.yoy??-9):(a.daysToBurst??9999)-(b.daysToBurst??9999)||GRADE_ORDER[b.grade]-GRADE_ORDER[a.grade]);
      const paged=paginateRows(rows,state,'tbPageLines',40);
      const statuses=[['all','全部'],['旺季中','旺季中'],['该上品了','该上品了'],['准备中','准备中'],['还早','还早'],['常年在售','常年在售']];
      const statusCounts=name=>pool.filter(item=>!item.removed&&(name==='all'||item.status===name)).length;
      return `<section class="tb-card"><header class="tb-toolbar"><div class="tb-toolbar-main"><div class="tb-seg">${[['big','按大品线'],['sub','按细分品线'],['kw','按关键词'],['excl',`AI 剔除的词 ${board.stats.removed}`]].map(([id,label])=>`<button type="button" class="${view===id?'on':''}" data-action="insights:tb-lines-view" data-insights-page="${page}" data-value="${id}">${label}</button>`).join('')}</div><label class="tb-search"><input type="search" value="${h.esc(state.tbLineQ||'')}" placeholder="搜品线或关键词，如 竹筒粽" data-insights-page="${page}" data-insights-field="tbLineQ" maxlength="100"></label></div><div class="tb-toolbar-side"><label class="tb-field"><span>建议上品月</span><select data-insights-page="${page}" data-insights-field="tbLineMonth">${['<option value="">全部</option>',...MONTHS.map((label,index)=>`<option value="${index+1}"${String(state.tbLineMonth)===String(index+1)?' selected':''}>${label}</option>`)].join('')}</select></label><label class="tb-field"><span>排序</span><select data-insights-page="${page}" data-insights-field="tbLineSort">${[['due','离起量最近的在前'],['last30','近30天日均 高→低'],['yoy','同比 高→低']].map(([id,label])=>`<option value="${id}"${state.tbLineSort===id?' selected':''}>${label}</option>`).join('')}</select></label></div></header>
        <div class="tb-statusbar">${statuses.map(([id,label])=>`<button type="button" class="tb-chip${status===id?' on':''}" data-action="insights:tb-line-status" data-insights-page="${page}" data-value="${id}">${label} <b>${statusCounts(id)}</b></button>`).join('')}</div>
        <div class="tb-table-wrap"><table class="tb-table tb-lines-table"><thead><tr><th>${view==='kw'||view==='excl'?'关键词':'品线'}</th><th>${view==='kw'||view==='excl'?'类目':'规模 / 所属'}</th><th>等级</th><th>趋势类型</th><th class="tb-strip-col">1–12 月</th><th>近30天日均</th><th>环比</th><th>同比</th><th>起量 · 建议上品</th><th>状态</th><th></th></tr></thead><tbody>${paged.rows.map(item=>{
          const isKeyword=view==='kw'||view==='excl';
          const label=isKeyword?item.keyword:item.name;
          const meta=isKeyword?(item.categories?.[0]||'未分类'):item.scale;
          const type=item.seasonType||'—';
          const heat=isKeyword?heatStrip(item.heat):heatStrip(item.heat);
          const last30=item.last30;
          const statusValue=item.removed?'已剔除':item.status;
          const burst=item.burstDate?`${monthDay(item.burstDate)}起量`:'全年';
          const list=item.listDate?`${monthDay(item.listDate)}上品`:'';
          return `<tr class="${item.removed?'tb-removed':''}"><td class="tb-line-cell">${isKeyword?`<button type="button" class="tb-link" data-action="insights:tb-detail" data-insights-page="${page}" data-kind="keyword" data-id="${h.esc(item.keyword)}">${h.esc(label)}</button>`:`<b>${h.esc(label)}</b>`}${isKeyword?`<span class="tb-sub">${h.esc(item.categories?.join('；')||'')}</span>`:`<span class="tb-sub">${h.esc((item.mainKeywords||[]).join('、'))}</span>`}</td><td class="tb-meta">${h.esc(meta||'—')}</td><td>${gradeBadge(item.grade)}</td><td>${h.esc(type)}</td><td class="tb-strip-col">${heat}</td><td class="tb-num">${fmtNum(last30)}</td><td>${pctCell(item.mom)}</td><td>${pctCell(item.yoy)}</td><td class="tb-ontime">${h.esc(`${burst}${list?` · ${list}`:''}`)}</td><td>${statusBadge(statusValue)}</td><td>${h.button(page,'趋势 ›','tb-detail',{small:true,attrs:`data-kind="${isKeyword?'keyword':'line'}" data-id="${h.esc(label)}"`})}</td></tr>`;
        }).join('')||'<tr><td colspan="11"><div class="tb-empty">没有符合条件的品线或关键词。</div></td></tr>'}</tbody></table></div>${rows.length?paged.footer:''}<p class="tb-note">色块越深表示那个月越旺，下划线是本月；斜纹表示本月还没过完。大品线 = 下面所有细分相加，细分 = 下面所有关键词相加；点“趋势 ›”看走势。</p></section>`;
    }

    // ---------- 关键词列表 ----------
    function keywordsView(){
      const query=String(state.tbLineQ||'').trim().toLowerCase();
      let rows=board.keywords.filter(item=>{
        if(state.tbKwStatus==='ok'&&item.removed)return false;
        if(state.tbKwStatus==='removed'&&!item.removed)return false;
        if(query&&!`${item.keyword} ${item.categories?.join(' ')}`.toLowerCase().includes(query))return false;
        return true;
      });
      const paged=paginateRows(rows,state,'tbPageKw',50);
      const metricMeta={impressionIndex:['展现指数',''],clickIndex:['点击指数',''],clickRate:['点击率','%'],conversionRate:['转化率','%']};
      const metric=metricMeta[state.tbKwMetric]||metricMeta.impressionIndex;
      return `<section class="tb-card"><header class="tb-toolbar"><div class="tb-toolbar-main"><label class="tb-search"><input type="search" value="${h.esc(query)}" placeholder="搜关键词，回车查询" data-insights-page="${page}" data-insights-field="tbLineQ"></label></div><div class="tb-toolbar-side"><label class="tb-field"><span>指标</span><select data-insights-page="${page}" data-insights-field="tbKwMetric">${Object.entries(metricMeta).map(([id,[label]])=>`<option value="${id}"${state.tbKwMetric===id?' selected':''}>${label}</option>`).join('')}</select></label><div class="tb-seg">${[['heat','色谱'],['num','数值']].map(([id,label])=>`<button type="button" class="${state.tbKwCells===id?'on':''}" data-action="insights:tb-kw-cells" data-insights-page="${page}" data-value="${id}">${label}</button>`).join('')}</div></div></header>
        <div class="tb-statusbar"><button type="button" class="tb-chip${state.tbKwStatus==='ok'?' on':''}" data-action="insights:tb-kw-status" data-insights-page="${page}" data-value="ok">可用 <b>${board.stats.usable}</b></button><button type="button" class="tb-chip${state.tbKwStatus==='removed'?' on':''}" data-action="insights:tb-kw-status" data-insights-page="${page}" data-value="removed">已剔除 <b>${board.stats.removed}</b></button><button type="button" class="tb-chip${state.tbKwStatus==='all'?' on':''}" data-action="insights:tb-kw-status" data-insights-page="${page}" data-value="all">全部 <b>${board.stats.keywords}</b></button></div>
        <div class="tb-table-wrap"><table class="tb-table"><thead><tr><th>关键词</th><th>类目</th><th>状态</th><th class="tb-strip-col">1–12 月</th><th>近30天日均 · ${metric[0]}</th><th>环比</th><th>同比</th><th>高峰</th></tr></thead><tbody>${paged.rows.map(item=>{
          const stats=item.metrics?.[state.tbKwMetric]||{};
          const heat=state.tbKwCells==='num'?`<div class="tb-heat-numbers">${(item.monthly||[]).map((m,index)=>`<span${index+1===currentMonth()?' class="now"':''}>${m.avg==null?'—':fmtNum(m.avg)}</span>`).join('')}</div>`:heatStrip(item.heat);
          return `<tr class="${item.removed?'tb-removed':''}"><td class="tb-line-cell"><button type="button" class="tb-link" data-action="insights:tb-detail" data-insights-page="${page}" data-kind="keyword" data-id="${h.esc(item.keyword)}">${h.esc(item.keyword)}</button>${item.removed?`<span class="tb-sub">${h.esc(item.removedBy.join('；'))}</span>`:''}</td><td class="tb-meta">${h.esc(item.categories?.join('；')||'未分类')}</td><td>${item.removed?statusBadge('已剔除'):'<span class="tb-state ok">可用</span>'}</td><td class="tb-strip-col">${heat}</td><td class="tb-num">${fmtNum(stats.last30)}${stats.last30!=null&&metric[1]?metric[1]:''}</td><td>${pctCell(stats.mom)}</td><td>${pctCell(stats.yoy)}</td><td class="nowrap">${item.peakMonth?`${item.peakMonth}月`:'—'}<span class="tb-sub">${h.esc(item.seasonType)}</span></td></tr>`;
        }).join('')||'<tr><td colspan="8"><div class="tb-empty">还没有关键词数据；在“数据维护”里保存或导入趋势批次。</div></td></tr>'}</tbody></table></div>${rows.length?paged.footer:''}<p class="tb-note">指标口径统一：近30天日均、环比、同比都按同一指标计算；缺失值保持为空，不按 0 计算。</p></section>`;
    }

    // ---------- 上品日历 ----------
    function calendarView(){
      const axis=axisMonths();
      const grade=state.tbCalGrade;
      const horizon=Number(state.tbCalHorizon)||60;
      const nowMs=Date.now();
      const pool=board.keywords.filter(item=>!item.removed&&(grade==='all'||item.grade===grade));
      const lanes=[['now','现在该上品','已进入上品准备期，还没起量',pool.filter(item=>item.status==='该上品了')],['soon',`未来 ${horizon} 天要上品`,'提前备货、做主图',pool.filter(item=>item.seasonal&&item.status!=='旺季中'&&item.windowStart!=null&&item.windowStart>nowMs&&item.windowStart-nowMs<=horizon*DAY)],['hot','正在起量','最近一年此时正在涨，注意承接和库存',pool.filter(item=>item.status==='旺季中')],['flat','四季常青','全年平稳，随时可上',pool.filter(item=>!item.seasonal)]];
      const rows=[...pool.filter(item=>item.seasonal)].sort(state.tbCalOrder==='grade'?(a,b)=>GRADE_ORDER[b.grade]-GRADE_ORDER[a.grade]:(a,b)=>(a.daysToBurst??9999)-(b.daysToBurst??9999));
      const paged=paginateRows(rows,state,'tbPageCal',30);
      return `<section class="tb-card tb-calendar-card"><header class="tb-toolbar"><div class="tb-toolbar-main"><div class="tb-seg">${[['all','全部'],['S','S 级'],['A','A 级'],['B','B 级']].map(([id,label])=>`<button type="button" class="${grade===id?'on':''}" data-action="insights:tb-cal-grade" data-insights-page="${page}" data-value="${id}">${label}</button>`).join('')}</div><span class="tb-dim">按上品时间</span><div class="tb-seg">${[30,60,90].map(days=>`<button type="button" class="${horizon===days?'on':''}" data-action="insights:tb-cal-horizon" data-insights-page="${page}" data-value="${days}">${days} 天</button>`).join('')}</div></div><div class="tb-toolbar-side"><label class="tb-field"><span>排序</span><select data-insights-page="${page}" data-insights-field="tbCalOrder">${[['list','按上品时间'],['grade','按等级']].map(([id,label])=>`<option value="${id}"${state.tbCalOrder===id?' selected':''}>${label}</option>`).join('')}</select></label></div></header>
        <div class="tb-legend"><span><i class="lg heat"></i>历史同月热度</span><span><i class="lg prep"></i>上品准备</span><span><i class="lg hot"></i>起量到高峰</span><span><i class="lg fall"></i>回落</span></div>
        <div class="tb-lanes">${lanes.map(([id,title,desc,items])=>`<div class="tb-lane ${id}"><div class="tb-lane-head"><b>${title}</b><span>${items.length}</span></div><p>${desc}</p>${items.slice(0,6).map(item=>`<div class="tb-lane-item">${gradeBadge(item.grade)}<span class="tb-lane-name">${h.esc(item.keyword)}</span><small>${h.esc(item.seasonType)}${id==='soon'?` · ${item.daysToBurst==null?'—':`${Math.max(0,item.daysToBurst-state.leadDays)} 天后上品`}`:id==='now'?` · ${item.daysToBurst} 天后起量`:item.status==='旺季中'?` · ${monthDay(item.burstDate)}见顶`:''}</small></div>`).join('')||'<p class="tb-na">暂无</p>'}${items.length>6?`<p class="tb-na">还有 ${items.length-6} 个，见下方日历</p>`:''}</div>`).join('')}</div>
        <div class="tb-cal"><div class="tb-cal-axis"><span class="tb-cal-label">关键词</span><div class="tb-cal-months">${axis.map(item=>`<span>${item.month}月</span>`).join('')}</div></div><div class="tb-cal-rows">${paged.rows.map(item=>`<div class="tb-cal-row"><div class="tb-cal-label">${gradeBadge(item.grade)}<span>${h.esc(item.keyword)}</span><small>${item.status==='旺季中'?`旺季中 · ${monthDay(item.burstDate)}见顶`:`${monthDay(item.listDate)}上品 · ${monthDay(item.burstDate)}起量`}</small></div><div class="tb-cal-track"><div class="tb-cal-bg">${axis.map(()=>'<i></i>').join('')}</div>${timeline(item,axis)}</div></div>`).join('')||'<div class="tb-empty">还没有季节词；季节判断需要至少 120 天数据。</div>'}</div></div>${rows.length?paged.footer:''}<p class="tb-note">${axisLabel(axis)}。底色越深表示历史同月越旺；按最近一年的起量日推算，起量前 ${state.leadDays} 天开始上品准备；等级：S 持续45天以上·日均1.7倍且点击同步上涨，A 30天以上·1.45倍，B 20天以上·1.25倍。已剔除的词不进入日历。</p></section>`;
    }

    // ---------- 过滤规则 ----------
    function filtersView(){
      const kind=state.tbFilterKind;
      const rules=kind==='brand'?board.filters?.brandRules||[]:board.filters?.keywordRules||[];
      const hits=rule=>board.keywords.filter(item=>rule.enabled!==false&&(rule.match==='exact'?item.keyword===rule.text:item.keyword.includes(rule.text))).length;
      return `<section class="tb-card"><header class="tb-toolbar"><div class="tb-seg">${[['brand','大品牌删除',board.filters?.brandRules?.length||0],['keyword','关键词黑名单',board.filters?.keywordRules?.length||0]].map(([id,label,count])=>`<button type="button" class="${kind===id?'on':''}" data-action="insights:tb-filter-kind" data-insights-page="${page}" data-value="${id}">${label} <b>${count}</b></button>`).join('')}</div></header>
        <div class="tb-rule-form"><label class="tb-field"><span>${kind==='brand'?'品牌名称':'关键词'}</span><input id="tb-rule-text" maxlength="100" placeholder="${kind==='brand'?'输入需要删除的品牌':'输入需要剔除的关键词'}"></label><label class="tb-field"><span>匹配方式</span><select id="tb-rule-match"><option value="contains">包含</option><option value="exact">完全匹配</option></select></label><label class="tb-field tb-rule-note"><span>备注</span><input id="tb-rule-note" maxlength="200" placeholder="可选，记录规则来源或用途"></label>${h.button(page,'新增规则','tb-rule-add',{primary:true,attrs:`data-kind="${kind}"`})}</div>
        <p class="tb-note">输入规则后，列表中会马上标出命中的关键词；停用规则后自动恢复。${kind==='brand'?'品牌建议用“完全匹配”或品牌全名，避免把“胡桃”误伤“三只松鼠”。':'关键词黑名单用于剔除明确不做的词。'}</p>
        <div class="tb-table-wrap"><table class="tb-table"><thead><tr><th>${kind==='brand'?'品牌名称':'关键词'}</th><th>匹配方式</th><th>状态</th><th>命中词</th><th>备注</th><th>操作</th></tr></thead><tbody>${rules.map(rule=>`<tr class="${rule.enabled===false?'tb-removed':''}"><td>${h.esc(rule.text)}</td><td>${rule.match==='exact'?'完全匹配':'包含'}</td><td>${rule.enabled===false?'<span class="tb-status early">已停用</span>':'<span class="tb-status hot">启用中</span>'}</td><td class="tb-num">${hits(rule)}</td><td>${h.esc(rule.note||'—')}</td><td><div class="tb-row-actions">${h.button(page,rule.enabled===false?'启用':'停用','tb-rule-toggle',{small:true,attrs:`data-kind="${kind}" data-id="${h.esc(rule.id)}"`})}${h.button(page,'删除','tb-rule-delete',{small:true,danger:true,attrs:`data-kind="${kind}" data-id="${h.esc(rule.id)}"`})}</div></td></tr>`).join('')||'<tr><td colspan="6"><div class="tb-empty">暂无规则。</div></td></tr>'}</tbody></table></div></section>`;
    }

    let content='';
    if(state.tbTab==='monthly')content=monthlyView();
    else if(state.tbTab==='lines')content=linesView();
    else if(state.tbTab==='keywords')content=keywordsView();
    else if(state.tbTab==='calendar')content=calendarView();
    else content=filtersView();
    let detail='';
    if(state.tbDetail){
      const record=state.tbDetail.kind==='keyword'
        ?board.keywords.find(item=>item.keyword===state.tbDetail.id)
        :null;
      const keyword=record||(()=>{
        const line=(board.bigLines||[]).find(item=>item.name===state.tbDetail.id)||(board.subLines||[]).find(item=>item.name===state.tbDetail.id);
        return line?board.keywords.find(item=>item.keyword===line.leadKeyword):null;
      })();
      if(keyword){
        detail=`<section class="tb-card tb-detail"><header class="tb-card-head"><div><h2>${h.esc(keyword.keyword)} <span class="tb-dim">趋势详情</span></h2><p>${h.esc(keyword.categories?.join('；')||'')} · 数据截至 ${h.esc(keyword.lastDate||'—')}</p></div>${h.button(page,'关闭','tb-detail-close',{small:true})}</header><div class="tb-detail-body"><div class="tb-detail-main">${miniChart(keyword)}</div><div class="tb-detail-side"><div class="tb-kv"><span>趋势类型</span><b>${h.esc(keyword.seasonType)}</b></div><div class="tb-kv"><span>等级</span><b>${gradeBadge(keyword.grade)} ${keyword.strength==null?'':'· '+Number(keyword.strength).toFixed(2)+'×'}</b></div><div class="tb-kv"><span>爆发时间</span><b>${h.esc(monthDay(keyword.burstDate))}</b></div><div class="tb-kv"><span>推荐上品</span><b>${h.esc(monthDay(keyword.listDate))}</b></div><div class="tb-kv"><span>近30天日均</span><b>${fmtNum(keyword.last30)}</b></div><div class="tb-kv"><span>环比 / 同比</span><b>${pctCell(keyword.mom)} / ${pctCell(keyword.yoy)}</b></div><p class="tb-note">${keyword.seasonal?`旺季持续约 ${keyword.durationDays} 天，日均约为平时的 ${Number(keyword.strength||0).toFixed(2)} 倍。`:'没有持续 20 天以上明显高于平时的起量期，按全年需求看待。'}</p></div></div></section>`;
      }
    }
    return heading+tabHeader(state)+maintenance+content+detail;
  });
})();
