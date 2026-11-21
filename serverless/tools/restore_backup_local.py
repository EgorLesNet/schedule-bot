#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import zipfile

from verify_backup import verify


def restore(source, target):
    source = source.resolve(strict=True)
    target = target.absolute()
    if target.parent.resolve(strict=True) != source.parent:
        raise ValueError('Restore directory must be next to the archive on the encrypted volume')
    rows, attachments = verify(source)
    os.umask(0o077)
    target.mkdir(mode=0o700)
    try:
        with zipfile.ZipFile(source) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            conn = sqlite3.connect(str(target / 'kv.sqlite3'))
            try:
                with conn:
                    conn.execute('CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)')
                    for part in range(manifest['snapshot']['parts']):
                        data = json.loads(archive.read('db/%d.json' % part))
                        conn.executemany('INSERT INTO kv VALUES (?, ?, ?)', data)
                    if conn.execute('SELECT COUNT(*) FROM kv').fetchone()[0] != rows:
                        raise ValueError('Restored row count mismatch')
                if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('SQLite integrity check failed')
            finally:
                conn.close()
            (target / 'files').mkdir()
            for item in manifest['files'].values():
                with archive.open(item['path']) as src, (target / item['path']).open('xb') as dst:
                    shutil.copyfileobj(src, dst, 65536)
            with (target / 'manifest.json').open('x', encoding='utf-8') as dst:
                json.dump(manifest, dst)
    except BaseException:
        shutil.rmtree(target)
        raise
    return rows, attachments


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Restore an archive locally without contacting TGCloud or Telegram')
    parser.add_argument('archive', type=Path)
    parser.add_argument('new_directory', type=Path)
    args = parser.parse_args()
    try:
        rows, files = restore(args.archive, args.new_directory)
    except Exception as exc:
        parser.exit(1, 'Local restore failed (%s)\n' % type(exc).__name__)
    print('Restored locally: %d database keys, %d attachments' % (rows, files))
