#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import zipfile


def verify(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive entry')
        manifest = json.loads(archive.read('manifest.json'))
        if manifest['format'] != 1:
            raise ValueError('Unsupported archive format')
        snapshot, files = manifest['snapshot'], manifest['files']
        expected = {'manifest.json'}
        keys, references = set(), set()
        if type(snapshot['parts']) is not int or not 1 <= snapshot['parts'] <= len(names):
            raise ValueError('Invalid part count')
        for part in range(snapshot['parts']):
            name = 'db/%d.json' % part
            expected.add(name)
            for key, value, updated in json.loads(archive.read(name)):
                if not isinstance(key, str) or not key or key in keys or key.startswith(('backup:', 'cache:')):
                    raise ValueError('Invalid database key')
                if not isinstance(value, str) or type(updated) is not int:
                    raise ValueError('Invalid database row')
                keys.add(key)
                if key.startswith(('hwfiles:', 'inbox:')):
                    data = json.loads(value)
                    groups = data.values() if key.startswith('hwfiles:') else [data]
                    for group in groups:
                        for item in group:
                            fid = item['fid']
                            if not isinstance(fid, str) or not fid:
                                raise ValueError('Invalid attachment reference')
                            references.add(fid)
        if len(keys) != snapshot['keys'] or references != set(files):
            raise ValueError('Database and manifest do not match')
        for item in files.values():
            name = item['path']
            if not re.fullmatch(r'files/[0-9]+', name) or name in expected:
                raise ValueError('Invalid attachment path')
            expected.add(name)
            digest = hashlib.sha256()
            size = 0
            with archive.open(name) as stream:
                for block in iter(lambda: stream.read(65536), b''):
                    digest.update(block)
                    size += len(block)
            if size != item['size'] or digest.hexdigest() != item['sha256']:
                raise ValueError('Attachment integrity check failed')
        if expected != set(names):
            raise ValueError('Unexpected archive entries')
    return len(keys), len(references)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Verify an iMac backup without modifying the database')
    parser.add_argument('archive')
    args = parser.parse_args()
    try:
        rows, files = verify(args.archive)
    except Exception as exc:
        parser.exit(1, 'Backup verification failed (%s)\n' % type(exc).__name__)
    print('Verified: %d database keys, %d attachments' % (rows, files))
