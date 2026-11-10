'use strict';
// =====================================================================
//  フィールドの形：移動できる範囲・地区の封鎖・敵の進む向き・地面とミニマップの描画
//    strip … 横に並ぶ長方形の地区（荒野）
//    disc  … 中心の円から外側の輪へ広がっていく円形の地区（洞窟）
//  開放状態は w.open（開放済みの地区数）と w.full（封鎖がすべて解けた＝ボス戦）で表す
// =====================================================================

const DISC_PAD = 14;   // 円形フィールドの外側に描く岩壁の厚み（m）

// 封鎖線の発光
function gateStyle(ctx, w) {
  const pulse = 0.55 + 0.45 * Math.sin(w.time * 4);
  ctx.strokeStyle = `rgba(255,140,40,${0.5 + 0.4 * pulse})`;
  ctx.shadowColor = '#ff8a2a';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([1.5, 1]);
}

// 封鎖中の地区名
function sealedLabel(ctx, D, x, y) {
  ctx.fillStyle = 'rgba(255,200,140,0.55)';
  ctx.font = 'bold 4.5px sans-serif';
  ctx.fillText(districtLabel(D), x, y - 3);
  ctx.font = 'bold 3px sans-serif';
  ctx.fillStyle = 'rgba(255,150,80,0.55)';
  ctx.fillText(T('B067' /* 封鎖中 */), x, y + 3);
}

// ミニマップの地区名の色
function mapLabelColor(sealed, done) {
  return sealed ? 'rgba(255,150,80,0.6)' : done ? 'rgba(140,255,170,0.6)' : 'rgba(255,230,180,0.6)';
}

