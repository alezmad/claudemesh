# Telegram bridge for claudemesh
# Node 22 runtime with tsx for TypeScript execution

FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

ENV NODE_ENV=production

CMD ["npx", "tsx", "src/index.ts"]
