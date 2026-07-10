"use strict";

/* ================================================================
 * Musica — コード進行とメロディーを選んで作曲するツール
 * 依存ライブラリなし / Web Audio API
 * ================================================================ */

/* ---------------- 音楽理論データ ---------------- */

const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const CHORD_QUALITIES = {
  maj:  { intervals: [0, 4, 7],      suffix: "" },
  min:  { intervals: [0, 3, 7],      suffix: "m" },
  dim:  { intervals: [0, 3, 6],      suffix: "dim" },
  maj7: { intervals: [0, 4, 7, 11],  suffix: "△7" },
  dom7: { intervals: [0, 4, 7, 10],  suffix: "7" },
  min7: { intervals: [0, 3, 7, 10],  suffix: "m7" },
  m7b5: { intervals: [0, 3, 6, 10],  suffix: "m7♭5" },
};

// ダイアトニックコード: [キーからの半音オフセット, 三和音, セブンス, 度数表記]
const DIATONIC = {
  major: [
    [0,  "maj", "maj7", "I"],
    [2,  "min", "min7", "II"],
    [4,  "min", "min7", "III"],
    [5,  "maj", "maj7", "IV"],
    [7,  "maj", "dom7", "V"],
    [9,  "min", "min7", "VI"],
    [11, "dim", "m7b5", "VII"],
  ],
  minor: [
    [0,  "min", "min7", "I"],
    [2,  "dim", "m7b5", "II"],
    [3,  "maj", "maj7", "III"],
    [5,  "min", "min7", "IV"],
    [7,  "min", "min7", "V"],
    [8,  "maj", "maj7", "VI"],
    [10, "maj", "dom7", "VII"],
  ],
};

// 追加コード(セカンダリードミナントなど)
const EXTRA_CHORDS = {
  major: [
    { root: 4, quality: "dom7", degree: "III7" }, // 丸サ進行用
    { root: 7, quality: "maj",  degree: "V" },
  ],
  minor: [
    { root: 7, quality: "maj",  degree: "V(メジャー)" },
    { root: 7, quality: "dom7", degree: "V7" },
  ],
};

const PRESETS = [
  { name: "王道進行", desc: "J-POPの定番", scale: "major",
    chords: [{ root: 5, quality: "maj7" }, { root: 7, quality: "dom7" }, { root: 4, quality: "min7" }, { root: 9, quality: "min7" }] },
  { name: "カノン進行", desc: "壮大で感動的", scale: "major",
    chords: [{ root: 0, quality: "maj" }, { root: 7, quality: "maj" }, { root: 9, quality: "min" }, { root: 4, quality: "min" },
             { root: 5, quality: "maj" }, { root: 0, quality: "maj" }, { root: 5, quality: "maj" }, { root: 7, quality: "maj" }] },
  { name: "小室進行", desc: "疾走感のある切なさ", scale: "major",
    chords: [{ root: 9, quality: "min" }, { root: 5, quality: "maj" }, { root: 7, quality: "maj" }, { root: 0, quality: "maj" }] },
  { name: "ポップパンク進行", desc: "明るく元気", scale: "major",
    chords: [{ root: 0, quality: "maj" }, { root: 7, quality: "maj" }, { root: 9, quality: "min" }, { root: 5, quality: "maj" }] },
  { name: "丸サ進行", desc: "おしゃれなシティポップ", scale: "major",
    chords: [{ root: 5, quality: "maj7" }, { root: 4, quality: "dom7" }, { root: 9, quality: "min7" }, { root: 0, quality: "dom7" }] },
  { name: "哀愁進行", desc: "物悲しいバラード", scale: "minor",
    chords: [{ root: 0, quality: "min" }, { root: 8, quality: "maj" }, { root: 3, quality: "maj" }, { root: 10, quality: "maj" }] },
  { name: "アンダルシア進行", desc: "情熱的でドラマチック", scale: "minor",
    chords: [{ root: 0, quality: "min" }, { root: 10, quality: "maj" }, { root: 8, quality: "maj" }, { root: 7, quality: "maj" }] },
];

