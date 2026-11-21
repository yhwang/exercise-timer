# Exercise Timer

Touch-friendly workout timer for a Raspberry Pi with a 7" display (800×480).

- **Configure mode:** create, edit and delete routines. Each routine has a warm-up time, a list of sets (name, exercise seconds, rest seconds), an iteration count for the whole list of sets, and optional background music.
- **Play mode:** runs warm-up, then exercise and rest for each set, repeated for every iteration. It beeps at 3, 2 and 1 seconds before each phase ends. A higher tone marks the start of an exercise, and a lower tone marks the start of a rest. Music loops in the background. Pause, Skip, Stop and a music volume slider are available.

## Run

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py            # serves http://127.0.0.1:5000 (localhost only)
```

Put `.mp3`, `.ogg`, `.wav`, `.m4a` or `.flac` files in `music/`. They appear in the routine editor's Music list. Routines are saved to `data/routines.json`.

For development, `RELOAD=1 python app.py` restarts the server when a Python file changes. Files in `static/` are read from disk on every request, so just refresh the browser after editing them. `PORT=5001` changes the port (useful on macOS, where AirPlay uses 5000).

## Start script

`scripts/run.sh` starts the server (in the background, logging to `data/server.log`) and then opens Chromium in kiosk mode on it. Run it again at any time to restart: it stops the server already running from this project, and closes any running Chromium, before starting both again. It works from a terminal on the Pi, from SSH (it targets the Pi's `wayland-0` display), or from the labwc autostart.

```bash
./scripts/run.sh
```

Options are environment variables: `PORT` (default 5000), `ALLOW_QUIT=0` to hide the Exit button (it is on by default here), `RELOAD=1` for development, `CHROMIUM` to choose the browser command, and `NO_BROWSER=1` to restart only the server.

## Kiosk autostart on Raspberry Pi OS (Bookworm, labwc)

Add this to `~/.config/labwc/autostart`, adjusting the path:

```bash
/home/pi/exercise-timer/.venv/bin/python /home/pi/exercise-timer/app.py &
sleep 3
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --password-store=basic --autoplay-policy=no-user-gesture-required \
  --touch-events=enabled http://127.0.0.1:5000 &
```

Notes:
- Audio starts only after you tap Start, so browser autoplay rules are satisfied.
- Voice cues ("Warm up", "Exercise", "Rest", "Workout complete") are played from `static/voice/*.wav` right after each phase's start tone. To change them, replace those files with your own recordings, or regenerate them on macOS with `say -o x.aiff "Exercise" && afconvert -f WAVE -d LEI16@22050 -c 1 x.aiff static/voice/exercise.wav`. If a clip is missing, that cue is skipped.
- Exit kiosk mode with `Alt+F4`, or over SSH with `pkill chromium`.
- Exit button: start the server with `ALLOW_QUIT=1` (for example `ALLOW_QUIT=1 /home/pi/exercise-timer/.venv/bin/python /home/pi/exercise-timer/app.py &`) and an "Exit" button appears on the routine list. After a confirmation, the server runs `pkill -x chromium` (and `chromium-browser`), which closes the browser. The Flask server keeps running, and nothing relaunches Chromium unless your autostart or a service does. Without `ALLOW_QUIT=1` the button is hidden and `/api/quit` returns 404.
- Disable screen blanking in `raspi-config` → Display Options. The app also requests a screen wake lock while a routine runs.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
