const SYSTEM = '你是资深漫剧导演与提示词编辑。用中文给出具体、可执行的创作方案。保持用户故事与角色设定。分析参考片时必须区分可观察事实、推测流程、无法确认的信息；不能从画面推断具体模型、真实提示词、成本或音频内容。只基于提供的材料，不虚构已执行的操作。';
const OPENAI_ORIGIN = 'https://api.openai.com';
const openAIPreset = Object.freeze({ baseURL: OPENAI_ORIGIN + '/v1', model: 'gpt-6.2-sol' });
// 32 × 32 synthetic image with a red left half and a blue right half.
const PROBE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAK0lEQVR4nO3NsQkAAAzDsPz/dHpDpi4CjwalydS4d90BAAAAAAAAAADAG3A2h/wuHtDxTwAAAABJRU5ErkJggg==';

function endpoint(baseURL, provider) {
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error('请输入完整的 API 地址。');
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error('API 地址不能包含凭证、查询参数或片段。');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error('API 地址需要 HTTPS，本地服务可使用 HTTP。');

  const path = url.pathname.replace(/\/+$/, '');
  if (provider === 'openai') {
    if (url.origin !== OPENAI_ORIGIN || !['', '/v1', '/v1/responses', '/v1/chat/completions'].includes(path))
      throw new Error('OpenAI 官方连接地址应为 https://api.openai.com/v1。');
    return OPENAI_ORIGIN + '/v1/responses';
  }
  const chatPath = path.replace(/\/chat\/completions$/, '') || (url.origin === OPENAI_ORIGIN ? '/v1' : '');
  return url.origin + chatPath + '/chat/completions';
}

async function upstreamError(response, hasImages) {
  let detail;
  try {
    detail = (await response.json())?.error;
  } catch {
    // Some gateways return HTML or an empty body. Only use known error identifiers.
  }
  const status = response.status;
  if (status === 429) {
    const quotaCodes = ['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'billing_hard_limit_reached'];
    if (quotaCodes.includes(detail?.code) || detail?.type === 'insufficient_quota')
      return 'API 额度已用尽或已达到用量上限，请在服务商后台检查余额和项目限额。';
    if (['rate_limit_exceeded', 'slow_down'].includes(detail?.code) || detail?.type === 'rate_limit_error')
      return '请求过于频繁，请稍后重试。';
    return '服务商返回 429，请检查请求频率和 API 额度。';
  }
  if (detail?.code === 'context_length_exceeded')
    return '输入超过模型上下文上限，请缩短提示词或减少参考画面。';
  if (detail?.code === 'model_not_found' || status === 404)
    return '接口或模型不可用，请检查 API 地址、模型 ID 和该项目的模型权限。';
  if (status === 400 && hasImages)
    return '服务商拒绝了图文请求，请检查所选模型的图片输入能力及参考图格式。';
  const messages = {
    400: '服务商拒绝了请求，请检查模型是否支持所选接口和本次输入。',
    401: 'API Key 无效或未获授权，请检查密钥及项目访问设置。',
    403: '服务商拒绝访问，请检查模型权限、项目或地区限制。',
    413: '请求内容过大，请减少参考画面或缩短输入。',
  };
  return messages[status] || `模型服务返回错误（${status}）。`;
}

function timedOut(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

function readOutput(data, useResponses) {
  const declined = '模型未能处理这次请求，请调整输入内容。';
  const truncated = '模型输出达到上限，请缩短任务或分段生成。';
  if (useResponses) {
    if (data?.incomplete_details?.reason === 'max_output_tokens') throw new Error(truncated);
    if (data?.incomplete_details?.reason === 'content_filter') throw new Error(declined);
    if (data?.status !== 'completed' || data.error)
      throw new Error('OpenAI 未完成这次生成，请检查模型状态后重试。');

    const messages = Array.isArray(data.output) ? data.output : [];
    const chunks = [];
    for (const message of messages) {
      if (message.type !== 'message' || message.role !== 'assistant' || message.phase === 'commentary') continue;
      if ((message.status && message.status !== 'completed') || !Array.isArray(message.content))
        throw new Error('模型返回了不完整的消息，请重试。');
      for (const part of message.content) {
        if (part.type === 'refusal') throw new Error(declined);
        if (part.type === 'output_text' && typeof part.text === 'string') chunks.push(part.text);
      }
    }
    return chunks.join('');
  }
  const choice = data?.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new Error(declined);
  if (choice?.finish_reason === 'length') throw new Error(truncated);
  return choice?.message?.content;
}

async function request(config, { prompt, images = [], json = false }, fetcher = fetch) {
  if (!config.apiKey || !config.model) throw new Error('请先在模型连接中填写 API Key 和模型 ID。');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 50000)
    throw new Error('提示词为空、过长或格式错误。');
  if (!Array.isArray(images) || images.length > 8 || images.some(image =>
    typeof image !== 'string' || image.length > 6000000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/u.test(image)))
    throw new Error('参考图格式或大小不符合要求。');

  const url = endpoint(config.baseURL, config.provider);
  const useResponses = config.provider === 'openai';
  let body;
  if (useResponses) {
    const content = [
      { type: 'input_text', text: prompt },
      ...images.map(image => ({ type: 'input_image', image_url: image, detail: 'auto' })),
    ];
    body = {
      model: config.model,
      instructions: json === true ? SYSTEM + '本次输出必须为完整的 JSON 对象。' : SYSTEM,
      input: [{ role: 'user', content }],
      store: false,
    };
    if (json === true) body.text = { format: { type: 'json_object' } };
  } else {
    const content = images.length ? [
      { type: 'text', text: prompt },
      ...images.map(image => ({ type: 'image_url', image_url: { url: image } })),
    ] : prompt;
    body = {
      model: config.model,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
      stream: false,
    };
    if (new URL(url).origin === OPENAI_ORIGIN) body.store = false;
  }

  let response;
  const timeoutMessage = '请求超时，请检查网络或服务商状态后重试。';
  try {
    response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(useResponses ? 300000 : 90000),
    });
  } catch (error) {
    throw new Error(timedOut(error) ? timeoutMessage : '无法连接模型服务，请检查地址和网络。');
  }
  if (!response.ok) throw new Error(await upstreamError(response, images.length > 0));
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error(timedOut(error) ? timeoutMessage : '服务商返回了无效的 JSON。');
  }
  const text = readOutput(data, useResponses);
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型未返回文本，请检查所选模型是否支持本次任务。');
  return { text, usage: data.usage || null };
}

async function testConnection(config, fetcher = fetch) {
  if (!config.apiKey || !config.model) throw new Error('请先在模型连接中填写 API Key 和模型 ID。');
  const url = endpoint(config.baseURL, config.provider);
  if (new URL(url).origin !== OPENAI_ORIGIN) {
    const result = await request(config, { prompt: '只回复：连接成功。' }, fetcher);
    return { message: result.text };
  }
  const { text } = await request(config, {
    prompt: '请按从左到右的顺序写出图中两块区域的颜色。仅输出两个中文颜色名称，用顿号分隔。',
    images: [PROBE_IMAGE],
  }, fetcher);
  const colors = text.match(/[红蓝绿黄黑白紫橙灰粉棕褐]/gu) || [];
  if (!/^(红蓝)+$/u.test(colors.join('')))
    throw new Error('模型已响应，但未正确识别测试图。请确认所选模型支持图片输入，再次测试。');
  return { message: 'GPT 已识别测试图的左右颜色，并返回文本。' };
}

module.exports = { openAIPreset, endpoint, request, testConnection };
