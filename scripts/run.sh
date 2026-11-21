#!/usr/bin/env bash
# Start the Exercise Timer server and a kiosk Chromium. Safe to re-run: any
# server already running from this project and any running Chromium are stopped
# first, then both are started again.
#
# Environment overrides:
#   PORT=5000        server port
#   ALLOW_QUIT=1     show the in-app Exit button (set to 0 to hide it)
#   RELOAD=1         restart the server when a Python file changes (development)
#   CHROMIUM=...     browser command (default: chromium, then chromium-browser)
#   NO_BROWSER=1     start only the server

set -u

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5000}"
URL="http://127.0.0.1:${PORT}"
LOG="${APP_DIR}/data/server.log"

if [ -x "${APP_DIR}/.venv/bin/python" ]; then
  PYTHON="${APP_DIR}/.venv/bin/python"
else
  PYTHON="$(command -v python3)"
fi

# Run a command detached from this shell so it survives the terminal or SSH session closing.
detach() {
  if command -v setsid >/dev/null; then setsid nohup "$@"; else nohup "$@"; fi
}

pick_browser() {
  if [ -n "${CHROMIUM:-}" ]; then echo "$CHROMIUM"; return; fi
  command -v chromium || command -v chromium-browser
}

# Working directory of a process (Linux first, lsof for macOS).
cwd_of() {
  readlink "/proc/$1/cwd" 2>/dev/null \
    || lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'
}

# PIDs of "python ... app.py" processes whose working directory is this project.
# With RELOAD=1 this finds both the reloader parent and its child.
server_pids() {
  local pid
  for pid in $(pgrep -f 'app\.py'); do
    [ "$pid" = "$$" ] && continue
    [ "$(cwd_of "$pid")" = "$APP_DIR" ] && echo "$pid"
  done
}

stop_server() {
  local pids
  pids="$(server_pids)"
  [ -z "$pids" ] && return
  echo "Stopping running server (PID: $(echo $pids))"
  kill $pids 2>/dev/null
  for _ in $(seq 1 50); do
    [ -z "$(server_pids)" ] && return
    sleep 0.1
  done
  echo "Server did not stop in 5 s, sending SIGKILL"
  kill -9 $(server_pids) 2>/dev/null
}

stop_browser() {
  # A new chromium started while another is running just opens a window in the
  # old process and ignores the kiosk flags, so close it first.
  pkill -x chromium 2>/dev/null
  pkill -x chromium-browser 2>/dev/null
  for _ in $(seq 1 50); do
    pgrep -x chromium >/dev/null || pgrep -x chromium-browser >/dev/null || return 0
    sleep 0.1
  done
}

wait_for_server() {
  for _ in $(seq 1 100); do
    curl -fs -o /dev/null --max-time 1 "${URL}/api/config" && return 0
    sleep 0.2
  done
  return 1
}

stop_server
mkdir -p "${APP_DIR}/data"

echo "Starting server on ${URL}"
(
  cd "$APP_DIR" || exit 1
  PORT="$PORT" ALLOW_QUIT="${ALLOW_QUIT:-1}" RELOAD="${RELOAD:-}" \
    detach "$PYTHON" app.py >"$LOG" 2>&1 &
)

if ! wait_for_server; then
  echo "Server did not come up. Last log lines (${LOG}):" >&2
  tail -n 20 "$LOG" >&2
  exit 1
fi

if [ "${NO_BROWSER:-0}" = "1" ]; then
  echo "Server running; browser not started (NO_BROWSER=1)."
  exit 0
fi

BROWSER="$(pick_browser)"
if [ -z "$BROWSER" ]; then
  echo "Chromium not found. Server is running at ${URL}." >&2
  exit 1
fi

stop_browser

# When run over SSH there is no desktop session in the environment, so point
# Chromium at the Wayland display of the logged-in user.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

echo "Starting browser: ${BROWSER}"
detach "$BROWSER" --kiosk --noerrdialogs --disable-infobars \
  --password-store=basic --autoplay-policy=no-user-gesture-required \
  --touch-events=enabled "$URL" >/dev/null 2>&1 &

echo "Done. Server log: ${LOG}"
