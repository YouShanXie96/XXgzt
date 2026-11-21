'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function within(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative)
    || /[:\0]/.test(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..'
      || /[ .]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('无效的数据路径');
  const result = path.resolve(root, relative);
  const diff = path.relative(path.resolve(root), result);
  if (!diff || diff === '..' || diff.startsWith('..' + path.sep) || path.isAbsolute(diff)) throw new Error('数据路径超出工作台目录');
  return result;
}
// Follow no junction/symlink inside the data tree, including the final file.
async function assertNoLinks(root, relative) {
  const target = within(root, relative);
  const pieces = path.relative(path.resolve(root), target).split(path.sep);
  let current = path.resolve(root);
  for (const piece of ['', ...pieces]) {
    if (piece) current = path.join(current, piece);
    try { const stat = await fs.lstat(current); if (stat.isSymbolicLink()) throw new Error('数据路径包含链接或目录联接，已拒绝访问'); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
  return target;
}
async function atomicWrite(root, relative, bytes) {
  const target = await assertNoLinks(root, relative);
  await fs.mkdir(path.dirname(target), {recursive:true});
  await assertNoLinks(root, relative);
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temp, target); break; }
      catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1))); }
    }
  } finally { await fs.unlink(temp).catch(()=>{}); }
}
function createStorage(dataDir) {
  const queues = new Map();
  let sealed = false;
  async function readJson(relative, fallback) {
    try { await queues.get(within(dataDir, relative)); return JSON.parse(await fs.readFile(await assertNoLinks(dataDir, relative), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return structuredClone(fallback); throw new Error(`数据文件无法读取：${relative}。请保留文件并从备份恢复。`, {cause:e}); }
  }
  function writeJson(relative, value) {
    if (sealed) return Promise.reject(new Error('业务数据写入已停止，请重新启动工作台。'));
    const target = within(dataDir, relative);
    const text = JSON.stringify(value, null, 2);
    if (text === undefined) throw new Error('不能保存空的数据对象');
    const op = (queues.get(target) || Promise.resolve()).catch(()=>{}).then(async () => {
      await assertNoLinks(dataDir, relative);
      await assertNoLinks(dataDir, relative+'.previous');
      await fs.readFile(target).then(bytes => atomicWrite(dataDir, relative+'.previous', bytes)).catch(e=>{if(e.code!=='ENOENT') throw e;});
      await atomicWrite(dataDir, relative, text);
    });
    queues.set(target, op);
    return op.finally(()=>{if(queues.get(target)===op) queues.delete(target);});
  }
  async function flush() {
    while (queues.size) { const results=await Promise.allSettled([...queues.values()]); const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason; }
  }
  return {readJson,writeJson,flush,sealWrites:async()=>{sealed=true;await flush();},isSealed:()=>sealed};
}
module.exports = {createStorage,within,assertNoLinks,atomicWrite};