const STEPS_PER_BAR = 8; // 8分音符 × 8 = 1小節(4拍子)
const OCTAVES = 2;       // メロディーグリッドの音域

/* ---------------- アプリの状態 ---------------- */

const state = {
  keyRoot: 0,
  scale: "major",
  tempo: 120,
  bars: 4,
  chords: [],   // [{root, quality}] 小節ごと
  melody: {},   // { 列番号: 行番号 } 行0が最高音
  selectedBar: -1,
  activePreset: 0,
};

/* ---------------- 派生値の計算 ---------------- */

function scaleRows() {
  // グリッドの行(上が高音)。MIDIノート番号のリストを返す。
  const base = 60 + state.keyRoot - (state.keyRoot >= 6 ? 12 : 0);
  const iv = SCALES[state.scale];
  const notes = [];
  for (let oct = 0; oct <= OCTAVES; oct++) {
    for (const i of iv) {
      const n = base + oct * 12 + i;
      if (n <= base + OCTAVES * 12) notes.push(n);
    }
  }
  notes.push(base + OCTAVES * 12); // 最上段のトニック
  const uniq = [...new Set(notes)].sort((a, b) => a - b);
  return uniq.reverse(); // 行0 = 最高音
}

function totalCols() {
  return state.bars * STEPS_PER_BAR;
}

function chordName(chord) {
  const pc = (state.keyRoot + chord.root) % 12;
  return KEY_NAMES[pc] + CHORD_QUALITIES[chord.quality].suffix;
}

function chordPitchClasses(chord) {
  const rootPc = (state.keyRoot + chord.root) % 12;
  return CHORD_QUALITIES[chord.quality].intervals.map(i => (rootPc + i) % 12);
}

