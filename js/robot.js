'use strict';
// =====================================================================
//  ロボット：性能計算と描画
// =====================================================================

function partById(cat, id) {
  return PARTS[cat].find(p => p.id === id) || PARTS[cat][0];
}

// 強化で小数になった性能値の表示用（整数ならそのまま、それ以外は小数1桁）
function fmtNum(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function upgradeLevel(upgrades, id) {
  return Math.min(UPGRADE_MAX, (upgrades && upgrades[id]) || 0);
}

// 強化レベルを反映したパーツ性能（元の PARTS は書き換えず写しを返す）
function upgradedPart(cat, p, lv) {
  const U = UPGRADES[cat];
  if (!U || !lv || p.type === 'none') return p;
  const q = Object.assign({}, p, { lv });
  U.apply(q, lv);
  return q;
}

// ブースター（+N）を反映した写し。強化はこのあとに重ねる
function bonusPart(cat, p, bonus) {
  if (!bonus || p.type === 'none') return p;
  const q = Object.assign({}, p, { bonus });
  for (const [k, f] of Object.entries(BONUS_STATS[cat])) {
    const v = p[k] * (1 + bonus * f / 100);
    q[k] = k === 'hp' || k === 'cap' || k === 'power' ? Math.round(v) : Math.round(v * 100) / 100;
  }
  return q;
}

// 表示名（ボーナス付きなら「GA-10 ガトリング +23」）
function partLabel(p) {
  return p.bonus ? `${p.name} +${p.bonus}` : p.name;
}

// ブースターの名前（「GA-10 ガトリング用ブースター +4」）
function boosterName(item) {
  return `${partById(item.cat, item.id).name}用ブースター +${item.bonus}`;
}

// ブースター { cat, id, bonus } を等級の色で表示する HTML（short = 対象パーツ名を省く）
function partTagHTML(item, short) {
  const t = bonusTier(item.bonus);
  return `<span class="ptag" style="--c:${t.color}" title="${bonusDesc(item.cat, item.bonus)}"><em>${t.name}</em>${short ? '' : partById(item.cat, item.id).name + '用'}ブースター <b>+${item.bonus}</b></span>`;
}

// スロットのパーツに差し込んだブースター（無ければ null）
function slotGear(build, key) {
  const g = build.gear && build.gear[key];
  return g && g.id === build[key] ? g : null;
}

function buildParts(build, upgrades) {
  const o = {};
  for (const s of SLOTS) {
    const p = partById(s.cat, build[s.key]);
    const g = slotGear(build, s.key);
    o[s.key] = upgradedPart(s.cat, bonusPart(s.cat, p, g ? g.bonus : 0), upgradeLevel(upgrades, p.id));
  }
  return o;
}

function clampRatio(reg, r) {
  return Math.min(reg.max, Math.max(reg.min, r));
}

function weaponPerf(w, mult) {
  const k = Math.sqrt(mult);
  const dmg = w.dmg * k, rate = w.rate * k, reload = w.reload / k;
  let dps = 0;
  if (w.type === 'none') dps = 0;
  else if (w.mag > 0) dps = dmg * w.mag / (w.mag / rate + reload);
  else dps = dmg * rate;
  dps *= w.shots || 1;   // 強化 Lv6〜 は1回の攻撃で複数発
  return { def: w, dmg, rate, reload, dps };
}

// 出力配分（腕への割合 ratio）と強化レベルから性能を計算
function computeStats(build, ratioOverride, upgrades) {
  const p = buildParts(build, upgrades);
  const ratio = clampRatio(p.headReg, ratioOverride != null ? ratioOverride : build.armRatio);
  const power = p.torso.power * p.headReg.eff;
  const base = power / 120;
  const armMult = base * (0.3 + 1.4 * ratio);
  const legMult = base * (0.3 + 1.4 * (1 - ratio));
  const weight = p.headCpu.weight + p.headReg.weight + p.torso.weight + p.armL.weight + p.armR.weight;
  const cap = p.legs.cap;
  const overF = weight > cap ? Math.pow(cap / weight, 1.5) : 1;
  const speed = p.legs.speed * Math.pow(legMult, 0.7) * overF;
  const turn = p.legs.turn * Math.pow(legMult, 0.5) * Math.sqrt(overF);
  let hp = 0;
  for (const s of SLOTS) hp += p[s.key].hp;
  const def = p.torso.def + (p.legs.defBonus || 0);
  return {
    parts: p, ratio, power, armMult, legMult, weight, cap, over: weight > cap,
    speed, turn, accel: p.legs.accel, strafe: p.legs.strafe, jump: p.legs.jump || null,
    hp, def, sensor: p.headCpu.sensor, grid: p.headCpu.grid, clock: p.headCpu.clock,
    armL: weaponPerf(p.armL, armMult), armR: weaponPerf(p.armR, armMult),
  };
}

// ---------------------------------------------------------------------
//  描画（ctx は メートル単位・ロボット中心原点・+X方向が正面・+Yが右）
//  各パーツの見た目は parts-art.js の PART_ART に定義する
// ---------------------------------------------------------------------

// スケルトンジョイントの関節位置（y は右側の値。左側は符号を反転）
const JOINTS = {
  core:     { x: 0,     y: 0 },     // 胴体の中心
  tail:     { x: -0.5,  y: 0 },     // 背骨の後端
  neck:     { x: 0.35,  y: 0 },     // 首
  shoulder: { x: 0.1,   y: 0.95 },  // 肩（腕の取り付け位置）
  hip:      { x: -0.45, y: 0.45 },  // 腰（脚の付け根）
  headA:    { x: 0.3,   y: 0 },     // 頭部Aソケット
  headB:    { x: -0.2,  y: 0 },     // 頭部Bソケット
};

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

// 自機パーツの外形線（太い線で重量感を出す）。内側のモールドは細い線で描く
const PART_OUTLINE = { color: '#1d1c19', width: 0.1, detail: 0.05 };

// 直前のパスを外形線で縁取る（線の設定は元に戻す）
function outline(ctx) {
  ctx.save();
  ctx.strokeStyle = PART_OUTLINE.color;
  ctx.lineWidth = PART_OUTLINE.width;
  ctx.stroke();
  ctx.restore();
}

// デザイン未登録のパーツ用の仮の図形（破線の枠）
const PLACEHOLDER_ART = {
  headCpu: { draw(ctx) { circle(ctx, 0, 0, 0.32); placeholderPaint(ctx); } },
  headReg: { draw(ctx) { rr(ctx, -0.22, -0.26, 0.4, 0.52, 0.08); placeholderPaint(ctx); } },
  torso:   { draw(ctx) { rr(ctx, -0.65, -0.65, 1.25, 1.3, 0.2); placeholderPaint(ctx); } },
  arm:     { muzzle: 1.2, draw(ctx) { rr(ctx, -0.2, -0.25, 1.4, 0.5, 0.1); placeholderPaint(ctx); } },
  legs:    {
    draw(ctx) {
      for (const k of [-1, 1]) { rr(ctx, -0.45, k * 0.6 - 0.2, 0.9, 0.4, 0.1); placeholderPaint(ctx); }
    },
  },
};

function placeholderPaint(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(150,150,150,0.6)';
  ctx.fill();
  ctx.strokeStyle = '#ff4adf';
  ctx.lineWidth = 0.05;
  ctx.setLineDash([0.12, 0.08]);
  ctx.stroke();
  ctx.restore();
}

const warnedArt = new Set();
function artOf(cat, id) {
  const a = PART_ART[cat] && PART_ART[cat][id];
  if (a) return a;
  if (!warnedArt.has(cat + ':' + id)) {
    warnedArt.add(cat + ':' + id);
    console.warn(`パーツデザイン未登録：PART_ART.${cat}.${id}（仮の図形で表示します）`);
  }
  return PLACEHOLDER_ART[cat];
}

// 機体中心から見た砲口の前方距離（弾の発射位置に使う）
function armMuzzle(armDef) {
  return JOINTS.shoulder.x + artOf('arm', armDef.id).muzzle;
}

function drawRobot(ctx, parts, o = {}) {
  const s = { t: o.time || 0, walk: o.walk || 0, side: 0 };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // 影（ジャンプ中は呼び出し側が地面に描く）
  if (!o.noShadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(-0.25, 0.25, 1.5, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawLegs(ctx, parts.legs, s);
  drawSkeleton(ctx, false);
  drawArm(ctx, parts.armL, -1, o.armL || {}, s);
  drawArm(ctx, parts.armR, 1, o.armR || {}, s);
  drawTorso(ctx, parts.torso, s);
  drawHead(ctx, parts.headCpu, parts.headReg, s);
  if (o.xray) drawSkeleton(ctx, true);
  if (o.hit > 0) {
    ctx.globalAlpha = Math.min(1, o.hit * 5) * 0.6;
    ctx.fillStyle = '#fff';
    circle(ctx, 0, 0, 1.2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSkeleton(ctx, xray) {
  const J = JOINTS;
  ctx.save();
  const bone = xray ? 'rgba(110,220,255,0.85)' : '#4b5055';
  const joint = xray ? 'rgba(180,240,255,0.95)' : '#6a7177';
  ctx.strokeStyle = bone;
  ctx.lineWidth = xray ? 0.08 : 0.16;
  ctx.beginPath();
  ctx.moveTo(J.tail.x, J.tail.y); ctx.lineTo(J.neck.x, J.neck.y);                   // 背骨
  ctx.moveTo(J.shoulder.x, -J.shoulder.y); ctx.lineTo(J.shoulder.x, J.shoulder.y);   // 肩
  ctx.moveTo(J.hip.x, -J.hip.y); ctx.lineTo(J.hip.x, J.hip.y);                       // 腰
  ctx.stroke();
  ctx.fillStyle = joint;
  const js = [[J.shoulder.x, -J.shoulder.y], [J.shoulder.x, J.shoulder.y], [J.hip.x, -J.hip.y], [J.hip.x, J.hip.y],
    [J.neck.x, J.neck.y], [J.core.x, J.core.y]];
  for (const [x, y] of js) { circle(ctx, x, y, xray ? 0.1 : 0.14); ctx.fill(); }
  ctx.restore();
}

function drawLegs(ctx, L, s) {
  ctx.save();
  ctx.lineWidth = 0.2;
  artOf('legs', L.id).draw(ctx, s);
  ctx.restore();
}

function drawTorso(ctx, T, s) {
  ctx.save();
  ctx.translate(JOINTS.core.x, JOINTS.core.y);
  ctx.strokeStyle = PART_OUTLINE.color;
  ctx.lineWidth = PART_OUTLINE.width;
  artOf('torso', T.id).draw(ctx, s);
  ctx.restore();
}

function drawHead(ctx, cpu, reg, s) {
  // 頭部B（後頭部）→ 頭部A（ドーム）の順に重ねる
  ctx.save();
  ctx.translate(JOINTS.headB.x, JOINTS.headB.y);
  artOf('headReg', reg.id).draw(ctx, s);
  ctx.restore();
  ctx.save();
  ctx.translate(JOINTS.headA.x, JOINTS.headA.y);
  artOf('headCpu', cpu.id).draw(ctx, s);
  ctx.restore();
}

function drawArm(ctx, A, side, st, s) {
  ctx.save();
  ctx.translate(JOINTS.shoulder.x, side * JOINTS.shoulder.y);
  // 肩関節のキャップ（未装着でも表示）
  ctx.fillStyle = '#6d6a62';
  circle(ctx, 0, 0, 0.3); ctx.fill(); outline(ctx);
  if (A.type === 'none') { ctx.restore(); return; }
  const art = artOf('arm', A.id);
  ctx.translate(-(st.recoil || 0) * 0.3, 0);
  ctx.strokeStyle = PART_OUTLINE.color;
  ctx.lineWidth = PART_OUTLINE.width;
  ctx.save();
  art.draw(ctx, { t: s.t, walk: s.walk, side });
  ctx.restore();
  // 発射炎（共通演出）
  if (st.flash > 0 && A.type !== 'melee') {
    const fx = art.muzzle + 0.1;
    if (A.type === 'flame') {
      ctx.fillStyle = 'rgba(255,170,60,0.8)';
      circle(ctx, fx + 0.1, 0, 0.28); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,230,140,0.95)';
      ctx.beginPath();
      ctx.moveTo(fx, -0.22); ctx.lineTo(fx + 0.55, 0); ctx.lineTo(fx, 0.22); ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}
