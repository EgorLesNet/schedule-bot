#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from verify_backup import verify

TOOLS = Path(__file__).resolve().parent


def call(module, payload):
    env = dict(os.environ)
    env['RECOVERY_MODE'] = '1' if module == 'recoveryImport' else '0'
    if module not in ('backupExport', 'recoveryImport'):
        raise ValueError('Unsupported module')
    r = subprocess.run([str(TOOLS / 'relay_cli.cjs'), json.dumps(payload)], env=env, capture_output=True, check=True, timeout=120)
    return json.loads(r.stdout)


def main():
    vault = Path(os.environ['BACKUP_VAULT']).resolve(strict=True)
    cert = Path(os.environ['BACKUP_CERT']).resolve(strict=True)
    snapshots = call('backupExport', {'action': 'list'})['snapshots']
    for snapshot in snapshots:
        sid = snapshot['id']
        if not isinstance(sid, str) or not sid.isascii() or not sid.isalnum():
            raise ValueError('Invalid snapshot ID')
        target = vault / 'archives' / sid
        if (target / 'manifest.json').is_file():
            continue
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            env = dict(os.environ, SCHEDULE_SNAPSHOT_ID=sid)
            subprocess.run([sys.executable, str(TOOLS / 'archive_backup.py'), '/', str(TOOLS / 'relay_cli.cjs')], env=env, check=True) if False else None
            # Collector requires a mount point. The runner uses a private tmpfs mounted by the workflow.
            mount = Path(os.environ['BACKUP_STAGING'])
            subprocess.run([sys.executable, str(TOOLS / 'archive_backup.py'), str(mount), str(TOOLS / 'relay_cli.cjs')], env=env, check=True, timeout=1800)
            archive = mount / ('schedule-' + sid + '.zip')
            keys, files = verify(archive)
            encrypted = work / 'archive.der'
            subprocess.run(['openssl','smime','-encrypt','-binary','-aes256','-outform','DER','-in',str(archive),'-out',str(encrypted),str(cert)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            archive.unlink()
            target.mkdir(parents=True, exist_ok=True)
            chunks = []
            with encrypted.open('rb') as stream:
                for number, block in enumerate(iter(lambda: stream.read(8*1024*1024), b'')):
                    name = '%06d.bin' % number
                    (target / name).write_bytes(block)
                    chunks.append({'name':name,'sha256':hashlib.sha256(block).hexdigest(),'size':len(block)})
            (target / 'manifest.json').write_text(json.dumps({'id':sid,'ts':snapshot['ts'],'keys':keys,'attachments':files,'chunks':chunks}))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as exc:
        print('Relay publication failed (%s); details withheld' % type(exc).__name__, file=sys.stderr)
        sys.exit(1)
