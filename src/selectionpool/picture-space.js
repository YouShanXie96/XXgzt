'use strict';

/**
 * 上品库 · 图片空间（老软件 picture-space-queue / warehouse-image-* 的替代）
 *
 * 用途：详情图 / 主图 / SKU 图要进「本店图片空间」才能被发布页详情编辑器直接引用。
 * 老软件日志：`[fill-detail] 详情图已上传到本店图片空间 16 张（接口上传）` 走的就是这条链。
 *
 * 依赖接口（用户还没申请，先按可用即启用、不可用就明确回落的方式实现）：
 *   taobao.picture.upload   上传单张（≤3MB，png/jpg/gif）→ picture_path
 *   taobao.item.joint.img   把图片空间里的图关联到商品（num_iid + pic_path + is_major + position）
 *   taobao.item.img.upload  直接给商品传图（二进制）
 *   taobao.item.seller.get  回读 item_imgs 做一致性校验
 *
 * 未配置凭证时 **不发明成功**：`readiness()` 返回 configured:false，调用方回落成发布页文件上传，
 * 并把「需要申请哪个接口」写进上架日志。
 */

const C = require('./contract');

const MAX_BYTES = 3 * 1024 * 1024;      // 图片空间单张上限
const MAX_PER_ITEM = 40;                // 老软件详情图上限
const CONCURRENCY = 2;