// ---------------------------------------------------------------------
//  strip：横に並ぶ長方形の地区
// ---------------------------------------------------------------------
const STRIP_SHAPE = {
  size(F) { return { FW: F.dw * F.districts.length, H: F.h }; },
  start(F) { return { x: F.dw / 2, y: F.h / 2, a: -Math.PI / 2 }; },
  init() {},
  // 開放されている範囲の右端
  openW(w) { return w.full ? w.FW : w.open * w.field.dw; },

  // 点が移動できる範囲の内側にあるか（m だけ内側に縮めて判定）
  inside(w, x, y, m) {
    return x >= m && y >= m && x <= this.openW(w) - m && y <= w.H - m;
  },
  clamp(w, o) {
    o.x = clamp(o.x, o.r, this.openW(w) - o.r);
    o.y = clamp(o.y, o.r, w.H - o.r);
  },
  randomPoint(w, di, m) {
    const dw = w.field.dw;
    return { x: rand(di * dw + m, (di + 1) * dw - m), y: rand(m, w.H - m) };
  },
  // 岩を置ける場所：外周から離し、出撃地点と地区の境界（封鎖線）の付近は空ける
  rockOk(w, x, y, r) {
    const dw = w.field.dw, s = w.start;
    return x >= r + 5 && y >= r + 5 && x <= w.FW - r - 5 && y <= w.H - r - 5 &&
      Math.hypot(x - s.x, y - s.y) >= 24 &&
      Math.abs(((x + dw / 2) % dw) - dw / 2) >= 9;
  },
  los() { return true; },
  dirTo(w, e, tx, ty) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 0.001;
    return [dx / d, dy / d];
  },

  drawGround(ctx, w, v) {
    const F = w.field;
    if (!groundPattern) groundPattern = makeGroundPattern(ctx);
    ctx.fillStyle = groundPattern;
    ctx.fillRect(Math.max(0, v.x0), Math.max(0, v.y0), Math.min(w.FW, v.x1) - Math.max(0, v.x0), Math.min(w.H, v.y1) - Math.max(0, v.y0));
    F.districts.forEach((D, i) => {
      ctx.fillStyle = D.tint;
      ctx.fillRect(i * F.dw, 0, F.dw, w.H);
    });
    ctx.strokeStyle = '#5a3d22';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0, 0, w.FW, w.H);
    // 開放済みの地区境界
    ctx.save();
    ctx.strokeStyle = 'rgba(255,230,180,0.25)';
    ctx.lineWidth = 0.3;
    ctx.setLineDash([2, 2]);
    const W = this.openW(w);
    for (let i = 1; i * F.dw < W; i++) {
      ctx.beginPath(); ctx.moveTo(i * F.dw, 0); ctx.lineTo(i * F.dw, w.H); ctx.stroke();
    }
    ctx.restore();
  },

  // 未開放の地区：暗幕と封鎖線
  drawSealed(ctx, w) {
    const F = w.field, W = this.openW(w);
    if (W >= w.FW) return;
    ctx.save();
    ctx.fillStyle = 'rgba(12,9,6,0.62)';
    ctx.fillRect(W, 0, w.FW - W, w.H);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = W - w.H; x < w.FW; x += 6) {
      ctx.moveTo(Math.max(W, x), Math.max(0, W - x));
      ctx.lineTo(Math.min(w.FW, x + w.H), Math.min(w.H, w.FW - x));
    }
    ctx.stroke();
    gateStyle(ctx, w);
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, w.H); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = w.open; i < F.districts.length; i++) sealedLabel(ctx, F.districts[i], (i + 0.5) * F.dw, w.H / 2);
    ctx.restore();
  },

  // ミニマップの背景（右上 right, top に置く）。敵などを描くための位置と縮尺を返す
  // max：幅の上限（狭い画面で小さくする）。小さいときは地区名を省く
  minimap(ctx, w, right, top, max = Infinity) {
    const F = w.field, mmw = Math.min(270, max), k = mmw / w.FW, mmh = w.H * k, mx = right - mmw, my = top;
    const W = this.openW(w);
    hudPanel(ctx, mx, my, mmw, mmh);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(mx + W * k, my, (w.FW - W) * k, mmh);
    ctx.textAlign = 'center';
    ctx.font = '10px sans-serif';
    F.districts.forEach((D, i) => {
      if (i > 0) {
        ctx.strokeStyle = 'rgba(255,220,170,0.25)';
        ctx.beginPath(); ctx.moveTo(mx + i * F.dw * k + 0.5, my); ctx.lineTo(mx + i * F.dw * k + 0.5, my + mmh); ctx.stroke();
      }
      if (mmw < 200) return;
      const sealed = i >= w.open && !w.full, done = w.stats.res[i] === 'clear';
      ctx.fillStyle = mapLabelColor(sealed, done);
      ctx.fillText(`${D.name}${sealed ? T('B068' /* （封鎖） */) : done ? T('B069' /* （掃討済） */) : ''}`, mx + (i + 0.5) * F.dw * k, my + mmh + 3);
    });
    ctx.textAlign = 'left';
    if (W < w.FW) {
      ctx.strokeStyle = 'rgba(255,140,40,0.9)';
      ctx.beginPath(); ctx.moveTo(mx + W * k + 0.5, my); ctx.lineTo(mx + W * k + 0.5, my + mmh); ctx.stroke();
    }
    return { mx, my, k };
  },
};

// ---------------------------------------------------------------------
//  disc：円形のフィールド。中心の円が第1地区で、外側の輪へ順に広がっていく
//  F.radii = 各地区の外周の半径（内側から順に）
// ---------------------------------------------------------------------
let caveFloorPattern = null, caveWallPattern = null;

