# syntax=docker/dockerfile:1.7
# One image, two roles: `web` (Next.js) and `worker` (BullMQ scheduler/generation/publishing).
FROM node:25-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fontconfig openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production
# version shown in the dashboard and /api/health (set by scripts/update.sh)
ARG GIT_SHA=dev
ARG BUILD_TIME=
ENV APP_VERSION=$GIT_SHA APP_BUILD_TIME=$BUILD_TIME
RUN groupadd -r app && useradd -r -g app -d /app app
COPY --from=build --chown=app:app /app /app
RUN mkdir -p /data/media && chown -R app:app /data
USER app
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
