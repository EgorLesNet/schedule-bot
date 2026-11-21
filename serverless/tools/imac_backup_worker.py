#!/usr/bin/env python3
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import urllib.request
import zipfile

from imac_export import NoRedirect
from verify_backup import verify

TOOLS = Path(__file__).resolve().parent
INTERVAL = 6 * 3600


def main():
    with Path(sys.argv[1]).expanduser().open() as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise RuntimeError('Private configuration file required')
        try:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        run(json.load(stream))


def run(settings):
    volume = Path(settings['volume']).resolve(strict=True)
    if volume == Path('/') or not os.path.ismount(volume):
        raise RuntimeError('Dedicated encrypted volume required')
    env = dict(os.environ, **{key: settings[key] for key in ('SCHEDULE_BACKUP_URL', 'SCHEDULE_BACKUP_TOKEN', 'TELEGRAM_BOT_TOKEN')})
    url = env['SCHEDULE_BACKUP_URL']
    if not re.fullmatch(r'https://app[0-9]+\.tgcloud\.ai/api/backupMac', url):
        raise ValueError('Unexpected TGCloud endpoint')
    adapter = TOOLS / 'imac_export.py'
    pinned = TOOLS / 'imac_pinned_export.py'
    if not os.access(pinned, os.X_OK):
        raise RuntimeError('Pinned adapter must be executable')

    def request(action):
        result = subprocess.run([sys.executable, str(adapter), json.dumps({'action': action})], env=env, capture_output=True, check=True, timeout=105)
        return json.loads(result.stdout)

    snapshots = request('list')['snapshots']
    if not snapshots or time.time() - max(s['ts'] for s in snapshots) / 1000 >= INTERVAL:
        request('create')
        snapshots = request('list')['snapshots']
    if not snapshots:
        raise RuntimeError('No available snapshots')
    failed = 0
    for snapshot in sorted(snapshots, key=lambda item: item['ts']):
        sid = snapshot['id']
        if not re.fullmatch(r'[a-z0-9]{1,32}', sid):
            raise ValueError('Invalid snapshot ID')
        archive = volume / ('schedule-' + sid + '.zip')
        receipt = volume / ('schedule-' + sid + '.receipt')
        try:
            try:
                with zipfile.ZipFile(archive) as saved:
                    if json.loads(saved.read('manifest.json'))['snapshot'] != snapshot:
                        raise ValueError('Snapshot metadata mismatch')
                counts = verify(archive)
            except Exception:
                subprocess.run([sys.executable, str(TOOLS / 'archive_backup.py'), str(volume), str(pinned)], env=dict(env, SCHEDULE_SNAPSHOT_ID=sid), check=True, timeout=1800)
                counts = verify(archive)
            with archive.open('rb') as stream:
                digest = hashlib.sha256()
                for block in iter(lambda: stream.read(65536), b''):
                    digest.update(block)
            checksum = digest.hexdigest()
            if receipt.is_file() and receipt.read_text().strip() == checksum:
                continue
            body = dict(token=env['SCHEDULE_BACKUP_TOKEN'], id=sid, keys=counts[0], attachments=counts[1], sha256=checksum)
            req = urllib.request.Request(url + 'Receipt', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
            with urllib.request.build_opener(NoRedirect()).open(req, timeout=45) as response:
                if json.loads(response.read(4096)).get('accepted') != sid:
                    raise ValueError('Receipt not accepted')
            receipt.write_text(checksum + '\n')
        except Exception as exc:
            failed += 1
            print('Snapshot %s: %s' % (sid, type(exc).__name__), file=sys.stderr)
    if failed:
        raise RuntimeError('At least one snapshot or receipt failed')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as exc:
        print('iMac backup failed (%s)' % type(exc).__name__, file=sys.stderr)
        sys.exit(1)
