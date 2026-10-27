FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Write runtime config from REACT_APP_API_BASE_URL (set on the container app) at container start.
RUN printf '#!/bin/sh\nif [ -n "$REACT_APP_API_BASE_URL" ]; then\n  echo "window.__CONFIG__ = { apiBaseUrl: \\"$REACT_APP_API_BASE_URL\\" };" > /usr/share/nginx/html/config.js\nfi\n' > /docker-entrypoint.d/40-runtime-config.sh && \
    chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
