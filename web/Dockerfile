FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build:console && pnpm run build:admin

FROM nginx:1.27-alpine
COPY nginx.main.conf /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/console /usr/share/nginx/console
COPY --from=build /app/dist/admin /usr/share/nginx/admin
EXPOSE 80 81
