FROM alpine:3.22

# icecast: streaming server, gettext: envsubst for the config template, mailcap: /etc/mime.types
RUN apk add --no-cache icecast gettext mailcap \
 && mkdir -p /var/icecast \
 && chown icecast:icecast /var/icecast

COPY icecast.xml.template /etc/icecast/icecast.xml.template
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

USER icecast
EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
