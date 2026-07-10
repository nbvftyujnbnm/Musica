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
  sus4: { intervals: [0, 5, 7],      suffix: "sus4" },
  add9: { intervals: [0, 4, 7, 14],  suffix: "add9" },
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
    { root: 7, quality: "sus4", degree: "Vsus4" },
    { root: 0, quality: "add9", degree: "Iadd9" },
  ],
  minor: [
    { root: 7, quality: "maj",  degree: "V(メジャー)" },
    { root: 7, quality: "dom7", degree: "V7" },
    { root: 0, quality: "sus4", degree: "Isus4" },
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
  { name: "ジャズ2-5-1", desc: "落ち着いた大人の響き", scale: "major",
    chords: [{ root: 2, quality: "min7" }, { root: 7, quality: "dom7" }, { root: 0, quality: "maj7" }, { root: 0, quality: "maj7" }] },
];

const STEPS_PER_BAR = 8; // 8分音符 × 8 = 1小節(4拍子)
const OCTAVES = 2;       // メロディーグリッドの音域

/* ---------------- 楽器・パターン定義 ---------------- */

// 音色: layers = [{type, detune, gain}], env = ADSR, filter(任意)
const INSTRUMENTS = {
  soft:    { label: "やわらか(三角波)",   layers: [{ type: "triangle" }], env: [0.012, 0.12, 0.75, 0.14] },
  lead:    { label: "シンセリード(鋸波)", layers: [{ type: "sawtooth" }], env: [0.008, 0.1, 0.7, 0.12], filter: 2600 },
  chip:    { label: "ファミコン(矩形波)", layers: [{ type: "square" }], env: [0.004, 0.05, 0.85, 0.06] },
  piano:   { label: "ピアノ風",           layers: [{ type: "triangle", gain: 1 }, { type: "sine", gain: 0.5, detune: 1200 }], env: [0.004, 0.35, 0.0, 0.18], filter: 3200 },
  epiano:  { label: "エレピ",             layers: [{ type: "sine", gain: 1 }, { type: "sine", gain: 0.4, detune: 1900 }], env: [0.006, 0.5, 0.1, 0.25] },
  strings: { label: "ストリングス",       layers: [{ type: "sawtooth", gain: 1 }, { type: "sawtooth", gain: 0.7, detune: 8 }], env: [0.12, 0.2, 0.85, 0.4], filter: 2200 },
  organ:   { label: "オルガン",           layers: [{ type: "sine", gain: 1 }, { type: "sine", gain: 0.5, detune: 1200 }, { type: "sine", gain: 0.3, detune: 1900 }], env: [0.01, 0.02, 0.95, 0.1] },
  bass:    { label: "シンセベース",       layers: [{ type: "sawtooth" }], env: [0.006, 0.08, 0.8, 0.1], filter: 900 },
  subbass: { label: "サブベース(丸い)",   layers: [{ type: "sine" }], env: [0.01, 0.1, 0.85, 0.12] },
  pluck:   { label: "プラック",           layers: [{ type: "triangle" }], env: [0.003, 0.16, 0.0, 0.1], filter: 2400 },
};

const MELODY_INSTRUMENTS = ["soft", "lead", "chip", "piano", "epiano", "pluck"];
const CHORD_INSTRUMENTS   = ["strings", "epiano", "organ", "piano", "lead", "soft"];
const BASS_INSTRUMENTS    = ["bass", "subbass", "pluck", "chip"];

const CHORD_STYLES = {
  pad:    "パッド(伸ばす)",
  arpUp:  "アルペジオ↑",
  arpDown:"アルペジオ↓",
  arpUpDn:"アルペジオ↕",
  stroke8:"8分ストローク",
  stroke4:"4分ストローク",
};

const BASS_PATTERNS = {
  whole:  "ルート(伸ばす)",
  quarter:"ルート(4分)",
  root5:  "ルート＋5度",
  octave: "オクターブ",
  walk:   "ウォーキング風",
};

