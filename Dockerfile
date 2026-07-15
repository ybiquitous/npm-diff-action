FROM node:26-alpine

WORKDIR /app

COPY package*.json /app/
COPY lib/* /app/lib/

RUN npm install --global npm@latest && \
    npm ci --ignore-scripts --omit=dev --engine-strict=true

ENTRYPOINT ["node", "/app/lib/index.js"]
