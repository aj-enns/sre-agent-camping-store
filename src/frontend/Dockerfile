FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/build ./build
COPY server ./server
RUN mkdir /app/data && chown node:node /app/data
USER node

EXPOSE 80
CMD ["node", "server/index.mjs"]
