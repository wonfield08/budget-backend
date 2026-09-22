# syntax=docker/dockerfile:1

# Using the full (non-slim) bookworm image because it already ships OpenSSL,
# which Prisma's query engine needs at runtime. The slim image doesn't, and
# apt-get install-ing it requires reaching deb.debian.org, which some
# networks (campus/corporate firewalls that block outbound port 80) can't do.
FROM node:20-bookworm AS builder
WORKDIR /app

COPY package*.json ./
# Cache mount persists npm's package cache across builds (even when the layer
# above is invalidated by a package.json change), so re-deploys after a code
# change don't re-download the whole dependency tree from the registry again.
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npx prisma generate
RUN npm run build
# Drop devDependencies now that the build is done, so production only ships
# (and only ever had to install once) what it actually runs.
RUN npm prune --omit=dev

# ---- production stage ----
FROM node:20-bookworm AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY package*.json ./
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/main"]
