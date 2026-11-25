#!/bin/bash
# Supervisor for the single-container Render deployment: Icecast + Liquidsoap + the public gateway.
#
# - Validates the configuration and renders the Icecast and nginx configs into a private runtime dir
#   (secrets stay in memory/runtime files, are never printed, and are not part of the image).
# - Starts Icecast (loopback only), waits for it, starts the gateway on 0.0.0.0:$PORT, then Liquidsoap.
# - Monitors all three: Liquidsoap is restarted in place (bounded); if Icecast or the gateway dies, or
#   Liquidsoap keeps failing, everything is stopped and the container exits non-zero so Render restarts it.
# - SIGTERM/SIGINT (Render's shutdown) stop all children, then exit 0.
# Runs as the unprivileged `liquidsoap` user (no root, no capabilities needed: ports are above 1024).
set -uo pipefail

APP_DIR=/opt/radio
RUNTIME_DIR="${RUNTIME_DIR:-/tmp/radio-runtime}"
ICECAST_PORT=8000          # fixed in icecast.xml.template; loopback only
LIQUIDSOAP_CONTROL_PORT="${LIQUIDSOAP_CONTROL_PORT:-1234}"   # Liquidsoap's control/health port; loopback only
PORT="${PORT:-10000}"      # the ONE public port (Render sets it; default 10000)

log() { printf '%s supervisor: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { printf 'entrypoint: %s\n' "$*" >&2; exit 1; }

# ---- configuration ----------------------------------------------------------------------------------

# Required, and not one of the placeholder values from the .env examples. Never echoes the value.
need() {
  local name=$1 value=${!1:-}
  [ -n "$value" ] || fail "$name must be set"
  case "$value" in
    *CHANGE_ME*|*REPLACE_WITH*|*YOUR_*|*PLACEHOLDER*) fail "$name must be set to a real value" ;;
  esac
}

# Values that end up in XML or HTTP headers: letters, digits and . _ ~ - only (no quotes, spaces, < > &).
safe() {
  case "${!1}" in
    ''|*[!A-Za-z0-9._~-]*) fail "$1 may contain only letters, digits, '.', '_', '~' and '-'" ;;
  esac
}

need API_INTERNAL_URL
need STREAM_INTERNAL_TOKEN
need LIQUIDSOAP_CONTROL_TOKEN
case "$API_INTERNAL_URL" in
  https://*|http://*) ;;
  *) fail "API_INTERNAL_URL must start with https:// (or http:// for local tests)" ;;
esac
API_INTERNAL_URL="${API_INTERNAL_URL%/}"
for var in STREAM_INTERNAL_TOKEN LIQUIDSOAP_CONTROL_TOKEN; do
  value=${!var}
  [ "${#value}" -ge 32 ] || fail "$var must be at least 32 characters"
  safe "$var"
done
[ "$PORT" -ge 1024 ] 2>/dev/null && [ "$PORT" -le 65535 ] || fail "PORT must be a number between 1024 and 65535"
[ "$PORT" -ne "$ICECAST_PORT" ] && [ "$PORT" -ne "$LIQUIDSOAP_CONTROL_PORT" ] || fail "PORT must differ from the internal ports"

# Icecast's three passwords are only ever used inside this container (the admin and source
# interfaces are not routed), so they are generated per start unless supplied.
random_secret() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
ICECAST_SOURCE_PASSWORD="${ICECAST_SOURCE_PASSWORD:-$(random_secret)}"
ICECAST_ADMIN_PASSWORD="${ICECAST_ADMIN_PASSWORD:-$(random_secret)}"
ICECAST_RELAY_PASSWORD="${ICECAST_RELAY_PASSWORD:-$(random_secret)}"
ICECAST_HOSTNAME="${ICECAST_HOSTNAME:-${RENDER_EXTERNAL_HOSTNAME:-localhost}}"
for var in ICECAST_SOURCE_PASSWORD ICECAST_ADMIN_PASSWORD ICECAST_RELAY_PASSWORD ICECAST_HOSTNAME; do
  safe "$var"
done

export PORT ICECAST_PORT LIQUIDSOAP_CONTROL_PORT RUNTIME_DIR API_INTERNAL_URL
export ICECAST_SOURCE_PASSWORD ICECAST_ADMIN_PASSWORD ICECAST_RELAY_PASSWORD ICECAST_HOSTNAME
export ICECAST_BIND_ADDRESS=127.0.0.1                       # Icecast: loopback only
export HARBOR_BIND_ADDR=127.0.0.1                           # Liquidsoap control/health: loopback only
export ICECAST_HOST=127.0.0.1 ICECAST_INTERNAL_PORT="$ICECAST_PORT"
export HARBOR_PORT="$LIQUIDSOAP_CONTROL_PORT"