function noteName(midi) {
  return KEY_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

function degreeLabel(chord) {
  const list = DIATONIC[state.scale];
  for (const [off, tri, sev, deg] of list) {
    if (off === chord.root) {
      return deg + (chord.quality === sev && sev !== tri ? "7" : "");
    }
  }
  for (const ex of EXTRA_CHORDS[state.scale]) {
    if (ex.root === chord.root && ex.quality === chord.quality) return ex.degree;
  }
  return "";
}

/* ---------------- DOM要素 ---------------- */

const $ = id => document.getElementById(id);
const keySelect = $("key-select");
const scaleSelect = $("scale-select");
const barsSelect = $("bars-select");
const tempoSlider = $("tempo-slider");
const tempoValue = $("tempo-value");
const presetList = $("preset-list");
const chordBarRow = $("chord-bar-row");
const chordPicker = $("chord-picker");
const pickerBarNum = $("picker-bar-num");
const pickerTriads = $("picker-triads");
const pickerSevenths = $("picker-sevenths");
const melodyGrid = $("melody-grid");
const btnPlay = $("btn-play");
const btnRandom = $("btn-random");
const btnClear = $("btn-clear");
const btnMidi = $("btn-midi");
const loopCheck = $("loop-check");

/* ---------------- UI構築 ---------------- */

function buildKeySelect() {
  keySelect.innerHTML = "";
  KEY_NAMES.forEach((name, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = name;
    keySelect.appendChild(opt);
  });
  keySelect.value = state.keyRoot;
}

function buildPresets() {
  presetList.innerHTML = "";
  PRESETS.forEach((p, i) => {
    const btn = document.createElement("button");
    btn.className = "preset-chip" + (i === state.activePreset ? " active" : "");
    btn.innerHTML = `${p.name}<span class="preset-desc">${p.desc}</span>`;
    btn.addEventListener("click", () => applyPreset(i));
    presetList.appendChild(btn);
  });
}

function applyPreset(i) {
  const p = PRESETS[i];
  state.activePreset = i;
  state.scale = p.scale;
  scaleSelect.value = p.scale;
  state.chords = [];
  for (let b = 0; b < state.bars; b++) {
    state.chords.push({ ...p.chords[b % p.chords.length] });
  }
  if (p.chords.length === 8 && state.bars === 4) {
    // カノン進行などは8小節に切り替えたほうが自然
    state.bars = 8;
    barsSelect.value = "8";
    state.chords = p.chords.map(c => ({ ...c }));
  }
  state.selectedBar = -1;
  chordPicker.classList.add("hidden");
  renderChords();
  renderGrid();
  saveState();
}

function renderChords() {
  chordBarRow.innerHTML = "";
  state.chords.forEach((chord, i) => {
    const cell = document.createElement("div");
    cell.className = "chord-cell" + (i === state.selectedBar ? " selected" : "");
    cell.dataset.bar = i;
    cell.innerHTML =
      `<span class="bar-num">小節 ${i + 1}</span>` +
      `<span class="chord-name">${chordName(chord)}</span>` +
      `<span class="degree">${degreeLabel(chord)}</span>`;
    cell.addEventListener("click", () => {
      state.selectedBar = state.selectedBar === i ? -1 : i;
      renderChords();
      renderPicker();
    });
    chordBarRow.appendChild(cell);
  });
}

function renderPicker() {
  if (state.selectedBar < 0) {
    chordPicker.classList.add("hidden");
    return;
  }
  chordPicker.classList.remove("hidden");
  pickerBarNum.textContent = state.selectedBar + 1;
  const current = state.chords[state.selectedBar];

  const makeBtn = (chord, container) => {
    const b = document.createElement("button");
    b.className = "picker-chord";
    if (current.root === chord.root && current.quality === chord.quality) {
      b.classList.add("current");
    }
    b.textContent = chordName(chord);
    b.addEventListener("click", () => {
      state.chords[state.selectedBar] = { root: chord.root, quality: chord.quality };
      state.activePreset = -1;
      buildPresets();
      renderChords();
      renderPicker();
      renderGrid();
      previewChord(state.chords[state.selectedBar]);
      saveState();
    });
    container.appendChild(b);
  };

  pickerTriads.innerHTML = "";
  pickerSevenths.innerHTML = "";
  for (const [off, tri, sev] of DIATONIC[state.scale]) {
    makeBtn({ root: off, quality: tri }, pickerTriads);
    makeBtn({ root: off, quality: sev }, pickerSevenths);
  }
  for (const ex of EXTRA_CHORDS[state.scale]) {
    makeBtn({ root: ex.root, quality: ex.quality }, pickerSevenths);
  }
}

/* ---------------- メロディーグリッド ---------------- */

let gridCells = []; // [row][col] -> element

function renderGrid() {
  const rows = scaleRows();
  const cols = totalCols();
  melodyGrid.style.gridTemplateColumns = `64px repeat(${cols}, minmax(18px, 1fr))`;
  melodyGrid.innerHTML = "";
  gridCells = [];

  // 各小節のコード構成音(ピッチクラス)
  const barPcs = state.chords.map(chordPitchClasses);
  const tonicPc = state.keyRoot % 12;

  rows.forEach((midi, r) => {
    const label = document.createElement("div");
    label.className = "row-label" + (midi % 12 === tonicPc ? " root-label" : "");
    label.textContent = noteName(midi);
    melodyGrid.appendChild(label);

    gridCells[r] = [];
    for (let c = 0; c < cols; c++) {
      const bar = Math.floor(c / STEPS_PER_BAR);
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      if (c % STEPS_PER_BAR === 0) cell.classList.add("bar-start");
      else if (c % 2 === 0) cell.classList.add("beat-start");
      if (midi % 12 === tonicPc) cell.classList.add("root-row");
      if (barPcs[bar] && barPcs[bar].includes(midi % 12)) cell.classList.add("chord-tone");
      cell.dataset.row = r;
      cell.dataset.col = c;
      melodyGrid.appendChild(cell);
      gridCells[r][c] = cell;
    }
  });

  // 既存メロディーの反映(行数が変わった場合は範囲外を削除)
  for (const col of Object.keys(state.melody)) {
    const c = Number(col);
    const r = state.melody[col];
    if (c >= cols || r >= rows.length) { delete state.melody[col]; continue; }
    markNote(r, c, true);
  }
  refreshNoteVisuals();
}

function markNote(r, c, on) {
  const cell = gridCells[r] && gridCells[r][c];
  if (cell) cell.classList.toggle("note-on", on);
}

function refreshNoteVisuals() {
  // 連続音の見た目(つながって見えるように)
  const cols = totalCols();
  for (let c = 0; c < cols; c++) {
    const r = state.melody[c];
    if (r === undefined) continue;
    const cell = gridCells[r][c];
    cell.classList.toggle("note-cont", state.melody[c - 1] === r);
  }
}

function setMelodyCell(r, c, on) {
  const prev = state.melody[c];
  if (on) {
    if (prev !== undefined) markNote(prev, c, false);
    state.melody[c] = r;
    markNote(r, c, true);
  } else {
    if (prev !== undefined) markNote(prev, c, false);
    delete state.melody[c];
  }
  refreshNoteVisuals();
}

// ドラッグ入力
let dragging = false;
let dragMode = true; // true=追加 false=削除
let lastPreviewedRow = -1;

function cellFromEvent(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el.classList.contains("grid-cell")) {
    return { r: Number(el.dataset.row), c: Number(el.dataset.col) };
  }
  return null;
}