const DRUM_PATTERNS = {
  none:    "なし",
  rock8:   "8ビート",
  four:    "4つ打ち",
  half:    "ハーフタイム",
  shuffle: "シャッフル",
  bossa:   "ボサノバ風",
};

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
  // サウンド設定
  melInst: "soft",
  chordInst: "strings",
  bassInst: "bass",
  chordStyle: "pad",
  bassPattern: "root5",
  drumPattern: "rock8",
  harmony: false,
  reverb: 25,
  swing: 0,
  volMelody: 80,
  volChord: 60,
  volBass: 75,
  volDrums: 70,
};

/* ---------------- 派生値の計算 ---------------- */

function scaleRows() {
  const base = 60 + state.keyRoot - (state.keyRoot >= 6 ? 12 : 0);
  const iv = SCALES[state.scale];
  const notes = [];
  for (let oct = 0; oct <= OCTAVES; oct++) {
    for (const i of iv) {
      const n = base + oct * 12 + i;
      if (n <= base + OCTAVES * 12) notes.push(n);
    }
  }
  notes.push(base + OCTAVES * 12);
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
      if (chord.quality === tri) return deg;
      if (chord.quality === sev) return deg + "7";
      return deg + "*";
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
const pickerClose = $("picker-close");
const melodyGrid = $("melody-grid");
const btnPlay = $("btn-play");
const btnRandom = $("btn-random");
const btnClear = $("btn-clear");
const btnMidi = $("btn-midi");
const btnWav = $("btn-wav");
const btnShare = $("btn-share");
const shareStatus = $("share-status");
const loopCheck = $("loop-check");

// サウンドUI
const melInstSel = $("mel-inst");
const chordInstSel = $("chord-inst");
const bassInstSel = $("bass-inst");
const chordStyleSel = $("chord-style");
const bassPatternSel = $("bass-pattern");
const drumPatternSel = $("drum-pattern");
const harmonyCheck = $("harmony-check");
const reverbSlider = $("reverb-slider");
const swingSlider = $("swing-slider");
const volMelody = $("vol-melody");
const volChord = $("vol-chord");
const volBass = $("vol-bass");
const volDrums = $("vol-drums");

/* ---------------- UI構築 ---------------- */

function fillSelect(sel, entries, value) {
  sel.innerHTML = "";
  for (const [val, label] of entries) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.value = value;
}

function buildKeySelect() {
  fillSelect(keySelect, KEY_NAMES.map((n, i) => [i, n]), state.keyRoot);
}

function buildSoundSelects() {
  fillSelect(melInstSel, MELODY_INSTRUMENTS.map(k => [k, INSTRUMENTS[k].label]), state.melInst);
  fillSelect(chordInstSel, CHORD_INSTRUMENTS.map(k => [k, INSTRUMENTS[k].label]), state.chordInst);
  fillSelect(bassInstSel, BASS_INSTRUMENTS.map(k => [k, INSTRUMENTS[k].label]), state.bassInst);
  fillSelect(chordStyleSel, Object.entries(CHORD_STYLES), state.chordStyle);
  fillSelect(bassPatternSel, Object.entries(BASS_PATTERNS), state.bassPattern);
  fillSelect(drumPatternSel, Object.entries(DRUM_PATTERNS), state.drumPattern);
  harmonyCheck.checked = state.harmony;
  reverbSlider.value = state.reverb;
  swingSlider.value = state.swing;
  volMelody.value = state.volMelody;
  volChord.value = state.volChord;
  volBass.value = state.volBass;
  volDrums.value = state.volDrums;
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
  // 8小節プリセット(カノン)は8小節へ、それ以外は現在の小節数を維持
  if (p.chords.length > state.bars) {
    state.bars = Math.min(16, p.chords.length);
    barsSelect.value = String(state.bars);
  }
  state.chords = [];
  for (let b = 0; b < state.bars; b++) {
    state.chords.push({ ...p.chords[b % p.chords.length] });
  }
  state.selectedBar = -1;
  chordPicker.classList.add("hidden");
  buildPresets();
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

function sameChord(a, b) {
  return a.root === b.root && a.quality === b.quality;
}

function renderPicker() {
  if (state.selectedBar < 0) {
    chordPicker.classList.add("hidden");
    return;
  }
  chordPicker.classList.remove("hidden");
  pickerBarNum.textContent = state.selectedBar + 1;

  const makeBtn = (chord, container) => {
    const current = state.chords[state.selectedBar];
    const b = document.createElement("button");
    b.className = "picker-chord";
    if (sameChord(current, chord)) b.classList.add("current");
    b.textContent = chordName(chord);
    b.addEventListener("click", () => {
      state.chords[state.selectedBar] = { root: chord.root, quality: chord.quality };
      state.activePreset = -1;
      buildPresets();
      renderChords();
      renderPicker();   // 選択状態の見た目を更新
      renderGrid();
      previewChord(state.chords[state.selectedBar]);
      saveState();
    });
    container.appendChild(b);
  };

  pickerTriads.innerHTML = "";
  pickerSevenths.innerHTML = "";
  const seen = new Set();
  for (const [off, tri, sev] of DIATONIC[state.scale]) {
    makeBtn({ root: off, quality: tri }, pickerTriads);
    makeBtn({ root: off, quality: sev }, pickerSevenths);
    seen.add(off + ":" + tri);
    seen.add(off + ":" + sev);
  }
  for (const ex of EXTRA_CHORDS[state.scale]) {
    if (seen.has(ex.root + ":" + ex.quality)) continue;
    makeBtn({ root: ex.root, quality: ex.quality }, pickerSevenths);
  }
}

/* ---------------- メロディーグリッド ---------------- */

let gridCells = []; // [row][col] -> element

function renderGrid() {
  const rows = scaleRows();
  const cols = totalCols();
  melodyGrid.style.gridTemplateColumns = `64px repeat(${cols}, minmax(18px, 1fr))`;
  melodyGrid.style.minWidth = (64 + cols * 20) + "px";
  melodyGrid.innerHTML = "";
  gridCells = [];

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
let dragMode = true;
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
      const strong = step === 0 || step === 4;
      const candidates = [];
      for (let r = 0; r < rows.length; r++) {
        const dist = Math.abs(r - prevRow);
        if (dist > (idx === 0 ? 5 : 3)) continue;
        const isChordTone = pcs.includes(rows[r] % 12);
        if (strong && !isChordTone) continue;
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

/* ================================================================
 * オーディオエンジン(ライブ再生 & オフライン書き出しで共用)
 * ================================================================ */

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// リバーブ用インパルス応答を生成
function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

// 出力グラフ(voiceをここのbusに接続する)
function makeGraph(ctx, reverbAmount) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3;
  comp.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);

  const bus = ctx.createGain();
  bus.connect(master);

  const wet = ctx.createGain();
  wet.gain.value = Math.min(0.9, reverbAmount / 100);
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx, 2.2, 3.0);
  bus.connect(conv);
  conv.connect(wet);
  wet.connect(master);

  return bus;
}

// 1音を鳴らす
function playNote(ctx, bus, { inst, midi, time, dur, gain }) {
  const def = INSTRUMENTS[inst] || INSTRUMENTS.soft;
  const [a, d, s, r] = def.env;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(gain, time + a);
  const susLevel = Math.max(0.0001, gain * s);
  env.gain.linearRampToValueAtTime(susLevel, time + a + d);
  const relStart = Math.max(time + a + d, time + dur);
  env.gain.setValueAtTime(Math.max(0.0001, env.gain.value || susLevel), relStart);
  env.gain.setTargetAtTime(0.0001, relStart, r / 3 + 0.01);

  let dest = env;
  if (def.filter) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = def.filter;
    f.connect(env);
    dest = f;
  }
  env.connect(bus);

  const freq = midiToFreq(midi);
  const stopAt = time + dur + r + 0.05;
  const oscs = [];
  for (const layer of def.layers) {
    const osc = ctx.createOscillator();
    osc.type = layer.type;
    osc.frequency.value = freq;
    if (layer.detune) osc.detune.value = layer.detune;
    const lg = ctx.createGain();
    lg.gain.value = layer.gain === undefined ? 1 : layer.gain;
    osc.connect(lg);
    lg.connect(dest);
    osc.start(time);
    osc.stop(stopAt);
    oscs.push(osc);
  }
  return oscs;
}

