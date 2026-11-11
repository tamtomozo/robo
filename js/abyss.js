'use strict';
// =====================================================================
//  地底エリア：各層で地底文明のマシン1機と1対1で戦う（全 ABYSS.floors 層。形は field.js の abyss）
//   ・戦闘の仕組みは対戦（versus.js）をそのまま使う。w.vs = true、w.abyss = { floor, mech }
//   ・対戦と違うところ：大地の脈動が起きる。脈動中の地底のマシンは回路の処理速度 ×ABYSS.surge
//     （simulateVersus で回路の実行間隔を縮める。攻撃力・防御力は変わらない）。勝つと次の層が解放され、鉱石とブースターを持ち帰れる（Game.endAbyss）
//   ・地底のマシンも自機と同じパーツ・強化・ブースター・回路で動く。見た目だけ専用（drawAbyssRobot）
// =====================================================================

// 層ごとの地底のマシン
//   build = 自機と同じ形（セーブの build と同じ）。hpMul = 耐久の倍率（守護機としての装甲）
//   強化レベルは出撃タブで選ぶレベル（ABYSS.levels の5段階）で決まる（abyssUpgrades）
//   tiles = 回路 [x, y, タイル, 出口, NO の出口, パラメータの番号]（判定タイルは 出口 = YES）
//   reward = 勝利で持ち帰る鉱石（レベル3のとき） / bonusFloor = 持ち帰るブースターの +値の出やすさ（出撃の第何層と同じか。レベル3のとき）
//   skin = 見た目（style で形、色は body / plate / plate2 / trim、glow = 発光の色 [r, g, b]）
const ABYSS_MECHS = [
  {
    id: 'arkes',
    name: T('abyss.arkes.name' /* 守門機アルケス */),
    sub: T('abyss.arkes.sub' /* 門の回廊 */),
    desc: T('abyss.arkes.desc' /* 聖域の門を守る番兵。ガトリングで間合いを詰め、光の刃で斬り伏… */),
    build: { headCpu: 'cpu_m', headReg: 'reg_p', torso: 't_std', armL: 'gatling', armR: 'blade', legs: 'biped', armRatio: 0.55, gear: {} },
    hpMul: 1.7,
    reward: { iron: 60, crystal: 25, core: 20 }, bonusFloor: 4,
    skin: { style: 'arkes', body: '#1b1f27', plate: '#323946', plate2: '#4a5365', trim: '#b9c9da', glow: [80, 220, 255] },
    tiles: [
      [0, 0, 'start', 2],
      [0, 1, 'c_proj', 1, 2, 1],      // 敵弾が8m以内 → 敵へ向いて前へ跳び（跳躍中は無敵）、着地ざまに斬りかかる
      [1, 1, 'c_jump', 1, 0],
      [2, 1, 'face', 1], [3, 1, 'jump', 1, 1, 0], [4, 1, 'fire_r', 1], [5, 1, 'face', 1], [6, 1, 'fire_l', 1],
      [1, 0, 'face', 1], [2, 0, 'fire_l', 1],   // 跳べないとき：横へは動かず、向き直ってガトリング
      [0, 2, 'c_front', 1, 2, 1],     // 前方±20°に敵
      [1, 2, 'c_near', 1, 2, 0],      //   5m以内 → 赤熱刃で斬り、向き直ってガトリング
      [2, 2, 'fire_r', 1], [3, 2, 'face', 1], [4, 2, 'fire_l', 1],
      [1, 3, 'c_near', 1, 2, 3],      //   30m以内 → 向き直って撃ちながら前進 / 遠ければ前進して向き直る
      [2, 3, 'face', 1], [3, 3, 'fire_l', 1], [4, 3, 'move_f', 1], [5, 3, 'face', 1],
      [1, 4, 'move_f', 1], [2, 4, 'face', 1],
      [0, 3, 'face', 2],              // 敵へ向く
    ],
  },
  {
    id: 'vesperia',
    name: T('abyss.vesperia.name' /* 祭祀機ヴェスペリア */),
    sub: T('abyss.vesperia.sub' /* 祭儀の円庭 */),
    desc: T('abyss.vesperia.desc' /* 脈動を祀る祭祀の機体。距離を保ってミサイルと貫通榴弾を浴びせ… */),
    build: { headCpu: 'cpu_x', headReg: 'reg_o', torso: 't_gen', armL: 'missile', armR: 'cannon', legs: 'rjoint', armRatio: 0.6,
      gear: {} },
    hpMul: 1.5,
    reward: { iron: 120, crystal: 60, core: 40 }, bonusFloor: 6,
    skin: { style: 'vesperia', body: '#1d1427', plate: '#36274b', plate2: '#523d74', trim: '#e4cdff', glow: [205, 95, 255] },
    tiles: [
      [0, 0, 'start', 2],
      [0, 1, 'c_proj', 1, 2, 1],      // 敵弾が8m以内 → 跳べるなら左右へ跳んでかわし、着地したら向き直って撃つ
      [1, 1, 'c_jump', 1, 0],
      [2, 1, 'c_rand', 1, 0, 1],
      [3, 1, 'jump', 1, 1, 2], [4, 1, 'face', 1], [5, 1, 'fire_both', 1],
      [2, 0, 'jump', 1, 1, 3], [3, 0, 'face', 1], [4, 0, 'fire_both', 1],
      [1, 0, 'strafe_l', 1],
      [0, 2, 'c_near', 1, 2, 1],      // 10m以内まで迫られた → 跳んで離脱して向き直る（跳べなければ下がりながら撃つ）
      [1, 2, 'c_jump', 1, 2],
      [2, 2, 'jump', 1, 1, 4], [3, 2, 'face', 1], [4, 2, 'fire_both', 1],
      [1, 3, 'move_b', 1], [2, 3, 'face', 1], [3, 3, 'fire_both', 1],
      [0, 3, 'face', 2],
      [0, 4, 'c_near', 1, 2, 4],      // 45m以内 → 撃つ。20m以内なら横へ回り込んで向き直る / 遠ければ前進して向き直る
      [1, 4, 'fire_both', 1],
      [2, 4, 'c_near', 2, 1, 2],
      [2, 5, 'c_rand', 1, 2, 1],
      [3, 5, 'strafe_l', 1], [4, 5, 'face', 1],
      [2, 6, 'strafe_r', 1], [3, 6, 'face', 1],
      [3, 4, 'move_f', 1], [4, 4, 'face', 1],
      [0, 5, 'move_f', 1], [1, 5, 'face', 2],
    ],
  },
  {
    id: 'zenordia',
    name: T('abyss.zenordia.name' /* 王機ゼノ＝オルディア */),
    sub: T('abyss.zenordia.sub' /* 王の心臓 */),
    desc: T('abyss.zenordia.desc' /* 地底文明の王の機体。六本の脚で滑るように回り込み、出力を自在… */),
    build: { headCpu: 'cpu_x', headReg: 'reg_o', torso: 't_heavy', armL: 'cannon', armR: 'gatling', legs: 'spider', armRatio: 0.55,
      gear: { armL: { uid: 0, id: 'cannon', bonus: 3 }, armR: { uid: 0, id: 'gatling', bonus: 3 } } },
    hpMul: 1.35,
    reward: { iron: 200, crystal: 100, core: 70 }, bonusFloor: 8,
    skin: { style: 'zenordia', body: '#16120d', plate: '#2e251a', plate2: '#4a3c27', trim: '#ebc65c', glow: [255, 72, 48] },
    tiles: [
      [0, 0, 'start', 2],
      [0, 1, 'c_proj', 1, 2, 1],      // 敵弾が8m以内 → 跳べるなら敵と反対の側へ跳び、向き直って撃つ
      [1, 1, 'c_jump', 1, 0],
      [2, 1, 'c_left', 1, 0],
      [3, 1, 'jump', 1, 1, 3], [4, 1, 'face', 1], [5, 1, 'fire_both', 1],
      [2, 0, 'jump', 1, 1, 2], [3, 0, 'face', 1], [4, 0, 'fire_both', 1],
      [1, 0, 'strafe_r', 1],
      [0, 2, 'face', 2],
      [0, 3, 'c_near', 1, 2, 3],      // 30m以内 → 出力を腕へ寄せて両腕で撃つ。10m以内なら下がり、それ以外は回り込む。動いたら向き直って撃つ
      [1, 3, 'power', 1, 1, 4],
      [2, 3, 'fire_both', 1],
      [3, 3, 'c_near', 1, 2, 1],
      [4, 3, 'move_b', 1], [5, 3, 'face', 1], [6, 3, 'fire_both', 1],
      [3, 4, 'c_rand', 1, 2, 1],
      [4, 4, 'strafe_l', 1], [5, 4, 'face', 1], [6, 4, 'fire_both', 1],
      [3, 5, 'strafe_r', 1], [4, 5, 'face', 1], [5, 5, 'fire_both', 1],
      [0, 4, 'power', 2, 1, 2],       // 遠い → 出力を脚へ寄せ、榴弾を撃ちながら詰めて向き直る
      [0, 5, 'move_f', 1],
      [1, 5, 'fire_l', 2], [1, 6, 'face', 1],
    ],
  },
];

