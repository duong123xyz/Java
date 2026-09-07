#!/usr/bin/env sh
export MP_HOST="${MP_HOST:-0.0.0.0}"
export MP_PORT="${MP_PORT:-14445}"
export MP_HTTP_PORT="${MP_HTTP_PORT:-14446}"
exec node server.mjs