# ---- runtime files (private to this user) ---------------------------------------------------------------

umask 077
rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR/tmp" /var/icecast || fail "cannot create $RUNTIME_DIR"
envsubst '${ICECAST_HOSTNAME} ${ICECAST_SOURCE_PASSWORD} ${ICECAST_ADMIN_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_BIND_ADDRESS}' \
  < "$APP_DIR/icecast.xml.template" > "$RUNTIME_DIR/icecast.xml" || fail "cannot render icecast.xml"
envsubst '${PORT} ${ICECAST_PORT} ${HARBOR_PORT} ${RUNTIME_DIR}' \
  < "$APP_DIR/nginx.conf.template" > "$RUNTIME_DIR/nginx.conf" || fail "cannot render nginx.conf"
nginx -t -c "$RUNTIME_DIR/nginx.conf" >/dev/null 2>"$RUNTIME_DIR/nginx-test.log" \
  || { cat "$RUNTIME_DIR/nginx-test.log" >&2; fail "nginx configuration is invalid"; }

# ---- process management -------------------------------------------------------------------------------------

declare -A NAMES=()     # pid -> name
STOPPING=0

start() {               # start <name> <command...>
  local name=$1; shift
  "$@" &
  NAMES[$!]=$name
  log "started $name (pid $!)"
}

stop_all() {            # TERM everything, give it 10 s, then KILL
  local pid i
  for pid in "${!NAMES[@]}"; do kill -TERM "$pid" 2>/dev/null; done
  for i in $(seq 1 50); do
    local alive=0
    for pid in "${!NAMES[@]}"; do kill -0 "$pid" 2>/dev/null && alive=1; done
    [ "$alive" -eq 0 ] && return 0
    sleep 0.2
  done
  for pid in "${!NAMES[@]}"; do kill -KILL "$pid" 2>/dev/null; done
}

on_signal() { STOPPING=1; log "received $1, shutting down"; }
trap 'on_signal TERM' TERM
trap 'on_signal INT' INT

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
wait_for_port() {       # wait_for_port <port> <seconds>
  local i
  for i in $(seq 1 $(($2 * 5))); do
    port_open "$1" && return 0
    [ "$STOPPING" -eq 1 ] && return 1
    sleep 0.2
  done
  return 1
}

start_liquidsoap() { start liquidsoap liquidsoap "$APP_DIR/radio.liq"; }

start icecast icecast2 -c "$RUNTIME_DIR/icecast.xml"
wait_for_port "$ICECAST_PORT" 30 || { stop_all; fail "Icecast did not start listening on 127.0.0.1:$ICECAST_PORT"; }
start gateway nginx -c "$RUNTIME_DIR/nginx.conf" -g 'daemon off;'
wait_for_port "$PORT" 15 || { stop_all; fail "the gateway did not start listening on 0.0.0.0:$PORT"; }
start_liquidsoap
log "up: gateway on 0.0.0.0:$PORT; Icecast and Liquidsoap control on 127.0.0.1 only"

# ---- monitor ------------------------------------------------------------------------------------------------------------

LIQUIDSOAP_MAX_RESTARTS=5     # within LIQUIDSOAP_WINDOW seconds, then give up and let Render restart the container
LIQUIDSOAP_WINDOW=600
restarts=()

while [ "$STOPPING" -eq 0 ]; do
  exited=""
  wait -n -p exited
  status=$?
  [ "$STOPPING" -eq 1 ] && break
  [ -n "$exited" ] || continue            # woken by a signal with nothing exited
  name=${NAMES[$exited]:-unknown}
  unset 'NAMES[$exited]'
  log "$name exited (status $status)"

  if [ "$name" = liquidsoap ]; then
    now=$(date +%s)
    recent=()
    for t in "${restarts[@]}"; do [ $((now - t)) -lt "$LIQUIDSOAP_WINDOW" ] && recent+=("$t"); done
    restarts=("${recent[@]}")
    if [ "${#restarts[@]}" -lt "$LIQUIDSOAP_MAX_RESTARTS" ]; then
      restarts+=("$now")
      log "restarting liquidsoap in 2 s (${#restarts[@]}/$LIQUIDSOAP_MAX_RESTARTS in the last ${LIQUIDSOAP_WINDOW}s)"
      sleep 2
      [ "$STOPPING" -eq 1 ] && break
      start_liquidsoap
      continue
    fi
    log "liquidsoap keeps failing; stopping so the container restarts"
  else
    log "$name is required; stopping so the container restarts"
  fi
  stop_all
  exit 1
done

stop_all
log "stopped"
exit 0