function makeCavePattern(ctx, base, blots, specks, cracks) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = rand(14, 48);
    const col = pick(blots);
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 2200; i++) {
    const [r0, g0, b0] = pick(specks);
    g.fillStyle = `rgba(${r0},${g0},${b0},${rand(0.1, 0.35)})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, rand(1, 2.5), rand(1, 2.5));
  }
  g.strokeStyle = cracks;
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    let x = Math.random() * 256, y = Math.random() * 256;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += rand(-18, 18); y += rand(-18, 18); g.lineTo(x, y); }
    g.stroke();
  }
  const pat = ctx.createPattern(c, 'repeat');
  if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / 8));
  return pat;
}

// 洞窟の床と岩壁の模様（初めて使うときに作る。地底エリアの岩壁にも使う）
function makeCavePatterns(ctx) {
  if (caveFloorPattern) return;
  caveFloorPattern = makeCavePattern(ctx, '#3e3b42',
    ['rgba(20,18,26,0.25)', 'rgba(95,95,115,0.16)'], [[90, 88, 100], [40, 38, 46], [120, 125, 140]], 'rgba(15,12,18,0.35)');
  caveWallPattern = makeCavePattern(ctx, '#1f1c21',
    ['rgba(0,0,0,0.35)', 'rgba(70,64,74,0.25)'], [[60, 56, 64], [10, 8, 12], [90, 86, 96]], 'rgba(0,0,0,0.5)');
}

// 中心 (cx,cy)、半径 r0〜r1 の輪（r0 = 0 なら円）
function annulusPath(ctx, cx, cy, r0, r1) {
  ctx.beginPath();
  ctx.arc(cx, cy, r1, 0, Math.PI * 2);
  if (r0 > 0) {
    ctx.moveTo(cx + r0, cy);
    ctx.arc(cx, cy, r0, 0, Math.PI * 2, true);
  }
}

const DISC_SHAPE = {
  labelA: -Math.PI / 2,   // ミニマップの番号を置く向き（真上）

  size(F) { const s = 2 * (F.radii[F.radii.length - 1] + DISC_PAD); return { FW: s, H: s }; },
  // 出撃地点：円の中心
  start(F) { const c = F.radii[F.radii.length - 1] + DISC_PAD; return { x: c, y: c, a: -Math.PI / 2 }; },
  // 外周の岩壁の縁のでこぼこ（内側へ最大 0.9m 張り出す。当たり判定は円のまま）
  init(w) {
    const R = this.outerR(w.field), c = w.FW / 2, n = 400;
    const ph = [rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)];
    w.discEdge = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      const j = 0.45 + 0.2 * Math.sin(a * 11 + ph[0]) + 0.15 * Math.sin(a * 29 + ph[1]) + 0.1 * Math.sin(a * 53 + ph[2]);
      w.discEdge.push([c + Math.cos(a) * (R - j), c + Math.sin(a) * (R - j)]);
    }
  },
  outerR(F) { return F.radii[F.radii.length - 1]; },
  innerR(F, i) { return i > 0 ? F.radii[i - 1] : 0; },
  // 開放されている範囲の半径
  openR(w) { return w.full ? this.outerR(w.field) : w.field.radii[w.open - 1]; },

  inside(w, x, y, m) {
    const c = w.FW / 2;
    return Math.hypot(x - c, y - c) <= this.openR(w) - m;
  },
  clamp(w, o) {
    const c = w.FW / 2, dx = o.x - c, dy = o.y - c, d = Math.hypot(dx, dy), lim = this.openR(w) - o.r;
    if (d > lim) {
      o.x = c + dx / d * lim;
      o.y = c + dy / d * lim;
    }
  },
  // 地区 di の中のランダムな位置（面積あたり均等）
  randomPoint(w, di, m) {
    const F = w.field, c = w.FW / 2;
    const r0 = di > 0 ? this.innerR(F, di) + m : 0, r1 = F.radii[di] - m;
    const r = Math.sqrt(rand(r0 * r0, r1 * r1)), a = rand(0, Math.PI * 2);
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
  },
  // 岩を置ける場所：出撃地点（中心）と地区の境界（封鎖線）・外周の付近は空ける
  rockOk(w, x, y, r) {
    const F = w.field, c = w.FW / 2, d = Math.hypot(x - c, y - c);
    if (d < 24) return false;
    return F.radii.every(b => Math.abs(d - b) >= r + 5);
  },
  los() { return true; },
  dirTo(w, e, tx, ty) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 0.001;
    return [dx / d, dy / d];
  },

  edgePath(ctx, w) {
    ctx.beginPath();
    w.discEdge.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath();
  },

  drawGround(ctx, w, v) {
    const F = w.field, c = w.FW / 2;
    makeCavePatterns(ctx);
    // 岩壁（視界全体を塗ってから床の円を描く）
    ctx.fillStyle = caveWallPattern;
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    this.edgePath(ctx, w);
    ctx.fillStyle = caveFloorPattern;
    ctx.fill();
    F.districts.forEach((D, i) => {
      ctx.fillStyle = D.tint;
      annulusPath(ctx, c, c, this.innerR(F, i), F.radii[i]);
      ctx.fill('evenodd');
    });
    // 外周の岩壁の縁取り
    this.edgePath(ctx, w);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(160,155,185,0.22)';
    ctx.lineWidth = 0.3;
    ctx.stroke();
    // 開放済みの地区境界
    ctx.save();
    ctx.strokeStyle = 'rgba(200,220,255,0.2)';
    ctx.lineWidth = 0.3;
    ctx.setLineDash([2, 2]);
    const n = w.full ? F.radii.length - 1 : w.open - 1;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(c, c, F.radii[i], 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  // 未開放の地区：外側の暗幕と円形の封鎖線
  drawSealed(ctx, w) {
    if (w.full) return;
    const F = w.field, c = w.FW / 2, R = this.openR(w);
    ctx.save();
    annulusPath(ctx, c, c, R, this.outerR(F) + 1);
    ctx.fillStyle = 'rgba(4,4,10,0.72)';
    ctx.fill('evenodd');
    gateStyle(ctx, w);
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 地区名は重ならないよう、次の地区は真上・その次は右下…と向きをずらして置く
    for (let i = w.open; i < F.districts.length; i++) {
      const rm = (this.innerR(F, i) + F.radii[i]) / 2, a = -Math.PI / 2 + (i - w.open) * Math.PI * 2 / 3;
      sealedLabel(ctx, F.districts[i], c + Math.cos(a) * rm, c + Math.sin(a) * rm);
    }
    ctx.restore();
  },

  minimap(ctx, w, right, top, max = Infinity) {
    const F = w.field, size = Math.min(170, max), k = size / w.FW, mx = right - size, my = top;
    const cx = mx + w.FW / 2 * k, cy = my + w.FW / 2 * k;
    hudPanel(ctx, mx, my, size, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px sans-serif';
    ctx.lineWidth = 1;
    F.districts.forEach((D, i) => {
      const sealed = i >= w.open && !w.full, done = w.stats.res[i] === 'clear';
      const r0 = this.innerR(F, i), r1 = F.radii[i];
      annulusPath(ctx, cx, cy, r0 * k, r1 * k);
      ctx.fillStyle = sealed ? 'rgba(0,0,0,0.55)' : 'rgba(255,230,180,0.08)';
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,220,170,0.25)';
      ctx.beginPath();
      ctx.arc(cx, cy, r1 * k, 0, Math.PI * 2);
      ctx.stroke();
      const rm = i > 0 ? (r0 + r1) / 2 : r1 * 0.55;
      ctx.fillStyle = mapLabelColor(sealed, done);
      ctx.fillText(String(i + 1), cx + Math.cos(this.labelA) * rm * k, cy + Math.sin(this.labelA) * rm * k);
    });
    if (!w.full) {
      ctx.strokeStyle = 'rgba(255,140,40,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, this.openR(w) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    return { mx, my, k };
  },
};

// ---------------------------------------------------------------------
//  arena：対戦の闘技場（versus.js）。半径 VS.r0 の砂の円を、鋼の床と電磁柵が囲む
//  動ける範囲は w.arenaR（時間がたつと外周の電磁柵が狭まる）
// ---------------------------------------------------------------------
const ARENA_PAD = 12;   // 闘技場の外側に描く鋼の床の幅（m）
let arenaSteelPattern = null;

function makeSteelPattern(ctx) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2d30';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 62, 62);
  g.strokeStyle = 'rgba(150,160,170,0.12)';
  g.lineWidth = 1;
  g.strokeRect(3, 3, 58, 58);
  g.fillStyle = 'rgba(160,170,180,0.25)';
  for (const [x, y] of [[7, 7], [57, 7], [7, 57], [57, 57]]) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
  const pat = ctx.createPattern(c, 'repeat');
  if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / 16));   // 4m 四方の鋼板
  return pat;
}

const ARENA_SHAPE = {
  size() { const s = 2 * (VS.r0 + ARENA_PAD); return { FW: s, H: s }; },
  start() { const c = VS.r0 + ARENA_PAD; return { x: c, y: c, a: 0 }; },
  init() {},
  openR(w) { return w.arenaR; },
  inside(w, x, y, m) {
    const c = w.FW / 2;
    return Math.hypot(x - c, y - c) <= w.arenaR - m;
  },
  clamp(w, o) {
    const c = w.FW / 2, dx = o.x - c, dy = o.y - c, d = Math.hypot(dx, dy), lim = w.arenaR - o.r;
    if (d > lim && d > 0) {
      o.x = c + dx / d * lim;
      o.y = c + dy / d * lim;
    }
  },
  randomPoint(w, di, m) {
    const c = w.FW / 2, r = Math.sqrt(rand(0, (VS.r0 - m) ** 2)), a = rand(0, Math.PI * 2);
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
  },
  rockOk() { return true; },
  los() { return true; },
  dirTo(w, e, tx, ty) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 0.001;
    return [dx / d, dy / d];
  },

  drawGround(ctx, w, v) {
    const c = w.FW / 2, R = VS.r0;
    if (!groundPattern) groundPattern = makeGroundPattern(ctx);
    if (!arenaSteelPattern) arenaSteelPattern = makeSteelPattern(ctx);
    ctx.fillStyle = arenaSteelPattern;
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fillStyle = groundPattern;
    ctx.fill();
    ctx.clip();
    // 白線：中央の円・中心線・開始位置（自機は青、相手は赤）
    ctx.strokeStyle = 'rgba(240,230,210,0.22)';
    ctx.lineWidth = 0.25;
    circle(ctx, c, c, 6); ctx.stroke();
    circle(ctx, c, c, R * 0.62); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.stroke();
    for (const [k, col] of [[-1, 'rgba(90,170,255,0.35)'], [1, 'rgba(255,100,80,0.35)']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 0.35;
      circle(ctx, c + k * VS.gap / 2, c, 2.4); ctx.stroke();
    }
    ctx.restore();
    // 縁石
    ctx.strokeStyle = '#4a4036';
    ctx.lineWidth = 1.2;
    circle(ctx, c, c, R + 0.6); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,170,0.18)';
    ctx.lineWidth = 0.2;
    circle(ctx, c, c, R); ctx.stroke();
  },

  // 外周の電磁柵。狭まった外側は暗くして、柵を赤く光らせる
  drawSealed(ctx, w) {
    const c = w.FW / 2, R = w.arenaR, closing = R < VS.r0 - 0.01;
    ctx.save();
    if (closing) {
      annulusPath(ctx, c, c, R, VS.r0 + ARENA_PAD * 2);
      ctx.fillStyle = 'rgba(40,6,4,0.45)';
      ctx.fill('evenodd');
    }
    const pulse = 0.55 + 0.45 * Math.sin(w.time * (closing ? 8 : 3));
    ctx.strokeStyle = closing ? `rgba(255,90,50,${0.55 + 0.4 * pulse})` : `rgba(110,220,255,${0.3 + 0.3 * pulse})`;
    ctx.shadowColor = closing ? '#ff5a2a' : '#6adcff';
    ctx.shadowBlur = 10;
    ctx.lineWidth = closing ? 0.45 : 0.3;
    ctx.setLineDash([1.6, 0.8]);
    circle(ctx, c, c, R); ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // 柵の支柱（15°ごと）
    ctx.fillStyle = closing ? '#ff8a5a' : '#9adcf0';
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      circle(ctx, c + Math.cos(a) * R, c + Math.sin(a) * R, 0.32); ctx.fill();
    }
    ctx.restore();
  },

  minimap(ctx, w, right, top, max = Infinity) {
    const size = Math.min(150, max), k = size / w.FW, mx = right - size, my = top;
    hudPanel(ctx, mx, my, size, size);
    ctx.strokeStyle = 'rgba(255,220,170,0.35)';
    circle(ctx, mx + w.FW / 2 * k, my + w.FW / 2 * k, w.arenaR * k); ctx.stroke();
    return { mx, my, k };
  },
};

// ---------------------------------------------------------------------
//  abyss：地底エリアの聖域（abyss.js）。半径 ABYSS.r0 の石板の床を、光る結界と石柱が囲む
//  動ける範囲は w.arenaR（時間がたつと結界が狭まる）。床の紋様は大地の脈動で赤く光る
// ---------------------------------------------------------------------
const ABYSS_PAD = 14;   // 聖域の外側に描く岩壁の幅（m）
let abyssSlabPattern = null;

// 4m 四方に 2m 角の石板を 2×2 並べた模様
function makeSlabPattern(ctx) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#1c1a20';
  g.fillRect(0, 0, 64, 64);
  for (const [x, y] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
    g.fillStyle = pick(['#2e2b35', '#29262f', '#312e39', '#2b2832']);
    g.fillRect(x + 1, y + 1, 30, 30);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${pick(['120,115,135', '10,8,14', '80,76,92'])},${rand(0.1, 0.3)})`;
      g.fillRect(x + 1 + Math.random() * 29, y + 1 + Math.random() * 29, rand(0.6, 1.6), rand(0.6, 1.6));
    }
    g.strokeStyle = 'rgba(150,145,170,0.08)';
    g.strokeRect(x + 2.5, y + 2.5, 27, 27);
  }
  const pat = ctx.createPattern(c, 'repeat');
  if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / 16));
  return pat;
}

