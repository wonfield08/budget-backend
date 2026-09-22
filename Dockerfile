# ---- build stage ----
# Using the full (non-slim) bookworm image because it already ships OpenSSL,
# which Prisma's query engine needs at runtime. The slim image doesn't, and
# apt-get install-ing it requires reaching deb.debian.org, which some networks
# (campus/corporate firewalls that block outbound port 80) can't do.
FROM node:20-bookworm AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ---- production stage ----
FROM node:20-bookworm AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/main"]
