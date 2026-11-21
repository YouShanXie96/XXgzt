"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPromotionExecutionExportFileName = createPromotionExecutionExportFileName;
exports.buildPromotionExecutionWorkbook = buildPromotionExecutionWorkbook;
const fflate_1 = require("fflate");
const headers = ['规则名称', '计划名称', '产品ID', '花费', '投产', '点击量', '执行状态', '执行模式', '执行时间', '是否恢复'];
const columnWidths = [22, 38, 20, 14, 12, 12, 14, 14, 22, 16];
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const EXCEL_EPOCH_OFFSET_DAYS = 25_569;
function createPromotionExecutionExportFileName(storeName, exportedAt = new Date()) {
    const safeStoreName = cleanText(storeName)
        .replace(/[<>:"/\\|?*]/gu, '_')
        .replace(/[. ]+$/gu, '')
        .slice(0, 80) || '店铺';
    const shifted = new Date(exportedAt.valueOf() + SHANGHAI_OFFSET_MS);
    const part = (value) => String(value).padStart(2, '0');
    const stamp = `${shifted.getUTCFullYear()}${part(shifted.getUTCMonth() + 1)}${part(shifted.getUTCDate())}-${part(shifted.getUTCHours())}${part(shifted.getUTCMinutes())}${part(shifted.getUTCSeconds())}`;
    return `${safeStoreName}-推广执行记录-${stamp}.xlsx`;
}
function buildPromotionExecutionWorkbook(input) {
    const exportedAt = input.exportedAt ?? new Date();
    const rows = buildExecutionExportRecords(input.logs, input.recoveries);
    const worksheet = buildWorksheet(input.storeName, rows, exportedAt);
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
function buildWorksheet(storeName, rows, exportedAt) {
    const lastRow = Math.max(4, rows.length + 4);
    const metadata = `店铺：${storeName}　记录：${rows.length} 条　导出时间：${formatShanghaiDateTime(exportedAt)}`;
    const titleRow = `<row r="1" ht="30" customHeight="1">${inlineStringCell('A1', '推广执行记录导出', 1)}</row>`;
    const metadataRow = `<row r="2" ht="24" customHeight="1">${inlineStringCell('A2', metadata, 2)}</row>`;
    const headerRow = `<row r="4" ht="28" customHeight="1">${headers.map((header, index) => (inlineStringCell(`${columnName(index + 1)}4`, header, 3))).join('')}</row>`;
    const dataRows = rows.map((row, index) => {
        const rowNumber = index + 5;
        const recoveryText = row.willRecoverNextDay === null
            ? '不适用'
            : row.willRecoverNextDay ? '是' : '否';
        const cells = [
            inlineStringCell(`A${rowNumber}`, row.ruleName),
            inlineStringCell(`B${rowNumber}`, row.campaignName, 8),
            inlineStringCell(`C${rowNumber}`, row.productId),
            optionalNumberCell(`D${rowNumber}`, row.spend, 4),
            optionalNumberCell(`E${rowNumber}`, row.roi, 5),
            optionalNumberCell(`F${rowNumber}`, row.clicks, 6),
            inlineStringCell(`G${rowNumber}`, row.executionStatus),
            inlineStringCell(`H${rowNumber}`, row.executionMode),
            dateCell(`I${rowNumber}`, row.createdAt),
            inlineStringCell(`J${rowNumber}`, recoveryText)
        ];
        return `<row r="${rowNumber}" ht="26" customHeight="1">${cells.join('')}</row>`;
    }).join('');
    const columns = columnWidths.map((width, index) => (`<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:J${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${titleRow}${metadataRow}${headerRow}${dataRows}</sheetData>
  <mergeCells count="2"><mergeCell ref="A1:J1"/><mergeCell ref="A2:J2"/></mergeCells>
  <autoFilter ref="A4:J${lastRow}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}
function buildExecutionExportRecords(logs, recoveries) {
    return logs.map((log) => {
        const recovery = log.action === 'pause'
            ? recoveries.find((candidate) => candidate.profileId === log.profileId
                && candidate.campaignId === log.campaignId
                && candidate.createdAt === log.createdAt)
            : undefined;
        const finiteOrNull = (value) => Number.isFinite(value) ? value : null;
        return {
            ruleName: log.ruleName,
            campaignName: log.campaignName,
            productId: log.itemId ?? (log.campaignId.startsWith('scan:') ? '—' : log.campaignId),
            spend: finiteOrNull(log.spend) ?? readMetricFromReason(log.reason, ['花费']),
            roi: finiteOrNull(log.roi) ?? readMetricFromReason(log.reason, ['净实际投产比', '实际投产比', '净成交比', '净投产比']),
            clicks: finiteOrNull(log.clicks) ?? readMetricFromReason(log.reason, ['点击量']),
            executionStatus: log.status === 'success' ? '成功' : log.status === 'failed' ? '失败' : '已跳过',
            executionMode: log.action === 'observe' ? '观察模式' : '正式模式',
            createdAt: log.createdAt,
            willRecoverNextDay: log.action !== 'pause'
                ? null
                : log.status !== 'success'
                    ? false
                    : recovery
                        ? recovery.status === 'pending' || recovery.status === 'completed'
                        : log.recoveryScheduled ?? false
        };
    });
}
function readMetricFromReason(reason, labels) {
    const match = reason.match(new RegExp(`(?:${labels.join('|')})\\s+(-?\\d+(?:\\.\\d+)?)`, 'u'));
    if (!match)
        return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
}
function inlineStringCell(reference, value, style = 0) {
    const text = xmlEscape(cleanText(value).slice(0, 32_767));
    return `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${text}</t></is></c>`;
}
function optionalNumberCell(reference, value, style) {
    return value === null || !Number.isFinite(value)
        ? inlineStringCell(reference, '')
        : `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
}
function dateCell(reference, value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp))
        return inlineStringCell(reference, '');
    const serial = ((timestamp + SHANGHAI_OFFSET_MS) / 86_400_000) + EXCEL_EPOCH_OFFSET_DAYS;
    return `<c r="${reference}" s="7"><v>${Number(serial.toFixed(10))}</v></c>`;
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
const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="执行记录" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const workbookRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FF0F172A"/><sz val="16"/><name val="Microsoft YaHei"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD6DEE8"/></left><right style="thin"><color rgb="FFD6DEE8"/></right><top style="thin"><color rgb="FFD6DEE8"/></top><bottom style="thin"><color rgb="FFD6DEE8"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0"><alignment horizontal="right"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0"><alignment horizontal="right"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="0"><alignment horizontal="right"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
const appPropertiesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>谢谢工作台</Application><AppVersion>1.0</AppVersion></Properties>`;
const corePropertiesXml = (createdAt) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>谢谢工作台</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`;
