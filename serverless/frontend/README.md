# React / Glisse: isolated first migration stage

This is an additive preview, NOT a completed migration and NOT a replacement for the production entrypoint. Existing `web/index.html`, backend, schema and service worker are unchanged.

## Implemented

- Actual React components from glisse 0.5.0: Button, Glass, Input and Switch, via shared wrappers.
- Day/week schedule, date navigation, subject/teacher search, favourites and personal notes.
- Homework list, done status, assistant add/delete and student proposals.
- Faculty/course/direction/stream selection, language start and reminders.
- Existing Telegram.WebApp.Serverless.call transport; no HTTP API replacement, initData substitution, SSR or separate Node runtime.
- Telegram themeChanged subscription, safe areas, haptic feedback and visible API errors.
- Session read cache scoped to Telegram user ID for range/subjects/subjectDates, one-hour TTL; never caches writes/bootstrap and never replays writes.

## Not migrated

Files and attachment actions, proposal moderation, homework editing/history/archive, schedule edits, subscription calendars, news, library, clubs, exams, admin and advanced settings remain in the original application. Preview clearly labels these limitations and links back to `../index.html`. This must not be described as a full migration.

## Requirements and build

Use Node >=22.12.0 and npm. From the repository root:

```sh
cd serverless/frontend
npm install
npm run build
```

Commit the generated package-lock.json after the first successful dependency resolution; subsequent reproducible installations should use npm ci. This commit does not include a fabricated lockfile or prebuilt assets. Vite emits files ONLY into `serverless/web/react/`; emptyOutDir is limited to that directory. Relative asset paths allow Telegram static hosting at a non-root URL. `tgcloud.jsonc` continues to publish `web`.

## Publish preview alongside production

```sh
cd ~/schedule-src
git checkout tgcloud
git pull --ff-only origin tgcloud
cd serverless/frontend
npm install
npm run build
cd ..
npx tgcloud push
```

Run the last command only in the already configured/authenticated Telegram Serverless project and verify the CLI account/project before pushing. It publishes existing backend plus static files according to the existing project configuration. No schema migration is introduced. If CLI setup is missing, use the project's existing scaffold/login procedure rather than creating a different bot.

Open `react/index.html` relative to the current Mini App static base URL inside Telegram Serverless. Keep the bot's production Mini App URL unchanged. Opening the page in a normal browser cannot test the Serverless bridge. Vite dev/preview only tests rendering without backend access.

## Validation status

No npm install, build, browser test or Telegram deployment has been executed by the authoring assistant. The source is a reviewable first stage, not a verified production build. Do not switch the root Mini App to this preview yet.

Before accepting: run npm install/build; test real Telegram iOS/Android/Desktop; verify course selection, day/week/search, theme changes, favourite/note persistence, homework permissions/add/delete/proposal/done, transport errors and return to legacy. Verify existing service worker behaviour: it is cache-first and can retain an older preview HTML on subsequent releases. This preview does not unregister or erase production caches. Before a production cutover, design and test a service-worker migration, complete all remaining screens and run regression tests.
