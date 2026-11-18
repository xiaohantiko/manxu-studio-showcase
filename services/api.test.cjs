const test=require('node:test');const assert=require('node:assert/strict');const {endpoint,request}=require('./api.cjs');
const config={baseURL:'https://provider.example/v1',model:'test-model',apiKey:'test-key'};
test('endpoint validates transport, credential injection and duplicate completion paths',()=>{assert.equal(endpoint(config.baseURL),'https://provider.example/v1/chat/completions');assert.equal(endpoint(config.baseURL+'/chat/completions'),'https://provider.example/v1/chat/completions');assert.equal(endpoint('http://localhost:11434/v1'),'http://localhost:11434/v1/chat/completions');assert.throws(()=>endpoint('http://provider.example/v1'),/HTTPS/);assert.throws(()=>endpoint('https://key@example.com/v1'),/凭证/);assert.throws(()=>endpoint('https://provider.example/v1?key=x'),/查询/);});
test('text request sends configured model, user content and key only to validated endpoint',async()=>{let seen;const r=await request(config,{prompt:'写一个故事'},async(url,init)=>{seen={url,...init,body:JSON.parse(init.body)};return {ok:true,json:async()=>({choices:[{message:{content:'测试结果'}}]})};});assert.equal(r.text,'测试结果');assert.equal(seen.headers.Authorization,'Bearer test-key');assert.equal(seen.body.messages[1].content,'写一个故事');assert.equal(seen.redirect,'error');});
test('vision request sends sampled images without raw video',async()=>{await request(config,{prompt:'分析画面',images:['data:image/jpeg;base64,AA==']},async(url,init)=>{const content=JSON.parse(init.body).messages[1].content;assert.equal(content[1].type,'image_url');assert.equal(content.length,2);return {ok:true,json:async()=>({choices:[{message:{content:'分析'}}]})};});});
test('errors never echo upstream bodies or keys',async()=>{await assert.rejects(request(config,{prompt:'测试'},async()=>({ok:false,status:401})),/API Key 无效/);await assert.rejects(request(config,{prompt:'测试'},async()=>({ok:true,json:async()=>({})})),/未返回文本/);await assert.rejects(request(config,{prompt:'测试',images:['https://example.com/private']}),/参考图格式/);});

const { testConnection, openAIPreset } = require('./api.cjs');
const openAI = { ...config, ...openAIPreset, provider: 'openai' };
const completion = (content, extra = {}) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content }, ...extra }] }),
});

test('official provider accepts its own origin and rejects other key destinations before dispatch', async () => {
  assert.equal(endpoint('https://api.openai.com', 'openai'), 'https://api.openai.com/v1/responses');
  assert.equal(endpoint('https://api.openai.com/v1/responses/', 'openai'), 'https://api.openai.com/v1/responses');
  assert.equal(endpoint('https://api.openai.com/v1/chat/completions', 'openai'), 'https://api.openai.com/v1/responses');
  const misconfigured = { ...openAI, baseURL: config.baseURL };
  await assert.rejects(request(misconfigured, { prompt: '测试' }, () => assert.fail('unexpected dispatch')), /官方连接地址/);
});

const responseOutput = (output, fields = {}) => ({
  ok: true, json: async () => ({ status: 'completed', output, ...fields }),
});
const outputMessage = (text, fields = {}) => ({
  type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer',
  content: [{ type: 'output_text', text }], ...fields,
});
const officialReply = text => responseOutput([outputMessage(text)]);

test('OpenAI connection test proves color recognition with a local synthetic PNG', async () => {
  let requests = 0;
  const result = await testConnection(openAI, async (url, init) => {
    requests++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.equal(body.model, openAI.model);
    assert.equal(body.model, 'gpt-6.2-sol');
    assert.equal(body.instructions.length > 0, true);
    assert.equal('messages' in body, false);
    assert.equal('text' in body, false);
    assert.equal(body.input[0].role, 'user');
    const parts = body.input[0].content;
    assert.equal(parts.length, 2);
    assert.doesNotMatch(parts[0].text, /红|蓝/);
    assert.equal(parts[0].type, 'input_text');
    assert.equal(parts[1].type, 'input_image');
    assert.equal(parts[1].detail, 'auto');
    assert.match(parts[1].image_url, /^data:image\/png;base64,/);
    return officialReply('图中左边是红色，右边是蓝色。');
  });
  assert.equal(requests, 1);
  assert.match(result.message, /已识别测试图/);
  await assert.rejects(testConnection(openAI, async () => officialReply('连接成功')), /未正确识别/);
  await assert.rejects(testConnection(openAI, async () => officialReply('蓝色、红色')), /未正确识别/);
  await testConnection({ ...openAI, provider: 'custom', model: 'gpt-4o' }, async (url, { body }) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(JSON.parse(body).model, 'gpt-4o');
    assert.equal(JSON.parse(body).store, false);
    assert.ok(Array.isArray(JSON.parse(body).messages[1].content));
    return completion('红、蓝');
  });
});

