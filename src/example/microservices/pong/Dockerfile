FROM node:20

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --only=production

CMD [ "node", "dist/src/test_service/server.js" ]
