FROM node:20-bookworm-slim

# better-sqlite3 may need to compile a native addon if no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Запуск под непривилегированным пользователем node (есть в образе).
# Каталог data принадлежит node, чтобы запись в БД работала из-под него.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

# Persist the SQLite database outside the image.
VOLUME ["/app/data"]
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