function abyssMech(floor) { return ABYSS_MECHS[clamp(floor | 0, 1, ABYSS.floors) - 1]; }

// 地底のマシンのレベル（1〜5）
function abyssLevel(lv) { return clamp(lv | 0, 1, ABYSS.levels.length); }

// マシン M の解放済みの一番高いレベル（レベル1から）
//   ・そのマシンをクリアしたレベルの次まで
//   ・第2層からは、ひとつ上の層のマシンをクリアしたレベルまで（同じレベルの中では第1層から順に進む）
function abyssMaxLv(save, M) {
  const clr = m => (save.abyssClear && save.abyssClear[m.id]) | 0, i = ABYSS_MECHS.indexOf(M);
  let max = clr(M) + 1;
  if (i > 0) max = Math.min(max, clr(ABYSS_MECHS[i - 1]));
  return abyssLevel(max);
}

// マシン M で選んでいるレベル（解放済みの範囲に収める）
function abyssSelLv(save, M) {
  return clamp(((save.abyssLv && save.abyssLv[M.id]) | 0) || 1, 1, abyssMaxLv(save, M));
}

// マシン M をレベル lv で倒したとき：クリアを記録する。そのレベルで初めてクリアしたら、次の出撃先 { floor, lv } を返す（無ければ null）
//   次の出撃先 = 同じレベルの次の層。最深部なら、ひとつ上のレベルの第1層。そのマシンのレベルの選択もそこに合わせる
//   層の選択（save.floor）は Game.endAbyss で合わせる
function abyssClearLevel(save, M, lv) {
  const first = (save.abyssClear[M.id] | 0) < lv;
  save.abyssClear[M.id] = Math.max((save.abyssClear[M.id] | 0), lv);
  if (!first) return null;
  const f = ABYSS_MECHS.indexOf(M) + 1;
  const next = f < ABYSS.floors ? { floor: f + 1, lv } : lv < ABYSS.levels.length ? { floor: 1, lv: lv + 1 } : null;
  if (!next || abyssMaxLv(save, abyssMech(next.floor)) < next.lv) return null;
  save.abyssLv[abyssMech(next.floor).id] = next.lv;
  return next;
}

