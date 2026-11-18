import {randomInt, randomUUID} from 'node:crypto';
import {constants as flags} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {MAX_PORTABLE_BYTES} from '../src/portable.js';

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SLOTS = 50;
const PREFIX = 'manxu/v1/backups/';
export class ServiceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const full = () => new ServiceError(409, '云备份已达到 50 份。请先在服务器或 COS 中归档旧备份。');
const missing = () => new ServiceError(404, '云备份不存在。');
const slotName = index => 'slot-' + String(index).padStart(2, '0');
function newId(index) {
  // Keep 114 random bits and embed the slot for direct lookup.
  return randomUUID().slice(0, -2) + index.toString(16).padStart(2, '0');
}
function slotOf(id) {
  const index = Number.parseInt(id.slice(-2), 16);
  if (!UUID.test(id) || index >= SLOTS) throw missing();
  return index;
}
function ordered(records) {
  return records.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function diskStore(directory) {
  if (!path.isAbsolute(directory)) throw Error('BACKUP_DIR 需要绝对路径。');
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  const root = await fs.lstat(directory);
  if (!root.isDirectory() || root.uid !== process.getuid() || await fs.realpath(directory) !== path.resolve(directory))
    throw Error('备份目录需要由服务用户拥有，并使用真实目录路径。');
  await fs.chmod(directory, 0o700);
  async function slotDirectory(index) {
    const folder = path.join(directory, slotName(index));
    const info = await fs.lstat(folder);
    if (!info.isDirectory() || info.uid !== root.uid || (info.mode & 0o077))
      throw Error('备份槽不可用。');
    return folder;
  }
  return {
    async list() {
      const entries = await fs.readdir(directory, {withFileTypes: true});
      const records = await Promise.all(entries.filter(e => /^slot-[0-4][0-9]$/.test(e.name)).map(async e => {
        const index = Number(e.name.slice(5));
        const folder = await slotDirectory(index);
        const [name] = await fs.readdir(folder);
        if (!name?.endsWith('.manxu')) return null;
        const id = name.slice(0, -6);
        if (!UUID.test(id) || slotOf(id) !== index) return null;
        const stat = await fs.lstat(path.join(folder, name));
        if (!stat.isFile() || stat.uid !== root.uid || (stat.mode & 0o077) || stat.size > MAX_PORTABLE_BYTES) return null;
        return {id, createdAt: stat.mtime.toISOString(), size: stat.size};
      }));
      return ordered(records);
    },
    async put(bytes) {
      const stage = await fs.mkdtemp(path.join(directory, '.pending-'));
      try {
        const pending = path.join(stage, 'pending');
        const handle = await fs.open(pending, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        let filename = pending;
        const createdAt = (await fs.stat(pending)).mtime.toISOString();
        const start = randomInt(SLOTS);
        for (let n = 0; n < SLOTS; n++) {
          const index = (start + n) % SLOTS;
          const id = newId(index);
          const next = path.join(stage, id + '.manxu');
          await fs.rename(filename, next);
          filename = next;
          try {
            // A populated directory cannot be replaced, even by another writer.
            await fs.rename(stage, path.join(directory, slotName(index)));
            const dir = await fs.open(directory, 'r');
            try { await dir.sync(); } finally { await dir.close(); }
            return {id, createdAt, size: bytes.length};
          } catch (err) {
            if (!['ENOTEMPTY', 'EEXIST'].includes(err.code)) throw err;
          }
        }
        throw full();
      } finally {
        await fs.rm(stage, {force: true, recursive: true});
      }
    },
    async get(id) {
      let handle;
      try {
        const folder = await slotDirectory(slotOf(id));
        handle = await fs.open(path.join(folder, id + '.manxu'), flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK);
        const stat = await handle.stat();
        if (!stat.isFile() || stat.uid !== root.uid || (stat.mode & 0o077) || stat.size > MAX_PORTABLE_BYTES) throw missing();
        return await handle.readFile();
      } catch (err) {
        if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(err.code)) throw missing();
        throw err;
      } finally { await handle?.close(); }
    },
  };
}

export function cosStore(client, Bucket, Region) {
  const common = {Bucket, Region};
  const key = index => PREFIX + slotName(index) + '.manxu';
  const status = error => Number(error?.statusCode || error?.status);
  async function occupied() {
    const result = await client.getBucket({...common, Prefix: PREFIX + 'slot-', MaxKeys: 1000});
    if (String(result.IsTruncated) === 'true') throw Error('备份专属前缀存在过多其他文件。');
    return new Set((result.Contents || []).map(item => item.Key));
  }
  return {
    async list() {
      const keys = await occupied();
      const records = [];
      for (let i = 0; i < SLOTS; i += 5) {
        records.push(...await Promise.all(Array.from({length: 5}, async (_, j) => {
          const index = i + j, Key = key(index);
          if (!keys.has(Key)) return null;
          const {headers} = await client.headObject({...common, Key});
          const id = headers['x-cos-meta-backup-id'];
          if (!id || !UUID.test(id) || slotOf(id) !== index) return null;
          const size = Number(headers['content-length']);
          if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PORTABLE_BYTES) return null;
          return {id, createdAt: new Date(headers['last-modified']).toISOString(), size};
        })));
      }
      return ordered(records);
    },
    async put(bytes) {
      const versioning = await client.getBucketVersioning(common);
      if (versioning.VersioningConfiguration?.Status) throw new ServiceError(503, 'COS 备份需要使用从未开启版本控制的专用私有桶。');
      const keys = await occupied(), start = randomInt(SLOTS);
      for (let n = 0; n < SLOTS; n++) {
        const index = (start + n) % SLOTS, Key = key(index);
        if (keys.has(Key)) continue;
        const id = newId(index);
        try {
          await client.putObject({...common, Key, Body: bytes, ContentType: 'application/json', ServerSideEncryption: 'AES256',
            Headers: {'x-cos-forbid-overwrite': 'true', 'x-cos-meta-backup-id': id}});
          return {id, createdAt: new Date().toISOString(), size: bytes.length};
        } catch (err) {
          if (status(err) !== 409 && status(err) !== 412) throw err;
        }
      }
      throw full();
    },
    async get(id) {
      try {
        const result = await client.getObject({...common, Key: key(slotOf(id)), Range: 'bytes=0-' + MAX_PORTABLE_BYTES});
        if (result.headers['x-cos-meta-backup-id'] !== id || !Buffer.isBuffer(result.Body) || result.Body.length > MAX_PORTABLE_BYTES) throw missing();
        return result.Body;
      } catch (err) {
        if (status(err) === 404) throw missing();
        throw err;
      }
    },
  };
}

export async function configuredStore(env) {
  if (env.BACKUP_DRIVER === 'disk') return diskStore(env.BACKUP_DIR || '/data/backups');
  if (env.BACKUP_DRIVER !== 'cos') throw Error('请配置 BACKUP_DRIVER 为 disk 或 cos。');
  if (!/^[a-z0-9-]+-\d+$/.test(env.COS_BUCKET || '') || !/^[a-z]+-[a-z0-9-]+$/.test(env.COS_REGION || '') ||
      !env.COS_SECRET_ID || !env.COS_SECRET_KEY) throw Error('COS 备份环境变量不完整。');
  const {default: COS} = await import('cos-nodejs-sdk-v5');
  const client = new COS({SecretId: env.COS_SECRET_ID, SecretKey: env.COS_SECRET_KEY, SecurityToken: env.COS_SESSION_TOKEN,
    Protocol: 'https:', Timeout: 60000});
  return cosStore(client, env.COS_BUCKET, env.COS_REGION);
}
