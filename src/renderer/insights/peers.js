'use strict';

(() => {
  const columns = [
    ['rank','排名'], ['title','宝贝标题'], ['itemId','商品 ID'], ['shopName','店铺名称'],
    ['listedDays','上架天数'], ['tradeCount','成交件数'], ['views','流量（原口径）'],
    ['paidClicks','付费点击量'], ['viewsChange','流量变化（原口径）'],
  ];
  window.XXInsights.register('peers', h => {
    const page = 'peers', data = h.moduleData(page), all = h.datasets(page), filtered = h.filtered(page), list = h.paginate(filtered,page);
    const current = h.selectedDetail(page);
    const captureFields = `<div class="insights-field-grid">${h.field(page,'captureCategory','榜单类目（核对后台后填写）',{placeholder:'可选，填写后台当前选中的完整类目',maxlength:500})}${h.field(page,'startDate','统计开始日期（可选）',{type:'date'})}${h.field(page,'endDate','统计结束日期（可选）',{type:'date'})}</div><p class="inline-note">仅在后台日期无法自动识别时，按当前页面的实际统计范围补充日期；填写的类目须与达摩盘当前查询一致。</p>`;
    const controls = h.button(page,'刷新本地数据','refresh') + h.button(page,'导出榜单数据','export',{icon:'export',disabled:!all.length});
    const toolbar = `<div class="insights-filter">${h.field(page,'query','榜单类型 / 对象',{placeholder:'例如销量明星、店铺、宝贝'})}${h.field(page,'category','类目筛选',{placeholder:'按已保存类目筛选'})}<div class="actions">${h.button(page,'筛选','filter')}${h.button(page,'重置','reset-filter')}</div></div>`;
    let detail = '';
    if (current) {
      const rows = h.arr(current.rows), slice = h.paginate(rows,page,'detailPage');
      const sourceColumns = columns.map(([key,label]) => {
        const field = key === 'views' ? 'viewsMetric' : key === 'viewsChange' ? 'viewsChangeMetric' : '';
        const names = field ? [...new Set(rows.map(row=>row.extra?.[field]).filter(Boolean))] : [];
        return [key,names.length === 1 ? names[0] : label];
      });
      detail = h.panel('榜单明细',h.esc([current.context?.rankingType,current.context?.subject,current.context?.category,h.range(current)].filter(Boolean).join(' · ')),h.renderWarnings(current.warnings) + h.simpleTable(slice.rows,sourceColumns) + (rows.length ? slice.footer : ''),h.button(page,'收起明细','close-detail',{small:true}));
    }
    return h.heading('同行榜单','保存达摩盘市场榜单，按榜单、类目和采集日期查看原始记录。',controls) +
      h.captureBar(page,'dmp','先在达摩盘选择类目、榜单和店铺 / 宝贝视图。保存范围以后台当前可见、已加载的记录为准。',captureFields) +
      h.notice('区间数据按原文保存，例如“1000～2500”；未提供的字段留空。当前页保存不代表已经获取所有榜单分页。') + detail +
      h.panel('榜单保存记录','每条记录保留采集条件与来源时间，避免混用不同榜单口径。',toolbar + h.table(['榜单 / 对象','类目','数据范围','记录数','保存时间','操作'],list.rows.map(item => `<tr><td>${h.esc(h.display(item.context?.rankingType))}<span class="cell-sub">${h.esc(h.display(item.context?.subject))}</span></td><td class="insights-data-cell">${h.esc(h.display(item.context?.category))}</td><td>${h.esc(h.range(item))}</td><td>${h.esc(h.display(item.rowCount))}</td><td>${h.esc(h.dateTime(item.capturedAt))}</td><td>${h.button(page,'查看榜单','detail',{small:true,attrs:`data-id="${h.esc(item.id)}"`})}</td></tr>`).join(''),h.empty('还没有榜单数据','打开达摩盘查询所需榜单，再返回保存当前页。')) + (filtered.length ? list.footer : '')) + h.logs(data);
  });
})();
