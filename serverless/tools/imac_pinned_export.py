#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def main():
    sid = os.environ['SCHEDULE_SNAPSHOT_ID']
    if not re.fullmatch(r'[a-z0-9]{1,32}', sid):
        raise ValueError('Invalid snapshot ID')
    payload = json.loads(sys.argv[1])
    action = payload.get('action')
    if action != 'list' and (action != 'part' or payload.get('id') != sid):
        raise ValueError('Unexpected pinned export request')
    adapter = Path(__file__).resolve().with_name('imac_export.py')
    result = subprocess.run([sys.executable, str(adapter), json.dumps(payload)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=105)
    data = json.loads(result.stdout)
    if action == 'list':
        snapshots = [item for item in data['snapshots'] if item['id'] == sid]
        if len(snapshots) != 1:
            raise ValueError('Pinned snapshot unavailable')
        data = {'snapshots': snapshots}
    elif data['id'] != sid or data['part'] != payload['part']:
        raise ValueError('Unexpected snapshot part')
    json.dump(data, sys.stdout)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Pinned backup export failed; response withheld', file=sys.stderr)
        sys.exit(1)
