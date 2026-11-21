# iMac relay: setup and recovery

This replaces the experimental direct HTTP transport. Do not deploy backupMac/backupMacReceipt for this design. Do not use imac_backup_worker.py or its old plist. The source bot and its existing cloud snapshots remain in TGCloud; iMac uses Python 3.11, git, SSH and OpenSSL, not Node. No MacBook backup job is needed. The MacBook is only an optional one-time deployment/recovery workstation.

## Prerequisites and limits

Create a separate PRIVATE initialized GitHub repository for encrypted archives. Give GitHub Actions a fine-grained token with contents read/write only for that repository. Give iMac its own SSH deploy key with write access (needed for signed receipts). Configure git author name/email there. Do not reuse either credential for the source repository. GitHub stores ciphertext chunks; it is an intermediate copy, not the only backup. History grows: no automatic retention or history rewrite is performed. Files not present in Telegram cannot be recovered by software; hosted Bot API download limits cause the entire snapshot export to fail rather than silently omit attachments. Only hwfiles/inbox attachment schemas are currently collected. This is not a backup of secrets, GitHub repo history or platform configuration; keep bot/configuration credentials and source separately.

The workflow polls hourly; /backup creates a cloud snapshot and does not immediately dispatch Actions. Scheduled workflows run from the default branch: place imac-relay.yml there too, or run it manually from tgcloud. Enable only after the setup below. Keep backup.yml enabled. Nothing is automatically deleted on either Mac.

## On iMac

1. Mount a dedicated encrypted HFS+ volume named ScheduleBackups. A chmod-700 directory is NOT encryption. Unlock the volume after login; unattended unlock is deliberately not included. Keep a second offline copy of the archive and keys. The private key below is unencrypted for unattended use: keep it on this encrypted volume and chmod 600.
2. Generate an RSA key/certificate on that volume (never paste private.pem into GitHub):

```sh
umask 077
cd /Volumes/ScheduleBackups
openssl req -x509 -newkey rsa:3072 -nodes -keyout private.pem -out public.pem -days 3650 -subj /CN=schedule-backup
```

3. Copy ONLY public.pem into the GitHub environment secret IMAC_BACKUP_CERT. Configure BACKUP_VAULT_TOKEN, BOT_TOKEN and TGCLOUD_TOKEN in the existing TGCLOUD_TOKEN environment. Set repository variable BACKUP_VAULT_REPO to owner/private-repo and IMAC_RELAY_ENABLED to true.
4. Clone the private repo using its SSH deploy key into ~/schedule-vault; clone/pull this source branch into ~/schedule-src. Create a private local config ~/schedule-relay.json (chmod 600) containing absolute paths:

```json
{"vault":"/Users/egorlesnykh/schedule-vault","volume":"/Volumes/ScheduleBackups","private_key":"/Volumes/ScheduleBackups/private.pem"}
```

5. Run the workflow manually once. It exports existing format-2 cloud snapshots, verifies attachments, encrypts with the public certificate and commits chunks. Private key never reaches Actions. If CLI output format changes or is truncated the run fails closed. On iMac run:

```sh
python3 ~/schedule-src/serverless/tools/imac_relay.py ~/schedule-relay.json
```

It pulls ciphertext, verifies chunks, decrypts onto the encrypted volume, validates database/attachments, then signs a receipt and pushes it. The NEXT workflow run verifies signatures and imports status via authenticated CLI. A signature proves the iMac key confirmed this archive, not that the disk remains online forever. Fix and push any uncommitted receipts after a failed git push before rerunning.
6. For automatic polling use a LaunchAgent: copy imac-backup.plist.example to ~/Library/LaunchAgents/net.schedulebot.imac-relay.plist, change Label to net.schedulebot.imac-relay, set absolute Python 3.11 path (command -v python3), script path to imac_relay.py, config path to schedule-relay.json. Load with launchctl load on High Sierra. Agent runs only in the logged-in user session; sleep/offline/unmounted storage delays backups. Inspect launchctl list; test manually first. Do NOT load the old worker too.

## Cloud deployment

On a machine with working TGCloud CLI 0.2.0: fetch/status first, copy reviewed lib/bot.js and endpoints/backupRelayReceipt.js into the linked production project, inspect diff, push only those two files. No force. Relay calls backupExport locally through CLI; keep that source module and existing lib/backup.js available in the source checkout. recoveryImport is for an isolated target, not production. Existing /backup still creates cloud snapshots. /backups appends signed historical iMac receipts with the date of last confirmation; it does not claim that iMac is currently online. /restore remains the legacy cloud restore and does not restore iMac archives.

## Full archive recovery

Use a NEW isolated target bot and empty kv database, not the live app. Disable all schedules/notifications and do not let real users access the target. Use a different token/project directory; do not point TGCLOUD_PROJECT_DIR at production. Copy schema.js, lib/store.js, lib/config.js and endpoints/recoveryImport.js and necessary dependencies to that project. An authenticated CLI run can execute the local import endpoint without exposing it publicly. Migrate schema first but create no kv rows. Configure target bot credentials separately. Restored idbind/users/reminders refer to original users: isolation is essential.

Install Node 20, CLI 0.2.0 and json5 2.2.3 on recovery workstation. chmod 700 relay_cli.cjs. Set TGCLOUD_TOKEN to target platform credential; TGCLOUD_PROJECT_DIR to absolute isolated project directory; TARGET_BOT_TOKEN to NEW bot token; TARGET_ADMIN_CHAT_ID to your numeric ID after opening the new bot chat. Never print these values or use debug logs. Run:

```sh
python3 serverless/tools/restore_cloud.py /Volumes/ScheduleBackups/schedule-ID.zip --confirm-empty-isolated-target
```

The client validates the archive, opens an empty-target session, reuploads every attachment as a document to the target admin chat, rewrites fid/uid/kind references in homework/inbox JSON and inserts database rows. Media become documents (bytes preserved); original display name metadata stays in DB. Before 49 MiB or larger uploads it refuses. An interrupted restore can leave a partial target and uploaded messages: discard the isolated target database and retry from a clean instance; no automatic destructive reset is provided. Test UI, announcements, timetable changes, homework and actual downloads. Do not redirect live traffic merely because import exited successfully. Production in-place restore and chat-driven destructive restore are intentionally NOT implemented.

## MacBook cleanup

No backup service was installed remotely. Do not delete schedule_bot or schedule-src. If you personally created a ScheduleBackups.dmg, first verify a real archive exists on iMac, eject that volume on the MacBook and move only that exact image to Trash. No wildcard rm commands.
