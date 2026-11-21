# Local backup collector

Run with Python 3.6+ on the iMac. Use a dedicated, mounted encrypted volume (disk or encrypted disk image); the script checks that the destination is a mount point, not that it is encrypted. The ZIP itself is not encrypted. Keep a separate encrypted copy and store the unlock credentials separately. Do not commit data, credentials, or local adapter files.

Usage: `python3 archive_backup.py /Volumes/ScheduleBackups /absolute/path/to/exporter`.

Provide `TELEGRAM_BOT_TOKEN` from local secret storage. The adapter is an executable that accepts one JSON argument and prints only the JSON result of the authorized `backupExport` call. The adapter and its TGCloud credentials must be set up separately. Never run the adapter in a workflow that logs stdout. The collector uses the latest already-created format-2 snapshot; it does not create one or deploy anything.

Every `hwfiles:` and `inbox:` reference in that snapshot is attempted. Telegram's hosted getFile may reject large or unavailable files. Any failed download fails the run without publishing a replacement archive. Existing archives are left alone. The manifest maps old file IDs to archived bytes and their SHA-256 hashes. Restore/import, re-upload and file-ID remapping, and launchd setup are not implemented by this commit; a successful archive is not a tested restore.