melodyGrid.addEventListener("pointerdown", e => {
  const cell = cellFromEvent(e);
  if (!cell) return;
  e.preventDefault();
  dragging = true;
  dragMode = state.melody[cell.c] !== cell.r;
  setMelodyCell(cell.r, cell.c, dragMode);
  if (dragMode) {
    previewNote(scaleRows()[cell.r]);
    lastPreviewedRow = cell.r;
  }
});

melodyGrid.addEventListener("pointermove", e => {
  if (!dragging) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  if (dragMode && state.melody[cell.c] === cell.r) return;
  if (!dragMode && state.melody[cell.c] === undefined) return;
  setMelodyCell(cell.r, cell.c, dragMode);
  if (dragMode && cell.r !== lastPreviewedRow) {
    previewNote(scaleRows()[cell.r]);
    lastPreviewedRow = cell.r;
  }
});

window.addEventListener("pointerup", () => {
  if (dragging) { dragging = false; saveState(); }
});

/* ---------------- おまかせメロディー生成 ---------------- */

const RHYTHM_PATTERNS = [
  [0, 2, 4, 6],
  [0, 2, 3, 4, 6],
  [0, 1, 2, 4, 6, 7],
  [0, 3, 4, 6],
  [0, 2, 4, 5, 6],
  [0, 4, 6, 7],
];

function generateMelody() {
  const rows = scaleRows();
  state.melody = {};
  let prevRow = Math.floor(rows.length / 2);

  state.chords.forEach((chord, bar) => {
    const pcs = chordPitchClasses(chord);
    const pattern = RHYTHM_PATTERNS[Math.floor(Math.random() * RHYTHM_PATTERNS.length)];
    pattern.forEach((step, idx) => {
      const col = bar * STEPS_PER_BAR + step;
      // 強拍(小節頭・3拍目)はコードトーン、それ以外は近い音を選ぶ
      const strong = step === 0 || step === 4;
      const candidates = [];
      for (let r = 0; r < rows.length; r++) {
        const dist = Math.abs(r - prevRow);
        if (dist > (idx === 0 ? 5 : 3)) continue;
        const isChordTone = pcs.includes(rows[r] % 12);
        if (strong && !isChordTone) continue;
        // 近い音ほど選ばれやすく、コードトーンを優遇
        let weight = 10 - dist * 2 + (isChordTone ? 4 : 0);
        if (weight > 0) candidates.push({ r, weight });
      }
      if (candidates.length === 0) return;
      const total = candidates.reduce((s, c) => s + c.weight, 0);
      let pick = Math.random() * total;
      for (const cand of candidates) {
        pick -= cand.weight;
        if (pick <= 0) { prevRow = cand.r; break; }
      }
      state.melody[col] = prevRow;
    });
  });
  renderGrid();
  saveState();
}

