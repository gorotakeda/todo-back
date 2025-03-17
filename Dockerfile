FROM node:18

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npm install @nestjs/websockets @nestjs/platform-socket.io socket.io

COPY . .

RUN npx prisma generate

# ここを8080に変更
EXPOSE 8080

# 環境変数PORTを使用するように修正
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:dev -- --port ${PORT:-8080}"]