// セーブの読み直し（main.js の Game.fromObj）：マシンごとのレベルを範囲内に整える
//   マシンごとに解放する前の版（全体で1つのレベル）のセーブは、レベル1からやり直し
function abyssFromObj(s) {
  const abyssLv = {}, abyssClear = {};
  const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : 0);
  for (const M of ABYSS_MECHS) {
    const c = clamp(own(s.abyssClear, M.id) | 0, 0, ABYSS.levels.length);
    if (c) abyssClear[M.id] = c;
    const l = own(s.abyssLv, M.id) | 0;
    if (l) abyssLv[M.id] = clamp(l, 1, abyssLevel(c + 1));
  }
  return { abyssLv, abyssClear };
}

// レベル lv の強化レベル：装着しているパーツ（強化できるもの）がすべて ABYSS.levels[lv-1]
function abyssUpgrades(M, lv) {
  const L = ABYSS.levels[abyssLevel(lv) - 1], up = {};
  for (const s of SLOTS) if (UPGRADES[s.cat]) up[M.build[s.key]] = L;
  return up;
}

// 地底のマシンを自機と同じ形の機体にする（name, build, upgrades, program）
function abyssMachine(M, lv) {
  const tiles = M.tiles.map(([x, y, t, d, n, p]) => ({ x, y, t, d, n: n == null ? 1 : n, p }));
  return { name: M.name, build: M.build, upgrades: abyssUpgrades(M, lv), program: tilesToProg(tiles).prog };
}

// 地底のマシンの性能（ガレージの説明用）。hp は耐久の倍率を掛けた値
function abyssStats(M, lv) {
  const st = computeStats(M.build, null, abyssUpgrades(M, lv));
  return Object.assign(st, { hp: Math.round(st.hp * M.hpMul) });
}

// 脈動による地底のマシンの回路の処理速度の倍率（1 〜 ABYSS.surge）
function abyssSurgeMul(w) {
  return 1 + (ABYSS.surge - 1) * w.surge.k;
}

