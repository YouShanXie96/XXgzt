'use strict';

// 需求9/需求5：点击指标弹出的“趋势”图。纯 SVG 手绘，不依赖外部库；
// 只使用服务端按本机已保存数据返回的每日点；按周/按月在这里做客户端聚合。
(() => {
  const UNITS = { day:'按天', week:'按周', month:'按月' };
  const DAY = 86400000;

  // 按天原样；按周取“周一”为每周的键（金额/数量求和，比率取平均）；按月取 YYYY-MM。
  function pointsFor(trend) {
    const points = Array.isArray(trend?.points) ? trend.points : [];
    const unit = trend?.granularity || 'day';
    if (unit === 'day') return points;
    const groups = new Map();
    for (const item of points) {
      if (!item || typeof item.date !== 'string') continue;
      const day = new Date(item.date + 'T00:00:00Z');
      if (!Number.isFinite(day.getTime())) continue;
      let key;
      if (unit === 'month') key = item.date.slice(0, 7);
      else {
        const monday = new Date(day);
        monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
        key = monday.toISOString().slice(0, 10);
      }
      if (!groups.has(key)) groups.set(key, []);
      if (typeof item.value === 'number') groups.get(key).push(item.value);
    }
    const average = ['percent', 'decimal'].includes(trend?.type);
    return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, values]) => ({ date: key, value: values.length ? Number((average ? values.reduce((a, b) => a + b, 0) / values.length : values.reduce((a, b) => a + b, 0)).toFixed(6)) : null }));
  }
  function axisLabel(date) {
    return String(date).length === 7 ? String(date).replace('-', '/') : String(date).slice(5);
  }
  // 估算文本宽度：用于把悬停卡片按内容裁到合适大小（CJK 全宽，其他按 0.56 宽）。
  function textWidth(value, size) {
    return [...String(value ?? '')].reduce((total, ch) => total + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.56), 0);
  }

  function chart(trend, deps) {
    const { esc, display } = deps;
    const points = pointsFor(trend), known = points.filter(item => typeof item.value === 'number');
    if (!known.length) return '';
    const width = 680, height = 236, padX = 56, padY = 34;
    const values = known.map(item => item.value);
    const max = Math.max(...values), min = Math.min(0, Math.min(...values)), span = (max - min) || Math.abs(max) || 1;
    const x = index => points.length <= 1 ? (padX + (width - 2 * padX) / 2) : padX + index * (width - 2 * padX) / (points.length - 1);
    const y = value => height - padY - ((value - min) / span) * (height - 2 * padY);
    const coords = points.map((item, index) => typeof item.value === 'number' ? { x: x(index), y: y(item.value), item } : null).filter(Boolean);
    const line = coords.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
    // 数值标签/悬停提示都要夹在绘图区内，避免第一个/最后一个点压到左侧刻度或被右侧裁掉。
    const clampX = value => Math.min(width - padX - 30, Math.max(padX + 30, value));
    // 悬停卡片按用户给的样式：第一行日期，第二行“圆点 + 指标名 + 数值”，深色圆角卡片，跟随节点并夹在绘图区内。
    const seriesName = String(trend.label || '数值');
    const dots = coords.map(point => {
      const dateText = String(point.item.date), valueText = display(point.item.value, trend.type);
      const width2 = 13 + textWidth(seriesName, 12) + 12 + textWidth(valueText, 12);
      const tipWidth = Math.round(Math.max(132, Math.min(280, Math.max(textWidth(dateText, 11.5), width2) + 26)));
      const tipHeight = 54, left = -tipWidth / 2, top = -tipHeight - 14;
      const tipX = Math.min(width - padX - tipWidth / 2 + 6, Math.max(padX + tipWidth / 2 - 6, point.x));
      const tipY = Math.max(tipHeight + 16, point.y - 18);
      const tip = `<g class="business-trend-tip" transform="translate(${tipX.toFixed(1)} ${tipY.toFixed(1)})"><rect x="${left.toFixed(1)}" y="${top}" width="${tipWidth}" height="${tipHeight}" rx="10"></rect><text class="business-trend-tip-date" x="${(left + 13).toFixed(1)}" y="${top + 21}">${esc(dateText)}</text><circle class="business-trend-tip-dot" cx="${(left + 17).toFixed(1)}" cy="${top + 39}" r="4"></circle><text class="business-trend-tip-name" x="${(left + 27).toFixed(1)}" y="${top + 43}">${esc(seriesName)}</text><text class="business-trend-tip-value" x="${(left + tipWidth - 13).toFixed(1)}" y="${top + 43}" text-anchor="end">${esc(valueText)}</text></g>`;
      const badge = trend.showValues ? `<text class="business-trend-value" x="${clampX(point.x).toFixed(1)}" text-anchor="middle" y="${(point.y - 12).toFixed(1)}">${esc(valueText)}</text>` : '';
      const guide = `<line class="business-trend-guide" x1="${point.x.toFixed(1)}" y1="${(padY - 4).toFixed(1)}" x2="${point.x.toFixed(1)}" y2="${(height - padY + 4).toFixed(1)}"></line>`;
      return `<g class="business-trend-node"><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.8" class="business-trend-dot"></circle>${badge}${guide}${tip}<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="12" class="business-trend-hit"></circle></g>`;
    }).join('');
    const grid = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
      const value = max - ratio * span, yy = y(value);
      return `<line x1="${padX}" y1="${yy.toFixed(1)}" x2="${width - padX}" y2="${yy.toFixed(1)}" class="business-trend-grid"></line><text x="${padX - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" class="business-trend-axis">${esc(display(Number(value.toFixed(2)), trend.type))}</text>`;
    }).join('');
    const step = Math.max(1, Math.ceil(points.length / 6));
    const labels = points.map((item, index) => ({ item, index })).filter(({ index }) => index === 0 || index === points.length - 1 || index % step === 0)
      .map(({ item, index }) => `<text x="${x(index).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="business-trend-axis">${esc(axisLabel(item.date))}</text>`).join('');
    return `<div class="business-trend-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(trend.label || '指标')}趋势">${grid}<path d="${line}" class="business-trend-line"></path>${dots}${labels}</svg></div>`;
  }

  function dialog(trend, deps) {
    if (!trend) return '';
    const { esc, button, display, actions = {} } = deps;
    const unit = trend.granularity || 'day';
    const points = pointsFor(trend), known = points.filter(item => typeof item.value === 'number');
    const sum = known.length ? Number(known.reduce((total, item) => total + item.value, 0).toFixed(6)) : null;
    const summary = trend.loading ? '正在读取本机数据…'
      : (known.length ? `区间合计 ${display(sum, trend.type)} · ${points.length} 个点 · ${known.length} 个有数据` : '所选日期内没有已保存的数据');
    const rows = (Array.isArray(trend.points) ? trend.points : []).map(item => `<div><span>${esc(String(item.date).replace(/-/g, '/'))}</span><span>${esc(display(item.value, trend.type))}</span></div>`).join('');
    const picker = ['day', 'week', 'month'].map(value => button(UNITS[value], 'trend-unit', { small: true, primary: unit === value, attrs: `data-value="${value}"` })).join('');
    const closeAction = actions.close || 'trend-close';
    // 注意：data-action 必须带 "business:" 前缀，否则会被 app.js 的全局点击分发忽略（关闭按钮点了没反应）。
    const closeAttr = `data-action="business:${closeAction}"`;
    return `<div class="business-modal-shade"><button type="button" class="business-modal-close" ${closeAttr} aria-label="关闭趋势图" title="关闭">×</button><section class="business-sync-dialog business-trend-dialog" role="dialog" aria-modal="true" aria-labelledby="business-trend-title" tabindex="-1"><header><div><h2 id="business-trend-title">${esc(`${trend.label || ''} · ${UNITS[unit]}趋势`)}</h2><p>${esc(summary)}</p></div><button type="button" class="button small" ${closeAttr}>关闭</button></header><div class="business-sync-dialog-body">${trend.error ? `<div class="business-error" role="alert">${esc(trend.error)}</div>` : ''}<div class="business-trend-controls"><span>查看：</span>${picker}<label class="business-trend-toggle" title="打开后图上一直显示数值（鼠标悬停不再变化）；关闭时鼠标移到节点上显示日期和数值"><input type="checkbox" data-business-trend-values${trend.showValues ? ' checked' : ''}> 显示数值</label></div>${trend.loading ? '' : chart(trend, deps)}<details class="business-trend-daily"${trend.loading ? '' : ' open'}><summary>每日数据</summary><div class="business-trend-list">${rows || '<span>无</span>'}</div></details></div></section></div>`;
  }

  window.XXBusinessTrend = Object.freeze({ pointsFor, chart, dialog });
})();
