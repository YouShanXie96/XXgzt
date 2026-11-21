'use strict';

(() => {
  window.XXInsights.register('business', h => {
    const page = 'business', data = h.moduleData(page);
    const datasets = h.datasets(page), current = h.selectedDetail(page);
    const metrics = h.arr(current?.rows), history = h.paginate(datasets, page);
    const captureFields = `<div class="insights-field-grid">${h.field(page,'startDate','统计开始日期（可选）',{type:'date'})}${h.field(page,'endDate','统计结束日期（可选）',{type:'date'})}</div><p class="inline-note">仅在后台日期无法自动识别时，按当前页面的实际统计范围填写以上日期；可以自动识别时无需填写。</p>`;
    const controls = h.button(page,'刷新本地数据','refresh') + h.button(page,'导出经营数据','export',{icon:'export',disabled:!datasets.length});
    const details = current ? h.panel('经营指标', h.esc(`${h.range(current)} · ${current.context?.period || '来源页面周期'}`), `${h.renderWarnings(current.warnings)}<div class="insights-metrics">${metrics.map(metric => `<article class="insights-metric"><span>${h.esc(metric.label || metric.metric || '指标')}</span><strong>${h.esc(h.display(metric.value))}${metric.unit ? `<small>${h.esc(metric.unit)}</small>` : ''}</strong><p>${h.esc(metric.comparison || metric.period || metric.section || '按生意参谋页面口径')}</p></article>`).join('')}</div>${!metrics.length ? h.empty('当前快照没有可显示的指标','请在生意参谋打开包含指标的页面后重新保存。') : ''}`, h.button(page,'收起指标','close-detail',{small:true})) : h.panel('经营指标', '选择一条保存记录查看对应周期的指标', h.empty('先保存生意参谋数据','打开后台，选择店铺、日期和所需指标，回到这里保存当前页数据。'));
    return h.heading('经营数据看板','保存生意参谋顶部经营总览的可见指标，按原始口径查看与导出。',controls) +
      h.captureBar(page,'sycm','先在生意参谋选好日期和视图，再保存当前页。登录或验证需要在后台完成。',captureFields) +
      h.notice('本版仅采集顶部经营总览中可见、可确认日期的指标；增长因子、推广花费等其他模块不在当前采集范围。数值沿用来源定义，未读取到的数据不补零。') +
      details +
      h.panel('经营数据保存记录','不同日期与视图分开保留，便于追溯来源。',h.table(['统计日期','来源周期','指标数量','保存时间','操作'],history.rows.map(item => `<tr><td>${h.esc(h.range(item))}</td><td>${h.esc(h.display(item.context?.period))}</td><td>${h.esc(h.display(item.rowCount))}</td><td>${h.esc(h.dateTime(item.capturedAt))}</td><td>${h.button(page,'查看指标','detail',{small:true,attrs:`data-id="${h.esc(item.id)}"`})}</td></tr>`).join(''),h.empty('还没有保存记录','这里仅显示本机已保存的数据。')) + (datasets.length ? history.footer : '')) + h.logs(data);
  });
})();
