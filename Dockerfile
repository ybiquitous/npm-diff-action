FROM node:16-alpine as build

COPY package*.json /
COPY lib/* /lib/
RUN npm ci --ignore-scripts && \
    npm run build

FROM node:16-alpine

COPY --from=build dist/* /

ENTRYPOINT ["node", "/index.js"]
