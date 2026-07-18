# Backup and recovery

Production data lives in the `luana-board` D1 database and the `luana-lessons` R2 bucket. Local backup files are ignored by Git because they can contain staff, student, and uploaded-file data.

## D1 protection

D1 Time Travel is automatic and needs no setup. Use it for point-in-time recovery within Cloudflare's retention window. Check the current bookmark before any risky migration:

```powershell
npx wrangler d1 time-travel info luana-board
```

Create a portable SQL export for longer-term retention:

```powershell
npm run backup:d1
```

The export is written under `backups/<UTC timestamp>/luana-board.sql`. Move it to encrypted storage outside this repository and workstation. A running export briefly blocks database requests, so schedule it outside busy hours.

Test the export against local D1 without touching production:

```powershell
npx wrangler d1 execute luana-board --local --file backups/<timestamp>/luana-board.sql
```

## D1 recovery

Time Travel restore overwrites production and cancels in-flight queries. Before restoring:

1. Stop staff writes and record the current bookmark with `d1 time-travel info`.
2. Identify the target timestamp and verify its timezone.
3. Run `npx wrangler d1 time-travel info luana-board --timestamp="<RFC3339 timestamp>"` to inspect the target bookmark.
4. Export the current database with `npm run backup:d1`.
5. Only then run `npx wrangler d1 time-travel restore luana-board --timestamp="<RFC3339 timestamp>"` and confirm interactively.
6. Run the app smoke checks. Keep the pre-restore bookmark so the restore can be undone.

Never automate the production restore command or use `--yes` for it.

## R2 protection

R2 object data needs a second copy. Install rclone 1.59 or newer, create an R2 API token with read access to `luana-lessons`, and configure a Cloudflare R2 remote named `r2`. Keep its credentials outside this repository.

```powershell
rclone config
rclone lsf r2:luana-lessons
npm run backup:r2
```

`backup:r2` uses `rclone copy`, which never deletes production objects. Store the resulting directory on encrypted storage outside this workstation. For unattended backups, copy directly to a separate provider or storage account instead of relying on the local `backups/` directory.

To restore one object, first verify its exact key and use a copy operation from the backup into `r2:luana-lessons/<key>`. Do not use `rclone sync` for recovery because it can delete destination objects.

## Schedule and drills

- D1 SQL export: weekly and before every migration or bulk edit.
- R2 copy: weekly, with versioned or dated retention at the backup destination.
- Recovery drill: quarterly, restoring D1 into local storage and checking an R2 sample without modifying production.
- Retention: keep at least four weekly and twelve monthly encrypted copies when policy permits.
