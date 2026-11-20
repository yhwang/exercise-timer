"use strict";

const $ = (id) => document.getElementById(id);
const SCREENS = ["list", "editor", "run"];

let routines = [];
let musicFiles = [];
let editing = null;
let run = null;
let audioCtx = null;
let wakeLock = null;

/* ---------- helpers ---------- */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  children.forEach((child) => node.appendChild(child));
  return node;
}

function show(screen) {
  SCREENS.forEach((name) => $(name).classList.toggle("hidden", name !== screen));
  if (screen !== "editor") hideOsk();
}

function fmt(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return String(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function saveAll() {
  routines = await api("/api/routines", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(routines),
  });
}

/* ---------- phases ---------- */

function buildPhases(routine) {
  const phases = [];
  if (routine.warmup > 0) phases.push({ type: "warmup", label: "Warm up", dur: routine.warmup });
  for (let round = 1; round <= routine.iterations; round++) {
    routine.sets.forEach((set, index) => {
      phases.push({
        type: "exercise",
        label: set.name || `Exercise ${index + 1}`,
        dur: set.exercise,
        round,
        set: index + 1,
      });
      const isLast = round === routine.iterations && index === routine.sets.length - 1;
      if (!isLast && set.rest > 0) {
        phases.push({ type: "rest", label: "Rest", dur: set.rest, round, set: index + 1 });
      }
    });
  }
  return phases;
}

function totalSeconds(routine) {
  return buildPhases(routine).reduce((sum, phase) => sum + phase.dur, 0);
}

/* ---------- routine list (configure mode) ---------- */

function renderList() {
  const list = $("routines");
  list.replaceChildren();
  if (routines.length === 0) {
    list.appendChild(el("li", { class: "meta", text: "No routines yet. Tap + New routine." }));
  }
  routines.forEach((routine) => {
    const meta = `${routine.sets.length} sets × ${routine.iterations} rounds · ${fmt(totalSeconds(routine))}`;
    list.appendChild(
      el("li", { class: "card" }, [
        el("div", {}, [
          el("div", { class: "title", text: routine.name }),
          el("div", { class: "meta", text: meta }),
        ]),
        el("div", { class: "btns" }, [
          el("button", { class: "btn primary", text: "Start", onclick: () => startRun(routine) }),
          el("button", { class: "btn", text: "Edit", onclick: () => openEditor(routine) }),
          el("button", { class: "btn danger", text: "Delete", onclick: () => deleteRoutine(routine) }),
        ]),
      ])
    );
  });
}

async function deleteRoutine(routine) {
  if (!window.confirm(`Delete "${routine.name}"?`)) return;
  routines = routines.filter((r) => r.id !== routine.id);
  await saveAll();
  renderList();
}

/* ---------- editor (configure mode) ---------- */

function openEditor(routine) {
  editing = routine
    ? structuredClone(routine)
    : {
        id: newId(),
        name: "New routine",
        warmup: 10,
        iterations: 1,
        music: "",
        sets: [{ name: "Exercise 1", exercise: 30, rest: 10 }],
      };
  $("f-name").value = editing.name;
  $("f-warmup").value = editing.warmup;
  $("f-iterations").value = editing.iterations;

  const select = $("f-music");
  select.replaceChildren(el("option", { value: "", text: "None" }));
  musicFiles.forEach((file) => select.appendChild(el("option", { value: file, text: file })));
  select.value = musicFiles.includes(editing.music) ? editing.music : "";

  $("editor-error").textContent = "";
  renderSets();
  show("editor");
}

// Wraps a number input with - / + buttons so no keyboard is needed on a touchscreen.
// The input comes first in the DOM so a surrounding <label> targets it, not a button.
function makeStepper(input, step, min, max) {
  input.setAttribute("inputmode", "none");
  input.min = String(min);
  input.max = String(max);
  const adjust = (delta) => {
    const current = parseInt(input.value, 10);
    const base = Number.isInteger(current) ? current : min;
    input.value = Math.min(max, Math.max(min, base + delta));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const minus = el("button", {
    class: "btn step minus", type: "button", text: "−", "aria-label": "Decrease", onclick: () => adjust(-step),
  });
  const plus = el("button", {
    class: "btn step", type: "button", text: "+", "aria-label": "Increase", onclick: () => adjust(step),
  });
  const wrap = el("div", { class: "stepper" });
  if (input.parentNode) input.replaceWith(wrap);
  wrap.append(input, minus, plus);
  return wrap;
}

function numberInput(value, onChange, min) {
  const input = el("input", { type: "number" });
  input.value = value;
  input.addEventListener("input", () => onChange(parseInt(input.value, 10)));
  return makeStepper(input, 5, min, 3600);
}

function renderSets() {
  const box = $("sets");
  box.replaceChildren();
  editing.sets.forEach((set, index) => {
    const nameInput = el("input", { type: "text", maxlength: "60", inputmode: "none" });
    nameInput.value = set.name;
    nameInput.addEventListener("input", () => { set.name = nameInput.value; });
    box.appendChild(
      el("div", { class: "set" }, [
        el("label", { text: "Exercise name" }, [nameInput]),
        el("label", { text: "Exercise (s)" }, [numberInput(set.exercise, (v) => { set.exercise = v; }, 1)]),
        el("label", { text: "Rest (s)" }, [numberInput(set.rest, (v) => { set.rest = v; }, 0)]),
        el("button", {
          class: "btn danger",
          text: "✕",
          "aria-label": "Remove set",
          onclick: () => {
            if (editing.sets.length > 1) {
              editing.sets.splice(index, 1);
              renderSets();
            }
          },
        }),
      ])
    );
  });
}

async function saveEditor() {
  const fail = (message) => { $("editor-error").textContent = message; };
  const warmup = parseInt($("f-warmup").value, 10);
  const iterations = parseInt($("f-iterations").value, 10);
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 3600) return fail("Warm-up must be 0-3600 seconds.");
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) return fail("Iterations must be 1-100.");
  for (const set of editing.sets) {
    if (!Number.isInteger(set.exercise) || set.exercise < 1 || set.exercise > 3600) return fail("Exercise time must be 1-3600 seconds.");
    if (!Number.isInteger(set.rest) || set.rest < 0 || set.rest > 3600) return fail("Rest time must be 0-3600 seconds.");
  }
  editing.name = $("f-name").value.trim() || "Routine";
  editing.warmup = warmup;
  editing.iterations = iterations;
  editing.music = $("f-music").value;

  const index = routines.findIndex((r) => r.id === editing.id);
  if (index >= 0) routines[index] = editing;
  else routines.push(editing);
  try {
    await saveAll();
  } catch {
    return fail("Could not save the routine.");
  }
  renderList();
  show("list");
}

