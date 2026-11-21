'use strict';

(() => {
  const labels=Object.freeze({customProfit:'自定义利润',reimbursementExpense:'报销费用'});
  function markup(dialog,esc,button){
    if(!dialog)return '';
    const current=dialog.entry;
    return `<div class="business-modal-shade"><section class="business-manual-dialog" role="dialog" aria-modal="true" aria-labelledby="business-manual-title" tabindex="-1"><header><div><h2 id="business-manual-title">${esc(labels[dialog.field]||'手工金额')}</h2><p>${esc(dialog.date)} · 仅修改本机手工记录</p></div>${button('关闭','manual-close',{small:true,disabled:dialog.saving})}</header><div class="business-manual-body">${current?`<div class="business-manual-current"><strong>当前记录：${esc(Number(current.amount).toFixed(2))} 元</strong><span>上次原因：${esc(current.reason)}</span></div>`:'<div class="business-manual-current"><strong>该日期尚未填写</strong><span>填写金额及原因后才会计入日报和导出。</span></div>'}<label class="business-manual-field">金额（元）<input type="number" step="0.01"${dialog.field==='reimbursementExpense'?' min="0"':''} data-business-manual-field="amount" value="${esc(dialog.amount)}"${dialog.saving?' disabled':''} aria-label="金额（元）"></label><label class="business-manual-field">本次原因（必填）<textarea required data-business-manual-field="reason" rows="3" maxlength="500"${dialog.saving?' disabled':''} aria-label="本次原因">${esc(dialog.reason)}</textarea></label><p class="business-manual-note">剔除只移除当日当前值；本次原因和金额会保留在导出的手工调整记录中。</p>${dialog.error?`<div class="business-error" role="alert">${esc(dialog.error)}</div>`:''}</div><footer>${current?button(dialog.saving?'正在处理…':'剔除该日金额','manual-exclude',{disabled:dialog.saving}):''}${button(dialog.saving?'正在保存…':'保存金额','manual-save',{primary:true,disabled:dialog.saving})}</footer></section></div>`;
  }
  function payload(dialog){
    if(!dialog)throw new Error('手工金额对话框已关闭');
    return {amount:dialog.amount,reason:dialog.reason};
  }
  window.XXBusinessManual=Object.freeze({labels,markup,payload});
})();
