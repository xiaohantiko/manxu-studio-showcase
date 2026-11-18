export const PORTABLE_EXTENSION = ".manxu";
export const MAX_PLAINTEXT_BYTES = 25 * 1024 * 1024;
export const MAX_PORTABLE_BYTES =
  Math.ceil((MAX_PLAINTEXT_BYTES + 16) / 3) * 4 + 1024;
export const MIN_EXPORT_PASSWORD_LENGTH = 12;
export const MAX_EXPORT_PASSWORD_LENGTH = 256;

const format = "manxu-encrypted-export";
const version = 1;
const kdf = "PBKDF2-SHA256";
const iterations = 600_000;
const cipher = "AES-256-GCM";
const tagLength = 128;
const saltSize = 16;
const ivSize = 12;
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const envelopeKeys = new Set([
  "format",
  "version",
  "kdf",
  "iterations",
  "cipher",
  "salt",
  "iv",
  "ciphertext",
]);
const invalidEnvelope = () =>
  new Error("加密文件格式不正确、版本不受支持或文件已损坏。");

function encode64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  const chunks = [];
  // Each chunk except the last ends on a base64 group boundary.
  for (let i = 0; i < bytes.length; i += 24_576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24_576))));
  }
  return chunks.join("");
}

function inspect64(text, min, max = min) {
  if (
    typeof text !== "string" ||
    !text.length ||
    text.length % 4 !== 0 ||
    text.length > Math.ceil(max / 3) * 4
  )
    throw invalidEnvelope();
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const size = 3 * (text.length / 4) - padding;
  if (
    size < min ||
    size > max ||
    /[^a-zA-Z0-9+/=]/.test(text) ||
    text.indexOf("=") !== (padding ? text.length - padding : -1)
  )
    throw invalidEnvelope();
  if (
    padding &&
    alphabet.indexOf(text[text.length - padding - 1]) & (padding === 2 ? 15 : 3)
  )
    throw invalidEnvelope();
}

function decode64(text) {
  if (typeof Uint8Array.fromBase64 === "function")
    return Uint8Array.fromBase64(text);
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function parsePortableEnvelope(envelopeText) {
  if (
    typeof envelopeText !== "string" ||
    envelopeText.length > MAX_PORTABLE_BYTES
  )
    throw new Error("加密文件过大或无法读取。");
  let envelope;
  try {
    envelope = JSON.parse(envelopeText);
  } catch {
    throw invalidEnvelope();
  }
  if (
    !envelope ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    Object.keys(envelope).length !== envelopeKeys.size ||
    Object.keys(envelope).some((key) => !envelopeKeys.has(key)) ||
    envelope.format !== format ||
    envelope.version !== version ||
    envelope.kdf !== kdf ||
    envelope.iterations !== iterations ||
    envelope.cipher !== cipher
  )
    throw invalidEnvelope();
  inspect64(envelope.salt, saltSize);
  inspect64(envelope.iv, ivSize);
  inspect64(
    envelope.ciphertext,
    tagLength / 8,
    MAX_PLAINTEXT_BYTES + tagLength / 8,
  );
  return envelope;
}

function webCrypto() {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "当前环境不支持加密，请使用 Mac App 或通过 HTTPS / 本机地址打开。",
    );
  return globalThis.crypto;
}

function checkPassword(password, minimum) {
  if (
    typeof password !== "string" ||
    password.length < minimum ||
    password.length > MAX_EXPORT_PASSWORD_LENGTH ||
    !password.trim()
  )
    throw new Error(
      minimum > 1
        ? `请设置 ${minimum}–${MAX_EXPORT_PASSWORD_LENGTH} 个字符的文件密码。`
        : "请输入有效的文件密码。",
    );
}

async function deriveKey(runtime, password, salt, usages) {
  const passwordBytes = encoder.encode(password);
  try {
    const secret = await runtime.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await runtime.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      secret,
      { name: "AES-GCM", length: 256 },
      false,
      usages,
    );
  } finally {
    passwordBytes.fill(0);
  }
}

function cipherOptions(iv, salt64, iv64) {
  return {
    name: "AES-GCM",
    iv,
    tagLength,
    additionalData: encoder.encode(
      JSON.stringify([format, version, kdf, iterations, cipher, salt64, iv64]),
    ),
  };
}

export async function encryptPortable(text, password) {
  checkPassword(password, MIN_EXPORT_PASSWORD_LENGTH);
  if (typeof text !== "string" || text.length > MAX_PLAINTEXT_BYTES)
    throw new Error("导出内容超过 25 MiB，无法创建加密文件。");
  const runtime = webCrypto();
  const plaintext = encoder.encode(text);
  try {
    if (plaintext.length > MAX_PLAINTEXT_BYTES)
      throw new Error("导出内容超过 25 MiB，无法创建加密文件。");
    const salt = runtime.getRandomValues(new Uint8Array(saltSize));
    const iv = runtime.getRandomValues(new Uint8Array(ivSize));
    const salt64 = encode64(salt);
    const iv64 = encode64(iv);
    const key = await deriveKey(runtime, password, salt, ["encrypt"]);
    const encrypted = await runtime.subtle.encrypt(
      cipherOptions(iv, salt64, iv64),
      key,
      plaintext,
    );
    return JSON.stringify({
      format,
      version,
      kdf,
      iterations,
      cipher,
      salt: salt64,
      iv: iv64,
      ciphertext: encode64(new Uint8Array(encrypted)),
    });
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptPortable(envelopeText, password) {
  checkPassword(password, 1);
  const envelope = parsePortableEnvelope(envelopeText);
  const runtime = webCrypto();
  const salt = decode64(envelope.salt);
  const iv = decode64(envelope.iv);
  const key = await deriveKey(runtime, password, salt, ["decrypt"]);
  let plaintext;
  try {
    plaintext = new Uint8Array(
      await runtime.subtle.decrypt(
        cipherOptions(iv, envelope.salt, envelope.iv),
        key,
        decode64(envelope.ciphertext),
      ),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error("无法解密：文件密码不正确，或文件已被修改、损坏。");
  } finally {
    plaintext?.fill(0);
  }
}
