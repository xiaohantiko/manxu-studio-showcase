const { Buffer } = require('node:buffer');

const model = 'gpt-6.2-sol';
const backupId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function baseURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写完整的腾讯云服务 HTTPS 根地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('腾讯云地址必须使用 HTTPS，且不能包含凭据、查询参数或片段。');
  return url.origin + url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
}

async function boundedText(response, max) {
  const fail = () => new Error('云服务返回的数据过大。');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('云服务没有返回数据。');
  let total = 0;
  const chunks = [];
  try {
    if (Number(response.headers.get('content-length')) > max) throw fail();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw fail();
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function metadata(row) {
  if (!backupId.test(row?.id) || typeof row.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(row.createdAt)) || !Number.isSafeInteger(row.size) || row.size < 1)
    throw new Error('云端备份记录格式不正确。');
  return { id: row.id, createdAt: new Date(row.createdAt).toISOString(), size: row.size };
}

function connect(config, fetcher = fetch) {
  if (config?.provider !== 'tencent' || !config.apiKey)
    throw new Error('请先在管理后台绑定腾讯云服务。');
  const base = baseURL(config.baseURL);
  async function send(route, { body, max = 1024 * 1024 } = {}) {
    let response;
    try {
      response = await fetcher(base + '/v1/' + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer ' + config.apiKey,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body, redirect: 'error', signal: AbortSignal.timeout(300000),
      });
    } catch {
      throw new Error('无法连接腾讯云服务，请检查地址、网络和服务状态。');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const messages = {401:'云服务访问令牌无效。',403:'云服务拒绝访问，请核对令牌和服务权限。',
        404:'未找到云端记录或接口，请核对服务地址。',409:'云备份空间已满，请在服务器或 COS 归档旧备份。',
        413:'请求超出云服务的大小限制。',429:'云服务达到用量或频率上限。',
        502:'模型服务调用失败，请在服务端核对模型权限、额度和网络。',
        503:'云服务尚未就绪，请检查服务端的模型或存储配置。'};
      throw new Error(messages[response.status] || '云服务返回错误（' + response.status + '）。');
    }
    return boundedText(response, max);
  }
  async function sendJSON(route, data) {
    const raw = await send(route, {body: data === undefined ? undefined : JSON.stringify(data)});
    try { return JSON.parse(raw); } catch { throw new Error('云服务返回了无效的 JSON。'); }
  }
  return {
    async generate({prompt, images, json}) {
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 50000)
        throw new Error('提示词为空或超出大小限制。');
      if (images !== undefined && (!Array.isArray(images) || images.length > 8 ||
          images.some(image => typeof image !== 'string' || image.length > 6000000 ||
            !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/u.test(image))))
        throw new Error('云端参考帧格式或大小不符合要求。');
      const r = await sendJSON('generate', {prompt, images, ...(json === true ? {json:true} : {})});
      if (typeof r?.text !== 'string' || !r.text.trim()) throw new Error('云端模型未返回文本。');
      return {text: r.text, usage: r.usage || null};
    },
    async test() {
      const r = await sendJSON('test', {});
      if (r?.model !== model || typeof r.message !== 'string' || !r.message.trim())
        throw new Error('云端模型验证失败，请检查服务版本。');
      return {message:r.message};
    },
    async upload(envelope) {
      const {parsePortableEnvelope} = await import('../src/portable.js');
      return metadata(await sendJSON('backups', parsePortableEnvelope(envelope)));
    },
    async list() {
      const r = await sendJSON('backups');
      if (!Array.isArray(r?.backups)) throw new Error('云端备份列表格式不正确。');
      return r.backups.map(metadata);
    },
    async download(id) {
      if (typeof id !== 'string' || !backupId.test(id)) throw new Error('备份编号无效。');
      const {parsePortableEnvelope, MAX_PORTABLE_BYTES} = await import('../src/portable.js');
      return JSON.stringify(parsePortableEnvelope(await send('backups/' + id, {max:MAX_PORTABLE_BYTES})));
    },
  };
}
module.exports = { baseURL, connect, model };
