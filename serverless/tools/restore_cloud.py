#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import uuid
import zipfile
from verify_backup import verify


def main():
    p = argparse.ArgumentParser(description='Restore only into an isolated empty TGCloud instance. Uploads files to the target bot admin chat.')
    p.add_argument('archive', type=Path)
    p.add_argument('--confirm-empty-isolated-target', action='store_true', required=True)
    args = p.parse_args()
    verify(args.archive)
    token = os.environ['TARGET_BOT_TOKEN']
    chat = os.environ['TARGET_ADMIN_CHAT_ID']
    env = dict(os.environ, RECOVERY_MODE='1')
    adapter = Path(__file__).with_name('relay_cli.cjs').resolve()

    def cli(data):
        r = subprocess.run([str(adapter),json.dumps(data)],env=env,capture_output=True,check=True,timeout=120)
        return json.loads(r.stdout)

    with zipfile.ZipFile(args.archive) as z:
        m = json.loads(z.read('manifest.json'))
        sid = m['snapshot']['id']
        mapping = {}
        for fid, item in m['files'].items():
            if item['size'] > 49 * 1024 * 1024:
                raise ValueError('Attachment exceeds conservative upload limit')
        if cli(dict(action='begin', id=sid, confirm='ISOLATED_EMPTY_INSTANCE')).get('ready') != sid:
            raise ValueError('Target not ready')
        for i, (fid, item) in enumerate(m['files'].items()):
            boundary = uuid.uuid4().hex
            body = ('--'+boundary+'\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n'+chat+'\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="document"; filename="recovered-%d"\r\nContent-Type: application/octet-stream\r\n\r\n' % i).encode() + z.read(item['path']) + ('\r\n--'+boundary+'--\r\n').encode()
            req = urllib.request.Request('https://api.telegram.org/bot'+token+'/sendDocument',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary})
            with urllib.request.urlopen(req,timeout=180) as response:
                result = json.load(response)
            doc = result['result']['document']
            mapping[fid] = doc

        def remap(value):
            if isinstance(value,list):
                return [remap(v) for v in value]
            if isinstance(value,dict):
                out = {k:remap(v) for k,v in value.items()}
                if value.get('fid') in mapping:
                    doc = mapping[value['fid']]
                    out.update(fid=doc['file_id'],uid=doc['file_unique_id'],kind='document')
                return out
            return value

        for part in range(m['snapshot']['parts']):
            rows = json.loads(z.read('db/%d.json' % part))
            for row in rows:
                if row[0].startswith(('hwfiles:','inbox:')):
                    row[1] = json.dumps(remap(json.loads(row[1])),ensure_ascii=False)
            for offset in range(0,len(rows),25):
                batch = rows[offset:offset+25]
                if cli(dict(action='insert',id=sid,rows=batch)).get('accepted') != len(batch):
                    raise ValueError('Import mismatch')
        if cli(dict(action='finish',id=sid)).get('closed') != sid:
            raise ValueError('Session not closed')
    print('Imported into isolated target; test application and attachments before enabling traffic')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('Recovery stopped (%s); partial target must remain isolated' % type(exc).__name__,file=sys.stderr)
        sys.exit(1)
