#!/usr/bin/env python3
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
import zipfile

TOOLS = Path(__file__).resolve().parent
INTERVAL = 6 * 3600


def main():
    config = Path(sys.argv[1]).expanduser()
    with config.open() as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise RuntimeError('Private configuration file required')
        settings = json.load(stream)
    volume = Path(settings['volume']).resolve(strict=True)
    if not os.path.ismount(volume) or volume == Path('/'):
        raise RuntimeError('Dedicated encrypted volume required')
    env = dict(os.environ, **{key: settings[key] for key in ('SCHEDULE_BACKUP_URL', 'SCHEDULE_BACKUP_TOKEN', 'TELEGRAM_BOT_TOKEN')})
    adapter = TOOLS / 'imac_export.py'

    def request(action):
        result = subprocess.run([sys.executable, str(adapter), json.dumps({'action': action})], env=env, capture_output=True, check=True, timeout=105)
        return json.loads(result.stdout)

    snapshots = request('list')['snapshots']
    if not snapshots or time.time() - max(s['ts'] for s in snapshots) / 1000 >= INTERVAL:
        request('create')
        snapshots = request('list')['snapshots']
    latest = max(snapshots, key=lambda item: item['ts'])
    sid = latest['id']
    if not isinstance(sid, str) or not sid.isascii() or not sid.isalnum():
        raise RuntimeError('Invalid snapshot ID')
    archive = volume / ('schedule-' + sid + '.zip')
    if archive.is_file():
        with zipfile.ZipFile(archive) as saved:
            if json.loads(saved.read('manifest.json'))['snapshot'] == latest and saved.testzip() is None:
                return
    subprocess.run([sys.executable, str(TOOLS / 'archive_backup.py'), str(volume), str(adapter)], env=env, check=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('iMac backup failed (%s)' % type(exc).__name__, file=sys.stderr)
        sys.exit(1)