// ドラム(ノイズ/サイン)
function drumHit(ctx, bus, type, time, gain) {
  if (type === "kick") {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.12);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(g); g.connect(bus);
    osc.start(time); osc.stop(time + 0.2);
    return;
  }
  // ノイズ系(snare/hat)
  const dur = type === "snare" ? 0.18 : 0.05;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "highpass";
  filt.frequency.value = type === "snare" ? 1200 : 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  src.connect(filt); filt.connect(g); g.connect(bus);
  if (type === "snare") {
    const tone = ctx.createOscillator();
    tone.frequency.value = 190;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(gain * 0.4, time);
    tg.gain.exponentialRampToValueAtTime(0.001, time + dur);
    tone.connect(tg); tg.connect(bus);
    tone.start(time); tone.stop(time + dur);
  }
  src.start(time); src.stop(time + dur);
}

function chordMidiNotes(chord) {
  const rootPc = (state.keyRoot + chord.root) % 12;
  let root = 48 + rootPc;
  if (root > 55) root -= 12;
  return CHORD_QUALITIES[chord.quality].intervals.map(i => root + i);
}

function bassRootMidi(chord) {
  return 36 + ((state.keyRoot + chord.root) % 12);
}

// スウィング適用済みの時刻を返す
function swungOffset(stepInBar, stepDur) {
  if (state.swing <= 0) return 0;
  return (stepInBar % 2 === 1) ? stepDur * (state.swing / 100) * 0.33 : 0;
}

