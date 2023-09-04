FROM node:20-alpine

COPY package*.json /
COPY lib/* /lib/
RUN npm ci --ignore-scripts --omit=dev

ENTRYPOINT ["node", "/lib/index.js"]
