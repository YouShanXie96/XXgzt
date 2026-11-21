'use strict';

(() => {
  const dayMs=86400000;
  const today=(offset=0,now=new Date())=>new Date(new Date(now).getTime()+8*3600000+offset*dayMs).toISOString().slice(0,10);
  function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;}
  function monthRange(month,now=new Date()){
    if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||month>today(0,now).slice(0,7))throw new Error('请选择有效月份，不能查询未来月份。');
    const start=`${month}-01`,next=new Date(`${start}T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
    const last=new Date(next.getTime()-dayMs).toISOString().slice(0,10);
    const end=last>today(-1,now)?today(-1,now):last;
    if(start>end)throw new Error('本月尚无完整日期，请选择上月或自定义历史日期。');
    return {start,end};
  }
  function shiftMonth(month,offset){const date=new Date(`${month}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+offset);return date.toISOString().slice(0,7);}
  // 精细化默认按“近7天”（页面筛选与整店同步都用这个默认值）；日报仍默认本月。
  function initial(mode,now=new Date()){
    const last=today(-1,now),month=last.slice(0,7);
    if(mode==='daily')return {dateMode:'month',month,...monthRange(month,now)};
    return {dateMode:'custom',month,start:today(-7,now),end:last,preset:'week'};
  }
  function range(draft,mode,now=new Date()){
    const value=mode==='daily'&&draft.dateMode==='month'?monthRange(draft.month,now):{start:draft.start,end:draft.end};
    if(!validDate(value.start)||!validDate(value.end)||value.start>value.end)throw new Error('请选择有效日期，开始日期不能晚于结束日期。');
    if(value.end>today(0,now))throw new Error('结束日期不能晚于今天。');
    if((Date.parse(value.end)-Date.parse(value.start))/dayMs>=31)throw new Error('一次最多查询或同步31天，请缩小日期范围。');
    return value;
  }
  function dailySyncWindow(now=new Date()){return {start:today(-31,now),end:today(-1,now)};}
  function preset(value,now=new Date()){
    const last=today(-1,now),month=last.slice(0,7);
    if(value==='yesterday')return {dateMode:'custom',month,start:last,end:last,preset:value};
    if(value==='week'||value==='recent30')return {dateMode:'custom',month,start:today(value==='week'?-7:-30,now),end:last,preset:value};
    if(value==='month'||value==='last-month'){
      const selected=value==='last-month'?shiftMonth(today(0,now).slice(0,7),-1):today(0,now).slice(0,7);
      return {dateMode:'month',month:selected,...monthRange(selected,now),preset:value};
    }
    throw new Error('请选择有效的同步日期快捷项。');
  }
  function syncRange(draft,mode,now=new Date()){
    const value=range(draft,mode,now),last=today(-1,now);if(value.end>last)value.end=last;
    if(value.start>value.end)throw new Error('整店同步仅统计截至昨日的日期，请选择已有完整日期的范围。');
    const window=dailySyncWindow(now);
    if(mode==='daily'&&value.start<window.start)throw new Error(`日报只能同步最近31个完整日（${window.start} 至 ${window.end}），请缩小同步范围；历史已保存数据仍可搜索和导出。`);
    return value;
  }
  function render(draft,mode,{esc,button}){
    const select=mode==='daily'?`<div class="business-date-mode">${button('按月','date-mode',{small:true,attrs:'data-value="month"',primary:draft.dateMode==='month'})}${button('自定义日期','date-mode',{small:true,attrs:'data-value="custom"',primary:draft.dateMode==='custom'})}</div>`:'';
    if(mode==='daily'&&draft.dateMode==='month')return `${select}<div class="field business-month-field"><label for="business-month">统计月份</label><div class="business-month-picker">${button('上一月','month-previous',{small:true})}<input type="month" id="business-month" data-business-field="month" value="${esc(draft.month)}" max="${today(-1).slice(0,7)}">${button('下一月','month-next',{small:true,disabled:draft.month>=today(-1).slice(0,7)})}</div></div>`;
    return `${select}<div class="field"><label for="business-start">开始日期</label><input type="date" id="business-start" data-business-field="start" value="${esc(draft.start)}" max="${today()}"></div><div class="field"><label for="business-end">结束日期</label><input type="date" id="business-end" data-business-field="end" value="${esc(draft.end)}" max="${today()}"></div>`;
  }
  window.XXBusinessDates=Object.freeze({today,validDate,monthRange,shiftMonth,initial,range,dailySyncWindow,preset,syncRange,render});
})();