// ドラムパターン: [step(0-7)] -> 楽器
const DRUM_MAPS = {
  rock8:   { kick: [0, 4], snare: [2, 6], hat: [0, 1, 2, 3, 4, 5, 6, 7] },
  four:    { kick: [0, 2, 4, 6], snare: [2, 6], hat: [1, 3, 5, 7] },
  half:    { kick: [0], snare: [4], hat: [0, 2, 4, 6] },
  shuffle: { kick: [0, 4], snare: [2, 6], hat: [0, 1, 3, 4, 5, 7] },
  bossa:   { kick: [0, 3, 4, 7], snare: [2, 6], hat: [0, 1, 2, 3, 4, 5, 6, 7] },
};

// 全パートをスケジュール(ライブ/オフライン共通)
function scheduleSong(ctx, bus, startTime) {
  const beat = 60 / state.tempo;
  const stepDur = beat / 2;
  const barDur = beat * 4;
  const rows = scaleRows();
  const vMel = state.volMelody / 100;
  const vCho = state.volChord / 100;
  const vBas = state.volBass / 100;
  const vDrm = state.volDrums / 100;

  state.chords.forEach((chord, bar) => {
    const t = startTime + bar * barDur;
    const notes = chordMidiNotes(chord);

    // --- コード ---
    if (vCho > 0) {
      const style = state.chordStyle;
      if (style === "pad") {
        for (const m of notes) {
          playNote(ctx, bus, { inst: state.chordInst, midi: m, time: t, dur: barDur * 0.98, gain: 0.09 * vCho });
        }
      } else if (style === "stroke8" || style === "stroke4") {
        const div = style === "stroke8" ? 8 : 4;
        const sd = barDur / div;
        for (let k = 0; k < div; k++) {
          const stepInBar = style === "stroke8" ? k : k * 2;
          const st = t + k * sd + swungOffset(stepInBar, stepDur);
          for (const m of notes) {
            playNote(ctx, bus, { inst: state.chordInst, midi: m, time: st, dur: sd * 0.9, gain: 0.08 * vCho });
          }
        }
      } else {
        // アルペジオ
        let seq = [...notes];
        if (style === "arpDown") seq.reverse();
        if (style === "arpUpDn") seq = notes.concat([...notes].reverse().slice(1, -1));
        const steps = STEPS_PER_BAR;
        for (let k = 0; k < steps; k++) {
          const m = seq[k % seq.length] + (Math.floor(k / seq.length) % 2 === 1 ? 12 : 0);
          const st = t + k * stepDur + swungOffset(k, stepDur);
          playNote(ctx, bus, { inst: state.chordInst, midi: m, time: st, dur: stepDur * 1.4, gain: 0.1 * vCho });
        }
      }
    }

    // --- ベース ---
    if (vBas > 0) {
      const rootM = bassRootMidi(chord);
      const fifth = rootM + 7;
      const pat = state.bassPattern;
      const emit = (m, off, len, g) =>
        playNote(ctx, bus, { inst: state.bassInst, midi: m, time: t + off + swungOffset(Math.round(off / stepDur), stepDur), dur: len, gain: g * vBas });
      if (pat === "whole") {
        emit(rootM, 0, barDur * 0.95, 0.3);
      } else if (pat === "quarter") {
        for (let k = 0; k < 4; k++) emit(rootM, k * beat, beat * 0.8, 0.28);
      } else if (pat === "root5") {
        emit(rootM, 0, beat * 1.8, 0.3);
        emit(fifth, beat * 2, beat * 1.8, 0.24);
      } else if (pat === "octave") {
        for (let k = 0; k < 4; k++) emit(k % 2 === 0 ? rootM : rootM + 12, k * beat, beat * 0.7, 0.27);
      } else if (pat === "walk") {
        const nextChord = state.chords[(bar + 1) % state.chords.length];
        const target = bassRootMidi(nextChord);
        const dir = target >= rootM ? 1 : -1;
        const seq = [rootM, rootM + (CHORD_QUALITIES[chord.quality].intervals[1] || 4), fifth, rootM + dir * 5];
        for (let k = 0; k < 4; k++) emit(seq[k], k * beat, beat * 0.8, 0.26);
      }
    }

    // --- ドラム ---
    if (vDrm > 0 && state.drumPattern !== "none") {
      const map = DRUM_MAPS[state.drumPattern] || DRUM_MAPS.rock8;
      for (const step of map.kick)  drumHit(ctx, bus, "kick",  t + step * stepDur + swungOffset(step, stepDur), 0.9 * vDrm);
      for (const step of map.snare) drumHit(ctx, bus, "snare", t + step * stepDur + swungOffset(step, stepDur), 0.5 * vDrm);
      for (const step of map.hat)   drumHit(ctx, bus, "hat",   t + step * stepDur + swungOffset(step, stepDur), 0.28 * vDrm);
    }
  });

  // --- メロディー ---
  if (vMel > 0) {
    const cols = totalCols();
    for (let c = 0; c < cols; c++) {
      const r = state.melody[c];
      if (r === undefined || state.melody[c - 1] === r) continue;
      let len = 1;
      while (state.melody[c + len] === r) len++;
      const stepInBar = c % STEPS_PER_BAR;
      const noteTime = startTime + c * stepDur + swungOffset(stepInBar, stepDur);
      const noteDur = stepDur * len * 0.95;
      playNote(ctx, bus, { inst: state.melInst, midi: rows[r], time: noteTime, dur: noteDur, gain: 0.32 * vMel });
      // ハモリ(スケール上で3度下)
      if (state.harmony && rows[r + 2] !== undefined) {
        playNote(ctx, bus, { inst: state.melInst, midi: rows[r + 2], time: noteTime, dur: noteDur, gain: 0.16 * vMel });
      }
    }
  }
}

