# Деплой Task Controller на VPS (Docker + Caddy + HTTPS)

Результат: приложение доступно по адресу `https://твой-домен`, с автоматическим
TLS-сертификатом, автозапуском после перезагрузки и базой данных, которая переживает
обновления контейнера. После этого им можно пользоваться с телефона.

Понадобится: VPS (Hetzner, Timeweb, Selectel, любой), домен или поддомен.

---

## 1. Завести VPS и домен

1. Создай самый дешёвый VPS (1–2 ГБ RAM достаточно), ОС — **Ubuntu 22.04/24.04**.
   Запиши его публичный IP.
2. В DNS своего домена добавь **A-запись** на поддомен → IP сервера. Например:
   `tasks.твойдомен.ru  →  203.0.113.10`.
   Подожди несколько минут, пока запись распространится (проверить: `ping tasks.твойдомен.ru`).

> Без домена HTTPS от Let's Encrypt не выдаётся. Если домена нет — можно купить
> дешёвый или взять бесплатный поддомен (например, на DuckDNS).

## 2. Поставить Docker на сервер

Подключись по SSH (`ssh root@IP`) и выполни:

```bash
curl -fsSL https://get.docker.com | sh
```

Проверь: `docker --version` и `docker compose version`.

## 3. Скопировать проект на сервер

Вариант А — через git (если положишь проект в репозиторий):
```bash
git clone <твой-репозиторий> task-controller
cd task-controller
```

Вариант Б — скопировать с ноутбука напрямую (без git), исключая лишнее:
```bash
# выполняется на ЛОКАЛЬНОЙ машине, из папки проекта
rsync -av --exclude node_modules --exclude data --exclude .env \
  ./ root@IP:/root/task-controller/
```

## 4. Создать .env на сервере

```bash
cd task-controller
cp .env.example .env
nano .env
```

Заполни:
- `APP_PASSWORD` — пароль на вход;
- `SESSION_SECRET` — длинная случайная строка (сгенерируй: `openssl rand -hex 32`);
- `DOMAIN` — твой поддомен (`tasks.твойдомен.ru`), **без** `https://`;
- `CADDY_EMAIL` — твой email (желательно);
- `ANTHROPIC_API_KEY` — по желанию, для разбора текста через Claude.

## 5. Запустить

```bash
docker compose up -d --build
```

Caddy сам получит TLS-сертификат для домена (займёт ~10–30 секунд при первом запуске).
Открой `https://tasks.твойдомен.ru` — увидишь экран входа.

Проверить логи, если что-то не так:
```bash
docker compose logs -f          # все сервисы
docker compose logs -f caddy    # отдельно прокси (тут видно проблемы с сертификатом)
```

## 6. Открыть порты (если есть фаервол)

Должны быть открыты **80** и **443** (80 нужен Let's Encrypt для проверки домена). На Ubuntu с ufw:
```bash
ufw allow 80
ufw allow 443
ufw allow OpenSSH
ufw enable
```

---

## Обновление после изменений в коде

```bash
git pull            # или повторный rsync
docker compose up -d --build
```

База в `./data` сохраняется между пересборками.

## Бэкап базы

База лежит в Docker-томе `appdata`. Скопировать файл наружу (можно по cron):
```bash
mkdir -p ~/backups
docker compose cp app:/app/data/task-controller.sqlite ~/backups/tc-$(date +%F).sqlite
```

Восстановление — обратной командой при остановленном `app`:
```bash
docker compose stop app
docker compose cp ~/backups/tc-2026-06-12.sqlite app:/app/data/task-controller.sqlite
docker compose start app
```

## Частые проблемы

- **Сертификат не выдаётся** — проверь, что A-запись указывает на этот сервер и порт 80 открыт. Смотри `docker compose logs caddy`.
- **502 Bad Gateway** — упал контейнер `app`: `docker compose logs app`.
- **Не пускает по паролю** — `APP_PASSWORD` не попал в окружение; проверь `.env` и пересоздай: `docker compose up -d`.