/* ---------------- 再生(Web Audio) ---------------- */

let audioCtx = null;
let masterGain = null;
let playing = false;
let scheduledNodes = [];
let loopTimer = null;
let playStartTime = 0;
let rafId = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -18;
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(comp);
    comp.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function playTone({ midi, time, dur, type = "triangle", gain = 0.2, filterFreq = 0 }) {
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.frequency.value = midiToFreq(midi);
  const g = audioCtx.createGain();
  const attack = 0.015;
  const release = 0.08;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(gain, time + attack);
  g.gain.setValueAtTime(gain, Math.max(time + attack, time + dur - release));
  g.gain.linearRampToValueAtTime(0.0001, time + dur);
  let node = osc;
  if (filterFreq > 0) {
    const f = audioCtx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filterFreq;
    osc.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(masterGain);
  osc.start(time);
  osc.stop(time + dur + 0.05);
  scheduledNodes.push(osc);
}

function chordMidiNotes(chord) {
  // オクターブ3〜4あたりにボイシング
  const rootPc = (state.keyRoot + chord.root) % 12;
  let root = 48 + rootPc;
  if (root > 55) root -= 12;
  return CHORD_QUALITIES[chord.quality].intervals.map(i => root + i);
}

function scheduleSong(startTime) {
  const beat = 60 / state.tempo;
  const stepDur = beat / 2;
  const barDur = beat * 4;
  const rows = scaleRows();

  state.chords.forEach((chord, bar) => {
    const t = startTime + bar * barDur;
    // コード(パッド)
    for (const m of chordMidiNotes(chord)) {
      playTone({ midi: m, time: t, dur: barDur * 0.98, type: "sawtooth", gain: 0.045, filterFreq: 900 });
    }
    // ベース(1拍目と3拍目)
    const rootPc = (state.keyRoot + chord.root) % 12;
    const bassMidi = 36 + rootPc;
    playTone({ midi: bassMidi, time: t, dur: beat * 1.8, type: "sine", gain: 0.28 });
    playTone({ midi: bassMidi, time: t + beat * 2, dur: beat * 1.8, type: "sine", gain: 0.22 });
  });

  // メロディー(同じ行が連続していたらつなげて1音に)
  const cols = totalCols();
  for (let c = 0; c < cols; c++) {
    const r = state.melody[c];
    if (r === undefined || state.melody[c - 1] === r) continue;
    let len = 1;
    while (state.melody[c + len] === r) len++;
    playTone({
      midi: rows[r],
      time: startTime + c * stepDur,
      dur: stepDur * len * 0.95,
      type: "triangle",
      gain: 0.3,
    });
    playTone({
      midi: rows[r] + 12,
      time: startTime + c * stepDur,
      dur: stepDur * len * 0.95,
      type: "sine",
      gain: 0.06,
    });
  }
}

function songDuration() {
  return (60 / state.tempo) * 4 * state.bars;
}

function startPlayback() {
  ensureAudio();
  stopPlayback(false);
  playing = true;
  btnPlay.textContent = "■ 停止";
  const start = audioCtx.currentTime + 0.08;
  playStartTime = start;
  scheduleSong(start);
  armLoop(start);
  rafId = requestAnimationFrame(updatePlayhead);
}

function armLoop(passStart) {
  const dur = songDuration();
  loopTimer = setTimeout(() => {
    if (!playing) return;
    if (loopCheck.checked) {
      const next = passStart + dur;
      playStartTime = next;
      scheduleSong(next);
      armLoop(next);
    } else {
      stopPlayback(true);
    }
  }, Math.max(0, (passStart + dur - audioCtx.currentTime - 0.15) * 1000));
}

function stopPlayback(updateButton = true) {
  playing = false;
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  for (const n of scheduledNodes) {
    try { n.stop(); } catch (_) { /* already stopped */ }
  }
  scheduledNodes = [];
  clearPlayhead();
  if (updateButton) btnPlay.textContent = "▶ 再生";
}

let lastPlayCol = -1;

function updatePlayhead() {
  if (!playing) return;
  const stepDur = (60 / state.tempo) / 2;
  const elapsed = audioCtx.currentTime - playStartTime;
  const col = Math.floor(elapsed / stepDur);
  if (col !== lastPlayCol && col >= 0 && col < totalCols()) {
    clearPlayhead();
    lastPlayCol = col;
    for (let r = 0; r < gridCells.length; r++) {
      gridCells[r][col].classList.add("play-col");
    }
    const bar = Math.floor(col / STEPS_PER_BAR);
    chordBarRow.children[bar] && chordBarRow.children[bar].classList.add("playing");
  }
  rafId = requestAnimationFrame(updatePlayhead);
}

function clearPlayhead() {
  if (lastPlayCol >= 0) {
    for (let r = 0; r < gridCells.length; r++) {
      const cell = gridCells[r] && gridCells[r][lastPlayCol];
      if (cell) cell.classList.remove("play-col");
    }
  }
  lastPlayCol = -1;
  for (const el of chordBarRow.children) el.classList.remove("playing");
}

function previewNote(midi) {
  ensureAudio();
  playTone({ midi, time: audioCtx.currentTime, dur: 0.25, type: "triangle", gain: 0.25 });
}

function previewChord(chord) {
  ensureAudio();
  const t = audioCtx.currentTime;
  for (const m of chordMidiNotes(chord)) {
    playTone({ midi: m, time: t, dur: 0.7, type: "sawtooth", gain: 0.05, filterFreq: 900 });
  }
}

/* ---------------- MIDI書き出し ---------------- */

function writeVarLen(value) {
  const bytes = [];
  let buffer = value & 0x7f;
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= ((value & 0x7f) | 0x80);
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function exportMidi() {
  const TPQ = 480;
  const stepTicks = TPQ / 2;
  const barTicks = TPQ * 4;
  const rows = scaleRows();
  const events = []; // {tick, data:[...]}

  const add = (tick, data) => events.push({ tick, data });

  // テンポ
  const usPerBeat = Math.round(60000000 / state.tempo);
  add(0, [0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff]);

  // コード(ch1) & ベース(ch2)
  state.chords.forEach((chord, bar) => {
    const t = bar * barTicks;
    for (const m of chordMidiNotes(chord)) {
      add(t, [0x91, m, 60]);
      add(t + barTicks - 10, [0x81, m, 0]);
    }
    const bass = 36 + ((state.keyRoot + chord.root) % 12);
    add(t, [0x92, bass, 90]);
    add(t + TPQ * 2 - 10, [0x82, bass, 0]);
    add(t + TPQ * 2, [0x92, bass, 80]);
    add(t + TPQ * 4 - 10, [0x82, bass, 0]);
  });

  // メロディー(ch0)
  const cols = totalCols();
  for (let c = 0; c < cols; c++) {
    const r = state.melody[c];
    if (r === undefined || state.melody[c - 1] === r) continue;
    let len = 1;
    while (state.melody[c + len] === r) len++;
    add(c * stepTicks, [0x90, rows[r], 100]);
    add((c + len) * stepTicks - 5, [0x80, rows[r], 0]);
  }

  add(state.bars * barTicks, [0xff, 0x2f, 0x00]); // トラック終端

  events.sort((a, b) => a.tick - b.tick);

  const trackBytes = [];
  let lastTick = 0;
  for (const ev of events) {
    trackBytes.push(...writeVarLen(ev.tick - lastTick), ...ev.data);
    lastTick = ev.tick;
  }

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, // MThd
    0, 0,                               // format 0
    0, 1,                               // 1トラック
    (TPQ >> 8) & 0xff, TPQ & 0xff,
  ];
  const len = trackBytes.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // MTrk
    (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff,
  ];

  const blob = new Blob([new Uint8Array([...header, ...trackHeader, ...trackBytes])], { type: "audio/midi" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `musica-${KEY_NAMES[state.keyRoot]}-${state.scale}.mid`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- 保存と復元 ---------------- */

const STORAGE_KEY = "musica-song-v1";

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      keyRoot: state.keyRoot,
      scale: state.scale,
      tempo: state.tempo,
      bars: state.bars,
      chords: state.chords,
      melody: state.melody,
      activePreset: state.activePreset,
    }));
  } catch (_) { /* プライベートモードなどでは保存しない */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.chords) || data.chords.length === 0) return false;
    Object.assign(state, {
      keyRoot: data.keyRoot ?? 0,
      scale: SCALES[data.scale] ? data.scale : "major",
      tempo: data.tempo ?? 120,
      bars: data.bars === 8 ? 8 : 4,
      chords: data.chords,
      melody: data.melody ?? {},
      activePreset: data.activePreset ?? -1,
    });
    return true;
  } catch (_) {
    return false;
  }
}

