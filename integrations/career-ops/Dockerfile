# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f AS runtime-base
ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git tini poppler-utils \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --prefix /opt/codex --omit=dev --no-audit --no-fund @openai/codex@0.166.0 \
    && mkdir -p /opt/codex/bin \
    && ln -s /opt/codex/node_modules/.bin/codex /opt/codex/bin/codex

FROM runtime-base AS dependencies
ADD --checksum=sha256:31269350d74d62d33a93fc6b950f770569c661c16a64c657f31fcfcd0f94cd04 https://codeload.github.com/career-ops-hq/career-ops/tar.gz/9170fed51af6894753a9f520074529d15e38a004 /tmp/career-ops.tar.gz
RUN mkdir -p /opt/career-ops && tar -xzf /tmp/career-ops.tar.gz --strip-components=1 -C /opt/career-ops \
    && rm /tmp/career-ops.tar.gz
WORKDIR /opt/career-ops
COPY dependencies/package-lock.json ./package-lock.json
RUN npm ci --no-audit --no-fund
WORKDIR /opt/career-ops/web
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY . /opt/pilot-integration
RUN --network=none CAREER_OPS_TEST_SOURCE=/opt/career-ops node --test \
    /opt/pilot-integration/patch-source.test.mjs \
    /opt/pilot-integration/fit.test.mjs \
    /opt/pilot-integration/launcher/launcher.test.mjs \
    /opt/pilot-integration/discovery/geo.test.mjs
RUN node /opt/pilot-integration/patch-source.mjs /opt/career-ops
RUN npm run build

FROM build AS app
ENV NODE_ENV=production \
    HOME=/state \
    CAREER_OPS_CODE_ROOT=/opt/career-ops \
    CAREER_OPS_ROOT=/data \
    CAREER_OPS_DATA_DIR=/data \
    CAREER_OPS_CLI=codex \
    CAREER_OPS_CODEX_HOME=/state/codex \
    TZ=Europe/Prague
RUN mkdir -p /data /state/codex /opt/career-ops-style \
    && cp /opt/pilot-integration/skills/humanizer.md /opt/career-ops-style/humanizer.md \
    && chown -R 1000:1000 /data /state
COPY entrypoint.sh /usr/local/bin/career-ops-entrypoint
RUN chmod 755 /usr/local/bin/career-ops-entrypoint
# The integration supplies a wrapper; its real binary remains under /opt/codex.
COPY launcher/ /opt/career-ops-launcher/
RUN ln -s /opt/career-ops-launcher/codex.mjs /usr/local/bin/codex
USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/career-ops-entrypoint"]
CMD ["node", "/opt/career-ops/web/server.mjs", "start", "--port", "3000"]
