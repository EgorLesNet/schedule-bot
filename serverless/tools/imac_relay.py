#!/usr/bin/env python3
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from verify_backup import verify


def run(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1800, **kwargs)


def main(config):
    with Path(config).expanduser().open() as stream:
        info = os.fstat(stream.fileno())
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('Configuration must be private')
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        c = json.load(stream)
        sync(c)


def sync(c):
    vault = Path(c['vault']).resolve(strict=True)
    volume = Path(c['volume']).resolve(strict=True)
    key = Path(c['private_key']).resolve(strict=True)
    if volume == Path('/') or not os.path.ismount(volume):
        raise ValueError('Encrypted backup volume must be mounted')
    if key.stat().st_mode & 0o077:
        raise ValueError('Private key permissions must be 600')
    if subprocess.check_output(['git','status','--porcelain'], cwd=vault).strip():
        raise ValueError('Vault checkout must be clean before syncing')
    run(['git','pull','--ff-only'], cwd=vault)
    for folder in sorted((vault / 'archives').glob('*')):
        if not re.fullmatch(r'[a-z0-9]{1,32}', folder.name):
            raise ValueError('Invalid archive directory')
        meta = json.loads((folder / 'manifest.json').read_text())
        sid = folder.name
        if meta['id'] != sid:
            raise ValueError('Archive identity mismatch')
        dest = volume / ('schedule-' + sid + '.zip')
        with tempfile.TemporaryDirectory(dir=volume) as tmp:
            tmp = Path(tmp)
            if not dest.is_file():
                encrypted = tmp / 'archive.der'
                with encrypted.open('xb') as out:
                    for i, chunk in enumerate(meta['chunks']):
                        if chunk['name'] != '%06d.bin' % i:
                            raise ValueError('Invalid chunk')
                        data = (folder / chunk['name']).read_bytes()
                        if len(data) != chunk['size'] or hashlib.sha256(data).hexdigest() != chunk['sha256']:
                            raise ValueError('Chunk checksum failed')
                        out.write(data)
                plain = tmp / 'archive.zip'
                run(['openssl','smime','-decrypt','-binary','-inform','DER','-in',str(encrypted),'-inkey',str(key),'-out',str(plain)])
                if verify(plain) != (meta['keys'], meta['attachments']):
                    raise ValueError('Archive content mismatch')
                import zipfile
                with zipfile.ZipFile(plain) as z:
                    if json.loads(z.read('manifest.json'))['snapshot']['id'] != sid:
                        raise ValueError('Snapshot identity mismatch')
                os.replace(plain, dest)
            counts = verify(dest)
            receipts = vault / 'receipts'
            receipts.mkdir(exist_ok=True)
            receipt = receipts / (sid + '.json')
            signature = receipts / (sid + '.sig')
            if receipt.exists() and signature.exists():
                continue
            digest = hashlib.sha256()
            with dest.open('rb') as stream:
                for block in iter(lambda: stream.read(65536), b''):
                    digest.update(block)
            receipt.write_text(json.dumps(dict(id=sid,ts=meta['ts'],keys=counts[0],attachments=counts[1],sha256=digest.hexdigest()),sort_keys=True))
            run(['openssl','dgst','-sha256','-sign',str(key),'-out',str(signature),str(receipt)])
    run(['git','add','receipts'], cwd=vault)
    diff = subprocess.run(['git','diff','--cached','--quiet'], cwd=vault)
    if diff.returncode == 1:
        run(['git','commit','-m','Confirm verified iMac archives'], cwd=vault)
        run(['git','push'], cwd=vault)
    elif diff.returncode != 0:
        raise ValueError('Git status failed')
    # Retry a previous committed receipt push if the network was unavailable.
    run(['git','push'], cwd=vault)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main(sys.argv[1])
    except Exception as exc:
        print('iMac relay failed (%s)' % type(exc).__name__, file=sys.stderr)
        sys.exit(1)
