const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {baseURL, connect, model} = require('./cloud-client.cjs');

const config = {provider:'tencent', baseURL:'https://relay.example/stage/', apiKey:'synthetic-app-credential'};
const response = (value, status=200) => new Response(JSON.stringify(value), {status});

test('Tencent relay keeps a stage prefix, pins HTTPS and never follows a new token destination', async () => {
  for (const invalid of ['http://relay.example','https://user@relay.example','https://relay.example/?token=example','https://relay.example/#other']) {
    assert.throws(() => baseURL(invalid));
  }
  assert.equal(baseURL('https://relay.example/stage/v1/'), 'https://relay.example/stage');
  assert.throws(() => connect({...config,provider:'openai'}));
  const calls = [];
  const client = connect(config, async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer ' + config.apiKey);
    assert.equal(options.redirect,'error');
    if (url.endsWith('/test')) return response({message:'通过',model});
    assert.equal(url,'https://relay.example/stage/v1/generate');
    assert.deepEqual(JSON.parse(options.body),{prompt:'synthetic vision prompt',images:[],json:true});
    return response({text:'text output',usage:{total_tokens:12}});
  });
  assert.deepEqual(await client.test(),{message:'通过'});
  const result = await client.generate({prompt:'synthetic vision prompt',images:[],json:true,model:'other',apiKey:'ignored'});
  assert.equal(result.text,'text output');
  await assert.rejects(client.generate({prompt:'test',images:['https://other.example/private']}), /参考帧/);
  assert.equal(calls.length,2);
});

test('cloud backup round trip sends only canonical ciphertext, validates IDs and cleans list metadata', async () => {
  const {encryptPortable,decryptPortable} = await import('../src/portable.js');
  const key = 'synthetic-backup-pass';
  const original = 'synthetic project content';
  const encrypted = await encryptPortable(original,key);
  const record = {id:randomUUID(), createdAt:new Date().toISOString(),size:Buffer.byteLength(encrypted)};
  let seen = 0;
  const client = connect(config, async (url,opt) => {
    seen++;
    if (opt.method === 'POST') {
      assert.equal(url,'https://relay.example/stage/v1/backups');
      assert.equal(opt.body,encrypted);
      assert.ok(!opt.body.includes(key) && !opt.body.includes(original));
      return response(record);
    }
    if (url.endsWith('/backups')) return response({backups:[{...record,fileName:'sensitive name should not be forwarded'}]});
    assert.equal(url,'https://relay.example/stage/v1/backups/' + record.id);
    return new Response(encrypted);
  });
  await assert.rejects(client.upload('{"project":"plaintext"}'));
  await assert.rejects(client.download('../private'));
  assert.equal(seen,0);
  assert.deepEqual(await client.upload(encrypted),record);
  assert.deepEqual(await client.list(),[record]);
  assert.equal(await decryptPortable(await client.download(record.id),key),original);
  assert.equal(seen,3);
});

test('cloud responses reject unsafe envelopes, too much data, upstream errors and incorrect probe model', async () => {
  const client = (r) => connect(config,async () => r);
  await assert.rejects(client(response({apiKey:'should never be shown'},401)).list(), (e) => /令牌/.test(e.message) && !e.message.includes('should never'));
  await assert.rejects(client(response({message:'through',model:'other'})).test(), /模型/);
  await assert.rejects(client(response({text:'through'})).download(randomUUID()), /加密/);
  await assert.rejects(client(response({backups:[{id:'bad'}]})).list(), /格式/);
  await assert.rejects(client(new Response('x'.repeat(1024 * 1024 + 1))).list(), /过大/);
});