/* ---------- audio ---------- */

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function beep(freq, duration = 0.15, delay = 0) {
  if (!audioCtx) return;
  const start = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.6, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

const WARN_TONE = 660;
const START_TONES = { warmup: 523, exercise: 988, rest: 440 };

/* ---------- voice cues (pre-recorded clips in static/voice/) ---------- */

const VOICE_NAMES = ["warmup", "exercise", "rest", "done"];
const voiceClips = {};

function loadVoices() {
  VOICE_NAMES.forEach((name) => {
    const clip = new Audio(`/static/voice/${name}.wav`);
    clip.preload = "auto";
    voiceClips[name] = clip;
  });
}

// Say the cue after a short delay, so it follows the start tone instead of overlapping it.
// Skipped if the run was stopped or paused in the meantime.
function speak(name, delayMs) {
  const current = run;
  setTimeout(() => {
    if (run !== current || current.paused) return;
    Object.values(voiceClips).forEach((clip) => clip.pause());
    const clip = voiceClips[name];
    clip.currentTime = 0;
    clip.play().catch(() => {});
  }, delayMs);
}

function startMusic(file) {
  const music = $("music");
  music.volume = parseFloat($("volume").value);
  if (!file) { music.removeAttribute("src"); return; }
  music.src = `/music/${encodeURIComponent(file)}`;
  music.play().catch(() => {});
}

function stopMusic() {
  const music = $("music");
  music.pause();
  music.removeAttribute("src");
  music.load();
}

/* ---------- screen wake lock ---------- */

async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch { /* not critical */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

/* ---------- play mode ---------- */

function startRun(routine) {
  ensureAudio();
  run = {
    routine,
    phases: buildPhases(routine),
    index: 0,
    remaining: 0,
    last: performance.now(),
    lastBeep: null,
    paused: false,
    done: false,
    timer: null,
  };
  $("pause").textContent = "Pause";
  show("run");
  startMusic(routine.music);
  acquireWakeLock();
  beginPhase(0);
  run.timer = setInterval(tick, 100);
}

function beginPhase(index) {
  const phase = run.phases[index];
  run.index = index;
  run.remaining = phase.dur * 1000;
  run.lastBeep = null;
  run.last = performance.now();
  document.body.dataset.phase = phase.type;
  beep(START_TONES[phase.type], 0.45);
  speak(phase.type, 500);
  renderRun();
}

function nextPhase() {
  if (run.index + 1 < run.phases.length) beginPhase(run.index + 1);
  else finishRun();
}

function finishRun() {
  clearInterval(run.timer);
  run.done = true;
  stopMusic();
  releaseWakeLock();
  document.body.dataset.phase = "done";
  [523, 659, 784, 1047].forEach((freq, i) => beep(freq, 0.3, i * 0.2));
  speak("done", 1200);
  $("run-where").textContent = run.routine.name;
  $("run-phase").textContent = "Done";
  $("run-name").textContent = "Great work!";
  $("run-time").textContent = "0";
  $("run-next").textContent = "";
  $("run-bar").style.width = "100%";
  $("pause").classList.add("hidden");
  $("skip").classList.add("hidden");
}

function tick() {
  const now = performance.now();
  const elapsed = now - run.last;
  run.last = now;
  if (run.paused) return;
  run.remaining -= elapsed;
  if (run.remaining <= 0) { nextPhase(); return; }
  const secs = Math.ceil(run.remaining / 1000);
  if (secs <= 3 && secs !== run.lastBeep) {
    run.lastBeep = secs;
    beep(WARN_TONE, 0.12);
  }
  renderRun();
}

function renderRun() {
  const phase = run.phases[run.index];
  const next = run.phases[run.index + 1];
  const where = phase.round
    ? `Round ${phase.round}/${run.routine.iterations} · Set ${phase.set}/${run.routine.sets.length}`
    : run.routine.name;
  $("run-where").textContent = where;
  $("run-phase").textContent = phase.type === "exercise" ? "Exercise" : phase.label;
  $("run-name").textContent = phase.type === "exercise" ? phase.label : "";
  $("run-time").textContent = fmt(run.remaining / 1000);
  $("run-next").textContent = next ? `Next: ${next.label} (${fmt(next.dur)}s)` : "Last one!";
  const total = phase.dur * 1000;
  $("run-bar").style.width = `${Math.min(100, ((total - run.remaining) / total) * 100)}%`;
}

function togglePause() {
  if (!run || run.done) return;
  run.paused = !run.paused;
  run.last = performance.now();
  $("pause").textContent = run.paused ? "Resume" : "Pause";
  const music = $("music");
  if (run.paused) music.pause();
  else if (music.getAttribute("src")) music.play().catch(() => {});
}

function stopRun() {
  if (run) clearInterval(run.timer);
  run = null;
  stopMusic();
  releaseWakeLock();
  document.body.dataset.phase = "idle";
  $("pause").classList.remove("hidden");
  $("skip").classList.remove("hidden");
  show("list");
}

/* ---------- on-screen keyboard (for text fields) ---------- */

const OSK_ROWS = [
  "1234567890".split(""),
  "qwertyuiop".split(""),
  "asdfghjkl".split(""),
  ["Shift", ..."zxcvbnm".split(""), "Del"],
  ["-", "'", "Space", ".", "Clear", "Done"],
];
let oskTarget = null;
let oskShift = false;

function buildOsk() {
  const osk = $("osk");
  // Keep focus (and the caret) in the text field while tapping keys.
  osk.addEventListener("mousedown", (event) => event.preventDefault());
  OSK_ROWS.forEach((row) => {
    const rowEl = el("div", { class: "osk-row" });
    row.forEach((key) => {
      const isLetter = /^[a-z]$/.test(key);
      const cls = ["osk-key"];
      if (key === "Space") cls.push("osk-space");
      else if (key.length > 1) cls.push("osk-wide");
      rowEl.appendChild(
        el("button", {
          class: cls.join(" "),
          type: "button",
          "data-key": key,
          "data-letter": isLetter ? "1" : "",
          text: key,
          onclick: () => pressKey(key),
        })
      );
    });
    osk.appendChild(rowEl);
  });
}

function shouldCapitalize(input) {
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  return before === "" || /\s$/.test(before);
}

function updateOskKeys() {
  document.querySelectorAll("#osk [data-letter='1']").forEach((btn) => {
    const key = btn.dataset.key;
    btn.textContent = oskShift ? key.toUpperCase() : key;
  });
  document.querySelector("#osk [data-key='Shift']").classList.toggle("active", oskShift);
}

function showOsk(input) {
  oskTarget = input;
  oskShift = shouldCapitalize(input);
  updateOskKeys();
  $("osk").classList.remove("hidden");
  document.body.classList.add("osk-open");
  // Center the field in the space above the keyboard (not the full screen).
  setTimeout(() => {
    const visibleHeight = window.innerHeight - $("osk").offsetHeight;
    const rect = input.getBoundingClientRect();
    $("editor").scrollTop += rect.top + rect.height / 2 - visibleHeight / 2;
  }, 50);
}

function hideOsk() {
  oskTarget = null;
  $("osk").classList.add("hidden");
  document.body.classList.remove("osk-open");
}

function pressKey(key) {
  const input = oskTarget;
  if (!input || !input.isConnected) return;
  if (key === "Done") { hideOsk(); input.blur(); return; }
  if (key === "Shift") { oskShift = !oskShift; updateOskKeys(); return; }

  let start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (key === "Clear") {
    input.value = "";
  } else if (key === "Del") {
    if (start === end) {
      if (start === 0) return;
      start -= 1;
    }
    input.setRangeText("", start, end, "end");
  } else {
    const ch = key === "Space" ? " " : (oskShift ? key.toUpperCase() : key);
    if (input.maxLength > 0 && input.value.length - (end - start) >= input.maxLength) return;
    input.setRangeText(ch, start, end, "end");
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  oskShift = shouldCapitalize(input);
  updateOskKeys();
}

/* ---------- play-mode size setting (A- / A+) ---------- */

const SCALE_KEY = "exerciseTimerScale";
const SCALE_MIN = 0.7;
const SCALE_MAX = 1.3;

function applyScale(scale) {
  document.documentElement.style.setProperty("--s", String(scale));
}

function loadScale() {
  const saved = parseFloat(localStorage.getItem(SCALE_KEY));
  return Number.isFinite(saved) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, saved)) : 1;
}

function changeScale(delta) {
  const next = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, loadScale() + delta)) * 10) / 10;
  localStorage.setItem(SCALE_KEY, String(next));
  applyScale(next);
}