test('a text-only compatible service still gets its original text connectivity probe', async () => {
  const result = await testConnection(config, async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(typeof body.messages[1].content, 'string');
    assert.equal('store' in body, false);
    return completion('连接成功。');
  });
  assert.equal(result.message, '连接成功。');
});

test('quota and rate limits get distinct safe advice, including without JSON', async () => {
  const reject429 = (detail, pattern) => assert.rejects(
    request(config, { prompt: '测试' }, async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { ...detail, message: 'private-value' } }),
    })),
    error => pattern.test(error.message) && !error.message.includes('private-value'),
  );
  await reject429({ code: 'credit_balance_exhausted' }, /检查余额/);
  await reject429({ type: 'insufficient_quota' }, /检查余额/);
  await reject429({ code: 'rate_limit_exceeded' }, /频繁/);
  await assert.rejects(request(config, { prompt: '测试' }, async () => ({ ok: false, status: 429 })), /频率和 API 额度/);
});

test('truncation, refusals, and body timeouts are not marked successful', async () => {
  await assert.rejects(request(config, { prompt: '测试' }, async () => completion('半截', { finish_reason: 'length' })), /输出达到上限/);
  await assert.rejects(request(config, { prompt: '测试' }, async () => completion(null, { message: { refusal: 'private-value' } })), /未能处理/);
  await assert.rejects(request(config, { prompt: '测试' }, async () => ({
    ok: true,
    json: async () => { throw new DOMException('timeout', 'TimeoutError'); },
  })), /超时/);
});

test('official Responses preserves text and usage, excluding intermediate output', async () => {
  const usage = { input_tokens: 30, output_tokens: 40, total_tokens: 70 };
  const result = await request(openAI, { prompt: '写一张角色卡' }, async (url, { body }) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.deepEqual(JSON.parse(body).input, [{ role: 'user', content: [{ type: 'input_text', text: '写一张角色卡' }] }]);
    return responseOutput([
      { type: 'reasoning', summary: [] },
      outputMessage('过程文本', { phase: 'commentary' }),
      outputMessage('角色'),
      outputMessage('卡片', { phase: undefined }),
    ], { usage });
  });
  assert.deepEqual(result, { text: '角色卡片', usage });
});

test('only official preset requests JSON mode, older compatible profiles retain their parameters', async () => {
  const payload = { prompt: '生成练习项目 JSON 对象', json: true };
  await request(openAI, payload, async (_url, { body }) => {
    const parsed = JSON.parse(body);
    assert.deepEqual(parsed.text, { format: { type: 'json_object' } });
    assert.match(parsed.instructions, /JSON/);
    return officialReply('{"name":"测试"}');
  });
  await request(config, payload, async (_url, { body }) => {
    assert.equal('response_format' in JSON.parse(body), false);
    return completion('{"name":"测试"}');
  });
});

test('official Responses failures, partial output and refusals never count as an answer', async () => {
  const check = (response, pattern) => assert.rejects(request(openAI, { prompt: '测试' }, async () => response), pattern);
  await check(responseOutput([outputMessage('半截')], { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), /输出达到上限/);
  await check(responseOutput([], { status: 'failed', error: { message: 'private-value' } }), /未完成/);
  await check(responseOutput([], { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }), /未能处理/);
  await check(responseOutput([outputMessage('', { content: [{ type: 'refusal', refusal: 'private-value' }] })]), /未能处理/);
  await check(responseOutput([outputMessage('半截', { status: 'incomplete' })]), /不完整/);
  await check(responseOutput([outputMessage('过程', { phase: 'commentary' })]), /未返回文本/);
});
