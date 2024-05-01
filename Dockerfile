FROM node:22-alpine

WORKDIR /app
COPY package*.json /app/
COPY lib/* /app/lib/
RUN npm ci --ignore-scripts --omit=dev

ENTRYPOINT ["node", "/app/lib/index.js"]