/* ---------------- イベント ---------------- */

keySelect.addEventListener("change", () => {
  state.keyRoot = Number(keySelect.value);
  stopPlayback();
  renderChords();
  renderPicker();
  renderGrid();
  saveState();
});

scaleSelect.addEventListener("change", () => {
  state.scale = scaleSelect.value;
  stopPlayback();
  // スケールに合うプリセットへ切り替え
  const idx = PRESETS.findIndex(p => p.scale === state.scale);
  applyPreset(idx >= 0 ? idx : 0);
});

barsSelect.addEventListener("change", () => {
  const newBars = Number(barsSelect.value);
  stopPlayback();
  if (newBars > state.bars) {
    // 既存の進行を繰り返して拡張
    const old = state.chords.map(c => ({ ...c }));
    while (state.chords.length < newBars) {
      state.chords.push({ ...old[state.chords.length % old.length] });
    }
  } else {
    state.chords = state.chords.slice(0, newBars);
  }
  state.bars = newBars;
  state.selectedBar = -1;
  chordPicker.classList.add("hidden");
  renderChords();
  renderGrid();
  saveState();
});

tempoSlider.addEventListener("input", () => {
  state.tempo = Number(tempoSlider.value);
  tempoValue.textContent = state.tempo;
  saveState();
});

btnPlay.addEventListener("click", () => {
  if (playing) stopPlayback();
  else startPlayback();
});

btnRandom.addEventListener("click", () => {
  generateMelody();
});

btnClear.addEventListener("click", () => {
  state.melody = {};
  renderGrid();
  saveState();
});

btnMidi.addEventListener("click", exportMidi);

document.addEventListener("keydown", e => {
  if (e.code === "Space" && !["SELECT", "INPUT", "BUTTON"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    if (playing) stopPlayback();
    else startPlayback();
  }
});

/* ---------------- 初期化 ---------------- */

buildKeySelect();
const restored = loadState();
buildPresets();
keySelect.value = state.keyRoot;
scaleSelect.value = state.scale;
barsSelect.value = String(state.bars);
tempoSlider.value = state.tempo;
tempoValue.textContent = state.tempo;
if (!restored) {
  applyPreset(0);
} else {
  renderChords();
  renderGrid();
}
