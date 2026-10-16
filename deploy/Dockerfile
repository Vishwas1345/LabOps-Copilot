# syntax=docker/dockerfile:1

# One container for a host that offers a single free web service and no free
# background worker: the API, the worker and the web app run as three separate
# processes, so the worker still never serves HTTP. See docs/infra/DEPLOYMENT.md.

FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run prisma:generate -w @labops/api \
  && npm run build -w @labops/api \
  && npm run build -w @labops/web

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# tini as PID 1 forwards the platform's SIGTERM to the process group (-g) and
# reaps the children.
RUN apk add --no-cache tini

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
COPY --from=build /repo/node_modules/@prisma node_modules/@prisma
# The migration CLI is a dev dependency; boot applies migrations, so carry it.
COPY --from=build /repo/node_modules/prisma node_modules/prisma
COPY --from=build /repo/apps/web/.next apps/web/.next
COPY --from=build /repo/apps/web/public apps/web/public
COPY --from=build /repo/apps/web/next.config.mjs apps/web/next.config.mjs
COPY deploy/start.sh /usr/local/bin/start.sh

USER node
EXPOSE 10000
ENTRYPOINT ["/sbin/tini", "-g", "--"]
CMD ["/usr/local/bin/start.sh"]
