# React / Glisse preview — stages 1 and 2

This is an additive preview, not a completed migration and not a replacement for the production entrypoint. Existing web/index.html, backend, schema and service worker remain unchanged.

## Implemented in source

- Shared wrappers for actual Glisse 0.5.0 Button, Glass, Input and Switch.
- Day/week schedule, date navigation, subject/teacher search, favourites and personal notes.
- Faculty/course/direction/stream selection, language start and reminders.
- Stage 2: current homework, archive search and server pagination (20 per page); done status; create/delete; edit text/date, remove individual attachments and add files from inbox; assistant-only history with restore using the server-provided version index.
- Stage 2: file inbox via bot chat, refresh, selection up to 10, confirmed removal from inbox; send homework files to personal chat; confirmed clearing of homework attachments. There is no fabricated browser-upload endpoint.
- Stage 2: student proposals with attachments, own proposal list/cancellation; assistant queue with editable text, approve/reject confirmations and attachment metadata. Pending proposal file download is not exposed by the existing endpoint and is not invented.
- One mutation lock across the homework screen; writes are not retried automatically. Stale read responses are ignored and query data is hidden immediately when request identity changes. Server remains the authority for permissions and limits.
- Existing Telegram.WebApp.Serverless.call transport, Telegram theme events, safe areas and haptics. Session read cache for range/subjects/subjectDates is scoped to Telegram user ID with one-hour TTL; bootstrap and writes are not cached.

## Still not migrated

Schedule edits/link management, subscription calendars, news, library, clubs, exams, admin, advanced settings and some legacy presentation conveniences. Legacy remains available via the old-version button. The full project must not be described as migrated.

## Build and publish preview

Node >=22.12.0 and npm are required. Use the existing configured/authenticated Telegram Serverless project.

```sh
cd ~/schedule-src
git checkout tgcloud
git pull --ff-only origin tgcloud
cd serverless/frontend
npm install && npm run build
```

Only after a successful build, and after verifying the CLI account/project:

```sh
cd ~/schedule-src/serverless
npx tgcloud push
```

Vite writes only to serverless/web/react/, with relative asset paths; tgcloud.jsonc still publishes web. No SSR, separate Node runtime or schema migration is introduced. The root Mini App URL must remain unchanged. Open react/index.html relative to the Mini App static base URL inside Telegram Serverless. A normal browser cannot validate the Serverless bridge.

The first npm install creates package-lock.json: inspect and commit it after successful dependency resolution, then use npm ci for reproducible installs. No fabricated lockfile or prebuilt assets are included.

## Validation status and regression checklist

The authoring assistant has not executed npm install/build, browser tests or deployment. These are reviewable sources, not a verified production build.

Before accepting stage 2, test real Telegram iOS/Android/Desktop with student and assistant accounts: archive search, multiple pages and empty pages after deletion; edit text/date with collision rejection; original history indices and restoration without changing attachments; inbox refresh/selection/drop; attach and send files; student file-type restrictions and five-pending/rate limits; approve replacing existing homework, reject/cancel; errors/timeouts without automatic write replay; correct permissions after changing streams; return to legacy. Test long texts, theme changes and safe areas.

The existing production service worker remains cache-first and can retain old preview HTML on later releases. No production caches are unregistered or deleted by the preview. A tested cache migration, remaining-screen migration and full regressions are required before switching production to React.