function songDuration() {
  return (60 / state.tempo) * 4 * state.bars;
}

/* ---------------- ライブ再生 ---------------- */

let audioCtx = null;
let liveBus = null;
let liveReverb = -1;
let playing = false;
let loopTimer = null;
let playStartTime = 0;
let rafId = null;
let lastPlayCol = -1;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (!liveBus || liveReverb !== state.reverb) {
    liveBus = makeGraph(audioCtx, state.reverb);
    liveReverb = state.reverb;
  }
}

function startPlayback() {
  stopPlayback(false);
  ensureAudio();
  playing = true;
  btnPlay.textContent = "■ 停止";
  const start = audioCtx.currentTime + 0.1;
  playStartTime = start;
  scheduleSong(audioCtx, liveBus, start);
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
      scheduleSong(audioCtx, liveBus, next);
      armLoop(next);
    } else {
      stopPlayback(true);
    }
  }, Math.max(0, (passStart + dur - audioCtx.currentTime - 0.2) * 1000));
}

function stopPlayback(updateButton = true) {
  playing = false;
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (audioCtx && liveBus) {
    // 発音中の音を素早くフェードアウト(新しいbusに差し替え)
    try { liveBus.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02); } catch (_) {}
    liveBus = null;
    liveReverb = -1;
  }
  clearPlayhead();
  if (updateButton) btnPlay.textContent = "▶ 再生";
}

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
  playNote(audioCtx, liveBus, { inst: state.melInst, midi, time: audioCtx.currentTime, dur: 0.28, gain: 0.28 });
}

