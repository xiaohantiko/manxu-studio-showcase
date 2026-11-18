const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');
const {baseURL, connect} = require('./cloud-client.cjs');

function backupConfig(input, previous = {}) {
  const address = baseURL(input.baseURL);
  const token = input.token;
  if (typeof token !== 'string') throw new Error('云服务访问令牌格式错误。');
  if (!token.trim() && previous.baseURL !== address)
    throw new Error('备份服务地址改变，请重新填写云服务访问令牌。');
  const credential = token.trim() || previous.apiKey;
  if (typeof credential !== 'string' || !/^[A-Za-z0-9_=-]{32,256}$/.test(credential))
    throw new Error('请填写服务器配置的 32 至 256 个字符的云服务令牌。');
  return {provider:'tencent',baseURL:address,apiKey:credential};
}

async function provisionBackup(vault, directory, fetcher = fetch) {
  const file = path.join(directory,'cloud-backup-setup.json');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const original = await handle.stat();
    if (!original.isFile() || original.nlink !== 1 || original.uid !== process.getuid() ||
        (original.mode & 0o777) !== 0o600 || original.size > 8192)
      throw new Error('预置文件必须归当前用户所有，权限为 0600。');
    const bytes = Buffer.alloc(8193);
    let input;
    try {
      const {bytesRead} = await handle.read(bytes,0,bytes.length,0);
      if (bytesRead !== original.size) throw Error();
      input = JSON.parse(bytes.toString('utf8',0,bytesRead));
    } catch {
      throw new Error('备份预置文件格式无效。');
    } finally { bytes.fill(0); }
    if (!input || Object.keys(input).sort().join(',') !== 'baseURL,token')
      throw new Error('备份预置文件字段无效。');
    const next = backupConfig(input);
    const previous = await vault.read('cloud-backup');
    if (previous != null && (previous.baseURL !== next.baseURL || previous.apiKey !== next.apiKey))
      throw new Error('已有其他备份绑定，请登录管理后台修改。');
    await connect(next, fetcher).list();
    await vault.write('cloud-backup',next);
    const current = await fs.lstat(file);
    if (current.dev !== original.dev || current.ino !== original.ino || current.mtimeMs !== original.mtimeMs)
      throw new Error('预置文件发生变化，请检查该文件。');
    await fs.unlink(file);
  } finally { await handle.close(); }
}
module.exports = {backupConfig,provisionBackup};
