#!/usr/bin/env python3
"""Build a complete archive of a selected snapshot on a mounted volume."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
import urllib.parse
import urllib.request
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('volume', type=pathlib.Path)
    parser.add_argument('exporter', type=pathlib.Path)
    args = parser.parse_args()
    volume = args.volume.resolve(strict=True)
    if not os.path.ismount(str(volume)):
        raise RuntimeError('Backup volume is not mounted')
    token = os.environ.pop('TELEGRAM_BOT_TOKEN', '')
    if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+', token):
        raise RuntimeError('Missing or invalid Telegram bot token')

    def export(**payload):
        result = subprocess.run([str(args.exporter.resolve()), json.dumps(payload)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=120)
        return json.loads(result.stdout)

    snapshots = export(action='list')['snapshots']
    requested = os.environ.get('SCHEDULE_SNAPSHOT_ID')
    if requested is not None:
        if not re.fullmatch(r'[a-z0-9]{1,32}', requested):
            raise RuntimeError('Invalid requested snapshot ID')
        matches = [s for s in snapshots if s['id'] == requested]
        if len(matches) != 1:
            raise RuntimeError('Requested snapshot is unavailable or ambiguous')
        snapshot = matches[0]
    else:
        if not snapshots:
            raise RuntimeError('No snapshots available')
        snapshot = max(snapshots, key=lambda item: item['ts'])
    sid = snapshot['id']
    if not re.fullmatch(r'[a-z0-9]{1,32}', sid):
        raise RuntimeError('Invalid snapshot ID')
    dest = volume / ('schedule-' + sid + '.zip')
    keys, files, inventory = set(), set(), {}
    os.umask(0o077)
    with tempfile.TemporaryDirectory(dir=str(volume)) as tmp:
        pending = pathlib.Path(tmp) / 'archive.zip'
        with zipfile.ZipFile(str(pending), 'w', zipfile.ZIP_DEFLATED) as archive:
            for part in range(snapshot['parts']):
                page = export(action='part', id=sid, part=part)
                if page['id'] != sid or page['part'] != part:
                    raise RuntimeError('Snapshot part mismatch')
                for key, value, updated in page['rows']:
                    if key in keys:
                        raise RuntimeError('Duplicate snapshot key')
                    keys.add(key)
                    if key.startswith(('hwfiles:', 'inbox:')):
                        data = json.loads(value)
                        groups = data.values() if key.startswith('hwfiles:') else [data]
                        for group in groups:
                            for item in group:
                                files.add(item['fid'])
                archive.writestr('db/%d.json' % part, json.dumps(page['rows']))
            if len(keys) != snapshot['keys']:
                raise RuntimeError('Snapshot key count mismatch')
            base = 'https://api.telegram.org/'
            for number, fid in enumerate(sorted(files)):
                name = 'files/%d' % number
                try:
                    query = urllib.parse.urlencode({'file_id': fid}).encode('ascii')
                    with urllib.request.urlopen(base + 'bot' + token + '/getFile', data=query, timeout=60) as response:
                        info = json.load(response)['result']
                    path = '/'.join(urllib.parse.quote(p, safe='') for p in info['file_path'].split('/'))
                    digest = hashlib.sha256()
                    size = 0
                    with urllib.request.urlopen(base + 'file/bot' + token + '/' + path, timeout=60) as response, archive.open(name, 'w') as entry:
                        for block in iter(lambda: response.read(65536), b''):
                            entry.write(block)
                            digest.update(block)
                            size += len(block)
                    if info.get('file_size', size) != size:
                        raise RuntimeError('Attachment size mismatch')
                except Exception:
                    raise RuntimeError('Attachment %d/%d could not be backed up; archive not published' % (number + 1, len(files))) from None
                inventory[fid] = {'path': name, 'sha256': digest.hexdigest(), 'size': size}
            archive.writestr('manifest.json', json.dumps({'format': 1, 'snapshot': snapshot, 'files': inventory}))
        with zipfile.ZipFile(str(pending)) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('Archive integrity check failed')
        os.replace(str(pending), str(dest))
    print('Backup complete: %s, %d database keys, %d attachments' % (sid, len(keys), len(files)))


if __name__ == '__main__':
    main()
