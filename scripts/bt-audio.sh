#!/usr/bin/env bash
# Connect a paired Bluetooth speaker and make it the default audio output.
# Never fails the caller: if there is no paired speaker, or it cannot be reached,
# it prints why and exits 0 so the default output (headphone jack / HDMI) is used.
#
# Environment overrides:
#   BT_SPEAKER=...   MAC address, or part of the device name, to use. Default:
#                    the first paired device that supports audio output.
#   BT_WAIT=15       seconds to wait for the speaker's audio output to appear

set -u

log() { echo "bluetooth-audio: $*"; }

for tool in bluetoothctl pactl; do
  command -v "$tool" >/dev/null || { log "$tool not found, skipping"; exit 0; }
done

# pactl talks to PipeWire through a socket under the user's runtime dir, which is
# missing from the environment when this runs over SSH.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

run_limited() { # run_limited SECONDS COMMAND...
  local secs="$1"; shift
  if command -v timeout >/dev/null; then timeout "$secs" "$@"; else "$@"; fi
}

lower() { tr '[:upper:]' '[:lower:]'; }

# Print the MAC of the wanted paired audio device, if any.
find_speaker() {
  local want mac name
  want="$(echo "${BT_SPEAKER:-}" | lower)"
  while read -r _ mac name; do
    if [ -n "$want" ] && ! echo "$mac $name" | lower | grep -qF -- "$want"; then
      continue
    fi
    bluetoothctl info "$mac" 2>/dev/null | grep -q "Audio Sink" || continue
    echo "$mac"
    return
  done < <(bluetoothctl devices Paired 2>/dev/null)
}

MAC="$(find_speaker)"
if [ -z "$MAC" ]; then
  log "no paired Bluetooth speaker${BT_SPEAKER:+ matching '$BT_SPEAKER'}, using the default output"
  exit 0
fi
NAME="$(bluetoothctl info "$MAC" | sed -n 's/^[[:space:]]*Name: //p' | head -n 1)"

bluetoothctl power on >/dev/null 2>&1
if bluetoothctl info "$MAC" | grep -q "Connected: yes"; then
  log "${NAME:-$MAC} is already connected"
else
  log "connecting to ${NAME:-$MAC} ($MAC)"
  run_limited 20 bluetoothctl connect "$MAC" >/dev/null 2>&1
fi

# The audio output shows up as "bluez_output.<MAC with underscores>..." once the
# A2DP profile is up, which can take a few seconds after the connection.
MAC_UNDERSCORE="$(echo "$MAC" | tr ':' '_')"
SINK=""
for _ in $(seq 1 "${BT_WAIT:-15}"); do
  SINK="$(pactl list short sinks 2>/dev/null | awk '{print $2}' | grep -iF "bluez_output.${MAC_UNDERSCORE}" | head -n 1)"
  [ -n "$SINK" ] && break
  sleep 1
done

if [ -z "$SINK" ]; then
  log "${NAME:-$MAC} did not provide an audio output (is it on and in range?), using the default output"
  exit 0
fi

pactl set-default-sink "$SINK" && log "default output set to ${NAME:-$MAC} ($SINK)"
exit 0
