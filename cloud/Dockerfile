FROM node:24-bookworm-slim AS disk
WORKDIR /opt/manxu
COPY cloud/package.json package.json
COPY cloud/server.mjs cloud/storage.mjs cloud/
COPY services/api.cjs services/
COPY src/portable.js src/
RUN install -d -o node -g node -m 700 /data/backups
USER node
ENV HOST=0.0.0.0 PORT=8080 BACKUP_DRIVER=disk BACKUP_DIR=/data/backups
EXPOSE 8080
CMD ["node", "cloud/server.mjs"]

FROM disk AS cos
USER root
COPY cloud/package.json cloud/package-lock.json cloud/
RUN npm ci --prefix cloud --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
ENV BACKUP_DRIVER=cos
USER node
