'use strict';
// Small, dependency-light XLSX reader/writer. IDs are always emitted as text.
const {zipSync,unzipSync,strToU8,strFromU8} = require('fflate');
const xml = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
const decode = s=>String(s??'').replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,h,d,e)=>h?String.fromCodePoint(parseInt(h,16)):d?String.fromCodePoint(Number(d)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e]));
function colName(n){let s='';do{s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1;}while(n>=0);return s;}
// 与工作台一致的显示格式：百分比保留两位并带 %，金额千分位两位，计数千分位，ROI 两位小数。
const NUM_FMTS=[{id:164,code:'0.00"%"',type:'percent'},{id:165,code:'#,##0.00',type:'money'},{id:166,code:'#,##0',type:'number'},{id:167,code:'0.00',type:'decimal'}];
const STYLE_BY_TYPE=new Map(NUM_FMTS.map((format,index)=>[format.type,index+2]));
function workbookBytes(sheets) {
  const names=new Set();
  const files={};
  const meta=sheets.map((sheet,i)=>{
    let name=String(sheet.name||`数据${i+1}`).replace(/[\\/:?*\[\]]/g,'_').slice(0,31);while(names.has(name))name=name.slice(0,25)+'_'+(i+1);names.add(name);
    const columns=sheet.columns?.length?sheet.columns:Object.keys(sheet.rows[0]||{说明:'没有记录'}).map(key=>({key,label:key}));
    const columnStyles=columns.map(column=>STYLE_BY_TYPE.get(column.type)||0);
    const records=[columns.map(c=>c.label),...sheet.rows.map(r=>columns.map(c=>r[c.key]))];
    const rows=records.map((r,ri)=>`<row r="${ri+1}">${r.map((v,ci)=>{
      if(v==null)return '';const ref=colName(ci)+(ri+1);const style=ri===0?' s="1"':(columnStyles[ci]?` s="${columnStyles[ci]}"`:'');
      if(typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}"${style}><v>${v}</v></c>`;
      const value=Array.isArray(v)?v.join('；'):typeof v==='object'?JSON.stringify(v):String(v);
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${i+1}.xml`]=strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns.map((c,j)=>`<col min="${j+1}" max="${j+1}" width="${/内容|标题|名称|图片|原因/.test(c.label)?38:22}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${colName(columns.length-1)}${records.length}"/></worksheet>`);
    return {name,index:i+1};
  });
  files['[Content_Types].xml']=strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${meta.map(s=>`<Override PartName="/xl/worksheets/sheet${s.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  files['_rels/.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  files['xl/workbook.xml']=strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${meta.map(s=>`<sheet name="${xml(s.name)}" sheetId="${s.index}" r:id="rId${s.index}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels']=strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${meta.map(s=>`<Relationship Id="rId${s.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.index}.xml"/>`).join('')}<Relationship Id="rIdStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files['xl/styles.xml']=strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="0.00&quot;%&quot;"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="#,##0"/><numFmt numFmtId="167" formatCode="0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>');
  return Buffer.from(zipSync(files,{level:6}));
}
function csvRows(text){
  const rows=[];let row=[],v='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(x=>x!==''))rows.push(row);row=[];v='';}else v+=c;}
  if(v||row.length){row.push(v);rows.push(row);}return rows;
}
function matrixToObjects(rows){
  const headers=(rows.shift()||[]).map((s,i)=>String(s||`列${i+1}`).trim());
  if(new Set(headers).size!==headers.length)throw new Error('表头存在重复列名，请修改后导入');
  return rows.filter(r=>r.some(v=>v!==''&&v!=null)).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}
function readTable(bytes,extension){
  if(extension.toLowerCase()==='.csv'){
    let text=new TextDecoder('utf-8').decode(bytes);if(text.includes('\uFFFD'))text=new TextDecoder('gb18030').decode(bytes);return matrixToObjects(csvRows(text.replace(/^\uFEFF/,'')));
  }
  // .xlsm（带宏的工作簿）与 .xlsx 同结构，按 XLSX 读取。
  if(!['.xlsx','.xlsm'].includes(extension.toLowerCase()))throw new Error('请选择 XLSX/XLSM 或 CSV 文件，旧版 XLS 请先另存为 XLSX');
  if(bytes.length>50*1024*1024)throw new Error('导入文件超过50MB，请分批导入');
  // 有些平台导出的工作簿单表解压后很大（例如 5MB 的包解压出 150MB 的 sheet1.xml），
  // 之前 100MB 的保护会直接把“第一张表”过滤掉，报“无法读取工作簿第一张表”。
  // 只保留一个防病态文件的兜底上限，正常的超大表照常读取。
  const MAX_SHEET_BYTES=1024*1024*1024;
  const skipped=[];
  const archive=unzipSync(bytes,{filter:f=>{
    if(!/^(xl\/(worksheets\/|sharedStrings|workbook|_rels\/workbook))/.test(f.name))return false;
    if(f.originalSize>=MAX_SHEET_BYTES){skipped.push(f.name);return false;}
    return true;
  }});
  const strings=[];const stringXml=archive['xl/sharedStrings.xml']?strFromU8(archive['xl/sharedStrings.xml']):'';
  for(const m of stringXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g))strings.push([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1].includes('&')?decode(x[1]):x[1]).join(''));
  const wb=strFromU8(archive['xl/workbook.xml']||new Uint8Array());const rid=/<sheet\b[^>]*r:id="([^"]+)"/.exec(wb)?.[1];
  const rels=strFromU8(archive['xl/_rels/workbook.xml.rels']||new Uint8Array());let sheetPath='xl/worksheets/sheet1.xml';
  for(const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)){if(new RegExp(`\\bId="${rid}"`).test(m[0])){const target=/Target="([^"]+)"/.exec(m[0])?.[1];if(target)sheetPath=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');}}
  if(!archive[sheetPath]){
    if(skipped.includes(sheetPath))throw new Error('第一张表解压后超过 1GB，请先拆分或精简后再导入');
    throw new Error('无法读取工作簿第一张表');
  }
  const source=strFromU8(archive[sheetPath]);const rows=[];
  for(const r of source.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
    const row=[];for(const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
      const ref=/\br="([A-Z]+)\d+"/.exec(c[1])?.[1];if(!ref)continue;let col=0;for(const ch of ref)col=col*26+ch.charCodeAt(0)-64;if(col>16384)throw new Error('列数异常');
      const inner=c[2]||'';const raw=/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1]||'';let val;
      // 只有真的含转义符时才走 decode：超大表里 60 万个单元格，这一条能省下好几秒。
      if(/\bt="s"/.test(c[1]))val=strings[Number(raw)]??'';else if(/\bt="inlineStr"/.test(c[1]))val=[...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m=>m[1].includes('&')?decode(m[1]):m[1]).join('');else val=raw.includes('&')?decode(raw):raw;
      row[col-1]=val;
    }rows.push(row);if(rows.length>500001)throw new Error('导入记录超过50万行，请分批导入');
  }return matrixToObjects(rows);
}
module.exports={workbookBytes,readTable,csvRows,xml};
