#!/usr/bin/env python3
"""Local-only adapter for archive_backup.py. Never run in public CI."""
import json
import os
import subprocess
import sys


def main():
    if len(sys.argv) != 2 or not os.environ.get('TGCLOUD_TOKEN'):
        raise ValueError('Expected JSON input and TGCLOUD_TOKEN')
    payload = json.loads(sys.argv[1])
    if payload.get('action') not in ('list', 'part'):
        raise ValueError('Unsupported backup export action')
    config = os.path.abspath(os.environ['TGCLOUD_PROJECT_DIR'])
    cli = os.environ['TGCLOUD_CLI']
    if not os.path.isabs(cli):
        raise ValueError('TGCLOUD_CLI must be an absolute path')
    result = subprocess.run([cli, 'run', 'endpoints/backupExport', json.dumps(payload), '--ctx', '{ initData: { user: { id: 1 } } }'], cwd=config, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=105)
    data = json.loads(result.stdout.decode('utf-8'))
    expected = 'snapshots' if payload['action'] == 'list' else 'rows'
    if not isinstance(data, dict) or not isinstance(data.get(expected), list):
        raise ValueError('Unexpected TGCloud response schema')
    json.dump(data, sys.stdout)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        sys.stderr.write('Backup export failed (%s); response withheld.\n' % type(exc).__name__)
        sys.exit(1)
