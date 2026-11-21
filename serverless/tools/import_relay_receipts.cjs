const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const JSON5 = require('json5');
try {
  const dir = path.join(process.env.BACKUP_VAULT,'receipts');
  if (fs.existsSync(dir)) for (const file of fs.readdirSync(dir).filter(x=>/^[a-z0-9]+\.json$/.test(x))) {
    const full = path.join(dir,file);
    const verify = spawnSync('openssl',['dgst','-sha256','-verify',process.env.BACKUP_PUBKEY,'-signature',full.replace(/\.json$/,'.sig'),full]);
    if (verify.status !== 0) throw Error();
    const data = JSON.parse(fs.readFileSync(full,'utf8'));
    if (data.id + '.json' !== file) throw Error();
    const r = spawnSync('npx',['--no-install','tgcloud','--no-pager','run','endpoints/backupRelayReceipt',JSON.stringify(data),'--ctx','{initData:{user:{id:1}}}'], {cwd:process.env.TGCLOUD_PROJECT_DIR,encoding:'utf8',maxBuffer:1024*1024,timeout:110000});
    const m = r.stdout?.trimEnd().match(/^<\s*(\{[\s\S]*\})\s+\d+(?:\.\d+)?\s*ms$/m);
    if (r.status !== 0 || !m || JSON5.parse(m[1]).accepted !== data.id) throw Error();
  }
} catch (_) { console.error('Receipt import failed; response withheld'); process.exit(1); }
