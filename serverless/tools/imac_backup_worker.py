#!/usr/bin/env python3
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import zipfile

TOOLS = Path(__file__).resolve().parent
INTERVAL = 6 * 3600


def main():
    config = Path(sys.argv[1]).expanduser().resolve(strict=True)
    with config.open() as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise RuntimeError('Private configuration file required')
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        run(json.load(stream))


def run(settings):
    volume = Path(settings['volume']).resolve(strict=True)
    if volume == Path('/') or not os.path.ismount(volume):
        raise RuntimeError('Dedicated encrypted volume required')
    env = dict(os.environ, **{key: settings[key] for key in ('SCHEDULE_BACKUP_URL', 'SCHEDULE_BACKUP_TOKEN', 'TELEGRAM_BOT_TOKEN')})
    adapter = TOOLS / 'imac_export.py'
    pinned = TOOLS / 'imac_pinned_export.py'
    if not os.access(pinned, os.X_OK):
        raise RuntimeError('Pinned adapter must be executable')

    def request(action):
        result = subprocess.run([sys.executable, str(adapter), json.dumps({'action': action})], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=105)
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
            raise RuntimeError('Invalid snapshot ID')
        archive = volume / ('schedule-' + sid + '.zip')
        try:
            with zipfile.ZipFile(archive) as saved:
                if json.loads(saved.read('manifest.json'))['snapshot'] == snapshot and saved.testzip() is None:
                    continue
        except (OSError, ValueError, KeyError, RuntimeError, zipfile.BadZipFile):
            pass
        result = subprocess.run([sys.executable, str(TOOLS / 'archive_backup.py'), str(volume), str(pinned)], env=dict(env, SCHEDULE_SNAPSHOT_ID=sid), timeout=1800)
        if result.returncode:
            failed += 1
    if failed:
        raise RuntimeError('At least one snapshot could not be archived')


if __name__ == '__main__':
    try:
        main()
    except BlockingIOError:
        sys.exit(0)
    except Exception as exc:
        print('iMac backup failed (%s)' % type(exc).__name__, file=sys.stderr)
        sys.exit(1)
