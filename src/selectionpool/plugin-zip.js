'use strict';

/**
 * 最小 zip 解包（无第三方依赖）。
 *
 * 用途：同事电脑没装 AI作图 时，从主机 `GET /api/extension/download` 取插件包。
 * 支持 stored(0) 与 deflate(8) 两种方式；AI作图 的 sendZip 是 stored + UTF-8 文件名。
 */

const zlib = require('node:zlib');

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function findEnd(buffer) {
  const start = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) return i;
  }
  return -1;
}

/**
 * @param {Buffer} buffer zip 内容
 * @returns {Array<{name:string, data:Buffer}>}
 */
function unzip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('不是有效的 zip 文件');
  const end = findEnd(buffer);
  if (end < 0) throw new Error('不是有效的 zip 文件（找不到目录结尾）');

  const total = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = [];

  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL) break;

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    cursor += 46 + nameLength + extraLength + commentLength;

    if (!name || name.endsWith('/')) continue;
    if (buffer.readUInt32LE(localOffset) !== LOCAL) continue;

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`不支持的压缩方式：${method}（文件 ${name}）`);

    files.push({ name, data });
  }

  if (!files.length) throw new Error('zip 里没有文件');
  return files;
}

/**
 * 去掉统一的前缀目录（AI作图 的包是 `AI作图插件/xxx`），返回相对路径。
 * 只有所有文件都在同一个顶层目录下才剥离，避免误伤。
 */
function stripCommonRoot(files) {
  if (!files.length) return files;
  const roots = new Set(files.map((file) => file.name.split('/')[0]));
  const hasNested = files.some((file) => file.name.includes('/'));
  if (roots.size !== 1 || !hasNested) return files;
  return files.map((file) => ({ name: file.name.split('/').slice(1).join('/'), data: file.data }));
}

/** CRC32（zip 打包用）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 最小 zip 打包（store-only，与 AI作图 sendZip 同款：无压缩 + UTF-8 文件名）。
 * @param {Array<{name:string, data:Buffer}>} files 文件列表（正斜杠相对路径）
 * @returns {Buffer}
 */
function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(String(file.name).replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 flag
    local.writeUInt16LE(0, 8);            // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const chunk of central) { centralSize += chunk.length; chunks.push(chunk); }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  chunks.push(end);
  return Buffer.concat(chunks);
}

module.exports = { unzip, stripCommonRoot, zipStore };
