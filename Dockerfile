FROM node:lts-alpine

ENV TZ=Asia/Shanghai

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

CMD ["npm", "run", "start"]