function createAbyssWorld(save, F) {
  const floor = clamp(save.floor[F.id] | 0, 1, ABYSS.floors), M = abyssMech(floor), lv = abyssSelLv(save, M);
  // 地底エリアでは戦闘中に回路1〜3を切り替えられる（対戦はできない。battle.js の canSwitchCircuit）
  const me = Object.assign(myMachine(save), { programs: save.programs, progSlot: save.progSlot }), foe = abyssMachine(M, lv);
  const w = createDuelWorld(F, ABYSS, me, foe);
  const R = w.rival;
  R.hp = R.maxHp = Math.round(R.maxHp * M.hpMul);
  R.skin = M.skin;
  w.floor = floor;
  w.abyss = { floor, mech: M, lv };
  // 大地の脈動（開始から少しして最初の脈動。続く長さ・間隔は ABYSS の値）
  w.surge = { state: 'idle', t: rand(ABYSS.surgeFirst[0], ABYSS.surgeFirst[1]), k: 0, ph: 0 };
  w.surgeDur = ABYSS.surgeDur;
  w.surgeGap = ABYSS.surgeGap;
  makeVeins(w);
  addLog(w, T('B131' /* {field} {floor}「{sub}」へ降下。 */, { field: F.name, floor: floorName(floor), sub: M.sub }), '#9fe0b0');
  addLog(w, T('B132' /* 地底文明のマシン {name} が起動した。 */, { name: M.name }), '#ff9a6a');
  addLog(w, T('B142' /* {name} のレベル：{level}（パーツ強化 Lv{l… */, { name: M.name, level: T('C029' /* レベル{n} */, { n: lv }), lv: ABYSS.levels[lv - 1] }), '#ffb070');
  return w;
}

// 勝利で持ち帰るもの：{ ore, part（ブースター { cat, id, bonus }） }。レベルが高いほど多く、+値も出やすい
function abyssRewardOre(M, lv) {
  const k = ABYSS.rewardMul[abyssLevel(lv) - 1], ore = emptyOre();
  for (const [id, n] of Object.entries(M.reward)) ore[id] = Math.round(n * k);
  return ore;
}
function abyssReward(floor, lv) {
  const M = abyssMech(floor);
  return { ore: abyssRewardOre(M, lv), part: randomDropPart(clamp(M.bonusFloor + ABYSS.bonusShift[abyssLevel(lv) - 1], 1, FLOORS)) };
}

// ---------------------------------------------------------------------
//  地底のマシンの見た目（robot.js の drawRobot から o.skin があるときに呼ばれる）
//  座標は自機と同じ（m・+X が正面・+Y が右）。腕・脚の形は装備の種類に合わせる。
//  弾の出る位置（砲口）は自機の腕と同じ長さにしてある
//  o.surge = 脈動の強さ（0〜1）。脈動中は発光が速く強くなり、赤みを帯びる
// ---------------------------------------------------------------------
function drawAbyssRobot(ctx, parts, o) {
  const K = o.skin, t = o.time || 0, sk = o.surge || 0;
  const pulse = 0.5 + 0.5 * Math.sin(t * (2.4 + 5 * sk));
  const gc = K.glow.map((c, i) => Math.round(c + ([255, 50, 30][i] - c) * sk * 0.8));
  const G = {
    K, t, sk, pulse, walk: o.walk || 0,
    glow: a => `rgba(${gc[0]},${gc[1]},${gc[2]},${Math.min(1, a)})`,
    hot: 0.55 + 0.3 * pulse + 0.35 * sk,   // 発光の強さ
  };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (!o.noShadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(-0.3, 0.25, 1.7, 1.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  abyssBack(ctx, G);
  abyssLegs(ctx, parts.legs, G);
  // 背骨と肩の骨
  ctx.beginPath();
  ctx.moveTo(-0.7, 0); ctx.lineTo(0.4, 0);
  ctx.moveTo(JOINTS.shoulder.x, -JOINTS.shoulder.y); ctx.lineTo(JOINTS.shoulder.x, JOINTS.shoulder.y);
  strut(ctx, K.body, 0.22);
  abyssArm(ctx, parts.armL, -1, o.armL || {}, G);
  abyssArm(ctx, parts.armR, 1, o.armR || {}, G);
  abyssTorso(ctx, G);
  abyssPauldrons(ctx, G);
  abyssHead(ctx, G);
  if (o.xray) drawSkeleton(ctx, true);
  if (o.hit > 0) {
    ctx.globalAlpha = Math.min(1, o.hit * 5) * 0.6;
    ctx.fillStyle = '#fff';
    circle(ctx, 0, 0, 1.3);
    ctx.fill();
  }
  ctx.restore();
}

// 多角形のパス（pts = [[x, y], …]。mirror = 左右反転）
function abyssPoly(ctx, pts, mirror) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, mirror ? -y : y); else ctx.lineTo(x, mirror ? -y : y); });
  ctx.closePath();
}

// 発光する線（にじみ＋芯）。直前のパスに描く
function abyssGlowLine(ctx, G, width, a = 1) {
  ctx.save();
  ctx.strokeStyle = G.glow(0.28 * G.hot * a);
  ctx.lineWidth = width * 3;
  ctx.stroke();
  ctx.strokeStyle = G.glow(0.95 * G.hot * a);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

// 装甲板：塗り（正面ほど明るいグラデーション）＋外形線＋内側の縁取り
function abyssArmor(ctx, G, x0, x1, light) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, G.K.body);
  g.addColorStop(1, light ? G.K.plate2 : G.K.plate);
  ctx.fillStyle = g;
  ctx.fill();
  outline(ctx);
}

