FROM node:20-bookworm-slim

# better-sqlite3 may need to compile a native addon if no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Persist the SQLite database outside the image.
VOLUME ["/app/data"]
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
