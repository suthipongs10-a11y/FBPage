# apps/api — NestJS API (multi-stage, pnpm workspace)
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/facebook-core/package.json packages/facebook-core/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/youtube-core/package.json packages/youtube-core/
COPY packages/web-core/package.json packages/web-core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @fbpm/api...

FROM deps AS build
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY packages/facebook-core packages/facebook-core
COPY packages/ai-core packages/ai-core
COPY packages/youtube-core packages/youtube-core
COPY packages/web-core packages/web-core
COPY apps/api apps/api
RUN pnpm --filter @fbpm/shared build \
 && pnpm --filter @fbpm/database build \
 && pnpm --filter @fbpm/ai-core build \
 && pnpm --filter @fbpm/facebook-core build \
 && pnpm --filter @fbpm/youtube-core build \
 && pnpm --filter @fbpm/web-core build \
 && pnpm --filter @fbpm/api build \
 && pnpm --filter @fbpm/api... deploy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Media service (§63): Chromium + ฟอนต์ไทยสำหรับเรนเดอร์การ์ดภาพ
RUN apk add --no-cache chromium font-noto-thai ttf-freefont && mkdir -p /app/data/media && chown -R node:node /app
ENV CHROME_BIN=/usr/bin/chromium-browser MEDIA_DIR=/app/data/media
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/database/prisma ./prisma
USER node
EXPOSE 4000
# รัน migration ก่อนเปิดบริการ (idempotent)
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/main.js"]
