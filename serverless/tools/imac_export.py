#!/usr/bin/env python3
import json
import os
import re
import sys
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    url = os.environ['SCHEDULE_BACKUP_URL']
    if not re.fullmatch(r'https://app[0-9]+\.tgcloud\.ai/api/backupMac', url):
        raise ValueError('Unexpected TGCloud endpoint')
    token = os.environ['SCHEDULE_BACKUP_TOKEN']
    if not re.fullmatch(r'[a-f0-9]{64}', token):
        raise ValueError('Invalid backup token')
    payload = json.loads(sys.argv[1])
    if payload.get('action') not in ('list', 'part', 'create'):
        raise ValueError('Unsupported operation')
    payload['token'] = token
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=90) as response:
        data = json.loads(response.read(8 * 1024 * 1024 + 1))
    expected = {'list': 'snapshots', 'part': 'rows', 'create': 'id'}[payload['action']]
    if not isinstance(data, dict) or not isinstance(data.get(expected), str if expected == 'id' else list):
        raise ValueError('Unexpected response')
    json.dump(data, sys.stdout)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('iMac export failed (%s); response withheld' % type(exc).__name__, file=sys.stderr)
        sys.exit(1)
