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
  ctx.fillText(`${D.name}「${D.sub}」`, x, y - 3);
  ctx.font = 'bold 3px sans-serif';
  ctx.fillStyle = 'rgba(255,150,80,0.55)';
  ctx.fillText('封鎖中', x, y + 3);
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
  minimap(ctx, w, right, top) {
    const F = w.field, mmw = 270, k = mmw / w.FW, mmh = w.H * k, mx = right - mmw, my = top;
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
      const sealed = i >= w.open && !w.full, done = i < w.stats.cleared;
      ctx.fillStyle = mapLabelColor(sealed, done);
      ctx.fillText(`${D.name}${sealed ? '（封鎖）' : done ? '（掃討済）' : ''}`, mx + (i + 0.5) * F.dw * k, my + mmh + 3);
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
    if (!caveFloorPattern) {
      caveFloorPattern = makeCavePattern(ctx, '#3e3b42',
        ['rgba(20,18,26,0.25)', 'rgba(95,95,115,0.16)'], [[90, 88, 100], [40, 38, 46], [120, 125, 140]], 'rgba(15,12,18,0.35)');
      caveWallPattern = makeCavePattern(ctx, '#1f1c21',
        ['rgba(0,0,0,0.35)', 'rgba(70,64,74,0.25)'], [[60, 56, 64], [10, 8, 12], [90, 86, 96]], 'rgba(0,0,0,0.5)');
    }
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

  minimap(ctx, w, right, top) {
    const F = w.field, size = 170, k = size / w.FW, mx = right - size, my = top;
    const cx = mx + w.FW / 2 * k, cy = my + w.FW / 2 * k;
    hudPanel(ctx, mx, my, size, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px sans-serif';
    ctx.lineWidth = 1;
    F.districts.forEach((D, i) => {
      const sealed = i >= w.open && !w.full, done = i < w.stats.cleared;
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

const FIELD_SHAPES = { strip: STRIP_SHAPE, disc: DISC_SHAPE };

// 出撃タブのフィールド選択カードに描く見取り図（地区の並びと進む向き）
function drawFieldThumb(cv, F) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, n = F.districts.length;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = F.dark ? '#18161b' : '#3b2a1c';
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (F.shape === 'disc') {
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