// 紋様の色：ふだんは青緑、脈動中は赤（a = 不透明度）
function abyssRuneColor(w, a) {
  const k = w.surge.k, b = k > 0 ? surgeBreath(w) : 0.5;
  const r = 90 + (255 - 90) * k, g = 210 + (60 - 210) * k, bl = 230 + (40 - 230) * k;
  return `rgba(${r | 0},${g | 0},${bl | 0},${a * (0.55 + 0.45 * (k > 0 ? b : 0.5 + 0.5 * Math.sin(w.time * 1.2)))})`;
}

const ABYSS_SHAPE = {
  size() { const s = 2 * (ABYSS.r0 + ABYSS_PAD); return { FW: s, H: s }; },
  start() { const c = ABYSS.r0 + ABYSS_PAD; return { x: c, y: c, a: 0 }; },
  // 聖域の外周に並ぶ石柱（見た目だけ。結界の外なので当たり判定は要らない）
  init(w) {
    const c = w.FW / 2;
    w.pillars = [];
    for (let i = 0; i < 12; i++) {
      const a = (i + 0.5) / 12 * Math.PI * 2;
      w.pillars.push({ x: c + Math.cos(a) * (ABYSS.r0 + 5), y: c + Math.sin(a) * (ABYSS.r0 + 5), a });
    }
  },
  openR(w) { return w.arenaR; },
  inside(w, x, y, m) {
    const c = w.FW / 2;
    return Math.hypot(x - c, y - c) <= w.arenaR - m;
  },
  clamp(w, o) {
    const c = w.FW / 2, dx = o.x - c, dy = o.y - c, d = Math.hypot(dx, dy), lim = w.arenaR - o.r;
    if (d > lim && d > 0) {
      o.x = c + dx / d * lim;
      o.y = c + dy / d * lim;
    }
  },
  randomPoint(w, di, m) {
    const c = w.FW / 2, r = Math.sqrt(rand(0, (ABYSS.r0 - m) ** 2)), a = rand(0, Math.PI * 2);
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
  },
  rockOk() { return true; },
  los() { return true; },
  dirTo(w, e, tx, ty) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 0.001;
    return [dx / d, dy / d];
  },

  drawGround(ctx, w, v) {
    const c = w.FW / 2, R = ABYSS.r0;
    makeCavePatterns(ctx);
    if (!abyssSlabPattern) abyssSlabPattern = makeSlabPattern(ctx);
    ctx.fillStyle = caveWallPattern;
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    ctx.save();
    circle(ctx, c, c, R);
    ctx.fillStyle = abyssSlabPattern;
    ctx.fill();
    ctx.clip();
    // 床の紋様：同心円・放射状の溝・中央の星・円周の古代文字
    ctx.lineCap = 'round';
    ctx.strokeStyle = abyssRuneColor(w, 0.32);
    ctx.lineWidth = 0.22;
    for (const k of [0.22, 0.48, 0.74]) { circle(ctx, c, c, R * k); ctx.stroke(); }
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, r0 = R * (i % 2 ? 0.48 : 0.22), r1 = R * 0.74;
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    }
    ctx.stroke();
    ctx.strokeStyle = abyssRuneColor(w, 0.5);
    ctx.lineWidth = 0.2;
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = off - Math.PI / 2 + i / 3 * Math.PI * 2, r = R * 0.18;
        if (i === 0) ctx.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r); else ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.strokeStyle = abyssRuneColor(w, 0.42);
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * Math.PI * 2, r = R * 0.61, ca = Math.cos(a), sa = Math.sin(a);
      const x = c + ca * r, y = c + sa * r, tx = -sa, ty = ca;   // 円周の向き（tx, ty）と外向き（ca, sa）
      const h = 0.9, s = 0.4, form = (i * 7) % 5;   // 文字の形は5通り
      ctx.moveTo(x - ca * h, y - sa * h); ctx.lineTo(x + ca * h, y + sa * h);
      if (form === 0 || form === 3) { ctx.moveTo(x - ca * h, y - sa * h); ctx.lineTo(x - ca * h + tx * s, y - sa * h + ty * s); }
      if (form === 1 || form === 3) { ctx.moveTo(x + ca * h, y + sa * h); ctx.lineTo(x + ca * h - tx * s, y + sa * h - ty * s); }
      if (form === 2) { ctx.moveTo(x - tx * s, y - ty * s); ctx.lineTo(x + tx * s, y + ty * s); }
      if (form === 4) { ctx.moveTo(x + tx * s, y + ty * s); ctx.lineTo(x + ca * h * 0.3, y + sa * h * 0.3); }
    }
    ctx.stroke();
    ctx.restore();
    // 縁石
    ctx.strokeStyle = '#121016';
    ctx.lineWidth = 1.4;
    circle(ctx, c, c, R + 0.7); ctx.stroke();
    ctx.strokeStyle = 'rgba(210,190,140,0.28)';
    ctx.lineWidth = 0.18;
    circle(ctx, c, c, R); ctx.stroke();
    // 石柱：八角の柱頭と、紋様と同じ色に灯る頂
    for (const p of w.pillars || []) {
      if (p.x < v.x0 - 3 || p.x > v.x1 + 3 || p.y < v.y0 - 3 || p.y > v.y1 + 3) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(p.x + 0.8, p.y + 1.0, 1.9, 1.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = p.a + i / 8 * Math.PI * 2;
        if (i === 0) ctx.moveTo(p.x + Math.cos(a) * 1.7, p.y + Math.sin(a) * 1.7); else ctx.lineTo(p.x + Math.cos(a) * 1.7, p.y + Math.sin(a) * 1.7);
      }
      ctx.closePath();
      ctx.fillStyle = '#3a3642'; ctx.fill();
      ctx.strokeStyle = '#141218'; ctx.lineWidth = 0.15; ctx.stroke();
      ctx.fillStyle = '#4c4757';
      circle(ctx, p.x - 0.2, p.y - 0.2, 1.05); ctx.fill();
      const g = ctx.createRadialGradient(p.x - 0.2, p.y - 0.2, 0, p.x - 0.2, p.y - 0.2, 1.4);
      g.addColorStop(0, abyssRuneColor(w, 1));
      g.addColorStop(1, abyssRuneColor(w, 0));
      ctx.fillStyle = g;
      circle(ctx, p.x - 0.2, p.y - 0.2, 1.4); ctx.fill();
    }
  },

  // 外周の結界。狭まった外側は暗くして、結界を赤紫に光らせる
  drawSealed(ctx, w) {
    const c = w.FW / 2, R = w.arenaR, closing = R < ABYSS.r0 - 0.01;
    ctx.save();
    if (closing) {
      annulusPath(ctx, c, c, R, ABYSS.r0 + ABYSS_PAD * 2);
      ctx.fillStyle = 'rgba(30,4,30,0.5)';
      ctx.fill('evenodd');
    }
    const pulse = 0.55 + 0.45 * Math.sin(w.time * (closing ? 7 : 2.5));
    ctx.strokeStyle = closing ? `rgba(255,80,190,${0.55 + 0.4 * pulse})` : `rgba(120,230,255,${0.3 + 0.3 * pulse})`;
    ctx.shadowColor = closing ? '#ff4ab0' : '#6adcff';
    ctx.shadowBlur = 12;
    ctx.lineWidth = closing ? 0.45 : 0.3;
    circle(ctx, c, c, R); ctx.stroke();
    ctx.lineWidth = 0.12;
    ctx.setLineDash([0.6, 1.4]);
    circle(ctx, c, c, R - 0.6); ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // 結界の要石（ゆっくり回る）
    ctx.fillStyle = closing ? '#ff8ad0' : '#a8ecff';
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2 + w.time * 0.08;
      const x = c + Math.cos(a) * R, y = c + Math.sin(a) * R;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 0.5, y + Math.sin(a) * 0.5);
      ctx.lineTo(x - Math.sin(a) * 0.28, y + Math.cos(a) * 0.28);
      ctx.lineTo(x - Math.cos(a) * 0.5, y - Math.sin(a) * 0.5);
      ctx.lineTo(x + Math.sin(a) * 0.28, y - Math.cos(a) * 0.28);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },

  minimap(ctx, w, right, top, max = Infinity) {
    const size = Math.min(150, max), k = size / w.FW, mx = right - size, my = top;
    hudPanel(ctx, mx, my, size, size);
    ctx.strokeStyle = 'rgba(150,220,255,0.4)';
    circle(ctx, mx + w.FW / 2 * k, my + w.FW / 2 * k, w.arenaR * k); ctx.stroke();
    return { mx, my, k };
  },
};