/* ---------- drag-to-scroll fallback ---------- */
// Some kiosk setups deliver touchscreen input as mouse events, which never scroll.
// Dragging with a mouse-type pointer scrolls the current screen; a drag is not a click.
function enableDragScroll() {
  let drag = null;
  let moved = false;
  document.addEventListener("pointerdown", (event) => {
    moved = false;
    drag = null;
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const screen = event.target.closest(".screen");
    if (!screen || event.target.closest("input, select, #osk")) return;
    drag = { screen, startY: event.clientY, startTop: screen.scrollTop };
  });
  document.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dy = event.clientY - drag.startY;
    if (!moved && Math.abs(dy) < 8) return;
    moved = true;
    drag.screen.scrollTop = drag.startTop - dy;
  });
  const end = () => { drag = null; };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  document.addEventListener("click", (event) => {
    if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; }
  }, true);
}

/* ---------- init ---------- */

async function init() {
  enableDragScroll();
  applyScale(loadScale());
  $("size-down").addEventListener("click", () => changeScale(-0.1));
  $("size-up").addEventListener("click", () => changeScale(0.1));
  buildOsk();
  loadVoices();
  makeStepper($("f-warmup"), 5, 0, 3600);
  makeStepper($("f-iterations"), 1, 1, 100);
  // Show the in-page keyboard for text fields in the editor, hide it otherwise.
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target.matches && target.matches("#editor input[type='text']")) showOsk(target);
    else if (!target.closest || !target.closest("#osk")) hideOsk();
  });
  $("new").addEventListener("click", () => openEditor(null));
  $("cancel").addEventListener("click", () => show("list"));
  $("save").addEventListener("click", saveEditor);
  $("add-set").addEventListener("click", () => {
    editing.sets.push({ name: `Exercise ${editing.sets.length + 1}`, exercise: 30, rest: 10 });
    renderSets();
  });
  $("pause").addEventListener("click", togglePause);
  $("skip").addEventListener("click", () => { if (run && !run.done) nextPhase(); });
  $("stop").addEventListener("click", stopRun);
  $("volume").addEventListener("input", () => { $("music").volume = parseFloat($("volume").value); });

  try {
    [routines, musicFiles] = await Promise.all([api("/api/routines"), api("/api/music")]);
  } catch {
    routines = [];
    musicFiles = [];
  }
  renderList();
  show("list");
}

init();
