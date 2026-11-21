"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPromotionProductExportFileName = createPromotionProductExportFileName;
exports.buildPromotionProductWorkbook = buildPromotionProductWorkbook;
const fflate_1 = require("fflate");
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
function createPromotionProductExportFileName(storeName, listName, exportedAt = new Date()) {
    const safePart = (value, fallback) => cleanText(value)
        .replace(/[<>:"/\\|?*]/gu, '_')
        .replace(/[. ]+$/gu, '')
        .slice(0, 80) || fallback;
    const shifted = new Date(exportedAt.valueOf() + SHANGHAI_OFFSET_MS);
    const part = (value) => String(value).padStart(2, '0');
    const stamp = `${shifted.getUTCFullYear()}${part(shifted.getUTCMonth() + 1)}${part(shifted.getUTCDate())}-${part(shifted.getUTCHours())}${part(shifted.getUTCMinutes())}${part(shifted.getUTCSeconds())}`;
    return `${safePart(storeName, '店铺')}-${safePart(listName, '商品列表')}-${stamp}.xlsx`;
}
function buildPromotionProductWorkbook(input) {
    const exportedAt = input.exportedAt ?? new Date();
    const columns = input.scope === 'product-decision' ? productDecisionColumns : channelListColumns(input.channel);
    const worksheet = buildWorksheet(input, columns, exportedAt);
    const createdAt = exportedAt.toISOString();
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
function channelListColumns(channel) {
    return [
        textColumn('状态', 13, (row) => row.status),
        textColumn('商品名称', 38, (row) => row.productName),
        textColumn('商品ID', 20, (row) => row.productId),
        textColumn('计划名称', 38, (row) => row.planNames),
        textColumn('计划ID', 21, (row) => row.planIds),
        textColumn('计划组', 28, (row) => row.groupNames),
        textColumn('渠道', 14, () => channel),
        metricColumn('花费', 14, 'money', 'spend'),
        metricColumn('ROI', 12, 'decimal', 'roi'),
        metricColumn('成交额', 14, 'money', 'revenue'),
        metricColumn('成交量', 12, 'integer', 'orders'),
        metricColumn('点击量', 12, 'integer', 'clicks'),
        metricColumn('平均点击花费', 16, 'money', 'avgClickCost'),
        metricColumn('展现量', 14, 'integer', 'impressions'),
        metricColumn('加购量', 12, 'integer', 'cartAdds')
    ];
}
const baseDecisionColumns = [
    textColumn('状态', 13, (row) => row.status),
    textColumn('商品名称', 38, (row) => row.productName),
    textColumn('商品ID', 20, (row) => row.productId),
    textColumn('计划名称', 38, (row) => row.planNames),
    textColumn('计划ID', 21, (row) => row.planIds),
    textColumn('计划组', 28, (row) => row.groupNames),
    textColumn('建议', 14, (row) => row.recommendation)
];
const productDecisionColumns = [
    ...baseDecisionColumns,
    ...decisionMetricColumns('全站商品', 'productMetrics'),
    ...decisionMetricColumns('全站全店', 'storeMetrics')
];
function decisionMetricColumns(prefix, source) {
    const column = (label, width, kind, key) => ({
        header: `${prefix}${label}`,
        width,
        kind,
        value: (row) => row[source]?.[key] ?? 0
    });
    return [
        column('花费', 16, 'money', 'spend'),
        column('ROI', 14, 'decimal', 'roi'),
        column('成交额', 16, 'money', 'revenue'),
        column('成交量', 14, 'integer', 'orders'),
        column('点击量', 14, 'integer', 'clicks'),
        column('平均点击花费', 18, 'money', 'avgClickCost'),
        column('展现量', 16, 'integer', 'impressions'),
        column('加购量', 14, 'integer', 'cartAdds')
    ];
}
function textColumn(header, width, value) {
    return { header, width, kind: 'text', value };
}
function metricColumn(header, width, kind, key) {
    return { header, width, kind, value: (row) => row.metrics?.[key] ?? 0 };
}
function buildWorksheet(input, columns, exportedAt) {
    const lastColumn = columnName(columns.length);
    const lastRow = Math.max(5, input.rows.length + 5);
    const title = input.scope === 'product-decision' ? '商品决策列表' : `${input.channel}商品列表`;
    const metadata = `店铺：${input.storeName}　日期：${input.startDate} 至 ${input.endDate}（${input.rangeLabel}）　渠道：${input.channel}　记录：${input.rows.length} 条　导出时间：${formatShanghaiDateTime(exportedAt)}`;
    const filter = `当前筛选：${input.filterLabel || '无（全部）'}`;
    const titleRow = `<row r="1" ht="30" customHeight="1">${inlineStringCell('A1', title, 1)}</row>`;
    const metadataRow = `<row r="2" ht="24" customHeight="1">${inlineStringCell('A2', metadata, 2)}</row>`;
    const filterRow = `<row r="3" ht="24" customHeight="1">${inlineStringCell('A3', filter, 2)}</row>`;
    const headerRow = `<row r="5" ht="30" customHeight="1">${columns.map((column, index) => inlineStringCell(`${columnName(index + 1)}5`, column.header, 3)).join('')}</row>`;
    const dataRows = input.rows.map((row, index) => {
        const rowNumber = index + 6;
        const cells = columns.map((column, columnIndex) => exportCell(`${columnName(columnIndex + 1)}${rowNumber}`, column.value(row), column.kind));
        return `<row r="${rowNumber}" ht="28" customHeight="1">${cells.join('')}</row>`;
    }).join('');
    const columnXml = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A6" sqref="A6"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${columnXml}</cols>
  <sheetData>${titleRow}${metadataRow}${filterRow}${headerRow}${dataRows}</sheetData>
  <mergeCells count="3"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/><mergeCell ref="A3:${lastColumn}3"/></mergeCells>
  <autoFilter ref="A5:${lastColumn}${lastRow}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}
function exportCell(reference, value, kind) {
    if (kind === 'text')
        return inlineStringCell(reference, value, 7);
    const number = Number(value);
    if (!Number.isFinite(number))
        return inlineStringCell(reference, '');
    const style = kind === 'money' ? 4 : kind === 'decimal' ? 5 : 6;
    return `<c r="${reference}" s="${style}"><v>${number}</v></c>`;
}
function inlineStringCell(reference, value, style = 0) {
    const text = xmlEscape(cleanText(value).slice(0, 32_767));
    return `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${text}</t></is></c>`;
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
const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const rootRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="商品列表" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const workbookRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="¥#,##0.00"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FF0F172A"/><sz val="16"/><name val="Microsoft YaHei"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD6DEE8"/></left><right style="thin"><color rgb="FFD6DEE8"/></right><top style="thin"><color rgb="FFD6DEE8"/></top><bottom style="thin"><color rgb="FFD6DEE8"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0"><alignment horizontal="right"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0"><alignment horizontal="right"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
const appPropertiesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>谢谢工作台</Application><AppVersion>1.0</AppVersion></Properties>`;
const corePropertiesXml = (createdAt) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>谢谢工作台</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`;