const FIELD_SHAPES = { strip: STRIP_SHAPE, disc: DISC_SHAPE, arena: ARENA_SHAPE, abyss: ABYSS_SHAPE };

// 出撃タブのフィールド選択カードに描く見取り図（地区の並びと進む向き）
function drawFieldThumb(cv, F) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, n = F.districts ? F.districts.length : 0;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = F.dark ? '#18161b' : '#3b2a1c';
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (F.shape === 'abyss') {
    // 地底エリア：石の円と、内側へ狭まる結界、向かい合う2機（青 = 自機、赤 = 地底のマシン）
    const cx = W / 2, cy = H / 2, R = H / 2 - 5;
    ctx.fillStyle = '#2c2933';
    circle(ctx, cx, cy, R); ctx.fill();
    ctx.strokeStyle = 'rgba(120,230,255,0.75)';
    circle(ctx, cx, cy, R); ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,90,190,0.8)';
    circle(ctx, cx, cy, R * 0.55); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,90,190,0.5)';
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const x0 = cx + Math.cos(a) * R * 0.92, y0 = cy + Math.sin(a) * R * 0.92, x1 = cx + Math.cos(a) * R * 0.66, y1 = cy + Math.sin(a) * R * 0.66;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.lineTo(x1 + Math.cos(a + 2.6) * 4, y1 + Math.sin(a + 2.6) * 4);
      ctx.moveTo(x1, y1); ctx.lineTo(x1 + Math.cos(a - 2.6) * 4, y1 + Math.sin(a - 2.6) * 4);
      ctx.stroke();
    }
    for (const [k, col] of [[-1, '#5ab0ff'], [1, '#ff5a4a']]) {
      ctx.fillStyle = col;
      circle(ctx, cx + k * R * 0.3, cy, 3.5); ctx.fill();
    }
  } else if (F.shape === 'disc') {
    const cx = W / 2, cy = H / 2, R = H / 2 - 4, k = R / F.radii[n - 1];
    for (let i = n - 1; i >= 0; i--) {
      ctx.beginPath();
      ctx.arc(cx, cy, F.radii[i] * k, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? '#4c4853' : '#57525f';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,170,0.35)';
      ctx.stroke();
      const rm = i > 0 ? (F.radii[i - 1] + F.radii[i]) / 2 : 0, a = -Math.PI / 2 + (i - 1) * Math.PI * 2 / 3;
      ctx.fillStyle = '#f0c890';
      ctx.fillText(String(i + 1), cx + Math.cos(a) * rm * k, cy + Math.sin(a) * rm * k);
    }
  } else {
    const m = 6, dw = (W - m * 2) / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? '#8a6a44' : '#a07a4e';
      ctx.fillRect(m + i * dw, m, dw, H - m * 2);
      ctx.strokeStyle = 'rgba(255,220,170,0.35)';
      ctx.strokeRect(m + i * dw + 0.5, m + 0.5, dw - 1, H - m * 2 - 1);
      ctx.fillStyle = '#2a1d12';
      ctx.fillText(String(i + 1), m + (i + 0.5) * dw, H / 2);
    }
  }
}
