"""Exercise timer backend: stores routines and serves the UI and music files."""
import json
import logging
import os
import re
import tempfile
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_FILE = DATA_DIR / "routines.json"
MUSIC_DIR = BASE_DIR / "music"
STATIC_DIR = BASE_DIR / "static"
MUSIC_EXTENSIONS = {".mp3", ".ogg", ".wav", ".m4a", ".flac"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

DEFAULT_ROUTINES = [
    {
        "id": "sample",
        "name": "Sample workout",
        "warmup": 10,
        "iterations": 2,
        "music": "",
        "sets": [
            {"name": "Push-ups", "exercise": 30, "rest": 10},
            {"name": "Squats", "exercise": 30, "rest": 10},
        ],
    }
]

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024
logger = logging.getLogger("exercise-timer")


def _int(value, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError("integer out of range")
    return value


def _text(value, max_length):
    if not isinstance(value, str):
        raise ValueError("expected string")
    return value.strip()[:max_length]


def validate_routine(raw):
    if not isinstance(raw, dict):
        raise ValueError("routine must be an object")
    routine_id = raw.get("id")
    if not isinstance(routine_id, str) or not ID_PATTERN.match(routine_id):
        raise ValueError("bad id")
    raw_sets = raw.get("sets")
    if not isinstance(raw_sets, list) or not 1 <= len(raw_sets) <= 50:
        raise ValueError("bad sets")
    sets = []
    for item in raw_sets:
        if not isinstance(item, dict):
            raise ValueError("set must be an object")
        sets.append(
            {
                "name": _text(item.get("name", ""), 60),
                "exercise": _int(item.get("exercise"), 1, 3600),
                "rest": _int(item.get("rest"), 0, 3600),
            }
        )
    return {
        "id": routine_id,
        "name": _text(raw.get("name", ""), 60) or "Routine",
        "warmup": _int(raw.get("warmup"), 0, 3600),
        "iterations": _int(raw.get("iterations"), 1, 100),
        "music": _text(raw.get("music", ""), 255),
        "sets": sets,
    }


def load_routines():
    if not DATA_FILE.exists():
        return DEFAULT_ROUTINES
    try:
        with DATA_FILE.open(encoding="utf-8") as handle:
            return [validate_routine(r) for r in json.load(handle)]
    except (OSError, ValueError):
        logger.error("Could not read routines file", exc_info=True)
        return DEFAULT_ROUTINES


def save_routines(routines):
    DATA_DIR.mkdir(exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(routines, handle, indent=2)
        os.replace(tmp_path, DATA_FILE)
    except OSError:
        os.unlink(tmp_path)
        raise


def list_music():
    if not MUSIC_DIR.is_dir():
        return []
    return sorted(
        p.name for p in MUSIC_DIR.iterdir() if p.is_file() and p.suffix.lower() in MUSIC_EXTENSIONS
    )


@app.after_request
def add_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; media-src 'self'; img-src 'self' data:"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


@app.get("/api/routines")
def get_routines():
    return jsonify(load_routines())


@app.put("/api/routines")
def put_routines():
    payload = request.get_json(silent=True)
    if not isinstance(payload, list) or len(payload) > 100:
        return jsonify({"error": "Invalid request"}), 400
    try:
        routines = [validate_routine(r) for r in payload]
        if len({r["id"] for r in routines}) != len(routines):
            raise ValueError("duplicate id")
        save_routines(routines)
    except ValueError:
        return jsonify({"error": "Invalid request"}), 400
    except OSError:
        logger.error("Could not save routines", exc_info=True)
        return jsonify({"error": "Could not save"}), 500
    return jsonify(routines)


@app.get("/api/music")
def get_music():
    return jsonify(list_music())


@app.get("/music/<path:name>")
def serve_music(name):
    if Path(name).suffix.lower() not in MUSIC_EXTENSIONS:
        abort(404)
    return send_from_directory(MUSIC_DIR, name)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)
