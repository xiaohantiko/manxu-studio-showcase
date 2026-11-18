import http from 'node:http';
import {createHash, timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import ai from '../services/api.cjs';
import {parsePortableEnvelope, MAX_PORTABLE_BYTES} from '../src/portable.js';
import {configuredStore, ServiceError, UUID} from './storage.mjs';

const digest = value => createHash('sha256').update(value).digest();
function fail(status, message) { throw new ServiceError(status, message); }

async function readText(req, limit) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    fail(415, '请发送 JSON 内容。');
  if (Number(req.headers['content-length']) > limit) fail(413, '请求文件过大。');
  let length = 0;
  const parts = [];
  for await (const piece of req.iterator({destroyOnReturn: false})) {
    length += piece.length;
    if (length > limit) fail(413, '请求文件过大。');
    parts.push(piece);
  }
  return Buffer.concat(parts, length).toString('utf8');
}
function generation(text) {
  let data;
  try { data = JSON.parse(text); } catch { fail(400, '生成请求不是有效的 JSON。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).some(key => !['prompt', 'images', 'json'].includes(key)) ||
      typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 50000 ||
      ('json' in data && typeof data.json !== 'boolean') ||
      ('images' in data && (!Array.isArray(data.images) || data.images.length > 8 ||
        data.images.some(img => typeof img !== 'string' || img.length > 6000000 ||
          !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(img)))))
    fail(400, '生成请求的提示词或图片不符合要求。');
  return data;
}
function canonical(text) {
  try { return Buffer.from(JSON.stringify(parsePortableEnvelope(text))); }
  catch { fail(400, '请提供完整的漫序加密备份文件。'); }
}
const tokenFormat = /^[A-Za-z0-9_=-]{32,256}$/;
export function createService({token, tokenSHA256, apiKey, storage, fetcher = fetch, perMinute = 30}) {
  if (tokenSHA256 !== undefined ? (token !== undefined || !/^[a-fA-F0-9]{64}$/.test(tokenSHA256)) : !tokenFormat.test(token || ''))
    throw Error('请配置一个有效的令牌或其 SHA-256 校验值。');
  const credential = tokenSHA256 ? Buffer.from(tokenSHA256, 'hex') : digest(token);
  const config = {...ai.openAIPreset, provider: 'openai', apiKey};
  let since = Date.now(), used = 0, active = 0, generating = 0;
  const server = http.createServer(async (req, res) => {
    const reply = (code, data) => {
      res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': 'max-age=31536000'});
      res.end(Buffer.isBuffer(data) ? data : JSON.stringify(data));
    };
    let counted = false, countedAI = false;
    try {
      if (req.method === 'GET' && req.url === '/healthz') return reply(200, {ok: true});
      const supplied = /^Bearer ([A-Za-z0-9_=-]{32,256})$/.exec(req.headers.authorization || '')?.[1];
      if (!supplied || !timingSafeEqual(credential, digest(supplied))) fail(401, '云服务令牌无效。');
      if (Date.now() - since >= 60000) { since = Date.now(); used = 0; }
      if (++used > perMinute || active >= 4) fail(429, '云服务请求过多，请稍后重试。');
      active++; counted = true;
      if (req.url === '/v1/backups' && req.method === 'POST') {
        const bytes = canonical(await readText(req, MAX_PORTABLE_BYTES));
        return reply(201, await storage.put(bytes));
      }
      if (req.url === '/v1/backups' && req.method === 'GET')
        return reply(200, {backups: await storage.list()});
      if (req.url.startsWith('/v1/backups/') && req.method === 'GET') {
        const id = req.url.slice('/v1/backups/'.length);
        if (!UUID.test(id)) fail(404, '云备份不存在。');
        const bytes = await storage.get(id);
        return reply(200, canonical(bytes.toString('utf8')));
      }
      if (req.method === 'POST' && ['/v1/test', '/v1/generate'].includes(req.url)) {
        if (!apiKey) fail(503, '云服务尚未配置 OpenAI 密钥。');
        if (generating >= 2) fail(429, '已有生成任务正在运行，请稍后重试。');
        generating++; countedAI = true;
        let payload;
        if (req.url === '/v1/generate') payload = generation(await readText(req, 16 * 1024 * 1024));
        else if (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0) {
          const text = await readText(req, 64);
          if (text.trim() !== '{}') fail(400, '连接测试无需其他参数。');
        }
        try {
          if (payload) return reply(200, await ai.request(config, payload, fetcher));
          return reply(200, {...await ai.testConnection(config, fetcher), model: config.model});
        } catch {
          fail(502, '云端模型请求未成功，请检查 OpenAI 项目的权限、额度与服务端网络。');
        }
      }
      fail(404, '该接口不存在。');
    } catch (err) {
      if (!req.complete) {
        req.resume();
      }
      if (!res.headersSent) reply(err instanceof ServiceError ? err.status : 503,
        {error: err instanceof ServiceError ? err.message : '云存储暂时无法使用，请检查服务器配置或稍后重试。'});
    } finally {
      if (counted) active--;
      if (countedAI) generating--;
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 120000;
  server.maxConnections = 64;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const port = Number(process.env.PORT || 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT 必须是有效的端口号。');
    const storage = await configuredStore(process.env);
    const service = createService({token: process.env.MANXU_CLOUD_TOKEN, tokenSHA256: process.env.MANXU_CLOUD_TOKEN_SHA256,
      apiKey: process.env.OPENAI_API_KEY, storage});
    service.on('error', () => { console.error('云服务监听失败。'); process.exitCode = 1; });
    service.listen(port, process.env.HOST || '127.0.0.1', () => console.log('漫序云服务已启动。'));
    process.on('SIGTERM', () => service.close());
  } catch {
    console.error('云服务启动失败。请核对令牌、存储配置、目录属主和监听端口。');
    process.exitCode = 1;
  }
}