function createPictureSpace({ taobaoApi, ctx, log } = {}) {
  const emit = line => { try { (typeof log === 'function' ? log : () => {})?.(String(line)); } catch { /* */ } };

  /** 接口凭证是否齐备（只看配置，不发请求）。 */
  async function readiness() {
    let view = {};
    try { view = await taobaoApi.readiness(); } catch { view = {}; }
    const configured = Boolean(C.trimmed(view.appKey) && C.trimmed(view.appSecret) && view.hasSessionKey);
    return {
      configured,
      appKey: Boolean(C.trimmed(view.appKey)),
      sessionKey: Boolean(view.hasSessionKey),
      note: configured
        ? '图片空间接口已启用（AppKey/AppSecret/sessionKey 齐全）'
        : '未填 AppKey / AppSecret / sessionKey：图片空间上传保持关闭，上架时回落成发布页文件上传',
      missing: configured ? [] : [
        ...(C.trimmed(view.appKey) && C.trimmed(view.appSecret) ? [] : ['AppKey 与 AppSecret']),
        ...(view.hasSessionKey ? [] : ['sessionKey（店铺 OAuth）']),
      ],
    };
  }

  /** 读图：支持 https 直链与本机绝对路径；返回 Buffer + 扩展名。 */
  async function readBytes(source) {
    const raw = C.str(source).trim();
    if (!raw) throw new Error('缺少图片来源');
    if (/^https:\/\//i.test(raw)) {
      const response = await fetch(raw, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`下载图片失败 HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      return { bytes: buffer, ext: /\.png(?:$|\?)/i.test(raw) ? 'png' : /\.webp(?:$|\?)/i.test(raw) ? 'webp' : 'jpg' };
    }
    const abs = raw.startsWith('local:') ? raw.slice(6) : raw;
    const fs = require('node:fs/promises');
    const buffer = await fs.readFile(abs);
    const ext = (/\.(png|jpe?g|webp)$/i.exec(abs) || [])[1] || 'jpg';
    return { bytes: buffer, ext: ext.toLowerCase().replace('jpeg', 'jpg') };
  }

  /** 超过 3MB 时用 Electron nativeImage 压到 1600px JPEG（图片空间硬限制）。 */
  function fitSize(bytes, ext) {
    if (bytes.length <= MAX_BYTES) return { bytes, ext };
    if (!ctx?.nativeImage?.createFromBuffer) return { bytes, ext, tooLarge: true };
    try {
      const image = ctx.nativeImage.createFromBuffer(bytes);
      if (image.isEmpty?.()) return { bytes, ext, tooLarge: true };
      const size = image.getSize();
      const width = Math.min(1600, size.width || 1600);
      const resized = image.resize({ width, quality: 'good' });
      return { bytes: resized.toJPEG(88), ext: 'jpg', resized: true };
    } catch {
      return { bytes, ext, tooLarge: true };
    }
  }

  /** 从 TOP 返回里抠 picture_path（不同版本字段名有差异）。 */
  function picturePathOf(data) {
    const node = data?.picture || data;
    return C.str(node?.picture_path || node?.picturePath || node?.pic_path || '');
  }

  /** 上传一张。未配置时返回 configured:false，不当作失败。 */
  async function uploadOne(source, title = '', categoryId = 0) {
    const ready = await readiness();
    if (!ready.configured) return { ok: false, configured: false, code: 'NOT_CONFIGURED', message: ready.note };
    let payload;
    try {
      payload = await readBytes(source);
    } catch (error) {
      return { ok: false, code: 'READ_FAILED', message: C.str(error?.message || error).slice(0, 200), source: C.str(source).slice(0, 200) };
    }
    const fitted = fitSize(payload.bytes, payload.ext);
    if (fitted.tooLarge) return { ok: false, code: 'TOO_LARGE', message: '图片超过 3MB 且无法压缩（缺少 nativeImage）', source: C.str(source).slice(0, 200) };
    const base64 = Buffer.from(fitted.bytes).toString('base64');
    const name = `${C.str(title || 'xx').slice(0, 40)}-${Date.now().toString(36)}`;
    const result = await taobaoApi.uploadPicture(base64, name, categoryId);
    if (!result?.ok) return { ok: false, code: C.str(result?.code), message: C.str(result?.message).slice(0, 300), source: C.str(source).slice(0, 200) };
    const picturePath = picturePathOf(result.data);
    if (!picturePath) return { ok: false, code: 'EMPTY_RECEIPT', message: '接口返回里没有 picture_path', source: C.str(source).slice(0, 200) };
    return {
      ok: true,
      picturePath,
      // 图片空间地址（发布页详情编辑器、item.update 的 desc 都吃这个）
      url: `https://img.alicdn.com/bao/uploaded/${picturePath.replace(/^\/+/, '')}`,
      source: C.str(source).slice(0, 200),
      resized: Boolean(fitted.resized),
    };
  }

  /** 批量上传（并发 2，逐张回报，失败不阻断其它）。 */
  async function uploadMany(sources, { titlePrefix = '', onLog } = {}) {
    const ready = await readiness();
    const list = C.strList(sources).slice(0, MAX_PER_ITEM);
    if (!ready.configured) {
      emit(`[picture-space] ${ready.note}；需要申请：taobao.picture.upload（图片空间上传）`);
      return { configured: false, uploaded: [], failed: [], note: ready.note };
    }
    const uploaded = [];
    const failed = [];
    const uploadedByIndex = new Array(list.length);
    const failedByIndex = new Array(list.length);
    let index = 0;
    const worker = async () => {
      while (index < list.length) {
        const current = index++;
        const source = list[current];
        const result = await uploadOne(source, `${titlePrefix}-${current + 1}`);
        if (result.ok) uploadedByIndex[current] = result;
        else failedByIndex[current] = result;
        if (typeof onLog === 'function') onLog(`[picture-space] ${result.ok ? '已上传' : '上传失败'} ${current + 1}/${list.length}${result.ok ? '' : ` · ${result.code || ''} ${result.message || ''}`}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length || 1) }, worker));
    // 并发完成顺序不能改变详情图顺序：按输入下标回收结果。
    for (const row of uploadedByIndex) if (row) uploaded.push(row);
    for (const row of failedByIndex) if (row) failed.push(row);
    return { configured: true, uploaded, failed, note: `上传 ${uploaded.length} / ${list.length}` };
  }

  /** 把图片空间里的图关联到已入仓商品（主图 is_major，position 从 1 开始）。 */
  async function jointImages(numIid, pictures, { major = true } = {}) {
    const ready = await readiness();
    if (!ready.configured) return { ok: false, code: 'NOT_CONFIGURED', message: ready.note, applied: 0 };
    const id = C.str(numIid);
    if (!/^\d+$/.test(id)) return { ok: false, code: 'INVALID_ITEM', message: '仓库商品编号不合法', applied: 0 };
    let applied = 0;
    const failures = [];
    for (let i = 0; i < pictures.length; i += 1) {
      const pic = pictures[i];
      const result = await taobaoApi.call('taobao.item.joint.img', {
        num_iid: id, picture_id: pic.picturePath, is_major: Boolean(major && i === 0), position: i + 1,
      });
      if (result?.ok) applied += 1;
      else failures.push({ code: C.str(result?.code), message: C.str(result?.message).slice(0, 200) });
    }
    return { ok: applied > 0, applied, failures };
  }

  /** 回读商品的图片列表（一致性校验用）。 */
  async function readItemImages(numIid) {
    const result = await taobaoApi.readItemForReadback(numIid);
    if (!result?.ok) return { ok: false, code: C.str(result?.code), message: C.str(result?.message).slice(0, 200), images: [] };
    const data = result.data || {};
    const node = data.item || data;
    const list = C.list(node.item_imgs?.item_img || node.item_imgs || []);
    return {
      ok: true,
      images: list.map(row => ({ id: C.str(row?.id), url: C.str(row?.url), position: Number(row?.position) || 0, major: row?.is_major === true })),
      desc: C.str(node.desc),
      title: C.str(node.title),
    };
  }

  /** 用详情图片 HTML 更新商品描述（回填详情页）。 */
  async function updateDescription(numIid, imageUrls, { text = '' } = {}) {
    const ready = await readiness();
    if (!ready.configured) return { ok: false, code: 'NOT_CONFIGURED', message: ready.note };
    const urls = C.strList(imageUrls).filter(u => /^https:\/\/\S+$/i.test(u)).slice(0, MAX_PER_ITEM);
    if (!urls.length) return { ok: false, code: 'EMPTY', message: '没有可写的详情图' };
    const html = `${C.str(text) ? `<p>${C.str(text).replace(/[<>]/g, '')}</p>` : ''}${urls.map(u => `<p><img src="${u}" align="absmiddle"/></p>`).join('')}`;
    const result = await taobaoApi.call('taobao.item.update', {
      num_iid: C.str(numIid), desc: html, update_fields: 'desc',
    });
    if (!result?.ok) return { ok: false, code: C.str(result?.code), message: C.str(result?.message).slice(0, 300) };
    return { ok: true, count: urls.length };
  }

  return { readiness, uploadOne, uploadMany, jointImages, readItemImages, updateDescription, picturePathOf };
}

module.exports = { createPictureSpace };
