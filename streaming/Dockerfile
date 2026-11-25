# Single-container streaming image for Render Free (a Web Service can run only one container and
# receives public traffic on one HTTP port). It runs Liquidsoap + Icecast + a small public gateway.
#
#   Build context: streaming/        (Render: Dockerfile path ./streaming/Dockerfile, context ./streaming)
#   Local Docker Compose does NOT use this file: it keeps its own two containers
#   (streaming/icecast/Dockerfile and the savonet/liquidsoap image).
#
# Public:  0.0.0.0:$PORT (default 10000)  ->  /radio.mp3, /status-json.xsl, /healthz, POST /control/{skip,reload}
# Private: Icecast 127.0.0.1:8000, Liquidsoap control/health 127.0.0.1:1234.

# Liquidsoap 2.4.6 (Debian 13), the same version as local Compose.
FROM savonet/liquidsoap:v2.4.6

USER root
# Debian 13 packages (versions are recorded in the build log): Icecast 2.4.4 (the same 2.4 line as the
# local Alpine image), nginx 1.26 (gateway), tini (PID 1: signals + zombie reaping), gettext-base
# (envsubst). CA certificates are already present; Liquidsoap verifies HTTPS with them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      icecast2=2.4.4-* nginx-light=1.26.* tini=0.19.* gettext-base \
 && rm -rf /var/lib/apt/lists/* \
 # icecast.xml.template uses the Alpine path /usr/share/icecast; Debian installs it as icecast2.
 && ln -s /usr/share/icecast2 /usr/share/icecast \
 && mkdir -p /opt/radio /var/icecast /tmp/radio-runtime \
 && chown liquidsoap:liquidsoap /var/icecast /tmp/radio-runtime \
 && icecast2 -v | head -1 && nginx -v && liquidsoap --version | head -1

# Everything the container needs is copied in: no host mounts, no music files, no disk.
COPY liquidsoap/radio.liq /opt/radio/radio.liq
COPY icecast/icecast.xml.template /opt/radio/icecast.xml.template
COPY production/nginx.conf.template /opt/radio/nginx.conf.template
COPY --chmod=755 production/entrypoint.sh production/healthcheck.sh /opt/radio/

# No root at runtime.
USER liquidsoap
ENV PORT=10000
EXPOSE 10000

# Used by local `docker run` (Render uses its own health check path: /healthz).
HEALTHCHECK --interval=15s --timeout=6s --start-period=40s --retries=3 CMD ["/opt/radio/healthcheck.sh"]

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/radio/entrypoint.sh"]
CMD []