function abyssTrim(ctx, G, width = 0.05) {
  ctx.save();
  ctx.strokeStyle = G.K.trim;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

// 光の点（中心が白く、まわりがにじむ）
function abyssGlowDot(ctx, G, x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
  g.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.9 * G.hot)})`);
  g.addColorStop(0.3, G.glow(0.9 * G.hot));
  g.addColorStop(1, G.glow(0));
  ctx.fillStyle = g;
  circle(ctx, x, y, r * 2.6);
  ctx.fill();
}

// 背中の飾り：アルケス = 後ろへ流れる二枚の刃のひれ / ヴェスペリア = 扇状に開く光の羽根 / ゼノ＝オルディア = 外套のような大翼と光輪
function abyssBack(ctx, G) {
  const K = G.K;
  if (K.style === 'arkes') {
    for (const m of [false, true]) {
      abyssPoly(ctx, [[-0.2, 0.55], [-1.75, 1.05], [-1.95, 0.85], [-0.75, 0.3]], m);
      abyssArmor(ctx, G, -1.9, -0.2, true);
      ctx.beginPath();
      ctx.moveTo(-0.45, m ? -0.5 : 0.5); ctx.lineTo(-1.7, m ? -0.95 : 0.95);
      abyssGlowLine(ctx, G, 0.05);
    }
  } else if (K.style === 'vesperia') {
    const sway = Math.sin(G.t * 1.6) * 0.06;
    for (const m of [false, true]) {
      for (let i = 0; i < 4; i++) {
        const a = Math.PI - (0.35 + i * 0.3 + sway) * (m ? -1 : 1), L = 1.55 - i * 0.12;
        const ex = -0.45 + Math.cos(a) * L, ey = Math.sin(a) * L;
        const nx = -Math.sin(a) * 0.1, ny = Math.cos(a) * 0.1;
        ctx.beginPath();
        ctx.moveTo(-0.45 + nx, ny); ctx.lineTo(ex, ey); ctx.lineTo(-0.45 - nx, -ny);
        ctx.closePath();
        abyssArmor(ctx, G, -1.9, -0.4, i % 2 === 0);
        ctx.beginPath();
        ctx.moveTo(-0.45 + Math.cos(a) * 0.4, Math.sin(a) * 0.4); ctx.lineTo(ex, ey);
        abyssGlowLine(ctx, G, 0.035, 0.8);
        abyssGlowDot(ctx, G, ex, ey, 0.05);
      }
    }
  } else {
    // ゼノ＝オルディア：外套の大翼と、背後で回る光輪
    for (const m of [false, true]) {
      abyssPoly(ctx, [[0.0, 0.7], [-0.9, 1.75], [-1.75, 1.55], [-2.05, 0.6], [-0.7, 0.2]], m);
      abyssArmor(ctx, G, -2.0, 0, false);
      abyssTrim(ctx, G, 0.06);
      ctx.beginPath();
      ctx.moveTo(-0.55, m ? -0.45 : 0.45); ctx.lineTo(-1.0, m ? -1.45 : 1.45);
      ctx.moveTo(-0.7, m ? -0.32 : 0.32); ctx.lineTo(-1.6, m ? -1.25 : 1.25);
      abyssGlowLine(ctx, G, 0.045, 0.85);
    }
    ctx.save();
    ctx.translate(-0.45, 0);
    ctx.rotate(G.t * 0.6);
    ctx.beginPath();
    ctx.arc(0, 0, 1.0, 0, Math.PI * 2);
    ctx.setLineDash([0.32, 0.14]);
    abyssGlowLine(ctx, G, 0.05, 0.7);
    ctx.setLineDash([]);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      abyssPoly(ctx, [[1.0, -0.09], [1.28, 0], [1.0, 0.09]]);
      ctx.fillStyle = K.trim;
      ctx.fill();
      outline(ctx);
      ctx.restore();
    }
    ctx.restore();
  }
}

function abyssLegs(ctx, L, G) {
  const K = G.K, ph = G.walk * 1.6, H = JOINTS.hip;
  if (L.id === 'biped') {
    for (const k of [-1, 1]) {
      const off = Math.sin(ph + (k > 0 ? Math.PI : 0)) * 0.5, y = k * 0.64;
      ctx.beginPath(); ctx.moveTo(H.x, k * H.y); ctx.lineTo(off - 0.1, y);
      strut(ctx, K.body, 0.24);
      abyssPoly(ctx, [[off + 0.62, y], [off + 0.34, y - 0.24], [off - 0.42, y - 0.2], [off - 0.55, y], [off - 0.42, y + 0.2], [off + 0.34, y + 0.24]]);
      abyssArmor(ctx, G, off - 0.55, off + 0.62, true);
      ctx.beginPath(); ctx.moveTo(off - 0.32, y); ctx.lineTo(off + 0.42, y);
      abyssGlowLine(ctx, G, 0.05);
    }
  } else if (L.id === 'rjoint') {
    for (const k of [-1, 1]) {
      const off = Math.sin(ph * 1.2 + (k > 0 ? Math.PI : 0)) * 0.6;
      const kx = -1.05 + off * 0.3, ky = k * 0.78, y = k * 0.6;
      ctx.beginPath(); ctx.moveTo(H.x, k * H.y); ctx.lineTo(kx, ky); ctx.lineTo(off + 0.05, y);
      strut(ctx, K.body, 0.2);
      // 膝から後ろへ伸びる棘
      abyssPoly(ctx, [[kx + 0.12, ky - 0.14], [kx - 0.6, ky + k * 0.12], [kx + 0.1, ky + 0.14]]);
      abyssArmor(ctx, G, kx - 0.6, kx + 0.1, true);
      abyssGlowDot(ctx, G, kx, ky, 0.07);
      // 刃のような足先
      abyssPoly(ctx, [[off + 0.85, y], [off - 0.1, y - 0.26], [off - 0.25, y], [off - 0.1, y + 0.26]]);
      abyssArmor(ctx, G, off - 0.25, off + 0.85, true);
      ctx.beginPath(); ctx.moveTo(off - 0.05, y); ctx.lineTo(off + 0.6, y);
      abyssGlowLine(ctx, G, 0.04);
    }
  } else if (L.id === 'spider') {
    const angs = [-0.65, -1.57, -2.45];
    for (const k of [-1, 1]) {
      angs.forEach((a, i) => {
        const sw = Math.sin(ph * 1.4 + i * 2.1 + (k > 0 ? Math.PI : 0)) * 0.25;
        const ang = (k > 0 ? Math.abs(a) : -Math.abs(a)) + sw;
        const c = Math.cos(ang), s = Math.sin(ang);
        const kx = c * 1.1 - 0.15, ky = s * 1.1, fx = c * 1.85 - 0.15, fy = s * 1.85;
        ctx.beginPath(); ctx.moveTo(-0.15, 0); ctx.lineTo(kx, ky);
        strut(ctx, K.plate, 0.2);
        // 先の尖った下肢
        const nx = -s * 0.12, ny = c * 0.12;
        ctx.beginPath();
        ctx.moveTo(kx + nx, ky + ny); ctx.lineTo(fx, fy); ctx.lineTo(kx - nx, ky - ny);
        ctx.closePath();
        abyssArmor(ctx, G, -1, 1, true);
        ctx.fillStyle = K.trim;
        circle(ctx, kx, ky, 0.15); ctx.fill(); outline(ctx);
        abyssGlowDot(ctx, G, fx - c * 0.1, fy - s * 0.1, 0.04);
      });
    }
    ctx.beginPath(); ctx.ellipse(-0.2, 0, 0.85, 0.78, 0, 0, Math.PI * 2);
    abyssArmor(ctx, G, -1, 0.6, false);
  } else {
    ctx.save();
    ctx.lineWidth = 0.2;
    artOf('legs', L.id).draw(ctx, { t: G.t, walk: G.walk, side: 0 });
    ctx.restore();
  }
}

// 腕（肩関節が原点）。武器の種類ごとに地底文明の形で描く。知らない種類は自機と同じ絵
function abyssArm(ctx, A, side, st, G) {
  const K = G.K;
  ctx.save();
  ctx.translate(JOINTS.shoulder.x, side * JOINTS.shoulder.y);
  if (A.type === 'none') { ctx.restore(); return; }
  ctx.translate(-(st.recoil || 0) * 0.3, 0);
  let muzzle = artOf('arm', A.id).muzzle;
  if (A.type === 'gun') {
    abyssPoly(ctx, [[-0.25, -0.24], [0.6, -0.3], [0.92, -0.18], [0.92, 0.18], [0.6, 0.3], [-0.25, 0.24]]);
    abyssArmor(ctx, G, -0.25, 0.92, true);
    const spin = (G.t * 30) % 1;
    ctx.beginPath();
    for (const y of [-0.12, 0, 0.12]) { ctx.moveTo(0.9, y * Math.cos(spin * Math.PI)); ctx.lineTo(1.52, y * Math.cos(spin * Math.PI)); }
    strut(ctx, K.body, 0.08);
    ctx.beginPath(); ctx.moveTo(1.15, -0.2); ctx.lineTo(1.15, 0.2);
    abyssGlowLine(ctx, G, 0.06);
    ctx.beginPath(); ctx.moveTo(-0.05, 0); ctx.lineTo(0.6, 0);
    abyssGlowLine(ctx, G, 0.04, 0.8);
  } else if (A.type === 'melee') {
    abyssPoly(ctx, [[-0.2, -0.22], [0.5, -0.26], [0.62, 0], [0.5, 0.26], [-0.2, 0.22]]);
    abyssArmor(ctx, G, -0.2, 0.62, true);
    // 光の刃
    const tip = 2.15;
    ctx.beginPath();
    ctx.moveTo(0.5, -0.16); ctx.quadraticCurveTo(1.4, -0.2, tip, -0.03 * side); ctx.quadraticCurveTo(1.4, 0.12, 0.5, 0.16);
    ctx.closePath();
    const g = ctx.createLinearGradient(0.5, 0, tip, 0);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, G.glow(0.95));
    g.addColorStop(1, G.glow(0.6));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = G.glow(0.35 * G.hot);
    ctx.lineWidth = 0.14;
    ctx.stroke();
    muzzle = tip;
  } else if (A.type === 'missile') {
    abyssPoly(ctx, [[-0.5, -0.4], [0.55, -0.44], [0.75, -0.3], [0.75, 0.3], [0.55, 0.44], [-0.5, 0.4]]);
    abyssArmor(ctx, G, -0.5, 0.75, true);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const x = -0.12 + i * 0.27, y = -0.17 + j * 0.34;
      ctx.fillStyle = K.body;
      circle(ctx, x, y, 0.1); ctx.fill();
      abyssGlowDot(ctx, G, x, y, 0.035);
    }
    ctx.beginPath(); ctx.moveTo(0.68, -0.32); ctx.lineTo(0.68, 0.32);
    abyssGlowLine(ctx, G, 0.05);
    // 外側のひれ
    abyssPoly(ctx, [[-0.4, side * 0.4], [-0.75, side * 0.62], [0.15, side * 0.44]]);
    abyssArmor(ctx, G, -0.75, 0.15, false);
  } else if (A.type === 'shell') {
    abyssPoly(ctx, [[-0.4, -0.3], [0.45, -0.34], [0.65, -0.18], [0.65, 0.18], [0.45, 0.34], [-0.4, 0.3]]);
    abyssArmor(ctx, G, -0.4, 0.65, true);
    // 二本のレールに挟まれた砲身
    for (const y of [-0.16, 0.16]) {
      abyssPoly(ctx, [[0.55, y - 0.05], [1.75, y - 0.04], [1.75, y + 0.04], [0.55, y + 0.05]]);
      ctx.fillStyle = K.plate2; ctx.fill(); outline(ctx);
    }
    ctx.beginPath(); ctx.moveTo(0.6, 0); ctx.lineTo(1.82, 0);
    abyssGlowLine(ctx, G, 0.07);
    for (const x of [0.9, 1.2, 1.5]) {
      ctx.beginPath(); ctx.moveTo(x, -0.22); ctx.lineTo(x, 0.22);
      ctx.strokeStyle = K.trim; ctx.lineWidth = 0.05; ctx.stroke();
    }
    abyssPoly(ctx, [[1.72, -0.24], [1.92, -0.17], [1.92, 0.17], [1.72, 0.24]]);
    ctx.fillStyle = K.body; ctx.fill(); outline(ctx);
  } else {
    ctx.strokeStyle = PART_OUTLINE.color;
    ctx.lineWidth = PART_OUTLINE.width;
    artOf('arm', A.id).draw(ctx, { t: G.t, walk: G.walk, side });
  }
  // 発射の光（地底の機体は発光色）
  if (st.flash > 0 && A.type !== 'melee') {
    const fx = muzzle + 0.1;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.moveTo(fx, -0.16); ctx.lineTo(fx + 0.45, 0); ctx.lineTo(fx, 0.16); ctx.closePath(); ctx.fill();
    abyssGlowDot(ctx, G, fx + 0.1, 0, 0.14);
  }
  ctx.restore();
}

function abyssTorso(ctx, G) {
  const K = G.K;
  const big = K.style === 'zenordia', slim = K.style === 'vesperia';
  const s = big ? 1.12 : slim ? 0.92 : 1;
  ctx.save();
  ctx.scale(s, s);
  abyssPoly(ctx, [[0.62, 0], [0.38, -0.66], [-0.5, -0.62], [-0.78, -0.2], [-0.78, 0.2], [-0.5, 0.62], [0.38, 0.66]]);
  abyssArmor(ctx, G, -0.78, 0.62, true);
  abyssPoly(ctx, [[0.42, 0], [0.24, -0.46], [-0.4, -0.42], [-0.58, 0], [-0.4, 0.42], [0.24, 0.46]]);
  abyssTrim(ctx, G, 0.045);
  // 胸の動力炉から走る光の筋
  ctx.beginPath();
  ctx.moveTo(-0.12, 0); ctx.lineTo(0.3, -0.5);
  ctx.moveTo(-0.12, 0); ctx.lineTo(0.3, 0.5);
  ctx.moveTo(-0.12, 0); ctx.lineTo(-0.65, 0);
  abyssGlowLine(ctx, G, 0.04, 0.85);
  ctx.fillStyle = K.body;
  abyssPoly(ctx, [[0.12, 0], [-0.12, -0.2], [-0.36, 0], [-0.12, 0.2]]);
  ctx.fill(); outline(ctx);
  abyssGlowDot(ctx, G, -0.12, 0, 0.1 + 0.03 * G.pulse);
  ctx.restore();
}

// 肩の装甲（腕の付け根の上に重ねる）
function abyssPauldrons(ctx, G) {
  const K = G.K, J = JOINTS.shoulder;
  for (const k of [-1, 1]) {
    ctx.save();
    ctx.translate(J.x, k * J.y);
    const m = k < 0;   // 形は右肩で決め、左肩は左右反転
    if (K.style === 'arkes') {
      abyssPoly(ctx, [[0.42, 0], [0.18, -0.3], [-0.45, -0.26], [-0.55, 0.05], [-0.3, 0.42], [0.2, 0.36]], m);
      abyssArmor(ctx, G, -0.55, 0.42, true);
      ctx.beginPath(); ctx.moveTo(-0.35, k * 0.25); ctx.lineTo(0.25, k * 0.22);
      abyssGlowLine(ctx, G, 0.04);
    } else if (K.style === 'vesperia') {
      circle(ctx, 0, 0, 0.36);
      abyssArmor(ctx, G, -0.36, 0.36, true);
      ctx.beginPath(); ctx.arc(0, 0, 0.24, 0, Math.PI * 2);
      abyssGlowLine(ctx, G, 0.035, 0.85);
      abyssGlowDot(ctx, G, 0, 0, 0.06);
    } else {
      // 王の肩当て：金の縁取りと外向きの棘
      abyssPoly(ctx, [[0.45, -0.1], [0.2, -0.34], [-0.5, -0.3], [-0.62, 0.2], [-0.25, 0.55], [0.3, 0.42]], m);
      abyssArmor(ctx, G, -0.62, 0.45, true);
      abyssTrim(ctx, G, 0.06);
      for (const x of [-0.35, 0.05]) {
        abyssPoly(ctx, [[x - 0.09, 0.4], [x - 0.02, 0.85], [x + 0.1, 0.42]], m);
        ctx.fillStyle = K.trim; ctx.fill(); outline(ctx);
      }
      abyssGlowDot(ctx, G, -0.08, k * 0.1, 0.06);
    }
    ctx.restore();
  }
}

// 頭：鋭い兜と光る単眼。アルケス = 後ろへ伸びる一本角 / ヴェスペリア = 後ろへ流れる二本の触角 / ゼノ＝オルディア = 前へ開く金の二本角
function abyssHead(ctx, G) {
  const K = G.K;
  ctx.save();
  ctx.translate(JOINTS.headA.x, JOINTS.headA.y);
  if (K.style === 'arkes') {
    abyssPoly(ctx, [[-0.1, -0.08], [-0.75, 0], [-0.1, 0.08]]);
    abyssArmor(ctx, G, -0.75, 0, true);
  } else if (K.style === 'vesperia') {
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0.05, k * 0.15); ctx.quadraticCurveTo(-0.4, k * 0.45, -0.95, k * 0.38);
      strut(ctx, K.plate2, 0.06);
      abyssGlowDot(ctx, G, -0.95, k * 0.38, 0.045);
    }
  }
  abyssPoly(ctx, [[0.42, 0], [0.24, -0.27], [-0.12, -0.25], [-0.22, 0], [-0.12, 0.25], [0.24, 0.27]]);
  abyssArmor(ctx, G, -0.22, 0.42, true);
  abyssTrim(ctx, G, 0.035);
  // 単眼（左右へゆっくり走る）
  const ey = Math.sin(G.t * 1.3) * 0.11;
  ctx.fillStyle = '#05060a';
  abyssPoly(ctx, [[0.36, -0.17], [0.42, 0], [0.36, 0.17], [0.27, 0.15], [0.27, -0.15]]);
  ctx.fill();
  abyssGlowDot(ctx, G, 0.34, ey, 0.05);
  if (K.style === 'zenordia') {
    for (const k of [-1, 1]) {
      abyssPoly(ctx, [[0.2, k * 0.05], [0.78, k * 0.52], [0.66, k * 0.56], [0.1, k * 0.16]]);
      ctx.fillStyle = K.trim; ctx.fill(); outline(ctx);
    }
    abyssGlowDot(ctx, G, 0.18, 0, 0.05);
  }
  ctx.restore();
}
