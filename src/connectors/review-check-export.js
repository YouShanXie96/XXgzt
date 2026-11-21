"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReviewCheckExportFileName = createReviewCheckExportFileName;
exports.buildReviewCheckOrderWorkbook = buildReviewCheckOrderWorkbook;
const fflate_1 = require("fflate");
const MAX_EXCEL_ROWS = 100_000;
const MAX_EXCEL_CELL_TEXT = 32_767;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const EXCEL_EPOCH_OFFSET_DAYS = 25_569;
const headers = [
    '订单号', '机构名称', '子订单号', '订单明细ID', '商品ID', 'SKU ID', '商品信息', '数量', '下单时间',
    '订单状态', '评价状态', '晒图状态', '图片数量', '评价记录数', '评价时间', '评价内容', '评分',
    '是否追评', '匹配依据'
];
const columnWidths = [20, 16, 20, 20, 16, 16, 38, 8, 20, 16, 14, 12, 10, 12, 20, 42, 8, 10, 36];
function createReviewCheckExportFileName(storeName, range) {
    const safeStoreName = cleanText(storeName)
        .replace(/[<>:"/\\|?*]/gu, '_')
        .replace(/[. ]+$/gu, '')
        .slice(0, 80) || '店铺';
    const dateSegment = (value, fallback) => {
        const digits = value.replace(/\D/gu, '').slice(0, 8);
        return digits.length === 8 ? digits : fallback;
    };
    return `${safeStoreName}-评价晒图检查-${dateSegment(range.start, 'start')}-${dateSegment(range.end, 'end')}.xlsx`;
}
function buildReviewCheckOrderWorkbook(input) {
    if (input.rows.length > MAX_EXCEL_ROWS)
        throw new Error('REVIEW_CHECK_EXPORT_TOO_LARGE');
    const now = input.exportedAt ?? new Date();
    const lastRow = Math.max(4, input.rows.length + 4);
    const worksheet = buildWorksheet(input, lastRow, now);
    const createdAt = now.toISOString();
    return (0, fflate_1.zipSync)({
        '[Content_Types].xml': (0, fflate_1.strToU8)(contentTypesXml),
        '_rels/.rels': (0, fflate_1.strToU8)(rootRelationshipsXml),
        'docProps/app.xml': (0, fflate_1.strToU8)(appPropertiesXml),
        'docProps/core.xml': (0, fflate_1.strToU8)(corePropertiesXml(createdAt)),
        'xl/_rels/workbook.xml.rels': (0, fflate_1.strToU8)(workbookRelationshipsXml),
        'xl/styles.xml': (0, fflate_1.strToU8)(stylesXml),
        'xl/workbook.xml': (0, fflate_1.strToU8)(workbookXml),
        'xl/worksheets/sheet1.xml': (0, fflate_1.strToU8)(worksheet)
    }, { level: 6 });
}
function buildWorksheet(input, lastRow, exportedAt) {
    const lastColumn = columnName(headers.length);
    const metadata = [
        `店铺：${input.storeName}`,
        `下单日期：${input.range.start} 至 ${input.range.end}`,
        `筛选：${input.filterLabel || '全部'}`,
        input.query.trim() ? `搜索：${input.query.trim()}` : '',
        `记录：${input.rows.length} 条`,
        `导出时间：${formatShanghaiDateTime(exportedAt)}`
    ].filter(Boolean).join('　');
    const titleRow = `<row r="1" ht="30" customHeight="1">${inlineStringCell('A1', '评价晒图检查订单导出', 1)}</row>`;
    const metadataRow = `<row r="2" ht="24" customHeight="1">${inlineStringCell('A2', metadata, 2)}</row>`;
    const headerRow = `<row r="4" ht="28" customHeight="1">${headers.map((header, index) => (inlineStringCell(`${columnName(index + 1)}4`, header, 3))).join('')}</row>`;
    const dataRows = input.rows.map((row, index) => buildDataRow(row, index + 5)).join('');
    const columns = columnWidths.map((width, index) => (`<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${titleRow}${metadataRow}${headerRow}${dataRows}</sheetData>
  <mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
  <autoFilter ref="A4:${lastColumn}${lastRow}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}
function buildDataRow({ order, match }, rowNumber) {
    const reviewStatus = match.status === 'confirmed' ? '已评价'
        : match.status === 'pending' ? '待确认'
            : match.status === 'sync-failed' ? '同步失败' : '未评价';
    const imageStatus = match.status !== 'confirmed' ? '' : match.imageCount > 0 ? '有晒图' : '无晒图';
    const cells = [
        inlineStringCell(`A${rowNumber}`, order.mainOrderId ?? ''),
        inlineStringCell(`B${rowNumber}`, order.organizationName ?? ''),
        inlineStringCell(`C${rowNumber}`, order.subOrderId ?? ''),
        inlineStringCell(`D${rowNumber}`, order.orderLineId ?? ''),
        inlineStringCell(`E${rowNumber}`, order.productId),
        inlineStringCell(`F${rowNumber}`, order.skuId ?? ''),
        inlineStringCell(`G${rowNumber}`, order.productTitle, 7),
        numberCell(`H${rowNumber}`, order.quantity, 4),
        dateCell(`I${rowNumber}`, order.orderedAt),
        inlineStringCell(`J${rowNumber}`, order.status),
        inlineStringCell(`K${rowNumber}`, reviewStatus),
        inlineStringCell(`L${rowNumber}`, imageStatus),
        numberCell(`M${rowNumber}`, match.imageCount, 4),
        numberCell(`N${rowNumber}`, match.reviewIds.length, 4),
        dateCell(`O${rowNumber}`, match.evaluatedAt),
        inlineStringCell(`P${rowNumber}`, match.content ?? '', 7),
        optionalNumberCell(`Q${rowNumber}`, match.score),
        inlineStringCell(`R${rowNumber}`, match.hasFollowUp ? '是' : '否'),
        inlineStringCell(`S${rowNumber}`, match.evidence.join('；'), 7)
    ];
    return `<row r="${rowNumber}" ht="32" customHeight="1">${cells.join('')}</row>`;
}
function inlineStringCell(reference, value, style = 0) {
    const text = xmlEscape(cleanText(value).slice(0, MAX_EXCEL_CELL_TEXT));
    return `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${text}</t></is></c>`;
}
function numberCell(reference, value, style = 0) {
    const number = Number(value);
    const normalized = Number.isFinite(number) ? number : 0;
    return `<c r="${reference}"${style ? ` s="${style}"` : ''}><v>${normalized}</v></c>`;
}
function optionalNumberCell(reference, value) {
    const number = Number(value);
    return value === undefined || value === null || !Number.isFinite(number)
        ? inlineStringCell(reference, '')
        : numberCell(reference, number);
}
function dateCell(reference, value) {
    const timestamp = Date.parse(String(value ?? ''));
    if (!Number.isFinite(timestamp))
        return inlineStringCell(reference, '');
    const excelSerial = ((timestamp + SHANGHAI_OFFSET_MS) / 86_400_000) + EXCEL_EPOCH_OFFSET_DAYS;
    return numberCell(reference, Number(excelSerial.toFixed(10)), 5);
}
function formatShanghaiDateTime(value) {
    const shifted = new Date(value.valueOf() + SHANGHAI_OFFSET_MS);
    const part = (number) => String(number).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${part(shifted.getUTCMonth() + 1)}-${part(shifted.getUTCDate())} ${part(shifted.getUTCHours())}:${part(shifted.getUTCMinutes())}:${part(shifted.getUTCSeconds())}`;
}
function columnName(index) {
    let current = index;
    let result = '';
    while (current > 0) {
        current -= 1;
        result = String.fromCharCode(65 + (current % 26)) + result;
        current = Math.floor(current / 26);
    }
    return result;
}
function cleanText(value) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '');
}
function xmlEscape(value) {
    return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}
const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const rootRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="评价订单明细" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`;
const workbookRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Microsoft YaHei"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Microsoft YaHei"/><family val="2"/></font><font><b/><color rgb="FF0F172A"/><sz val="16"/><name val="Microsoft YaHei"/><family val="2"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD6DEE8"/></left><right style="thin"><color rgb="FFD6DEE8"/></right><top style="thin"><color rgb="FFD6DEE8"/></top><bottom style="thin"><color rgb="FFD6DEE8"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
const appPropertiesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>谢谢工作台</Application><AppVersion>1.0</AppVersion></Properties>`;
const corePropertiesXml = (createdAt) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>谢谢工作台</dc:creator><cp:lastModifiedBy>谢谢工作台</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`;