function previewChord(chord) {
  ensureAudio();
  const t = audioCtx.currentTime;
  for (const m of chordMidiNotes(chord)) {
    playNote(audioCtx, liveBus, { inst: state.chordInst, midi: m, time: t, dur: 0.8, gain: 0.09 });
  }
}

/* ---------------- WAV書き出し(OfflineAudioContext) ---------------- */

async function exportWav() {
  btnWav.disabled = true;
  btnWav.textContent = "書き出し中…";
  try {
    const tail = 2.5; // リバーブの残響
    const dur = songDuration() + tail;
    const rate = 44100;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const octx = new OfflineCtx(2, Math.ceil(rate * dur), rate);
    const bus = makeGraph(octx, state.reverb);
    scheduleSong(octx, bus, 0.05);
    const buffer = await octx.startRendering();
    const blob = encodeWav(buffer);
    downloadBlob(blob, `musica-${KEY_NAMES[state.keyRoot]}-${state.scale}.wav`);
  } catch (e) {
    alert("WAVの書き出しに失敗しました: " + e.message);
  } finally {
    btnWav.disabled = false;
    btnWav.textContent = "🎧 WAVで保存";
  }
}

function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;
  const rate = buffer.sampleRate;
  const bytesPerSample = 2;
  const dataSize = len * numCh * bytesPerSample;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * numCh * bytesPerSample, true);
  view.setUint16(32, numCh * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const chans = [];
  for (let ch = 0; ch < numCh; ch++) chans.push(buffer.getChannelData(ch));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = Math.max(-1, Math.min(1, chans[ch][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  const events = [];
  const add = (tick, data) => events.push({ tick, data });

  const usPerBeat = Math.round(60000000 / state.tempo);
  add(0, [0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff]);

  state.chords.forEach((chord, bar) => {
    const t = bar * barTicks;
    for (const m of chordMidiNotes(chord)) {
      add(t, [0x91, m, 60]);
      add(t + barTicks - 10, [0x81, m, 0]);
    }
    const bass = bassRootMidi(chord);
    add(t, [0x92, bass, 90]);
    add(t + TPQ * 2 - 10, [0x82, bass, 0]);
    add(t + TPQ * 2, [0x92, bass, 80]);
    add(t + TPQ * 4 - 10, [0x82, bass, 0]);
  });

  const cols = totalCols();
  for (let c = 0; c < cols; c++) {
    const r = state.melody[c];
    if (r === undefined || state.melody[c - 1] === r) continue;
    let len = 1;
    while (state.melody[c + len] === r) len++;
    add(c * stepTicks, [0x90, rows[r], 100]);
    add((c + len) * stepTicks - 5, [0x80, rows[r], 0]);
    if (state.harmony && rows[r + 2] !== undefined) {
      add(c * stepTicks, [0x90, rows[r + 2], 70]);
      add((c + len) * stepTicks - 5, [0x80, rows[r + 2], 0]);
    }
  }

  add(state.bars * barTicks, [0xff, 0x2f, 0x00]);
  events.sort((a, b) => a.tick - b.tick);

  const trackBytes = [];
  let lastTick = 0;
  for (const ev of events) {
    trackBytes.push(...writeVarLen(ev.tick - lastTick), ...ev.data);
    lastTick = ev.tick;
  }

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (TPQ >> 8) & 0xff, TPQ & 0xff];
  const len = trackBytes.length;
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  const blob = new Blob([new Uint8Array([...header, ...trackHeader, ...trackBytes])], { type: "audio/midi" });
  downloadBlob(blob, `musica-${KEY_NAMES[state.keyRoot]}-${state.scale}.mid`);
}

/* ---------------- 共有リンク ---------------- */

function snapshot() {
  return {
    keyRoot: state.keyRoot, scale: state.scale, tempo: state.tempo, bars: state.bars,
    chords: state.chords, melody: state.melody, activePreset: state.activePreset,
    melInst: state.melInst, chordInst: state.chordInst, bassInst: state.bassInst,
    chordStyle: state.chordStyle, bassPattern: state.bassPattern, drumPattern: state.drumPattern,
    harmony: state.harmony, reverb: state.reverb, swing: state.swing,
    volMelody: state.volMelody, volChord: state.volChord, volBass: state.volBass, volDrums: state.volDrums,
  };
}

function encodeShare() {
  const json = JSON.stringify(snapshot());
  return btoa(unescape(encodeURIComponent(json)));
}

function shareLink() {
  const url = location.origin + location.pathname + "#s=" + encodeShare();
  const done = () => { shareStatus.textContent = "共有リンクをクリップボードにコピーしました ✔"; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => {
      shareStatus.textContent = "リンク: " + url;
    });
  } else {
    shareStatus.textContent = "リンク: " + url;
  }
  history.replaceState(null, "", "#s=" + encodeShare());
}

function tryLoadFromHash() {
  const m = location.hash.match(/s=([^&]+)/);
  if (!m) return false;
  try {
    const json = decodeURIComponent(escape(atob(m[1])));
    return applySnapshot(JSON.parse(json));
  } catch (_) {
    return false;
  }
}

/* ---------------- 保存と復元 ---------------- */

const STORAGE_KEY = "musica-song-v2";

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
  } catch (_) {}
}

