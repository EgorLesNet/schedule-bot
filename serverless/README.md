# schedule-bot на Telegram Serverless

Порт Python-бота на JS для Telegram Serverless + Mini App (PWA).

- tgcloud/ - бэкенд (handlers, endpoints, lib, schema.js)
- web/ - фронтенд Mini App (index.html, app.js, manifest, sw.js)

Деплой: npm create @tgcloud/bot, затем скопировать tgcloud/ и web/ в проект, npx tgcloud login, push, migrate. После первого push вписать URL Mini App в tgcloud/lib/config.js (APP_URL) и сделать push ещё раз.

Проверьте вызовы db/endpoint по docs/tgcloud-sdk.md из scaffold: все обращения к БД собраны в tgcloud/lib/store.js, а разбор пользователя в endpoint-ах - в tgcloud/lib/auth.js.
