#!/usr/bin/env node
const {spawnSync} = require('node:child_process');
const JSON5 = require('json5');
try {
  const input = JSON.parse(process.argv[2]);
  const moduleName = process.env.RECOVERY_MODE === '1' ? 'recoveryImport' : 'backupExport';
  const r = spawnSync('npx', ['--no-install','tgcloud','--no-pager','run','endpoints/' + moduleName,JSON.stringify(input),'--ctx','{initData:{user:{id:1}}}'], {cwd:process.env.TGCLOUD_PROJECT_DIR,encoding:'utf8',timeout:110000,maxBuffer:16*1024*1024});
  if (r.error || r.status !== 0) throw Error();
  const match = r.stdout.replace(/\x1b\[[0-9;]*m/g,'').trimEnd().match(/^<\s*(\{[\s\S]*\})\s+\d+(?:\.\d+)?\s*ms$/m);
  if (!match) throw Error();
  let data = JSON5.parse(match[1]);
  const id = process.env.SCHEDULE_SNAPSHOT_ID;
  if (moduleName === 'backupExport' && input.action === 'list' && id) data = {snapshots:data.snapshots.filter(x=>x.id===id)};
  if (moduleName === 'backupExport' && input.action === 'part' && id && input.id !== id) throw Error();
  process.stdout.write(JSON.stringify(data));
} catch (_) { console.error('CLI relay failed; response withheld'); process.exit(1); }
