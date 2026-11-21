'use strict';

// 扣费设置（仅本店）。纯标记与输入解析；IPC、弹窗状态和保存提示由业务页负责。
(() => {
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const RATE_FIELDS=[['domesticRate','国内费率'],['overseasRate','海外费率'],['taxVat','增值税'],['taxIncome','企业所得税'],['taxStamp','印花税']];
  const AMOUNT_FIELDS=[['technicalFee','技术费（元/月）'],['warehouseExpense','中转仓（元/月）'],['serviceMonthlyFee','客服费用（元/月）'],['logisticsPerOrder','操作单物流费（元/单）']];
  const KEYS=[...RATE_FIELDS.map(([key])=>key),...AMOUNT_FIELDS.map(([key])=>key)];
  function parseRate(value,label){
    if(typeof value!=='string')throw new Error('请输入'+label);
    const text=value.trim();if(!text)return null;
    if(!/^\d+(?:\.\d{1,4})?$/.test(text)||!Number.isFinite(Number(text))||Number(text)>100)throw new Error(label+'应为 0–100，最多4位小数；留空表示未设置');
    return Number(text);
  }
  function parseAmount(value,label){
    if(typeof value!=='string')throw new Error('请输入'+label);
    const text=value.trim();if(!text)return null;
    if(!/^\d+(?:\.\d{1,2})?$/.test(text)||!Number.isFinite(Number(text))||Number(text)>1000000000)throw new Error(label+'应为 0 以上的金额，最多2位小数；留空表示未设置');
    return Number(text);
  }
  function payload(container){
    if(typeof container?.querySelector!=='function')throw new Error('扣费设置输入区域不存在');
    const result={};
    for(const [key,label]of RATE_FIELDS){const input=container.querySelector(`[name="${key}"]`);if(!input)throw new Error('扣费设置字段不完整');result[key]=parseRate(input.value,label);}
    for(const [key,label]of AMOUNT_FIELDS){const input=container.querySelector(`[name="${key}"]`);if(!input)throw new Error('扣费设置字段不完整');result[key]=parseAmount(input.value,label);}
    return result;
  }
  function button({disabled=false}={}){return `<button type="button" class="button" data-action="business:fees"${disabled?' disabled':''}>扣费设置</button>`;}
  function markup({storeName='',value={},esc=escape,error='',saving=false}={}){
    const input=(key,label,unit,hint,pattern)=>`<div class="field"><label for="business-fee-${key}">${label}${unit}</label><input id="business-fee-${key}" name="${key}" data-business-fee="${key}" type="text" inputmode="decimal" maxlength="16" autocomplete="off" placeholder="${hint}" value="${esc(value[key]??'')}"${saving?' disabled':''}></div>`;
    const rateField=(key,label)=>input(key,label,'（%）','未设置');
    const amountField=(key,label)=>input(key,label,'','未设置');
    return `<div class="business-modal-shade"><section class="business-sync-dialog business-fee-dialog" role="dialog" aria-modal="true" aria-labelledby="business-fee-title" tabindex="-1" data-business-fees data-store-id="${esc(value.storeId||'')}"><header><div><h2 id="business-fee-title">扣费设置</h2><p>${esc(storeName)} · 仅此店铺</p></div><button type="button" class="button small" data-action="business:fees-close"${saving?' disabled':''}>关闭</button></header><div class="business-sync-dialog-body"><fieldset class="business-fee-group"><legend>扣点费率</legend><div class="business-sync-dates">${rateField('domesticRate','国内费率')}${rateField('overseasRate','海外费率')}</div><p class="business-fee-formula">每日扣点 =（当天销售额 − 退款金额）× 国内费率</p></fieldset><fieldset class="business-fee-group"><legend>按单费用（当天操作单量 × 每单金额）</legend><div class="business-sync-dates">${amountField('technicalFee','技术费（元/单）')}${amountField('warehouseExpense','中转仓（元/单）')}${amountField('logisticsPerOrder','操作单物流费（元/单）')}</div><p class="business-fee-formula">操作单来源尚未接入时，按当天支付买家数计“单量”；接入后自动改用操作单量。</p></fieldset><fieldset class="business-fee-group"><legend>每月固定费用（按当月天数折算到每天）</legend><div class="business-sync-dates">${amountField('serviceMonthlyFee','客服费用（元/月）')}</div><p class="business-fee-formula">客服费用按月总额 ÷ 当月天数，再按本店当天买家数占全部店铺的比例分摊。</p></fieldset><fieldset class="business-fee-group"><legend>税费</legend><div class="business-sync-dates">${rateField('taxVat','增值税')}${rateField('taxIncome','企业所得税')}${rateField('taxStamp','印花税')}</div><p class="business-fee-formula">增值税 / 印花税 =（销售额 − 退款金额）× 税率；企业所得税 =（销售额 − 退款金额 − 推广总花费 − 淘客佣金 − 品牌新享 − 扣点）× 税率。三项相加进入日报“税费”列。</p></fieldset><p class="business-sync-note">留空表示未设置，不参与计算；0 表示明确设置为 0（填 0 时该列按 0 显示）。</p>${error?`<div class="business-error" role="alert" data-business-fee-error>${esc(error)}</div>`:''}</div><footer><button type="button" class="button" data-action="business:fees-close"${saving?' disabled':''}>取消</button><button type="button" class="button primary" data-action="business:fees-save"${saving?' disabled':''}>${saving?'正在保存…':'保存设置'}</button></footer></section></div>`;
  }
  window.XXBusinessFeeSettings=Object.freeze({button,markup,payload,parseRate,parseAmount,KEYS});
})();
