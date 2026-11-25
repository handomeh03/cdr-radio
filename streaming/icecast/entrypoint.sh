#!/bin/sh
# Renders icecast.xml from environment variables, then runs Icecast in the foreground.
set -eu

for var in ICECAST_HOSTNAME ICECAST_SOURCE_PASSWORD ICECAST_ADMIN_PASSWORD ICECAST_RELAY_PASSWORD; do
  eval "value=\${$var:-}"
  if [ -z "$value" ] || [ "$value" = "CHANGE_ME" ] || [ "${value#REPLACE_WITH}" != "$value" ]; then
    echo "entrypoint: $var must be set to a real value" >&2
    exit 1
  fi
  # Values are inserted into XML: allow only safe characters.
  case "$value" in
    *[!A-Za-z0-9._-]*)
      echo "entrypoint: $var may contain only letters, digits, '.', '_' and '-'" >&2
      exit 1
      ;;
  esac
done

# Listen on all container interfaces (the published port is what limits access locally).
ICECAST_BIND_ADDRESS="${ICECAST_BIND_ADDRESS:-0.0.0.0}"
export ICECAST_BIND_ADDRESS

envsubst '${ICECAST_HOSTNAME} ${ICECAST_SOURCE_PASSWORD} ${ICECAST_ADMIN_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_BIND_ADDRESS}' \
  < /etc/icecast/icecast.xml.template > /var/icecast/icecast.xml
chmod 600 /var/icecast/icecast.xml

exec icecast -c /var/icecast/icecast.xml
