FROM node:22-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY sdk/package.json ./sdk/package.json
COPY web/package.json ./web/package.json
RUN npm ci
COPY sdk/ ./sdk/
COPY web/ ./web/
COPY src/domain/rfc3161.mjs src/domain/rfc3161.d.mts /app/src/domain/
RUN npm --prefix web run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts/migrate.mjs ./scripts/migrate.mjs
COPY migrations ./migrations
COPY config/authorization-policy.public-beta.json ./config/authorization-policy.public-beta.json
COPY --from=web-build /app/web/dist ./web/dist
RUN addgroup -S priorseal && adduser -S -G priorseal priorseal
USER priorseal
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/bootstrap/http-server.mjs"]
