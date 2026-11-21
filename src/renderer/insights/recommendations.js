'use strict';

(() => {
  const formatMonths = (h, value) => h.monthList(value).map(month => `${month}月`).join('、') || '未填写';
  window.XXInsights.register('recommendations', h => {
    const page = 'recommendations', data = h.moduleData(page), state = h.ui(page), all = h.arr(data.recommendations);
    const query = state.query.trim().toLocaleLowerCase(), category = state.category.trim().toLocaleLowerCase();
    const filtered = all.filter(row => (state.month === 'all' || Number(row.recommendedMonth) === Number(state.month)) && (!query || [row.keyword,row.productGroup].join(' ').toLocaleLowerCase().includes(query)) && (!category || String(row.category || '').toLocaleLowerCase().includes(category)));
    const list = h.paginate(filtered,page);
    const actions = h.button(page,'导出回填模板','template',{icon:'export',disabled:!h.datasets(page).length}) + h.button(page,'导入分析结果','import',{primary:true,icon:'folder'});
    const months = `<div class="insights-months" role="group" aria-label="建议上品月份筛选">${[['all','全部月份'],...Array.from({length:12},(_,index) => [String(index+1),`${index+1}月`])].map(([key,label]) => h.button(page,label,'month',{small:true,primary:state.month === key,attrs:`data-month="${key}" aria-pressed="${state.month === key}"`})).join('')}</div>`;
    const filters = `<div class="insights-filter">${h.field(page,'query','关键词 / 产品组',{placeholder:'搜索关键词或产品组'})}${h.field(page,'category','类目筛选',{placeholder:'按类目筛选'})}<div class="actions">${h.button(page,'筛选','filter')}${h.button(page,'重置','reset-filter')}</div></div>`;
    const rows = list.rows.map(row => `<tr><td class="insights-data-cell"><span class="cell-main">${h.esc(row.productGroup || row.keyword || '未提供名称')}</span>${row.productGroup ? `<span class="cell-sub">${h.esc(row.keyword)}</span>` : ''}<span class="cell-sub">${h.esc(h.display(row.category))}</span></td><td><span class="insights-month-value">${h.esc(row.recommendedMonth)}月</span><span class="cell-sub">预计起涨：${row.risingMonth ? `${h.esc(row.risingMonth)}月` : '未填写'}</span></td><td><span class="cell-main">旺季：${h.esc(formatMonths(h,row.peakMonths))}</span><span class="cell-sub">淡季：${h.esc(formatMonths(h,row.lowMonths))}</span></td><td class="insights-reason">${h.esc(h.display(row.reason))}</td><td><span class="cell-main">${h.esc(h.range(row))}</span><span class="cell-sub">分析：${h.esc(h.display(row.analyzedAt))}</span><span class="cell-sub">导入：${h.esc(h.dateTime(row.importedAt))}</span>${row.version ? `<span class="cell-sub">版本 ${h.esc(row.version)}</span>` : ''}</td></tr>`).join('');
    return h.heading('月份上品推荐','导入 Codex 分析后的推荐文件，按建议月份安排上品。',actions) +
      h.notice('先从“趋势关键词”导出分析包与回填模板，一起发给 Codex。分析结果回填模板后，在这里预览校验并导入。建议上品月份按预计持续起涨时间提前两个月判断。') +
      h.panel('按月份查看推荐',`共 ${all.length} 条已导入推荐；当前筛选 ${filtered.length} 条。`,months + filters + h.table(['关键词 / 产品组 / 类目','建议上品 / 起涨','淡旺季','推荐理由','数据与分析时间'],rows,h.empty(all.length ? '当前筛选没有推荐' : '等待导入分析结果',all.length ? '切换月份或清空关键词、类目筛选查看其他结果。' : '月份推荐来自你导入的分析文件；软件不会自行生成推荐或调用 AI 模型。',all.length ? '' : h.button(page,'导入分析结果','import',{primary:true}))) + (filtered.length ? list.footer : '')) +
      h.notice('推荐是根据历史数据作出的上品建议。新采集的数据不会自动改变已导入结果；重新分析后再次导入，可更新对应推荐并保留历史版本。') + h.logs(data);
  });
})();
