FROM node:18

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npm install @nestjs/websockets @nestjs/platform-socket.io socket.io

COPY . .

RUN npx prisma generate

EXPOSE 8000

CMD ["npm", "run", "start:dev"]
