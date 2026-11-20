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

function numberInput(value, onChange) {
  const input = el("input", { type: "number", inputmode: "numeric", min: "0", max: "3600" });
  input.value = value;
  input.addEventListener("input", () => onChange(parseInt(input.value, 10)));
  return input;
}

function renderSets() {
  const box = $("sets");
  box.replaceChildren();
  editing.sets.forEach((set, index) => {
    const nameInput = el("input", { type: "text", maxlength: "60" });
    nameInput.value = set.name;
    nameInput.addEventListener("input", () => { set.name = nameInput.value; });
    box.appendChild(
      el("div", { class: "set" }, [
        el("label", { text: "Exercise name" }, [nameInput]),
        el("label", { text: "Exercise (s)" }, [numberInput(set.exercise, (v) => { set.exercise = v; })]),
        el("label", { text: "Rest (s)" }, [numberInput(set.rest, (v) => { set.rest = v; })]),
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

/* ---------- init ---------- */

async function init() {
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
