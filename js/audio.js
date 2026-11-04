'use strict';
// =====================================================================
//  サウンド：Web Audio で合成する効果音（SE）と BGM（外部ファイル不要）
//  ブラウザの制限により、最初のクリック／キー入力で音声が有効になる
// =====================================================================

const SOUND_KEY = 'ironWasteland.sound';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// 'C#5' → MIDI ノート番号
function noteMidi(s) {
  const r = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!r) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[r[1]];
  return 12 * (+r[3] + 1) + base + (r[2] === '#' ? 1 : r[2] === 'b' ? -1 : 0);
}

// 'F#m' → 3和音（根音は第3オクターブ）
function chordMidi(s) {
  const r = /^([A-G][#b]?)(m?)$/.exec(s);
  if (!r) return [noteMidi('C3'), noteMidi('E3'), noteMidi('G3')];
  const root = noteMidi(r[1] + '3');
  return [root, root + (r[2] ? 3 : 4), root + 7];
}

// メロディ表記："E5 . . G5 r ." … 音名で発音、'.' で直前の音を伸ばす、'r' で休符
function parseMelody(src) {
  const tok = src.trim().split(/\s+/);
  const notes = new Map();
  for (let i = 0; i < tok.length; i++) {
    if (tok[i] === '.' || tok[i] === 'r') continue;
    let len = 1;
    while (i + len < tok.length && tok[i + len] === '.') len++;
    notes.set(i, { m: noteMidi(tok[i]), len });
  }
  return notes;
}

// ---------------------------------------------------------------------
//  効果音レシピ：gap = 同じ音を鳴らす最短間隔（秒）。play は鳴る長さ（秒）を返す
// ---------------------------------------------------------------------
const SFX = {
  // ---- UI（軍用端末ライクなソリッドで重厚なクリック） ----
  ui: { gap: 0.03, play(S, t, out) {
    S.tone(out, t, { type: 'sine', f: 200, f2: 80, dur: 0.04, vol: 0.2 });
    S.tone(out, t, { type: 'square', f: 1200, f2: 500, dur: 0.025, vol: 0.07 });
    S.noise(out, t, { dur: 0.02, vol: 0.12, filt: 'bandpass', f: 2800, q: 3 });
    return 0.05;
  } },
  tick: { gap: 0.03, play(S, t, out) {
    S.tone(out, t, { type: 'triangle', f: 420, f2: 180, dur: 0.03, vol: 0.14 });
    S.tone(out, t, { type: 'sine', f: 110, dur: 0.03, vol: 0.18 });
    return 0.04;
  } },
  equip: { gap: 0.05, play(S, t, out) {
    // 重火器ユニットの油圧ロック＆重金属ラッチ（ドスッ＋ガシャン！）
    S.tone(out, t, { type: 'sine', f: 115, f2: 36, dur: 0.2, vol: 0.65 });
    S.noise(out, t, { dur: 0.12, vol: 0.38, filt: 'lowpass', f: 2400, f2: 350 });
    S.tone(out, t + 0.025, { type: 'sawtooth', f: 260, f2: 80, dur: 0.12, vol: 0.16, filt: 'lowpass', ff: 850 });
    S.noise(out, t + 0.065, { dur: 0.06, vol: 0.25, filt: 'bandpass', f: 3400, q: 4 });
    return 0.22;
  } },
  place: { gap: 0.03, play(S, t, out) {
    // 回路モジュールのソリッドなロック音
    S.tone(out, t, { type: 'sine', f: 240, f2: 95, dur: 0.08, vol: 0.28 });
    S.tone(out, t + 0.02, { type: 'triangle', f: 720, dur: 0.06, vol: 0.16 });
    S.noise(out, t, { dur: 0.03, vol: 0.16, filt: 'highpass', f: 2200 });
    return 0.1;
  } },
  erase: { gap: 0.03, play(S, t, out) {
    // パージ・消去音
    S.tone(out, t, { type: 'sine', f: 160, f2: 45, dur: 0.13, vol: 0.35 });
    S.noise(out, t, { dur: 0.09, vol: 0.2, filt: 'lowpass', f: 750, f2: 180 });
    return 0.14;
  } },
  rotate: { gap: 0.03, play(S, t, out) {
    // 高トルク・サーボの唸りとラッチ
    S.tone(out, t, { type: 'sawtooth', f: 120, f2: 260, dur: 0.08, vol: 0.14, filt: 'lowpass', ff: 650 });
    S.tone(out, t + 0.03, { type: 'sine', f: 85, dur: 0.07, vol: 0.22 });
    return 0.09;
  } },
  undo: { gap: 0.03, play(S, t, out) {
    S.tone(out, t, { type: 'sine', f: 320, f2: 110, dur: 0.1, vol: 0.22 });
    return 0.11;
  } },
  upgrade: { gap: 0.1, play(S, t, out) {
    // 低周波エネルギーチャージから火花散る強力強化音
    S.tone(out, t, { type: 'sawtooth', f: 55, f2: 240, dur: 0.45, vol: 0.28, filt: 'lowpass', ff: 600 });
    S.tone(out, t, { type: 'sine', f: 70, f2: 280, dur: 0.45, vol: 0.4 });
    [60, 65, 72, 79].forEach((m, i) => S.tone(out, t + 0.18 + i * 0.06, { type: 'square', f: midiHz(m), dur: 0.12, vol: 0.1 }));
    S.noise(out, t + 0.36, { dur: 0.35, vol: 0.25, filt: 'highpass', f: 4500 });
    S.tone(out, t + 0.38, { type: 'sine', f: 85, f2: 32, dur: 0.35, vol: 0.45 });
    return 0.7;
  } },
  sortie: { gap: 0.5, play(S, t, out) {
    // 巨大ハッチ開放＆メインブースターの轟音（32Hzのスーパーサブベース）
    S.tone(out, t, { type: 'sine', f: 45, f2: 26, dur: 1.6, vol: 0.7, a: 0.08 });
    S.tone(out, t, { type: 'sawtooth', f: 60, f2: 125, dur: 1.5, vol: 0.28, a: 0.25, filt: 'lowpass', ff: 350 });
    S.noise(out, t + 0.08, { dur: 1.5, vol: 0.48, a: 0.35, filt: 'bandpass', f: 220, f2: 1800, q: 1.2 });
    return 1.7;
  } },

  // ---- 自機の武装（低音重視・重量感のあるミリタリー火器） ----
  gun: { gap: 0.045, play(S, t, out) {
    // 重機関銃（重厚な低音キックバック + メカニカルなマズル衝撃）
    S.tone(out, t, { type: 'sine', f: 88, f2: 34, dur: 0.1, vol: 0.5 }); // サブベースのパンチ
    S.tone(out, t, { type: 'square', f: 210, f2: 55, dur: 0.06, vol: 0.2 });
    S.noise(out, t, { dur: 0.075, vol: 0.38, filt: 'bandpass', f: 1500 + Math.random() * 500, f2: 450, q: 1.4 });
    return 0.11;
  } },
  shell: { gap: 0.1, play(S, t, out) {
    // 大口径滑腔砲（戦艦砲・リニアキャノン：強烈な28Hzサブベース + 破裂音）
    S.tone(out, t, { type: 'sine', f: 85, f2: 24, dur: 0.7, vol: 0.9 }); // 超低音の空気震動
    S.tone(out, t, { type: 'triangle', f: 140, f2: 38, dur: 0.38, vol: 0.55 });
    S.noise(out, t, { dur: 0.58, vol: 0.75, filt: 'lowpass', f: 2200, f2: 80 });
    S.noise(out, t, { dur: 0.06, vol: 0.55, filt: 'bandpass', f: 1100, q: 1.5 });
    return 0.72;
  } },
  missile: { gap: 0.06, play(S, t, out) {
    // ロケットモーター点火と推進音（60Hzサブベース点火 + 噴射ノイズ）
    S.tone(out, t, { type: 'sine', f: 80, f2: 32, dur: 0.28, vol: 0.45 });
    S.noise(out, t, { dur: 0.42, vol: 0.38, a: 0.02, filt: 'bandpass', f: 450, f2: 2200, q: 1.5 });
    S.tone(out, t, { type: 'sawtooth', f: 160, f2: 80, dur: 0.14, vol: 0.14, filt: 'lowpass', ff: 550 });
    return 0.44;
  } },
  flame: { gap: 0.075, play(S, t, out) {
    // 重い「ゴォォォ！」（低周波唸り + 激しい燃焼）
    S.tone(out, t, { type: 'sine', f: 65, f2: 45, dur: 0.2, vol: 0.28 });
    S.noise(out, t, { dur: 0.2, vol: 0.32, a: 0.02, filt: 'lowpass', f: 850 + Math.random() * 300, f2: 300 });
    return 0.21;
  } },
  melee: { gap: 0.08, play(S, t, out) {
    // 巨大金属刃の重いスイング（空気を裂く低周波）
    S.tone(out, t, { type: 'sine', f: 100, f2: 40, dur: 0.18, vol: 0.35 });
    S.noise(out, t, { dur: 0.2, vol: 0.38, a: 0.02, filt: 'bandpass', f: 550, f2: 2600, q: 1.5 });
    return 0.22;
  } },
  meleeHit: { gap: 0.05, play(S, t, out) {
    // ズバァァン！！（42Hzサブベース・クラッシュ + 装甲両断）
    S.tone(out, t, { type: 'sine', f: 120, f2: 30, dur: 0.32, vol: 0.8 });
    S.tone(out, t, { type: 'sawtooth', f: 200, f2: 55, dur: 0.22, vol: 0.28, filt: 'lowpass', ff: 1100 });
    S.noise(out, t, { dur: 0.24, vol: 0.48, filt: 'lowpass', f: 2200, f2: 160 });
    S.noise(out, t, { dur: 0.3, vol: 0.22, filt: 'highpass', f: 3600 });
    return 0.34;
  } },
  reload: { gap: 0.1, play(S, t, out) {
    S.noise(out, t, { dur: 0.04, vol: 0.3, filt: 'bandpass', f: 2000, q: 4 });
    S.tone(out, t + 0.08, { type: 'sine', f: 130, f2: 60, dur: 0.06, vol: 0.22 });
    return 0.15;
  } },
  reloaded: { gap: 0.1, play(S, t, out) {
    // ガチャンとボルトが前進し固定される重火器の装填
    S.noise(out, t, { dur: 0.04, vol: 0.34, filt: 'bandpass', f: 2600, q: 4 });
    S.tone(out, t + 0.06, { type: 'sine', f: 150, f2: 40, dur: 0.14, vol: 0.4 });
    S.noise(out, t + 0.06, { dur: 0.06, vol: 0.38, filt: 'bandpass', f: 1500, q: 3 });
    return 0.18;
  } },
  ratio: { gap: 0.04, play(S, t, out, o) {
    const up = o.up ? 1 : -1;
    S.tone(out, t, { type: 'sine', f: 400, f2: 400 * Math.pow(2, up * 0.5), dur: 0.09, vol: 0.16 });
    return 0.1;
  } },
  jump: { gap: 0.2, play(S, t, out) {
    // 脚部のスラスター噴射（ボシュッ！と一気に浮き上がる）
    S.noise(out, t, { dur: 0.32, vol: 0.42, a: 0.01, filt: 'bandpass', f: 500, f2: 2400, q: 1.2 });
    S.tone(out, t, { type: 'sine', f: 70, f2: 180, dur: 0.22, vol: 0.32 });
    S.tone(out, t + 0.02, { type: 'triangle', f: 240, f2: 520, dur: 0.18, vol: 0.1 });
    return 0.34;
  } },
  land: { gap: 0.2, play(S, t, out) {
    // 着地の衝撃（足音より重く、油圧で衝撃を吸収する音つき）
    S.tone(out, t, { type: 'sine', f: 70, f2: 20, dur: 0.34, vol: 0.65 });
    S.noise(out, t, { dur: 0.16, vol: 0.32, filt: 'lowpass', f: 700, f2: 90 });
    S.noise(out, t + 0.08, { dur: 0.12, vol: 0.1, filt: 'bandpass', f: 1800, q: 3 });
    return 0.36;
  } },
  step: { gap: 0.12, play(S, t, out) {
    // 数十トンの鋼鉄ロボットが大地を踏みしめる重低音フットステップ（ズシィン…）
    S.tone(out, t, { type: 'sine', f: 60, f2: 22, dur: 0.24, vol: 0.5 }); // 大地を揺らすサブベース
    S.tone(out, t, { type: 'triangle', f: 120, f2: 45, dur: 0.14, vol: 0.28 });
    S.noise(out, t, { dur: 0.09, vol: 0.18, filt: 'lowpass', f: 550, f2: 110 }); // 足裏の接地
    S.noise(out, t + 0.03, { dur: 0.05, vol: 0.09, filt: 'bandpass', f: 2000, q: 3 }); // 微かな油圧エア
    return 0.25;
  } },

  // ---- 着弾・撃破 ----
  hit: { gap: 0.04, play(S, t, out) {
    // 装甲に直撃する鈍い低音インパクト + 金属火花
    S.tone(out, t, { type: 'sine', f: 150, f2: 50, dur: 0.07, vol: 0.32 });
    S.tone(out, t, { type: 'square', f: 750 + Math.random() * 200, f2: 220, dur: 0.045, vol: 0.09 });
    return 0.08;
  } },
  boom: { gap: 0.06, play(S, t, out, o) {
    const k = clamp((o.size || 3) / 4, 0.6, 2.2);
    // 超重低音の衝撃波（28Hz）+ 破壊の轟音
    S.tone(out, t, { type: 'sine', f: 70 / Math.sqrt(k), f2: 18, dur: 0.6 * k, vol: 0.75 });
    S.tone(out, t, { type: 'triangle', f: 120 / Math.sqrt(k), f2: 28, dur: 0.38 * k, vol: 0.4 });
    S.noise(out, t, { dur: 0.6 * k, vol: 0.6, filt: 'lowpass', f: 1700, f2: 70 });
    return 0.65 * k;
  } },
  kill: { gap: 0.04, play(S, t, out) {
    // 敵機粉砕（低音爆縮 + メカニカル破断）
    S.tone(out, t, { type: 'sine', f: 85, f2: 26, dur: 0.22, vol: 0.45 });
    S.noise(out, t, { dur: 0.18, vol: 0.38, filt: 'bandpass', f: 1000, f2: 220, q: 1.8 });
    S.tone(out, t, { type: 'sawtooth', f: 240, f2: 50, dur: 0.16, vol: 0.14, filt: 'lowpass', ff: 950 });
    return 0.23;
  } },
  killBig: { gap: 0.08, play(S, t, out) {
    // 巨大敵の重低音崩壊
    S.tone(out, t, { type: 'sine', f: 55, f2: 18, dur: 0.75, vol: 0.65 });
    S.noise(out, t, { dur: 0.65, vol: 0.55, filt: 'lowpass', f: 1100, f2: 80 });
    S.tone(out, t + 0.07, { type: 'sawtooth', f: 110, f2: 25, dur: 0.55, vol: 0.22, filt: 'lowpass', ff: 450 });
    return 0.78;
  } },
  ore: { gap: 0.03, play(S, t, out, o) {
    const now = S.ctx.currentTime;
    S.oreChain = now - (S.oreT || 0) < 0.35 ? Math.min(S.oreChain + 1, 10) : 0;
    S.oreT = now;
    const base = { iron: 68, crystal: 72, core: 64 }[o.kind] || 68;
    const f = midiHz(base + [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24][S.oreChain]);
    S.tone(out, t, { type: 'triangle', f, f2: f * 1.4, dur: 0.08, vol: 0.15 });
    S.tone(out, t + 0.015, { type: 'sine', f: f * 1.5, dur: 0.07, vol: 0.07 });
    return 0.1;
  } },

  // ---- エネミー ----
  acid: { gap: 0.07, play(S, t, out) {
    S.tone(out, t, { type: 'sine', f: 380, f2: 110, dur: 0.16, vol: 0.22 });
    S.noise(out, t, { dur: 0.1, vol: 0.18, filt: 'bandpass', f: 750, q: 3 });
    return 0.17;
  } },
  bite: { gap: 0.09, play(S, t, out) {
    S.tone(out, t, { type: 'sine', f: 110, f2: 40, dur: 0.12, vol: 0.35 });
    S.noise(out, t, { dur: 0.06, vol: 0.22, filt: 'bandpass', f: 2200, q: 3 });
    S.noise(out, t + 0.05, { dur: 0.06, vol: 0.2, filt: 'bandpass', f: 1600, q: 3 });
    return 0.14;
  } },
  hurt: { gap: 0.08, play(S, t, out) {
    // 自機ダメージ：コクピットに伝わる重低音衝撃 + 警戒
    S.tone(out, t, { type: 'sine', f: 70, f2: 26, dur: 0.28, vol: 0.55 });
    S.tone(out, t, { type: 'square', f: 160, f2: 100, dur: 0.18, vol: 0.18 });
    S.noise(out, t, { dur: 0.15, vol: 0.32, filt: 'highpass', f: 1600 });
    return 0.29;
  } },
  alarm: { gap: 0.6, play(S, t, out) {
    for (let i = 0; i < 4; i++) S.tone(out, t + i * 0.12, { type: 'square', f: i % 2 ? 550 : 770, dur: 0.1, vol: 0.12 });
    return 0.52;
  } },
  die: { gap: 1, play(S, t, out) {
    // 自機大破：連続重低音爆破
    for (let i = 0; i < 5; i++) {
      S.tone(out, t + i * 0.15, { type: 'sine', f: 75, f2: 20, dur: 0.75, vol: 0.6 });
      S.noise(out, t + i * 0.15, { dur: 0.75, vol: 0.6, filt: 'lowpass', f: 1400, f2: 60 });
    }
    S.tone(out, t, { type: 'sawtooth', f: 110, f2: 20, dur: 2.2, vol: 0.28, filt: 'lowpass', ff: 350 });
    return 2.4;
  } },

  // ---- ボス ----
  roar: { gap: 1, play(S, t, out) {
    // 地を揺るがす怪獣・巨大ボスの重低音咆哮（28Hzの唸り）
    S.tone(out, t, { type: 'sine', f: 50, f2: 25, dur: 1.9, vol: 0.55, a: 0.2 });
    S.tone(out, t, { type: 'sawtooth', f: 70, f2: 32, dur: 1.9, vol: 0.38, a: 0.15, filt: 'lowpass', ff: 420, vib: [7, 8] });
    S.noise(out, t, { dur: 1.9, vol: 0.42, a: 0.3, filt: 'lowpass', f: 380, f2: 80 });
    return 2.0;
  } },
  quake: { gap: 1, play(S, t, out) {
    // 地震・地鳴りの極低周波
    S.tone(out, t, { type: 'sine', f: 30, f2: 22, dur: 2.8, vol: 0.7, a: 0.5 });
    S.noise(out, t, { dur: 2.8, vol: 0.6, a: 0.6, filt: 'lowpass', f: 110, f2: 40 });
    return 2.9;
  } },
  siren: { gap: 2, play(S, t, out) {
    for (let i = 0; i < 3; i++) {
      S.tone(out, t + i * 0.9, { type: 'sawtooth', f: 360, f2: 720, dur: 0.45, vol: 0.11, a: 0.05, filt: 'lowpass', ff: 1200, curve: 'lin' });
      S.tone(out, t + i * 0.9 + 0.45, { type: 'sawtooth', f: 720, f2: 360, dur: 0.45, vol: 0.11, filt: 'lowpass', ff: 1200, curve: 'lin' });
    }
    return 2.8;
  } },
  charge: { gap: 0.5, play(S, t, out) {
    S.tone(out, t, { type: 'sawtooth', f: 45, f2: 200, dur: 0.85, vol: 0.25, a: 0.3, filt: 'lowpass', ff: 800, curve: 'lin' });
    S.noise(out, t, { dur: 0.85, vol: 0.25, a: 0.4, filt: 'bandpass', f: 180, f2: 1100, q: 1 });
    return 0.9;
  } },
  slam: { gap: 0.3, play(S, t, out) {
    // 激突・スラム（48Hz->16Hz の超重低音ダイブ）
    S.tone(out, t, { type: 'sine', f: 50, f2: 16, dur: 1.1, vol: 0.95 });
    S.noise(out, t, { dur: 0.95, vol: 0.7, filt: 'lowpass', f: 850, f2: 50 });
    return 1.15;
  } },
  volley: { gap: 0.2, play(S, t, out) {
    S.noise(out, t, { dur: 0.28, vol: 0.4, filt: 'bandpass', f: 550, f2: 160, q: 1 });
    S.tone(out, t, { type: 'sine', f: 100, f2: 40, dur: 0.28, vol: 0.4 });
    return 0.3;
  } },
  summon: { gap: 0.5, play(S, t, out) {
    S.tone(out, t, { type: 'sine', f: 60, f2: 30, dur: 0.9, vol: 0.4 });
    S.noise(out, t, { dur: 0.9, vol: 0.38, a: 0.3, filt: 'lowpass', f: 180, f2: 850 });
    for (let i = 0; i < 5; i++) S.noise(out, t + 0.35 + i * 0.07, { dur: 0.06, vol: 0.18, filt: 'bandpass', f: 1600 + i * 200, q: 3 });
    return 1.05;
  } },
  inhale: { gap: 0.5, play(S, t, out) {   // 弾を放つ前に砂礫を吸い込む
    S.noise(out, t, { dur: 0.95, vol: 0.32, a: 0.8, filt: 'bandpass', f: 250, f2: 1600, q: 2 });
    S.tone(out, t, { type: 'sawtooth', f: 60, f2: 110, dur: 0.95, vol: 0.14, a: 0.7, filt: 'lowpass', ff: 500, vib: [12, 4] });
    return 1;
  } },
  burrow: { gap: 0.5, play(S, t, out) {   // 地中へ潜る
    S.noise(out, t, { dur: 1.4, vol: 0.45, a: 0.1, filt: 'lowpass', f: 700, f2: 90 });
    S.tone(out, t, { type: 'sine', f: 55, f2: 30, dur: 1.2, vol: 0.35 });
    return 1.5;
  } },
  rumble: { gap: 0.5, play(S, t, out) {   // 真下から噴き出す直前の地鳴り
    S.noise(out, t, { dur: 0.9, vol: 0.5, a: 0.6, filt: 'lowpass', f: 120, f2: 500 });
    S.tone(out, t, { type: 'sine', f: 35, f2: 60, dur: 0.9, vol: 0.4, a: 0.5 });
    return 0.95;
  } },
  throb: { gap: 0.8, play(S, t, out) {    // 大地の脈動：地の底から響く鼓動（ドクン…ドクン）
    S.tone(out, t, { type: 'sine', f: 44, f2: 24, dur: 0.38, vol: 0.75, a: 0.03 });
    S.noise(out, t, { dur: 0.3, vol: 0.32, a: 0.03, filt: 'lowpass', f: 140, f2: 40 });
    S.tone(out, t + 0.26, { type: 'sine', f: 52, f2: 28, dur: 0.3, vol: 0.55, a: 0.02 });
    S.noise(out, t + 0.26, { dur: 0.22, vol: 0.22, filt: 'lowpass', f: 170, f2: 50 });
    return 0.6;
  } },
  // ---- 蒼晶蜘蛛（洞窟のボス） ----
  screech: { gap: 0.8, play(S, t, out) {   // 甲高い金切り声
    S.tone(out, t, { type: 'sawtooth', f: 900, f2: 1500, dur: 0.9, vol: 0.12, a: 0.08, filt: 'bandpass', ff: 1800, vib: [23, 6] });
    S.tone(out, t, { type: 'square', f: 1350, f2: 980, dur: 0.8, vol: 0.06, a: 0.1, filt: 'bandpass', ff: 2400, vib: [17, 5] });
    S.noise(out, t, { dur: 0.9, vol: 0.18, a: 0.1, filt: 'bandpass', f: 3000, f2: 1800, q: 3 });
    return 1;
  } },
  leap: { gap: 0.3, play(S, t, out) {      // 跳躍の風切り音
    S.noise(out, t, { dur: 0.5, vol: 0.35, a: 0.05, filt: 'bandpass', f: 400, f2: 1800, q: 1.5 });
    S.tone(out, t, { type: 'sine', f: 90, f2: 50, dur: 0.15, vol: 0.3 });
    return 0.55;
  } },
  web: { gap: 0.3, play(S, t, out) {       // 糸玉を吐く粘つく音
    for (let i = 0; i < 3; i++) {
      S.noise(out, t + i * 0.07, { dur: 0.12, vol: 0.2, filt: 'lowpass', f: 900, f2: 300 });
      S.tone(out, t + i * 0.07, { type: 'sine', f: 380, f2: 150, dur: 0.1, vol: 0.12 });
    }
    return 0.3;
  } },
  shard: { gap: 0.15, play(S, t, out) {    // 晶弾の発射（澄んだ高音）
    [88, 92, 95].forEach((m, i) => S.tone(out, t + i * 0.025, { type: 'triangle', f: midiHz(m), dur: 0.25, vol: 0.07 }));
    S.noise(out, t, { dur: 0.08, vol: 0.18, filt: 'highpass', f: 5000 });
    return 0.32;
  } },
  shatter: { gap: 0.06, play(S, t, out) {  // 結晶が砕ける
    S.noise(out, t, { dur: 0.3, vol: 0.35, filt: 'highpass', f: 3500 });
    for (let i = 0; i < 4; i++) S.tone(out, t + i * 0.03, { type: 'triangle', f: 2200 + Math.random() * 2400, dur: 0.12, vol: 0.05 });
    S.tone(out, t, { type: 'sine', f: 140, f2: 60, dur: 0.18, vol: 0.25 });
    return 0.32;
  } },
  bossDie: { gap: 2, play(S, t, out) {
    for (let i = 0; i < 8; i++) {
      S.tone(out, t + i * 0.16, { type: 'sine', f: 65, f2: 18, dur: 0.85, vol: 0.65 });
      S.noise(out, t + i * 0.16, { dur: 0.85, vol: 0.6, filt: 'lowpass', f: 1800, f2: 50 });
    }
    S.tone(out, t, { type: 'sawtooth', f: 60, f2: 18, dur: 2.8, vol: 0.45, a: 0.05, filt: 'lowpass', ff: 450, vib: [5, 12] });
    return 3.0;
  } },

  // ---- ジングル ----
  radio: { gap: 0.3, play(S, t, out) {
    S.noise(out, t, { dur: 0.12, vol: 0.12, filt: 'bandpass', f: 2200, q: 2 });
    S.tone(out, t + 0.09, { type: 'sine', f: 1100, dur: 0.07, vol: 0.12 });
    S.tone(out, t + 0.18, { type: 'sine', f: 1466, dur: 0.09, vol: 0.12 });
    return 0.3;
  } },
  clear: { gap: 1, play(S, t, out) {
    // 凱旋軍楽ファンファーレ（ブラス重低音 + トランペット）
    [50, 57, 62].forEach(m => S.tone(out, t, { type: 'sawtooth', f: midiHz(m), dur: 1.2, vol: 0.12, filt: 'lowpass', ff: 900 }));
    [[62, 0], [65, 0.14], [69, 0.28], [74, 0.42]].forEach(([m, d]) => S.tone(out, t + d, { type: 'square', f: midiHz(m), dur: 0.2, vol: 0.11 }));
    S.tone(out, t + 0.42, { type: 'sine', f: 75, f2: 30, dur: 0.6, vol: 0.5 }); // ドン！
    return 1.5;
  } },
  win: { gap: 2, play(S, t, out) {
    // 威風堂々たる軍隊マーチの勝利ジングル
    S.tone(out, t, { type: 'sine', f: 65, f2: 26, dur: 0.6, vol: 0.6 });
    const seq = [[50, 0, 0.2], [57, 0.2, 0.2], [62, 0.4, 0.35], [60, 0.75, 0.18], [62, 0.93, 0.18], [65, 1.11, 0.9]];
    for (const [m, d, l] of seq) {
      S.tone(out, t + d, { type: 'square', f: midiHz(m + 12), dur: l, vol: 0.12 });
      S.tone(out, t + d, { type: 'sawtooth', f: midiHz(m), dur: l, vol: 0.1, filt: 'lowpass', ff: 1100 });
    }
    S.tone(out, t + 1.11, { type: 'sine', f: 55, f2: 24, dur: 1.0, vol: 0.65 });
    return 2.3;
  } },
  lose: { gap: 2, play(S, t, out) {
    // 重低音ゴングと不気味なホラードローン
    S.tone(out, t, { type: 'sine', f: 45, f2: 20, dur: 2.2, vol: 0.65 });
    const seq = [[50, 0, 0.4], [49, 0.4, 0.4], [48, 0.8, 0.4], [47, 1.2, 1.4]];
    for (const [m, d, l] of seq) S.tone(out, t + d, { type: 'sawtooth', f: midiHz(m), dur: l, vol: 0.14, filt: 'lowpass', ff: 500 });
    return 2.7;
  } },
  retreat: { gap: 2, play(S, t, out) {
    [[62, 0], [57, 0.2], [50, 0.4]].forEach(([m, d]) => S.tone(out, t + d, { type: 'square', f: midiHz(m), dur: 0.22, vol: 0.1 }));
    S.tone(out, t + 0.4, { type: 'sine', f: 60, f2: 25, dur: 0.8, vol: 0.5 });
    return 1.6;
  } },
  pause: { gap: 0.05, play(S, t, out, o) {
    S.tone(out, t, { type: 'sine', f: o.on ? 700 : 500, f2: o.on ? 500 : 700, dur: 0.08, vol: 0.16 });
    return 0.09;
  } },
};

// ---------------------------------------------------------------------
//  BGM：16分音符単位のステップシーケンサー
// ---------------------------------------------------------------------
const BGM_TRACKS = {
  // 基地（ガレージ）：規律的で軍隊的なミリタリーマーチ＆インダストリアル（重低音重視）
  garage: {
    bpm: 100, swing: 0, vol: 0.82,
    sections: [
      // Section 0: 規律ある点呼・整備ドックの行進
      { chords: ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Dm', 'Gm', 'A'] },
      // Section 1: 勇壮な軍楽テーマ（ホルン/トランペット風の力強い旋律）
      { chords: ['Dm', 'F', 'C', 'Dm', 'Bb', 'F', 'Gm', 'A'],
        lead: `D5 . . F5  A5 . . .  A5 . G5 F5  E5 . . .
               F5 . . G5  A5 . . .  D6 . C6 Bb5 A5 . . .
               Bb5 . . A5 G5 . . .  A5 . . G5   F5 . . .
               G5 . . F5  E5 . . .  C#5 . . .   D5 . . .` },
    ],
    step(S, s) {
      const { st, t, ch, sd, bar } = s;

      // 1. バスドラム（行進を支える重厚なミリタリー大太鼓）
      if (st === 0 || st === 8) {
        S.kick(t, 0.72, { f: 110, f2: 34, dur: 0.32 });
      } else if (bar % 2 === 1 && (st === 6 || st === 14)) {
        // 行進の推進力を生むダブルキック
        S.kick(t, 0.42, { f: 95, f2: 34, dur: 0.22, punch: false });
      }

      // 2. マーチングスネア（軍隊ドラムの規律正しいルーディメンツ）
      if (st === 4 || st === 12) {
        S.snare(t, 0.34); // メインの拍
      }
      // スネアのロール＆ゴーストノート（行進のタカタカ感）
      if (bar % 2 === 0) {
        if (st === 2 || st === 6 || st === 10 || st === 14) S.snare(t, 0.11, true);
      } else {
        if (st === 2 || st === 6 || st === 7 || st === 10 || st === 14 || st === 15) S.snare(t, 0.13, true);
      }

      // 3. フィールドタム（行進のアクセント・大太鼓の胴鳴り）
      if (bar % 4 === 3 && (st === 12 || st === 14)) {
        S.tom(t, st === 12 ? 95 : 75, 0.38);
      }

      // 4. 金属パルス（工場・兵器庫の規則正しい打音）
      if (st % 2 === 0) {
        S.hat(t, st % 4 === 2 ? 0.07 : 0.04);
      }

      // 5. ミリタリーベース（重厚な低音で歩幅を刻む）
      if (st % 4 === 0) {
        const rootMidi = ch[0] - 12;
        // 拍によってルートと5度を行き来する力強い軍隊ベースライン
        const note = st === 8 ? ch[2] - 12 : (st === 12 ? rootMidi + 12 : rootMidi);
        S.bass(t, midiHz(note), sd * 2.8, 0.32, { cut: 550, q: 2.5 });
      }

      // 6. 金管・ブラススタブ（軍楽隊の重厚なホーン）
      if (st === 0) {
        S.brass(t, ch.map(m => m + 12), sd * 3.5, 0.08);
      } else if (st === 6) {
        S.brass(t, ch.map(m => m + 12), sd * 1.6, 0.05);
      }

      // 7. 軍楽リード（勇壮なトランペット旋律）
      if (s.note) {
        S.lead(t, midiHz(s.note.m), sd * s.note.len, 0.095, 'sawtooth');
      }
    },
  },

  // 地区戦闘：鼓動音をイメージに少しホラーなテイスト（重低音重視）
  battle: {
    bpm: 116, swing: 0, vol: 0.85,
    sections: [
      // Section 0: 忍び寄る恐怖・蠢く異形（Cフリジアン・トライトーンの不穏な進行）
      { chords: ['Cm', 'Db', 'Cm', 'Gb', 'Cm', 'Db', 'Bbm', 'G'] },
      // Section 1: 狂気と接触・戦慄（背筋が凍る冷たい旋律）
      { chords: ['Cm', 'Db', 'Fm', 'Gb', 'Ab', 'Bbm', 'G', 'G'],
        lead: `C6 . . .  Db6 . . .  C6 . . .  Gb5 . . .
               r . . .   Eb6 . . .  D6 . . .  r . . .
               C6 . . .  Db6 . . .  F6 . . .  E6 . . .
               r . . .   Ab5 . . .  G5 . . .  r . . .` },
    ],
    step(S, s) {
      const { st, t, ch, sd, bar } = s;

      // 1. 心臓の鼓動（Heartbeat Sub-Kick）: 腹に響く超低音 Lub-Dub パルス
      // 第1心音（Lub: 深く重い心室収縮 46Hz->26Hz）
      if (st === 0 || st === 8) {
        S.heartbeat(t, 0.9, 'lub');
      }
      // 第2心音（Dub: 引き締まった弁閉鎖 56Hz->32Hz、約0.13秒後の16分音符2つ先）
      if (st === 2 || st === 10) {
        S.heartbeat(t, 0.8, 'dub');
      }
      // 後半（恐怖で動悸が跳ね上がるような不穏な脈動）
      if (s.lead && (st === 6 || st === 14)) {
        S.heartbeat(t, 0.55, 'lub');
      }

      // 2. 地底から蠢くホラー・サブドローン（Sub Drone）
      if (st === 0) {
        S.darkDrone(t, midiHz(ch[0] - 24), sd * 16, 0.28);
      }

      // 3. 冷たく金属的な不気味なパーカッション（時計の秒針や金属の軋み）
      if (st % 4 === 2) {
        S.hat(t, 0.065);
      } else if (st % 2 === 1 && bar % 2 === 1) {
        S.hat(t, 0.03);
      }

      // 4. 不気味なスネア/インダストリアル衝撃（鼓動の合間に鳴る遠くの物音）
      if (st === 4 || st === 12) {
        S.snare(t, 0.16, true);
      }

      // 5. 歪んだダーク・サブベース（鼓動の隙間を這う重低音）
      if (st === 4 || st === 12) {
        const rootMidi = ch[0] - 12;
        S.bass(t, midiHz(rootMidi), sd * 3.0, 0.26, { cut: 450, dist: true, q: 4 });
      } else if (st === 14 && bar % 2 === 1) {
        // 半音ずり上がる不協和音の低音
        const tritoneNote = ch[0] - 11;
        S.bass(t, midiHz(tritoneNote), sd * 1.8, 0.22, { cut: 600, dist: true });
      }

      // 6. 不気味なホラーパッド（減5度や短2度の冷気）
      if (st === 0 && !s.lead) {
        S.eeriePad(t, ch.map(m => m + 12), sd * 16, 0.05);
      }

      // 7. ホラーリード（氷のように冷たい高音の旋律・ベル）
      if (s.note) {
        S.lead(t, midiHz(s.note.m), sd * s.note.len, 0.08, 'triangle');
      }
    },
  },

  // ボス戦：パニック・モンスターホラー鼓動（暴威・凶悪サブベース・絶望）
  boss: {
    bpm: 144, swing: 0, vol: 0.88,
    sections: [
      { chords: ['Cm', 'Cm', 'Db', 'Db', 'Cm', 'Cm', 'Gb', 'G'] },
      { chords: ['Ab', 'Gb', 'Fm', 'Db', 'Ab', 'Gb', 'G', 'G'],
        lead: `C5 . . .  Db5 . . .  Eb5 . . .  D5 . . .
               C5 . . .  Gb4 . . .  G4 . . .   r . . .
               F5 . . .  Gb5 . . .  Ab5 . . .  G5 . . .
               Eb5 . . . D5 . . .   Db5 . . .  B4 . . .` },
    ],
    step(S, s) {
      const { st, t, ch, sd, bar } = s;

      // 1. 狂乱の激しい鼓動（タキカルディア：心拍数が跳ね上がり高速で連打される）
      if (st % 2 === 0) {
        S.heartbeat(t, st % 4 === 0 ? 0.95 : 0.82, st % 4 === 0 ? 'lub' : 'dub');
      }

      // 2. 地響きのようなスーパーサブキック
      if (st === 0 || st === 6 || st === 8 || st === 14) {
        S.kick(t, 0.7, { f: 90, f2: 24, dur: 0.35 });
      }

      // 3. インダストリアル・スネア＆重金属スラミング
      if (st === 4 || st === 12) {
        S.snare(t, 0.35);
        S.tom(t, 80, 0.3);
      }

      // 4. ハイハット（冷徹な連続刻み）
      S.hat(t, st % 2 === 0 ? 0.07 : 0.04);

      // 5. 凶悪な歪みアシッド・サブベース（激しい重低音の唸り）
      const bp = 'r.rr.rr.r.rr.ror'[st];
      if (bp !== '.') {
        const m = ch[0] - 24 + (bp === 'o' ? 12 : 0);
        S.bass(t, midiHz(m), sd * 1.5, 0.22, { cut: 850, dist: true });
      }

      // 6. 不協和音スタブ（怪異の咆哮）
      if (!s.lead && (st === 0 || st === 6 || st === 12)) {
        S.brass(t, ch.map(m => m + 12), sd * 2.0, 0.08);
      }

      // 7. 禍々しいボスリード
      if (s.note) {
        S.lead(t, midiHz(s.note.m), sd * s.note.len, 0.085, 'sawtooth');
      }
    },
  },
};

for (const tr of Object.values(BGM_TRACKS)) {
  for (const sec of tr.sections) sec.notes = sec.lead ? parseMelody(sec.lead) : null;
  tr.bars = tr.sections.reduce((n, sec) => n + sec.chords.length, 0);
}

// ---------------------------------------------------------------------
//  サウンド本体
// ---------------------------------------------------------------------
const Sound = {
  ctx: null,
  vol: { bgm: 0.6, se: 0.8 },
  mute: { bgm: false, se: false },
  last: {},          // 効果音ごとの最終再生時刻（連打の間引き）
  voices: [],        // 鳴っている効果音の終了予定時刻
  lis: { x: 0, y: 0, r: 30 },
  want: null,        // 鳴らしたい BGM（音声の有効化前に指定されたもの）
  cur: null,         // 再生中の BGM { name, tr, gain, step, next }
  ducked: false,
  oreChain: 0, oreT: 0,

  init() {
    try {
      const s = JSON.parse(localStorage.getItem(SOUND_KEY));
      if (s) { Object.assign(this.vol, s.vol); Object.assign(this.mute, s.mute); }
    } catch (e) { /* 設定なし */ }
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
    // ボタン類のクリック音（個別の効果音を鳴らす要素は除く）
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.matches('.up-btn, #btn-sortie, #rep-retry')) return;
      this.play('ui');
    });
    document.addEventListener('input', (e) => {
      if (e.target.matches('input[type=range]') && !e.target.closest('#sound-ctl')) this.play('tick');
    });
    this.buildPanel();
  },

  persist() {
    try { localStorage.setItem(SOUND_KEY, JSON.stringify({ vol: this.vol, mute: this.mute })); } catch (e) { /* 保存不可 */ }
  },

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();

      // マスター・ダイナミクスコンプレッサー（低音を太く接着し、クリッピングを防止）
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -8;
      this.comp.knee.value = 8;
      this.comp.ratio.value = 10;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.18;
      this.comp.connect(ctx.destination);

      // 低音域を豊かに厚くするマスタリング・ローシェルフEQ（+3.5dB @ 150Hz）
      this.subEnhancer = ctx.createBiquadFilter();
      this.subEnhancer.type = 'lowshelf';
      this.subEnhancer.frequency.value = 150;
      this.subEnhancer.gain.value = 3.5;
      this.subEnhancer.connect(this.comp);

      this.sfxBus = ctx.createGain();
      this.bgmBus = ctx.createGain();
      this.sfxBus.connect(this.subEnhancer);
      this.bgmBus.connect(this.subEnhancer);

      // BGM のリード用ディレイ
      this.delay = ctx.createDelay(1);
      this.delayFb = ctx.createGain();
      this.delayFb.gain.value = 0.32;
      this.delayOut = ctx.createGain();
      this.delayOut.gain.value = 0.35;
      this.delay.connect(this.delayFb).connect(this.delay);
      this.delay.connect(this.delayOut).connect(this.bgmBus);

      // ホワイトノイズ用バッファ
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      // ディストーション（ソフトサチュレーション）カーブ
      this.distCurve = new Float32Array(257);
      for (let i = 0; i < 257; i++) this.distCurve[i] = Math.tanh((i / 128 - 1) * 3);

      this.applyVolume();
      this.timer = setInterval(() => this.schedule(), 25);
    }
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
    if (this.want && (!this.cur || this.cur.name !== this.want)) this.startBgm(this.want);
  },

  applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(this.mute.se ? 0 : this.vol.se * 0.85, t, 0.03);
    this.bgmBus.gain.setTargetAtTime(this.mute.bgm ? 0 : this.vol.bgm * (this.ducked ? 0.35 : 1) * 0.65, t, 0.08);
  },

  // ------------------------------------------------------------ 音量パネル
  buildPanel() {
    const el = document.createElement('div');
    el.id = 'sound-ctl';
    el.innerHTML = ['bgm', 'se'].map(k => `
      <button data-k="${k}" title="${k === 'bgm' ? 'BGM' : '効果音'}のオン／オフ">${k === 'bgm' ? '♪ BGM' : '🔊 SE'}</button>
      <input type="range" data-k="${k}" min="0" max="100" step="5" title="${k === 'bgm' ? 'BGM' : '効果音'}の音量">`).join('');
    document.body.appendChild(el);
    const sync = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('off', this.mute[b.dataset.k]));
    el.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        this.mute[b.dataset.k] = !this.mute[b.dataset.k];
        sync(); this.applyVolume(); this.persist();
        b.blur();
      };
    });
    el.querySelectorAll('input').forEach(r => {
      r.value = Math.round(this.vol[r.dataset.k] * 100);
      r.oninput = () => {
        this.vol[r.dataset.k] = +r.value / 100;
        this.mute[r.dataset.k] = false;
        sync(); this.applyVolume(); this.persist();
        if (r.dataset.k === 'se') this.play('tick');
      };
      r.onchange = () => r.blur();
    });
    sync();
  },

  // ------------------------------------------------------------ 効果音
  listen(x, y, r) { this.lis.x = x; this.lis.y = y; this.lis.r = r; },

  play(name, o = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.mute.se) return;
    const def = SFX[name];
    if (!def) return;
    const now = ctx.currentTime;
    if (now - (this.last[name] || -1) < def.gap) return;
    this.voices = this.voices.filter(v => v > now);
    if (this.voices.length > 28) return;
    let g = o.vol == null ? 1 : o.vol, pan = 0;
    if (o.x != null) {
      const L = this.lis, dx = o.x - L.x, d = Math.hypot(dx, o.y - L.y);
      if (d > L.r) g *= Math.max(0, 1 - (d - L.r) / (L.r * 1.5));
      if (g < 0.05) return;
      pan = clamp(dx / L.r, -1, 1) * 0.7;
    }
    this.last[name] = now;
    const out = ctx.createGain();
    out.gain.value = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p).connect(this.sfxBus);
    } else out.connect(this.sfxBus);
    const len = def.play(this, now + 0.005, out, o);
    this.voices.push(now + len);
  },

  // 包絡線（アタック → 指数減衰）
  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + 0.01));
  },

  // 発振器1音
  tone(out, t, o) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) {
      if (o.curve === 'lin') osc.frequency.linearRampToValueAtTime(o.f2, t + o.dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + o.dur);
    }
    if (o.vib) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = o.vib[0];
      lg.gain.value = o.f * o.vib[1] / 100;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t); lfo.stop(t + o.dur + 0.05);
    }
    let node = osc;
    if (o.filt) {
      const f = ctx.createBiquadFilter();
      f.type = o.filt;
      f.frequency.value = o.ff || 1000;
      node = node.connect(f);
    }
    this.env(g, t, o.a || 0.004, o.vol, o.dur);
    node.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  },

  // ノイズ1音
  noise(out, t, o) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = this.noiseBuf;
    src.loop = true;
    f.type = o.filt || 'lowpass';
    f.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.dur);
    if (o.q) f.Q.value = o.q;
    this.env(g, t, o.a || 0.003, o.vol, o.dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.8);
    src.stop(t + o.dur + 0.05);
  },

  // ------------------------------------------------------------ BGM
  playBgm(name) {
    this.want = name;
    if (!this.ctx) return;
    if (this.cur && this.cur.name === name) return;
    this.startBgm(name);
  },

  stopBgm(fade = 1) {
    this.want = null;
    this.fadeOut(fade);
  },

  fadeOut(fade) {
    const c = this.cur;
    if (!c) return;
    const t = this.ctx.currentTime, g = c.gain.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    g.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => c.gain.disconnect(), fade * 1000 + 3000);
    this.cur = null;
  },

  startBgm(name) {
    this.fadeOut(0.8);
    const tr = BGM_TRACKS[name];
    if (!tr) return;
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(tr.vol, t + 0.6);
    gain.connect(this.bgmBus);
    this.delay.delayTime.setValueAtTime(60 / tr.bpm * 0.75, t);
    this.cur = { name, tr, gain, step: 0, next: t + 0.1 };
  },

  duck(on) {
    if (this.ducked === on) return;
    this.ducked = on;
    this.applyVolume();
  },

  schedule() {
    const c = this.cur, ctx = this.ctx;
    if (!c || ctx.state !== 'running') return;
    const tr = c.tr, sd = 60 / tr.bpm / 4;
    if (c.next < ctx.currentTime - 0.2) c.next = ctx.currentTime + 0.05;
    while (c.next < ctx.currentTime + 0.12) {
      const bar = Math.floor(c.step / 16) % tr.bars, st = c.step % 16;
      let b = bar, sec = tr.sections[0];
      for (const s of tr.sections) { sec = s; if (b < s.chords.length) break; b -= s.chords.length; }
      const t = c.next + (st % 2 ? tr.swing * sd : 0);
      this.out = c.gain;
      tr.step(this, {
        bar, st, t, sd, ch: chordMidi(sec.chords[b]),
        lead: !!sec.notes, note: sec.notes ? sec.notes.get(b * 16 + st) : null,
      });
      c.step++;
      c.next += sd;
    }
  },

  // ------------------------------------------------------------ 楽器群（低音強化・ミリタリー・ホラー用）
  // 重厚なバスドラム
  kick(t, v, o = {}) {
    const f = o.f || 120, f2 = o.f2 || 32, dur = o.dur || 0.3;
    this.tone(this.out, t, { type: 'sine', f, f2, dur, vol: v });
    if (o.punch !== false) {
      this.tone(this.out, t, { type: 'triangle', f: f * 1.4, f2: f2 * 1.2, dur: dur * 0.35, vol: v * 0.35 });
    }
  },

  // 心臓の鼓動（Lub-Dub：超低音パルス）
  heartbeat(t, v = 0.8, type = 'lub') {
    if (type === 'lub') {
      // 第1心音（深く重い心室収縮：46Hz -> 26Hz）
      this.tone(this.out, t, { type: 'sine', f: 46, f2: 26, dur: 0.24, vol: v, a: 0.015 });
      this.tone(this.out, t, { type: 'triangle', f: 88, f2: 42, dur: 0.16, vol: v * 0.35, a: 0.01 });
      this.noise(this.out, t, { dur: 0.12, vol: v * 0.18, filt: 'lowpass', f: 160, f2: 45 });
    } else {
      // 第2心音（少し短く引き締まった閉鎖音：56Hz -> 32Hz）
      this.tone(this.out, t, { type: 'sine', f: 56, f2: 32, dur: 0.16, vol: v * 0.85, a: 0.01 });
      this.tone(this.out, t, { type: 'triangle', f: 105, f2: 50, dur: 0.12, vol: v * 0.25, a: 0.008 });
      this.noise(this.out, t, { dur: 0.09, vol: v * 0.14, filt: 'lowpass', f: 200, f2: 60 });
    }
  },

  // スネアドラム（軍隊マーチング用スナッピー＆リム）
  snare(t, v, rim = false) {
    if (rim) {
      this.noise(this.out, t, { dur: 0.04, vol: v * 0.85, filt: 'bandpass', f: 2800, q: 4 });
      this.tone(this.out, t, { type: 'triangle', f: 360, f2: 200, dur: 0.03, vol: v * 0.3 });
      return;
    }
    this.noise(this.out, t, { dur: 0.15, vol: v, filt: 'highpass', f: 1500 });
    this.noise(this.out, t, { dur: 0.08, vol: v * 0.7, filt: 'bandpass', f: 3200, q: 2 });
    this.tone(this.out, t, { type: 'triangle', f: 220, f2: 120, dur: 0.08, vol: v * 0.65 });
  },

  hat(t, v, open = false) {
    this.noise(this.out, t, { dur: open ? 0.16 : 0.035, vol: v, filt: 'highpass', f: 7200 });
  },

  tom(t, f, v) {
    this.tone(this.out, t, { type: 'sine', f, f2: f * 0.55, dur: 0.24, vol: v });
    this.tone(this.out, t, { type: 'triangle', f: f * 1.2, f2: f * 0.6, dur: 0.12, vol: v * 0.3 });
  },

  // 重厚な低音ベース（サブベースサイン波レイヤー付き）
  bass(t, f, dur, v, o = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
    osc.type = o.type || 'sawtooth';
    osc.frequency.value = f;
    flt.type = 'lowpass';
    flt.Q.value = o.q || 3.5;
    const cut = o.cut || 650;
    flt.frequency.setValueAtTime(cut, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(70, cut * 0.25), t + dur);
    this.env(g, t, o.a || 0.008, v, dur);
    let node = osc.connect(flt);
    if (o.dist) {
      const ws = ctx.createWaveShaper();
      ws.curve = this.distCurve;
      node = node.connect(ws);
    }

    // サブベースサイン波をレイヤーして腹に響く低音を強烈に補強
    const subOsc = ctx.createOscillator(), subG = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.value = f > 75 ? f / 2 : f;
    this.env(subG, t, 0.01, v * 0.85, dur);
    subOsc.connect(subG).connect(this.out);
    subOsc.start(t);
    subOsc.stop(t + dur + 0.05);

    node.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  },

  // 軍楽・行進用ミリタリーブラス（金管アンサンブル）
  brass(t, notes, dur, v) {
    const ctx = this.ctx;
    if (!Array.isArray(notes)) notes = [notes];
    for (const m of notes) {
      const freq = typeof m === 'number' ? midiHz(m) : m;
      const osc = ctx.createOscillator(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      flt.type = 'lowpass';
      flt.Q.value = 2.5;
      flt.frequency.setValueAtTime(450, t);
      flt.frequency.exponentialRampToValueAtTime(2200, t + Math.min(0.08, dur * 0.3));
      flt.frequency.exponentialRampToValueAtTime(650, t + dur);
      this.env(g, t, 0.02, v, dur);
      osc.connect(flt).connect(g).connect(this.out);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  },

  // 地底から蠢くホラー・サブドローン
  darkDrone(t, f, dur, v) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = Math.max(28, f);
    lfo.frequency.value = 0.45;
    lg.gain.value = 35;
    lfo.connect(lg).connect(flt.frequency);
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(120, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(flt).connect(g).connect(this.out);
    osc.start(t); lfo.start(t);
    osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  },

  // 不協和音ホラーパッド
  eeriePad(t, notes, dur, v) {
    const ctx = this.ctx;
    const flt = ctx.createBiquadFilter(), g = ctx.createGain();
    flt.type = 'bandpass';
    flt.frequency.value = 650;
    flt.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + Math.min(0.6, dur * 0.3));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    flt.connect(g).connect(this.out);
    for (const m of notes) {
      for (const det of [-12, 12]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiHz(m);
        osc.detune.value = det;
        osc.connect(flt);
        osc.start(t);
        osc.stop(t + dur + 0.1);
      }
    }
  },

  pluck(t, f, dur, v, type = 'triangle') {
    this.tone(this.out, t, { type, f, dur: Math.min(dur, 0.35), vol: v, filt: 'lowpass', ff: 2800 });
  },

  lead(t, f, dur, v, type = 'sawtooth') {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    osc.type = type;
    osc.frequency.value = f;
    lfo.frequency.value = 5.2;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(dur, 0.35));
    lfo.connect(lg).connect(osc.frequency);
    flt.type = 'lowpass';
    flt.frequency.value = type === 'triangle' ? 3600 : 2400;
    const rel = Math.min(0.1, dur * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.012);
    g.gain.setValueAtTime(v * 0.8, t + dur - rel);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(flt).connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    osc.start(t); lfo.start(t);
    osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  },

  pad(t, notes, dur, v) {
    const ctx = this.ctx;
    const flt = ctx.createBiquadFilter(), g = ctx.createGain();
    flt.type = 'lowpass';
    flt.frequency.value = 850;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.5, dur * 0.3));
    g.gain.setValueAtTime(v, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    flt.connect(g).connect(this.out);
    for (const m of notes) {
      for (const det of [-8, 8]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiHz(m);
        osc.detune.value = det;
        osc.connect(flt);
        osc.start(t);
        osc.stop(t + dur + 0.35);
      }
    }
  },

  stab(t, notes, v) {
    for (const m of notes) this.tone(this.out, t, { type: 'sawtooth', f: midiHz(m), dur: 0.14, vol: v, filt: 'lowpass', ff: 2000 });
  },
};