function applySnapshot(data) {
  if (!data || !Array.isArray(data.chords) || data.chords.length === 0) return false;
  const has = (obj, k, v) => (obj[k] !== undefined ? obj[k] : v);
  state.keyRoot = has(data, "keyRoot", 0);
  state.scale = SCALES[data.scale] ? data.scale : "major";
  state.tempo = Math.min(240, Math.max(40, has(data, "tempo", 120)));
  state.bars = [4, 8, 12, 16].includes(data.bars) ? data.bars : 4;
  state.chords = data.chords.map(c => ({ root: c.root, quality: CHORD_QUALITIES[c.quality] ? c.quality : "maj" }));
  state.melody = data.melody || {};
  state.activePreset = has(data, "activePreset", -1);
  state.melInst = INSTRUMENTS[data.melInst] ? data.melInst : "soft";
  state.chordInst = INSTRUMENTS[data.chordInst] ? data.chordInst : "strings";
  state.bassInst = INSTRUMENTS[data.bassInst] ? data.bassInst : "bass";
  state.chordStyle = CHORD_STYLES[data.chordStyle] ? data.chordStyle : "pad";
  state.bassPattern = BASS_PATTERNS[data.bassPattern] ? data.bassPattern : "root5";
  state.drumPattern = DRUM_PATTERNS[data.drumPattern] ? data.drumPattern : "rock8";
  state.harmony = !!data.harmony;
  state.reverb = has(data, "reverb", 25);
  state.swing = has(data, "swing", 0);
  state.volMelody = has(data, "volMelody", 80);
  state.volChord = has(data, "volChord", 60);
  state.volBass = has(data, "volBass", 75);
  state.volDrums = has(data, "volDrums", 70);
  return true;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return applySnapshot(JSON.parse(raw));
  } catch (_) {
    return false;
  }
}

