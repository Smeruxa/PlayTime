# PlayTime

Мессенджер со сквозным шифрованием переписки, комнатами, голосовыми звонками и демонстрацией экрана.

[Веб-клиент](https://smeruxa.ru/playtime/app/) · [Скачать приложение](https://smeruxa.ru/playtime/)

## Локальный запуск

Нужны Node.js 24, PostgreSQL и Redis.

```sh
npm ci
npm ci --prefix apps
cp -n apps/env.example apps/.env
```

В `apps/.env` укажите параметры PostgreSQL, `REDIS_URL` и случайный `JWT_SECRET_ENV` от 32 символов (`openssl rand -hex 32`). Для веб-клиента задайте `CORS_ORIGIN=http://127.0.0.1:4176`. Для пустой локальной базы используйте те же параметры подключения, что и в `apps/.env`.

```sh
createdb -h localhost -U postgres playtime
psql -h localhost -U postgres -d playtime -v ON_ERROR_STOP=1 -f apps/database/schema.sql
SKIP_SITE_BUILD=1 npm run dev:services
```

В другом терминале запустите `npm run web:dev` и откройте [веб-клиент](http://127.0.0.1:4176/playtime/app/).

## Код

- `apps/frontend` — веб и Electron, `apps/site` — лендинг и админка.
- `apps/gateway`, `apps/auth-api`, `apps/chat-api`, `apps/room-api` — серверные приложения.
- `mobile` — Android-клиент на React Native и Kotlin.

## Проверки

```sh
npm run codecheck
npm run typecheck:services
npm run test:security
```

Для интеграционных тестов запустите Docker, установите Chromium через `npx playwright install chromium` и выполните `npm run test:services`.

[Конфигурация K3s](deploy/k8s/k3s-git.yaml) · [Манифесты Kubernetes](deploy/k8s/two-vps/) · [MIT](LICENSE)
