FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATABASE_PATH=/app/data/ironlog.sqlite
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/index.mjs ./server/index.mjs
COPY --from=build /app/src/validation.ts ./src/validation.ts
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME /app/data
EXPOSE 3001
CMD ["node", "server/index.mjs"]
