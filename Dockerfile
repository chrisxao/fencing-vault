FROM node:22-bookworm-slim AS build
ARG VITE_INSTANT_APP_ID
ARG VITE_API_URL
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/instant.schema.ts ./
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
CMD ["npm", "start"]