/* ---------------- スケール変更時のコード再マッピング ---------------- */

function remapChordsToScale(oldScale, newScale) {
  const oldD = DIATONIC[oldScale];
  const newD = DIATONIC[newScale];
  state.chords = state.chords.map(chord => {
    const idx = oldD.findIndex(([off]) => off === chord.root);
    if (idx < 0) return { ...chord }; // ダイアトニック外はそのまま
    const [, oldTri, oldSev] = oldD[idx];
    const [newOff, newTri, newSev] = newD[idx];
    let quality = chord.quality;
    if (chord.quality === oldTri) quality = newTri;
    else if (chord.quality === oldSev) quality = newSev;
    return { root: newOff, quality };
  });
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
  const oldScale = state.scale;
  const newScale = scaleSelect.value;
  if (newScale === oldScale) return;
  stopPlayback();
  // プリセットに頼らず、今のコード進行をそのまま新しいスケールへ移調
  remapChordsToScale(oldScale, newScale);
  state.scale = newScale;
  state.activePreset = -1;
  buildPresets();
  renderChords();
  renderPicker();
  renderGrid();
  saveState();
});

barsSelect.addEventListener("change", () => {
  const newBars = Number(barsSelect.value);
  stopPlayback();
  if (newBars > state.bars) {
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

pickerClose.addEventListener("click", () => {
  state.selectedBar = -1;
  renderChords();
  renderPicker();
});

btnPlay.addEventListener("click", () => {
  if (playing) stopPlayback();
  else startPlayback();
});
btnRandom.addEventListener("click", generateMelody);
btnClear.addEventListener("click", () => {
  state.melody = {};
  renderGrid();
  saveState();
});
btnMidi.addEventListener("click", exportMidi);
btnWav.addEventListener("click", exportWav);
btnShare.addEventListener("click", shareLink);

// サウンド設定
melInstSel.addEventListener("change", () => { state.melInst = melInstSel.value; saveState(); });
chordInstSel.addEventListener("change", () => { state.chordInst = chordInstSel.value; saveState(); });
bassInstSel.addEventListener("change", () => { state.bassInst = bassInstSel.value; saveState(); });
chordStyleSel.addEventListener("change", () => { state.chordStyle = chordStyleSel.value; saveState(); });
bassPatternSel.addEventListener("change", () => { state.bassPattern = bassPatternSel.value; saveState(); });
drumPatternSel.addEventListener("change", () => { state.drumPattern = drumPatternSel.value; saveState(); });
harmonyCheck.addEventListener("change", () => { state.harmony = harmonyCheck.checked; saveState(); });
reverbSlider.addEventListener("input", () => { state.reverb = Number(reverbSlider.value); saveState(); });
swingSlider.addEventListener("input", () => { state.swing = Number(swingSlider.value); saveState(); });
volMelody.addEventListener("input", () => { state.volMelody = Number(volMelody.value); saveState(); });
volChord.addEventListener("input", () => { state.volChord = Number(volChord.value); saveState(); });
volBass.addEventListener("input", () => { state.volBass = Number(volBass.value); saveState(); });
volDrums.addEventListener("input", () => { state.volDrums = Number(volDrums.value); saveState(); });

document.addEventListener("keydown", e => {
  if (e.code === "Space" && !["SELECT", "INPUT", "BUTTON", "TEXTAREA"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    if (playing) stopPlayback();
    else startPlayback();
  }
});

/* ---------------- 初期化 ---------------- */

buildKeySelect();
const fromHash = tryLoadFromHash();
const restored = fromHash || loadState();
buildPresets();
buildSoundSelects();
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
