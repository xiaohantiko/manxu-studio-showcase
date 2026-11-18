import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createService} from '../server.mjs';
import {cosStore, diskStore} from '../storage.mjs';
import {encryptPortable, decryptPortable, MAX_PORTABLE_BYTES} from '../../src/portable.js';

const token = randomBytes(32).toString('hex');
const password = 'synthetic portable test';
const secret = 'synthetic private creative work';
const envelope = await encryptPortable(secret, password);

async function start(t, options) {
  const service = createService({token, ...options});
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { service.close(resolve); service.closeAllConnections(); }));
  const url = 'http://127.0.0.1:' + service.address().port;
  return (route, method = 'GET', body, key = token) => fetch(url + route, {
    method, body, headers: {authorization: 'Bearer ' + key, 'content-type': 'application/json'},
  });
}
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), 'manxu-cloud-test-'));
  t.after(() => fs.rm(dir, {force: true, recursive: true}));
  return dir;
}
test('backup-only HTTP round trip and disk restart, ciphertext and owner-only files', async t => {
  const dir = await directory(t);
  const app = await start(t, {storage: await diskStore(dir)});
  assert.equal((await app('/healthz', 'GET', undefined, 'none')).status, 200);
  assert.equal((await app('/v1/backups', 'GET', undefined, 'wrong')).status, 401);
  assert.equal((await app('/v1/test', 'POST')).status, 503);
  assert.equal((await app('/v1/backups', 'POST', JSON.stringify({secret}))).status, 400);
  assert.equal((await app('/v1/backups', 'POST', ' '.repeat(MAX_PORTABLE_BYTES + 1))).status, 413);
  const saved = await app('/v1/backups', 'POST', envelope);
  assert.equal(saved.status, 201);
  const record = await saved.json();
  assert.equal(record.size, Buffer.byteLength(envelope));
  const listing = await (await app('/v1/backups')).json();
  assert.deepEqual(listing.backups, [record]);
  const recovered = await (await app('/v1/backups/' + record.id)).text();
  assert.equal(await decryptPortable(recovered, password), secret);
  const [slot] = await fs.readdir(dir);
  const file = path.join(dir, slot, record.id + '.manxu');
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(file, 'utf8'), envelope);
  assert.ok(!envelope.includes(secret));
  assert.deepEqual(await (await diskStore(dir)).list(), [record]);
  await fs.unlink(file); await fs.symlink('/etc/passwd', file);
  assert.equal((await app('/v1/backups/' + record.id)).status, 404);
});
test('concurrent disk slots cap at 50 complete distinct backups without overwrites', async t => {
  const dir = await directory(t);
  const store = await diskStore(dir);
  const writes = await Promise.allSettled(Array.from({length: 52}, () => store.put(Buffer.from(envelope))));
  const done = writes.filter(w => w.status === 'fulfilled');
  assert.equal(done.length, 50);
  assert.equal(new Set(done.map(x => x.value.id)).size, 50);
  assert.ok(writes.filter(w => w.status === 'rejected').every(w => w.reason.status === 409));
  assert.equal((await store.list()).length, 50);
});
test('GPT routes use the fixed official Responses endpoint, server credential, and actual visual probe', async t => {
  const calls = [];
  const app = await start(t, {storage: {}, apiKey: 'server-only-secret', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer server-only-secret');
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(body.model, 'gpt-6.2-sol'); assert.equal(body.store, false);
    return Response.json({status:'completed', output:[{type:'message',role:'assistant',content:[{type:'output_text',text: '红、蓝'}]}]});
  }});
  assert.equal((await app('/v1/generate', 'POST', JSON.stringify({prompt: 'ok', model: 'other'}))).status, 400);
  const ping = await (await app('/v1/test', 'POST', '{}')).json();
  assert.equal(ping.model, 'gpt-6.2-sol');
  assert.ok(calls[0].input[0].content[1].image_url.startsWith('data:image/png;base64,'));
  const response = await app('/v1/generate', 'POST', JSON.stringify({prompt: 'test', json: true}));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, '红、蓝'); assert.equal(calls[1].text.format.type, 'json_object');
});
test('bounded requests and safe operational errors', async t => {
  const app = await start(t, {storage: {async list() { throw Error('fake-private-credential'); }}, perMinute:1});
  const failure = await app('/v1/backups');
  assert.equal(failure.status, 503); assert.ok(!(await failure.text()).includes('fake-private-credential'));
  assert.equal((await app('/v1/backups')).status, 429);
});
test('hash-only token configuration authorizes backups, with no OpenAI key or server-side bearer', async t => {
  const hash = createHash('sha256').update(token).digest('hex');
  const store = await diskStore(await directory(t));
  assert.throws(() => createService({storage: store}));
  assert.throws(() => createService({tokenSHA256: 'wrong', storage: store}));
  assert.throws(() => createService({token, tokenSHA256: hash, storage: store}));
  const app = await start(t, {token: undefined, tokenSHA256: hash, storage: store});
  const saved = await app('/v1/backups', 'POST', envelope);
  assert.equal(saved.status, 201);
  const {id} = await saved.json();
  assert.equal((await app('/v1/backups', 'GET', undefined, hash)).status, 401);
  assert.equal(await (await app('/v1/backups/' + id)).text(), envelope);
  assert.equal((await app('/v1/test', 'POST')).status, 503);
});
test('COS receives ciphertext with no-overwrite, SSE, private metadata and bounded downloads', async () => {
  const files = new Map();
  const common = async ({Key}) => files.get(Key) || Promise.reject({statusCode:404});
  let versioning = {};
  const client = {
    async getBucketVersioning() { return {VersioningConfiguration: versioning}; },
    async getBucket() { return {Contents:[...files.keys()].map(Key => ({Key}))}; },
    async putObject(p) {
      assert.equal(p.ServerSideEncryption, 'AES256'); assert.equal(p.Headers['x-cos-forbid-overwrite'], 'true');
      if (files.has(p.Key)) throw Object.assign(Error(), {statusCode:409});
      files.set(p.Key, {Body:p.Body, headers:{'content-length':String(p.Body.length), 'last-modified':new Date().toUTCString(),
        'x-cos-meta-backup-id':p.Headers['x-cos-meta-backup-id']}});
    },
    headObject:common, async getObject(p) { assert.equal(p.Range, 'bytes=0-' + MAX_PORTABLE_BYTES); return common(p); },
  };
  const store = cosStore(client, 'private-10000', 'ap-test');
  const {id} = await store.put(Buffer.from(envelope));
  assert.equal((await store.list())[0].id, id);
  assert.equal((await store.get(id)).toString(), envelope);
  const wrong = (id[0] === 'a' ? 'b' : 'a') + id.slice(1);
  await assert.rejects(() => store.get(wrong), e => e.status === 404);
  versioning = {Status:'Enabled'};
  await assert.rejects(() => store.put(Buffer.from(envelope)), e => e.status === 503);
});
