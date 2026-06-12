# Task Controller

Личный трекер задач продакт-менеджера. Заменяет «Избранное» в Telegram: стримы (проекты),
план «Сегодня» с переносом незавершённого, заметки/контекст по задачам, утреннее ревью и
разбор свободного текста в задачи (через Claude, опционально).

Стек: **Node + Express + SQLite** (better-sqlite3), фронтенд — статичный SPA (vanilla JS), вход по паролю.

## Запуск локально

```bash
cp .env.example .env        # задайте APP_PASSWORD и SESSION_SECRET
npm install
npm start                   # http://localhost:3000
```

`npm run dev` — то же с авто-перезапуском (`node --watch`).

База данных создаётся автоматически в `data/task-controller.sqlite` (каталог `data/` в `.gitignore`).

## Просмотр базы данных

```bash
npm run db:dump            # вывести таблицы в консоль (только чтение, безопасно при работающем app)
npm run db:dump tasks      # только задачи (с именем стрима)
npm run db                 # интерактивный sqlite3 (нужен установленный sqlite3 CLI)
```

В Docker — то же через контейнер:
```bash
docker compose exec app node scripts/db-dump.js
```

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `APP_PASSWORD` | Пароль на вход. Если пуст — вход открыт (только для локали). |
| `SESSION_SECRET` | Секрет для подписи cookie-сессии. Задайте длинную случайную строку. |
| `PORT` | Порт (по умолчанию 3000). |
| `ANTHROPIC_API_KEY` | Ключ Claude. Если задан — «Разобрать из текста» использует Claude; иначе — простая эвристика. |
| `ANTHROPIC_MODEL` | Модель (по умолчанию `claude-opus-4-8`). |
| `DB_PATH` | Путь к файлу БД (по умолчанию `data/task-controller.sqlite`). |

## Деплой на VPS (Docker + Caddy + HTTPS)

Пошаговая инструкция — в **[DEPLOY.md](DEPLOY.md)**. Коротко (на сервере, в папке проекта):

```bash
cp .env.example .env   # заполнить APP_PASSWORD, SESSION_SECRET, DOMAIN, CADDY_EMAIL
docker compose up -d --build
```

`docker-compose.yml` поднимает само приложение и Caddy, который автоматически получает
и продлевает TLS-сертификат Let's Encrypt для домена из `DOMAIN`. База в `./data` переживает
пересборки. Обновление: `git pull && docker compose up -d --build`.

Только образ приложения, без прокси (контейнер работает под non-root, БД — в именованном томе):
```bash
docker build -t task-controller .
docker run -d -p 3000:3000 --env-file .env -v tc_data:/app/data task-controller
```

## Поведение

- **Ежедневный перенос.** При первом открытии в новый календарный день все задачи выходят из плана
  «Сегодня»; незавершённые всплывают в утреннем ревью как перенесённые (счётчик ↻).
- **AI-разбор приватность.** Запрос к Claude уходит только при явном нажатии «Распознать задачи»,
  и только тот текст, что вы ввели. Без `ANTHROPIC_API_KEY` всё работает на локальной эвристике.

## Структура

```
server.js          — Express: auth, REST API, статика
src/db.js          — схема SQLite, сериализация, ежедневный перенос
src/ai.js          — разбор текста в задачи через Claude (опционально)
public/index.html  — разметка + стили
public/app.js      — клиентская логика (работа с API)
REQUIREMENTS.md    — требования к сервису
prototype.html     — исходный кликабельный прототип (без бэкенда)
```
