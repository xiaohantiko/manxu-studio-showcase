const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const {randomUUID} = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const {backupConfig, provisionBackup} = require('./backup-config.cjs');

test('first-use provisioning checks the backup namespace, writes independently, then removes its input',async(t)=>{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'manxu-provision-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file = path.join(dir,'cloud-backup-setup.json');
  const input = {baseURL:'https://cloud.example/prefix',token:randomUUID()};
  await fs.writeFile(file,JSON.stringify(input),{mode:0o600});
  const direct = {provider:'openai',apiKey:randomUUID()};
  const records = new Map([['connection',direct]]);
  const vault = {read:async name=>records.get(name),write:async(name,v)=>records.set(name,v)};
  let checks=0;
  const fetcher = async(url,opts) => {
    assert.equal(url,'https://cloud.example/prefix/v1/backups');
    assert.equal(opts.method,'GET');
    assert.equal(opts.headers.Authorization,'Bearer '+input.token);
    checks++;
    return Response.json({backups:[]});
  };
  await provisionBackup(vault,dir,fetcher);
  assert.equal(checks,1);
  assert.deepEqual(records.get('cloud-backup'),backupConfig(input));
  assert.equal(records.get('connection'),direct);
  await assert.rejects(fs.stat(file),{code:'ENOENT'});
  // Repeat setup after a crash between durable write and input unlink.
  await fs.writeFile(file,JSON.stringify(input),{mode:0o600});
  await provisionBackup(vault,dir,fetcher);
  assert.equal(checks,2);
  await fs.writeFile(file,JSON.stringify({...input,token:randomUUID()}),{mode:0o600});
  await assert.rejects(provisionBackup(vault,dir,fetcher),/已有其他备份/);
  assert.equal(checks,2);
  assert.deepEqual(records.get('cloud-backup'),backupConfig(input));
});

test('provisioning refuses symlinks, broad permissions, invalid service login and incomplete writes',async(t)=>{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'manxu-provision-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file = path.join(dir,'cloud-backup-setup.json');
  const original = JSON.stringify({baseURL:'https://cloud.example',token:randomUUID()});
  const other = path.join(dir,'source');
  await fs.writeFile(other,original,{mode:0o600});
  await fs.symlink(other,file);
  let attempts = 0;
  const vault = {read:async()=>null,write:async()=>{attempts++;throw new Error('vault locked');}};
  await assert.rejects(provisionBackup(vault,dir),{code:'ELOOP'});
  await fs.unlink(file);
  await fs.rename(other,file);
  await fs.chmod(file,0o644);
  await assert.rejects(provisionBackup(vault,dir),/0600/);
  await fs.chmod(file,0o600);
  await assert.rejects(provisionBackup(vault,dir,async()=>new Response('',{status:401})),/令牌/);
  assert.equal(attempts,0);
  await assert.rejects(provisionBackup(vault,dir,async()=>Response.json({backups:[]})),/vault locked/);
  assert.equal(attempts,1);
  assert.equal(await fs.readFile(file,'utf8'),original);
});
