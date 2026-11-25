#!/bin/bash
# Container health: GET /healthz on this container's public port; healthy only on HTTP 200
# (Liquidsoap is alive and Icecast lists the station's mount). Uses bash's /dev/tcp: no curl needed.
exec 3<>"/dev/tcp/127.0.0.1/${PORT:-10000}" || exit 1
printf 'GET /healthz HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3
IFS= read -r -t 5 status <&3 || exit 1
[[ "$status" == HTTP/*" 200 "* ]]
