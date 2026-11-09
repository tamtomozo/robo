'use strict';
// =====================================================================
//  戦闘：フィールド（見下ろし）・プレイヤー1機 vs エネミー多数 → ボス。フィールドの形は field.js
// =====================================================================

const STEP = 1 / 60;

function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

function addLog(w, msg, color = '#cfe8d6') {
  w.log.push({ t: w.time, msg, color });
  if (w.log.length > 60) w.log.shift();
}

// ---------------------------------------------------------------------
//  生成
// ---------------------------------------------------------------------
function makeArm(perf, side) {
  // echo = 強化 Lv6〜 の近接武器が2撃目を振るまでの残り時間
  return { side, def: perf.def, perf, ammo: perf.def.mag, cd: 0, reloading: 0, trigger: 0, recoil: 0, flash: 0, echo: 0 };
}

function createPlayer(save) {
  const st = computeStats(save.build, null, save.upgrades);
  return {
    x: 0, y: 0, a: -Math.PI / 2, vx: 0, vy: 0, r: 1.2,
    build: save.build, upgrades: save.upgrades, st, hp: st.hp, maxHp: st.hp,
    action: null, walk: 0, hit: 0, dead: false, hpWarn: 100,
    air: 0, airMax: 0, jvx: 0, jvy: 0, jumpCd: 0,   // ジャンプ：残り滞空時間 / 跳躍速度 / 再使用までの待ち
    arms: { L: makeArm(st.armL, 'L'), R: makeArm(st.armR, 'R') },
    vm: new CircuitVM(save.program, st.grid, st.clock),
  };
}

function setPlayerRatio(w, P, v) {
  const reg = P.st.parts.headReg;
  const r = clampRatio(reg, Math.round(v * 100) / 100);
  if (Math.abs(r - P.st.ratio) < 0.001) return;
  if (!P.rival) Sound.play('ratio', { up: r > P.st.ratio });   // 対戦相手の切り替えは鳴らさない
  P.st = computeStats(P.build, r, P.upgrades);
  P.arms.L.perf = P.st.armL;
  P.arms.R.perf = P.st.armR;
  addLog(w, T('B002' /* 出力配分：腕 {arm}% / 脚 {leg}% */, { arm: Math.round(r * 100), leg: Math.round((1 - r) * 100) }), '#c9a0ff');
}

// ---------------------------------------------------------------------
//  ジャンプ（脚部 強化Lv6〜）：滞空中は被弾せず、岩も飛び越えられる
// ---------------------------------------------------------------------
function canJump(P) {
  return !!P.st.jump && P.jumpCd <= 0 && !(P.air > 0);
}

// 回路タイルのパラメータ（前/後/左/右/敵から離脱）から跳ぶ方向を決める
function jumpAngle(w, P, p) {
  if (p === 4) {
    const n = nearestEnemy(w, P, P.st.sensor);
    if (n) return Math.atan2(P.y - n.e.y, P.x - n.e.x);
    p = 1;
  }
  return P.a + [0, Math.PI, -Math.PI / 2, Math.PI / 2][p];
}

// 機体の向きに対する方向ごとの飛び幅の割合（前は 100%）。斜めはその間で変わる
const JUMP_SIDE = 0.6;   // 真横
const JUMP_BACK = 0.4;   // 真後ろ

function startJump(w, P, ang) {
  if (w.result || !canJump(P)) return false;
  const c = Math.cos(ang - P.a);   // 1 = 前 / 0 = 真横 / -1 = 真後ろ
  const k = c >= 0 ? JUMP_SIDE + (1 - JUMP_SIDE) * c : JUMP_SIDE + (JUMP_SIDE - JUMP_BACK) * c;
  const J = P.st.jump, v = J.dist * k / J.dur;
  P.air = P.airMax = J.dur;
  P.jvx = Math.cos(ang) * v;
  P.jvy = Math.sin(ang) * v;
  P.jumpCd = J.cd;
  Sound.play('jump', { x: P.x, y: P.y });
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    w.fx.push({ type: 'dust', x: P.x + Math.cos(a) * 0.8, y: P.y + Math.sin(a) * 0.8,
      vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, life: 0.6, max: 0.6, size: rand(0.5, 0.9) });
  }
  return true;
}

function landJump(w, P) {
  P.air = 0;
  P.vx = P.jvx * 0.25;
  P.vy = P.jvy * 0.25;
  w.shake = Math.max(w.shake, 0.15);
  Sound.play('land', { x: P.x, y: P.y });
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    w.fx.push({ type: 'dust', x: P.x + Math.cos(a), y: P.y + Math.sin(a),
      vx: Math.cos(a) * 5, vy: Math.sin(a) * 5, life: 0.7, max: 0.7, size: rand(0.6, 1.1) });
  }
}

function insideRock(w, x, y, r) {
  return w.rocks.some(k => Math.hypot(k.x - x, k.y - y) < k.r + r);
}

// 活動限界：機体が動けるのは ACT_LIMIT 秒。3地区＋ボスを ACT_SEG 秒ずつで区切る
//   区切りは出撃からの活動時間で決まる（第1地区 〜1:00 / 第2地区 〜2:00 / 第3地区 〜3:00 / ボス 〜4:00）
//   早く掃討すれば、余った時間は次の地区に回る。確認ダイアログの間は活動時間が止まる
const ACT_SEG = 60, ACT_LIMIT = 240;

// 今の区切り（地区 / ボス戦）が終わる活動時間
function actDeadline(w) {
  return w.full ? ACT_LIMIT : Math.min(ACT_LIMIT, (w.district + 1) * ACT_SEG);
}

function fmtClock(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function createWorld(save) {
  // field = 出撃するフィールド、geo = その形の処理（field.js）。FW × H = フィールド全体の大きさ
  const F = fieldById(save.field), geo = FIELD_SHAPES[F.shape];
  const { FW, H } = geo.size(F);
  const floor = clamp(save.floor[F.id] | 0, 1, FLOORS);
  const w = {
    field: F, floor, fm: floorMul(floor),   // 出撃した層 / その層のエネミー強化倍率（耐久・攻撃・鉱石）
    geo, FW, H, district: 0, open: 1, full: false, perDistrict: save.enemyCount,
    time: 0, act: 0, actWarned: false, timeUp: false, segTotal: 0, enemies: [], pshots: [], eshots: [], fx: [], scorch: [], rocks: [], decor: [],
    webs: [], hazards: [],   // 蜘蛛の巣（機体が減速する）/ 落下予告の出ている攻撃（boss-spider.js）
    phase: 'fight', phaseT: 0, boss: null, log: [], result: null, endT: 0, shake: 0, banner: null,
    program: save.program,
    ores: [], ore: emptyOre(), orePulse: {}, oreResult: null,   // 落ちている鉱石 / 回収した鉱石
    loot: [], parts: [], partPulse: 0,   // 落ちているブースター（レアエネミーのドロップ） / 回収したブースター
    veins: [], surge: { state: 'idle', t: rand(35, 55), k: 0, ph: 0 },   // 大地の脈動（地面の亀裂 / 状態）
    stats: {
      kills: { scarab: 0, spitter: 0, troll: 0, boss: 0 }, dmgDealt: 0, dmgTaken: 0,
      shots: { L: 0, R: 0 }, hits: { L: 0, R: 0 }, dmgBy: { L: 0, R: 0 },
      distance: 0, total: save.enemyCount, bossAt: null, cleared: 0,
      rareSeen: 0, rareKills: 0,
      res: [],   // 地区ごとの結果：'clear'（掃討）/ 'time'（活動時間の区切りで次へ）
    },
  };
  w.start = geo.start(F);
  geo.init(w);
  w.player = createPlayer(save);
  w.player.x = w.start.x;
  w.player.y = w.start.y;
  w.player.a = w.start.a;

  const nd = F.districts.length;
  for (let i = 0; i < F.rocksPer * nd; i++) {
    // 岩同士・外周との間に大型エネミーが通れる隙間（4.5m以上）を確保する
    let x, y, tries = 0, ok = false;
    const r = rand(F.rockR[0], F.rockR[1]);
    while (!ok && tries++ < 60) {
      ({ x, y } = geo.randomPoint(w, i % nd, r + 5));
      ok = geo.rockOk(w, x, y, r) &&
           w.rocks.every(k => Math.hypot(k.x - x, k.y - y) >= k.r * 1.12 + r * 1.12 + 4.5);
    }
    if (!ok) continue;
    w.rocks.push({ x, y, r, pts: rockPoints(r), cave: !!F.dark });
  }
  for (let i = 0; i < F.decorN; i++) {
    const { x, y } = geo.randomPoint(w, i % nd, 0.5);
    w.decor.push({ x, y, s: rand(0.5, 1.5), rot: rand(0, 6.283), type: pick(F.decor) });
  }
  makeVeins(w);
  addLog(w, T('B003' /* 戦闘モード起動。{name} {floor}へ降下完了。 */, { name: F.name, floor: floorName(floor) }), '#9fe0b0');
  if (floor > 1) addLog(w, T('B004' /* 深層の敵性生体：耐久 {hp} / 攻撃力 {dmg} */, { hp: fmtMul(w.fm.hp), dmg: fmtMul(w.fm.dmg) }), '#ffb070');
  startDistrict(w);
  return w;
}

// 岩の輪郭（半径 r のまわりをでこぼこさせた多角形）
function rockPoints(r) {
  const n = 7 + ((Math.random() * 4) | 0);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2;
    const rr = r * rand(0.8, 1.12);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}

// 現在の地区の敵を配置（同時出現上限を超える分は増援キューへ）
// 前の地区の残敵（出現待ちを含む）はそのまま残り、新しい地区の敵が加わる
function startDistrict(w) {
  const D = w.field.districts[w.district];
  const comp = enemyComposition(w.perDistrict, D);
  for (let i = comp.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [comp[i], comp[j]] = [comp[j], comp[i]];
  }
  w.queue = comp.concat(w.queue || []);   // 末尾から出現するので、前の地区の出現待ちが先に出る
  w.reinT = 0;
  w.reinLogged = false;
  while (w.queue.length && w.enemies.length < MAX_ACTIVE_ENEMIES) spawnEnemy(w, w.queue.pop(), null);
  w.segTotal = w.enemies.filter(e => !e.def.boss).length + w.queue.length;
  w.timeUp = false;
  w.phase = 'fight';
  w.banner = { title: `${floorName(w.floor)} ${districtLabel(D)}`, sub: T('B005' /* 敵性生体反応 {perDistrict}体 */, { perDistrict: w.perDistrict }), t: 3 };
  Sound.play('radio');
  addLog(w, T('B006' /* {district}：敵性生体反応 {perDistrict… */, { district: districtLabel(D), perDistrict: w.perDistrict }), '#ffd24a');
}

// 確認ダイアログで「進む」を選んだとき
function advanceDistrict(w) {
  const DS = w.field.districts;
  if (w.district < DS.length - 1) {
    w.district++;
    w.open = w.district + 1;
    w.stats.total += w.perDistrict;
    addLog(w, T('B007' /* 封鎖線を解除。{name}へ進攻する。 */, { name: DS[w.district].name }), '#9fe0b0');
    startDistrict(w);
  } else {
    w.open = DS.length;
    w.full = true;
    w.phase = 'warn';
    w.phaseT = 3;
    w.timeUp = false;
    const allClear = w.stats.res.every(r => r === 'clear');
    addLog(w, allClear ? T('B008' /* 全地区 掃討完了。{bossWarn} */, { bossWarn: w.field.bossWarn })
      : T('B095' /* 全地区の封鎖を解除。{bossWarn} */, { bossWarn: w.field.bossWarn }), '#ffd24a');
    if (w.enemies.length || w.queue.length) addLog(w, T('B085' /* 残敵 {n}体はボス戦に持ち越し。 */, { n: w.enemies.length + w.queue.length }), '#ffb070');
    Sound.stopBgm(1.5);
    Sound.play('siren');
  }
}

// 確認ダイアログで「基地に帰還」を選んだとき
function returnToBase(w) {
  w.phase = 'done';
  endBattle(w, 'return');
}

// ---------------------------------------------------------------------
//  大地の脈動：ときどき大地が赤く染まって呼吸するように脈打ち、エネミーが活性化する
// ---------------------------------------------------------------------
const SURGE = {
  rise: 3, fall: 3,            // 赤く染まる / 鎮まるまでの秒数
  dur: [21, 30],               // 脈動が続く秒数
  gap: [45, 80],               // 鎮まってから次の脈動までの秒数
  breath: 2.4,                 // 呼吸1回の秒数
  speed: 1, rate: 0.6, dmg: 0.35, boss: 0.2,   // 最大時の強化量（移動速度 +100% ＝ 2倍 / 攻撃頻度 / 与ダメージ / ボスの行動速度）
};

// 地面に走る亀裂（脈動中に赤く光る）。各地区に枝分かれした線を散らす
function makeVeins(w) {
  const nd = w.field.districts.length;
  const grow = (x, y, a, n) => {
    const pts = [[x, y]];
    for (let k = 0; k < n; k++) {
      a += rand(-0.6, 0.6);
      const l = rand(1.2, 3.2);
      x += Math.cos(a) * l; y += Math.sin(a) * l;
      pts.push([x, y]);
    }
    return pts;
  };
  for (let i = 0; i < nd * 16; i++) {
    const p0 = w.geo.randomPoint(w, i % nd, 2);
    const a = rand(0, Math.PI * 2);
    const lines = [grow(p0.x, p0.y, a, 4 + ((Math.random() * 5) | 0))];
    const nb = (Math.random() * 3) | 0;
    for (let b = 0; b < nb; b++) {
      const src = lines[0][1 + ((Math.random() * (lines[0].length - 1)) | 0)];
      lines.push(grow(src[0], src[1], a + (Math.random() < 0.5 ? -1 : 1) * rand(0.7, 1.3), 2 + ((Math.random() * 3) | 0)));
    }
    w.veins.push({ x: p0.x, y: p0.y, r: 22, lines, w: rand(0.7, 1.3) });
  }
}

// 呼吸の深さ（0〜1）
function surgeBreath(w) { return 0.5 - 0.5 * Math.cos(w.surge.ph * Math.PI * 2); }

function updateSurge(w, dt) {
  const S = w.surge;
  const ok = !w.result && (w.phase === 'fight' || w.phase === 'boss');
  if (S.state === 'idle') {
    if (ok) S.t -= dt;
    if (S.t <= 0) {
      S.state = 'rise';
      addLog(w, T('B009' /* 警告：地中から鼓動のような振動を検知…… */), '#ff7a5a');
      Sound.play('quake');
    }
  } else if (S.state === 'rise') {
    S.k = Math.min(1, S.k + dt / SURGE.rise);
    if (!ok) S.state = 'fall';
    else if (S.k >= 1) {
      S.state = 'active';
      S.t = rand(SURGE.dur[0], SURGE.dur[1]);
      w.banner = { title: T('B010' /* 大地脈動 */), sub: T('B011' /* 赤く脈打つ大地に呼応し、敵性生体が活性化！ */), t: 3 };
      addLog(w, T('B012' /* 大地が脈動している。敵性生体の活性化を確認！ */), '#ff5a3a');
      Sound.play('roar');
    }
  } else if (S.state === 'active') {
    S.t -= dt;
    if (S.t <= 0 || !ok) S.state = 'fall';
  } else if (S.state === 'fall') {
    S.k = Math.max(0, S.k - dt / SURGE.fall);
    if (S.k <= 0) {
      S.state = 'idle';
      S.t = rand(SURGE.gap[0], SURGE.gap[1]);
      if (!w.result) addLog(w, T('B013' /* 大地の脈動が鎮まった。 */), '#9fe0b0');
    }
  }
  // 呼吸：脈動が強いほど速く。息を吸いきるたびに鼓動を鳴らす
  if (S.k > 0) {
    const prev = S.ph;
    S.ph += dt / (SURGE.breath * (1.25 - 0.25 * S.k));
    if (Math.floor(prev + 0.5) !== Math.floor(S.ph + 0.5) && S.k > 0.3 && !w.result) {
      Sound.play('throb', { vol: S.k });
      w.shake = Math.max(w.shake, 0.12 * S.k);
    }
  } else S.ph = 0;
}

function spawnEnemy(w, type, at) {
  const def = ENEMY_DEFS[type];
  let x, y;
  if (at) { x = at.x; y = at.y; }
  else {
    // 現在の地区の中で、機体から 40m 以上離れた位置に出現。狭くて見つからなければ候補のうち一番遠い位置
    let best = null, bd = -1;
    for (let tries = 0; tries < 40; tries++) {
      const pt = w.geo.randomPoint(w, w.district, 5);
      if (insideRock(w, pt.x, pt.y, def.r)) continue;
      const d = Math.hypot(pt.x - w.player.x, pt.y - w.player.y);
      if (d > bd) { bd = d; best = pt; }
      if (d >= 40) break;
    }
    if (!best) best = w.geo.randomPoint(w, w.district, 5);
    ({ x, y } = best);
  }
  // 一般エネミーは地区の出現・増援のときだけ、まれにレア（輝晶個体）になる
  const rare = !def.boss && !at && Math.random() < RARE.chance * (w.surge.k > 0.5 ? RARE.surgeMul : 1);
  const d = rare ? rareDef(def) : def;
  const e = {
    type, def: d, rare, x, y, vx: 0, vy: 0, a: 0, r: d.r, hp: 0, maxHp: 0,
    cd: rand(0, def.cd), flash: 0, anim: rand(0, 10), strafeDir: Math.random() < 0.5 ? -1 : 1, lunge: 0,
    cx: x, cy: y, chkT: rand(1, 1.5), unstuck: 0,
  };
  e.hp = e.maxHp = Math.round(d.hp * w.fm.hp);   // 下の層ほど耐久が高い
  w.enemies.push(e);
  if (rare) {
    w.stats.rareSeen++;
    addLog(w, T('B014' /* レア個体を検知：{name} */, { name: d.name }), '#ffd84a');
    Sound.play('rare');
  }
  return e;
}

// レア個体の性能（元の種類の写しを強化する）
function rareDef(def) {
  return Object.assign({}, def, {
    name: RARE.prefix + def.name, hp: Math.round(def.hp * RARE.hp), speed: def.speed * RARE.speed, dmg: def.dmg * RARE.dmg,
  });
}

// ボスの耐久（エネミー数と層で決まる）
function bossHp(def, perDistrict, floor) {
  return Math.round((def.hp + 25 * perDistrict) * floorMul(floor).hp);
}

function spawnBoss(w) {
  const P = w.player;
  // 機体から離れた、フィールドの内側の位置に出現（見つからなければ近づける）
  let x, y, t = 0;
  do {
    const a = rand(0, Math.PI * 2), dist = t < 40 ? 32 : 20;
    x = P.x + Math.cos(a) * dist;
    y = P.y + Math.sin(a) * dist;
  } while ((!w.geo.inside(w, x, y, 7) || insideRock(w, x, y, 5)) && t++ < 80);
  // ボスの種類はフィールドごとに決まる（BOSS_KINDS）
  const K = BOSS_KINDS[w.field.boss];
  const e = spawnEnemy(w, w.field.boss, { x, y });
  w.geo.clamp(w, e);
  e.hp = e.maxHp = bossHp(e.def, w.perDistrict, w.floor);
  bossSet(e, 'emerge', K.emergeT);
  e.invuln = true;
  e.phase2 = false;
  K.init(w, e);
  w.boss = e;
  w.stats.bossAt = w.time;
  w.shake = 1;
  addLog(w, T('B015' /* ボス出現：{name} */, { name: e.def.name }), '#ff6a4a');
  Sound.play('quake');
  Sound.play(K.cry);
  Sound.playBgm('boss');
}

// ---------------------------------------------------------------------
//  シミュレーション
// ---------------------------------------------------------------------
function simulate(w, dt, inp) {
  w.time += dt;
  if (!w.result) w.act += dt;   // 活動時間（確認ダイアログの間はシミュレーション自体が止まる）
  w.shake = Math.max(0, w.shake - dt * 2.5);
  if (w.banner) { w.banner.t -= dt; if (w.banner.t <= 0) w.banner = null; }
  const P = w.player;
  if (!w.result) updatePlayer(w, P, dt, inp);
  else { P.vx *= 0.9; P.vy *= 0.9; P.action = null; }
  updatePlayerShots(w, dt);
  updateEnemies(w, dt);
  updateEnemyShots(w, dt);
  updateOres(w, dt);
  updateHazards(w, dt);
  updateSurge(w, dt);
  updateFx(w, dt);
  updatePhase(w, dt);
  if (w.result) w.endT += dt;
}

function updatePhase(w, dt) {
  if (w.result) return;
  if ((w.phase === 'fight' || w.phase === 'boss') && w.queue.length) {
    w.reinT -= dt;
    if (w.reinT <= 0 && w.enemies.length < MAX_ACTIVE_ENEMIES) {
      spawnEnemy(w, w.queue.pop(), null);
      w.reinT = 0.6;
      if (!w.reinLogged) { w.reinLogged = true; addLog(w, T('B016' /* 増援接近：後続 {n}体 */, { n: w.queue.length + 1 }), '#ffb070'); }
    }
  }
  // 活動限界の10秒前に知らせる（地区の区切りまでの時間は知らせない）
  if (!w.actWarned && ACT_LIMIT - w.act <= 10 && (w.phase === 'fight' || w.phase === 'boss')) {
    w.actWarned = true;
    addLog(w, T('B086' /* 活動限界まで 残り10秒！ */), '#ffb070');
    Sound.play('radio');
  }
  if (w.full && w.act >= ACT_LIMIT) {
    endBattle(w, 'timeout');
    return;
  }
  if (w.phase === 'fight' && w.enemies.length === 0 && w.queue.length === 0) {
    // 地区掃討 → 確認ダイアログ待ち（Battle 側がダイアログを出す）
    const D = w.field.districts[w.district];
    w.stats.res[w.district] = 'clear';
    w.stats.cleared = w.stats.res.filter(r => r === 'clear').length;
    w.phase = 'confirm';
    w.pshots = [];
    w.eshots = [];
    addLog(w, T('B017' /* {district} 掃討完了。 */, { district: districtLabel(D) }), '#9fe0b0');
    Sound.play('clear');
    collectAllOres(w);
  } else if (w.phase === 'fight' && w.act >= actDeadline(w)) {
    // 活動時間の区切り：敵が残っていても確認ダイアログへ（進めば残敵はそのまま、次の地区の敵が加わる）
    const D = w.field.districts[w.district];
    w.stats.res[w.district] = 'time';
    w.timeUp = true;
    w.phase = 'confirm';
    w.pshots = [];
    w.eshots = [];
    addLog(w, T('B088' /* {district} 活動時間の区切り。残敵 {n}体。 */, { district: districtLabel(D), n: w.enemies.length + w.queue.length }), '#ffd24a');
    Sound.play('radio');
  } else if (w.phase === 'warn') {
    w.phaseT -= dt;
    if (w.phaseT <= 0) { w.phase = 'boss'; spawnBoss(w); }
  }
}

function endBattle(w, result) {
  if (w.result) return;
  w.result = result;
  w.endT = 0;
  if (result === 'win') addLog(w, T('B018' /* ボス撃破を確認。任務完了。 */), '#9fe0b0');
  if (result === 'lose') addLog(w, T('B019' /* 機体大破。通信途絶…… */), '#ff6a4a');
  if (result === 'retreat') addLog(w, T('B020' /* 撤退信号を受信。戦域を離脱する。 */), '#ffd24a');
  if (result === 'return') addLog(w, T('B021' /* {n}地区を掃討。基地への帰還を開始する。 */, { n: w.stats.cleared }), '#9fe0b0');
  if (result === 'timeout') addLog(w, T('B089' /* 活動限界に到達。機体を回収する。 */), '#ffb070');
  Sound.stopBgm(result === 'lose' ? 0.3 : 1);
  Sound.play({ win: 'win', lose: 'lose', retreat: 'retreat', return: 'retreat', timeout: 'retreat' }[result]);
}

function collideRocks(w, o) {
  for (const k of w.rocks) {
    const dx = o.x - k.x, dy = o.y - k.y;
    const d = Math.hypot(dx, dy), rr = k.r + o.r;
    if (d < rr && d > 0.0001) {
      o.x = k.x + dx / d * rr;
      o.y = k.y + dy / d * rr;
    }
  }
}

function clampField(w, o) {
  w.geo.clamp(w, o);
}

function updatePlayer(w, P, dt, inp) {
  const st = P.st;
  let thrust = 0, strafe = 0, turn = 0, faceTo = null, manualVel = null;
  P.jumpCd = Math.max(0, P.jumpCd - dt);

  if (inp.manual) {
    P.action = null;
    let mx = (inp.keys.KeyD ? 1 : 0) - (inp.keys.KeyA ? 1 : 0);
    let my = (inp.keys.KeyS ? 1 : 0) - (inp.keys.KeyW ? 1 : 0);
    const l = Math.hypot(mx, my);
    if (l > 0) { mx /= l; my /= l; }
    // 3D 表示：W = カメラの奥（前進）・A/D = カメラから見た左右（inp.camYaw = カメラの向き）
    if (inp.camYaw != null) {
      const fx = Math.cos(inp.camYaw), fy = Math.sin(inp.camYaw);
      [mx, my] = [mx * -fy - my * fx, mx * fx - my * fy];
    }
    manualVel = [mx * st.speed, my * st.speed];
    if (inp.jump) { inp.jump = false; startJump(w, P, l > 0 ? Math.atan2(my, mx) : P.a); }   // 移動キーの方向（なければ正面）へ
    if (inp.aim) faceTo = Math.atan2(inp.aim.y - P.y, inp.aim.x - P.x);
    if (inp.fireL) P.arms.L.trigger = Math.max(P.arms.L.trigger, 0.05);
    if (inp.fireR) P.arms.R.trigger = Math.max(P.arms.R.trigger, 0.05);
  } else {
    P.vm.update(dt, P, w);
    const act = P.action;
    if (act) {
      if (act.type === 'move') { thrust = act.thrust; strafe = act.strafe; }
      else if (act.type === 'turn') turn = act.dir;
      else if (act.type === 'face') {
        const n = nearestEnemy(w, P, st.sensor);
        if (n) {
          faceTo = Math.atan2(n.e.y - P.y, n.e.x - P.x);
          if (Math.abs(angDiff(faceTo, P.a)) < 0.03) act.t = 0;
        } else act.t = 0;
      }
      act.t -= dt;
      if (act.t <= 0) P.action = null;
    }
  }

  if (faceTo != null) {
    const d = angDiff(faceTo, P.a), m = st.turn * dt;
    P.a += clamp(d, -m, m);
  } else {
    P.a += turn * st.turn * dt;
  }

  let dvx, dvy;
  if (manualVel) [dvx, dvy] = manualVel;
  else {
    const fx = Math.cos(P.a), fy = Math.sin(P.a), rx = -fy, ry = fx;
    dvx = (fx * thrust + rx * strafe * st.strafe) * st.speed;
    dvy = (fy * thrust + ry * strafe * st.strafe) * st.speed;
  }
  const air = P.air > 0;
  if (air) {
    // 滞空中は跳躍の勢いのまま進む（移動入力・ノックバック・蜘蛛の巣の影響を受けない）
    P.vx = P.jvx;
    P.vy = P.jvy;
  } else {
    if (w.webs.length && inWeb(w, P)) { dvx *= WEB_SLOW; dvy *= WEB_SLOW; }   // 蜘蛛の巣に脚を取られる
    const k = Math.min(1, st.accel * dt);
    P.vx += (dvx - P.vx) * k;
    P.vy += (dvy - P.vy) * k;
  }
  P.x += P.vx * dt;
  P.y += P.vy * dt;
  const sp = Math.hypot(P.vx, P.vy);
  w.stats.distance += sp * dt;
  if (air) {
    P.air -= dt;
    if (P.air <= 0) landJump(w, P);
  } else {
    P.walk += sp * dt;
    // 歩幅ごとに足音
    const stride = Math.floor(P.walk / 2.6);
    if (stride !== P.stride) { P.stride = stride; Sound.play('step', { x: P.x, y: P.y, vol: 0.7 }); }
  }
  if (!(P.air > 0)) collideRocks(w, P);   // 滞空中は岩を飛び越える（着地時に重なっていれば押し出す）
  clampField(w, P);
  P.hit = Math.max(0, P.hit - dt);

  updateArm(w, P, P.arms.L, dt);
  updateArm(w, P, P.arms.R, dt);

  if (!air && sp > 2 && Math.random() < dt * sp * 0.7) {
    w.fx.push({
      type: 'dust', x: P.x - Math.cos(P.a) * 0.8 + rand(-0.7, 0.7), y: P.y - Math.sin(P.a) * 0.8 + rand(-0.7, 0.7),
      vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4), life: 0.9, max: 0.9, size: rand(0.4, 0.8),
    });
  }
}

function updateArm(w, P, arm, dt) {
  arm.recoil = Math.max(0, arm.recoil - dt * 6);
  arm.flash = Math.max(0, arm.flash - dt);
  arm.cd -= dt;
  if (arm.echo > 0) {
    // 強化 Lv6〜 の近接武器：少し遅れて返す刀でもう一撃
    arm.echo -= dt;
    if (arm.echo <= 0) {
      arm.echo = 0;
      arm.recoil = 1;
      w.stats.shots[arm.side]++;
      Sound.play('melee', { x: P.x, y: P.y });
      meleeSwing(w, P, arm, arm.perf.dmg);
    }
  }
  if (arm.reloading > 0) {
    arm.reloading -= dt;
    if (arm.reloading <= 0) { arm.reloading = 0; arm.ammo = arm.def.mag; Sound.play('reloaded', { x: P.x, y: P.y }); }
  }
  if (arm.trigger > 0) {
    arm.trigger -= dt;
    if (arm.def.type !== 'none' && arm.cd <= 0 && arm.reloading <= 0) {
      fireArm(w, P, arm);
      arm.cd = 1 / arm.perf.rate;
      if (arm.def.mag > 0) {
        arm.ammo--;
        if (arm.ammo <= 0) {
          arm.reloading = arm.perf.reload;
          Sound.play('reload', { x: P.x, y: P.y });
          const sec = arm.perf.reload.toFixed(1);
          addLog(w, arm.side === 'L' ? T('B070' /* 左腕 弾切れ → リロード {sec}秒 */, { sec }) : T('B071' /* 右腕 弾切れ → リロード {sec}秒 */, { sec }), '#9cd6d6');
        }
      }
    }
  }
}

function aimAngle(w, P, mx, my, range) {
  let best = null, bd = Infinity;
  for (const e of w.enemies) {
    if (e.invuln) continue;
    const dx = e.x - mx, dy = e.y - my;
    const d = Math.hypot(dx, dy) - e.r;
    if (d > range) continue;
    if (Math.abs(angDiff(Math.atan2(dy, dx), P.a)) < 0.3 && d < bd) { bd = d; best = e; }
  }
  return best ? Math.atan2(best.y - my, best.x - mx) : P.a;
}

function nearestTo(w, x, y, maxD) {
  let best = null, bd = maxD;
  for (const e of w.enemies) {
    if (e.invuln || e.hp <= 0) continue;
    const d = Math.hypot(e.x - x, e.y - y) - e.r;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// 射程内で、爆風に巻き込める敵が多い（群れの中心にいる）敵を優先して狙う
function pickMissileTarget(w, P, range, splash) {
  const list = [];
  for (const e of w.enemies) {
    if (e.invuln || e.hp <= 0) continue;
    const d = Math.hypot(e.x - P.x, e.y - P.y) - e.r;
    if (d <= range) list.push({ e, d });
  }
  for (const c of list) {
    let n = 0;
    for (const o of list) {
      if (Math.hypot(o.e.x - c.e.x, o.e.y - c.e.y) - o.e.r < splash) n++;
    }
    c.score = n - c.d / range;
  }
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, 3);
  return top.length ? pick(top).e : null;
}

function fireArm(w, P, arm) {
  const d = arm.def, s = arm.side === 'L' ? -1 : 1;
  const fx = Math.cos(P.a), fy = Math.sin(P.a), rx = -fy, ry = fx;
  const J = JOINTS.shoulder, mz = armMuzzle(d);
  const mx = P.x + fx * mz + rx * s * J.y;
  const my = P.y + fy * mz + ry * s * J.y;
  const n = d.shots || 1;   // 強化 Lv6〜 は1回の攻撃で2発
  w.stats.shots[arm.side] += d.type === 'melee' ? 1 : n;
  arm.recoil = 1;
  arm.flash = 0.06;
  const dmg = arm.perf.dmg;
  Sound.play({ gun: 'gun', shell: 'shell', missile: 'missile', flame: 'flame', melee: 'melee' }[d.type], { x: mx, y: my });
  if (d.type === 'melee') {
    meleeSwing(w, P, arm, dmg);
    if (n > 1) arm.echo = Math.min(0.15, 0.5 / arm.perf.rate);
    return;
  }

  const aim = d.type === 'missile' ? P.a : aimAngle(w, P, mx, my, d.range);
  const fan = { missile: 0.35, flame: 0.12, shell: 0.05 }[d.type] || 0.035;   // 複数発のときの左右の開き(rad)
  for (let i = 0; i < n; i++) {
    const off = i - (n - 1) / 2;
    const ox = rx * off * 0.35, oy = ry * off * 0.35;   // 砲口から左右に少しずらして並べて撃つ
    const ang = aim + off * fan + rand(-d.spread, d.spread);
    const shot = {
      kind: d.type, arm: arm.side, x: mx + ox, y: my + oy, ang, speed: d.speed,
      // 前フレーム位置＝肩。最初の判定で肩〜砲口間の密着した敵にも当たる
      px: P.x + fx * J.x + rx * s * J.y + ox, py: P.y + fy * J.x + ry * s * J.y + oy,
      vx: Math.cos(ang) * d.speed, vy: Math.sin(ang) * d.speed,
      dmg, life: d.range / d.speed, r: 0.25, splash: d.splash || 0, counted: false,
    };
    if (d.type === 'flame') {
      shot.r = 0.4; shot.hitSet = new Set(); shot.max = shot.life;
      shot.vx += P.vx; shot.vy += P.vy;
    } else if (d.type === 'missile') {
      shot.target = pickMissileTarget(w, P, d.range, shot.splash);
      shot.turn = d.turn; shot.life *= 1.5; shot.smokeT = 0;
      shot.r = d.fuse || shot.r;   // 近接信管：敵にこの距離まで近づいたら起爆
    } else if (d.type === 'shell') {
      shot.r = 0.35;
      if (d.pierce) { shot.pierce = true; shot.hitSet = new Set(); }   // 強化 Lv6〜：敵を貫いて飛ぶ
      w.shake = Math.max(w.shake, 0.25);
    }
    w.pshots.push(shot);
  }
}

function meleeSwing(w, P, arm, dmg) {
  const d = arm.def;
  let hit = false;
  for (const e of w.enemies) {
    if (e.invuln || e.hp <= 0 || e.air > 0) continue;   // air = ジャンプ中の対戦相手
    const dx = e.x - P.x, dy = e.y - P.y;
    const len = Math.hypot(dx, dy) || 1;
    const dist = len - e.r;
    if (dist > d.range + 0.8) continue;
    if (Math.abs(angDiff(Math.atan2(dy, dx), P.a)) > d.arc / 2 && dist > 0.5) continue;
    damageEnemy(w, e, dmg, arm.side);
    hit = true;
    knockEnemy(e, dx / len, dy / len, KNOCK.melee);
    for (let i = 0; i < 4; i++) {
      w.fx.push({ type: 'spark', x: e.x - dx / len * e.r, y: e.y - dy / len * e.r, vx: rand(-8, 8), vy: rand(-8, 8), life: 0.25, max: 0.25, size: 0.15 });
    }
  }
  if (hit) { w.stats.hits[arm.side]++; Sound.play('meleeHit', { x: P.x, y: P.y }); }
  w.fx.push({ type: 'slash', x: P.x, y: P.y, a: P.a, range: d.range + 1.2, arc: d.arc, life: 0.18, max: 0.18 });
}

// 被弾ノックバックの強さ（敵の速度に加える量。約0.2秒で元の動きに戻る）
const KNOCK = { melee: 12, shell: 14, missile: 9, gun: 0.5 };

// 一般エネミーを (ux, uy) の向きへ押す。ボスは押さない。トロールは重いので1/3
// 対戦相手の機体（e.robot）は半分の強さで押す（ジャンプ中は押さない）
function knockEnemy(e, ux, uy, power) {
  if (e.robot) {
    if (power && !(e.air > 0)) { e.vx += ux * power * 0.5; e.vy += uy * power * 0.5; }
    return;
  }
  if (e.def.boss || !power) return;
  const k = power * (e.type === 'troll' ? 1 / 3 : 1);
  e.vx += ux * k;
  e.vy += uy * k;
}

function damageEnemy(w, e, dmg, side) {
  if (e.robot) { hurtRobot(w, e, dmg, side); return; }   // 対戦相手の機体（versus.js）
  if (e.invuln || e.hp <= 0) return;
  const real = Math.min(dmg, e.hp);
  e.hp -= dmg;
  e.flash = 0.08;
  Sound.play('hit', { x: e.x, y: e.y });
  w.stats.dmgDealt += real;
  w.stats.dmgBy[side] += real;
  if (e.hp <= 0) killEnemy(w, e);
}

function killEnemy(w, e) {
  w.stats.kills[e.def.boss ? 'boss' : e.type]++;
  const art = enemyArtOf(e.type);
  const col = art.gibColor;
  const n = e.def.boss ? 60 : e.type === 'troll' ? 16 : 7;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(2, 9) * (e.def.boss ? 2 : 1);
    w.fx.push({ type: 'gib', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), max: 0.9, size: rand(0.15, 0.35) * (e.def.boss ? 2 : 1), color: col });
  }
  addScorch(w, e.x, e.y, e.r * 1.2, art.scorchColor);
  dropOre(w, e);
  if (e.rare) dropPart(w, e);
  Sound.play(e.def.boss ? 'bossDie' : e.type === 'troll' ? 'killBig' : 'kill', { x: e.x, y: e.y });
  if (e.def.boss) {
    w.hazards = [];
    for (let i = 0; i < 8; i++) {
      w.fx.push({ type: 'boom', x: e.x + rand(-4, 4), y: e.y + rand(-4, 4), life: rand(0.5, 1.2), max: 1.2, size: rand(3, 6) });
    }
    w.shake = 1.5;
    endBattle(w, 'win');
    return;
  }
  const remain = w.enemies.filter(o => o.hp > 0 && !o.def.boss).length + w.queue.length;
  const killed = w.stats.kills.scarab + w.stats.kills.spitter + w.stats.kills.troll;
  if (w.phase === 'fight') {
    if (remain > 0 && (remain <= 3 || killed % 10 === 0)) addLog(w, T('B022' /* 撃破 {killed} / 残敵 {remain}体 */, { killed, remain }));
  }
}

function addScorch(w, x, y, r, color) {
  w.scorch.push({ x, y, r, color, rot: rand(0, 6.28) });
  if (w.scorch.length > 160) w.scorch.shift();
}

function explode(w, x, y, rad, dmg, side, direct, shot) {
  const kb = shot ? KNOCK[shot.kind] || 0 : 0;
  const sv = shot ? Math.hypot(shot.vx, shot.vy) || 1 : 1;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.invuln || e.air > 0) continue;
    const cx = e.x - x, cy = e.y - y, cd = Math.hypot(cx, cy);
    // 爆心から外向きに押す（爆心が敵の真上なら弾の進む向き）
    const [ux, uy] = cd > 0.3 ? [cx / cd, cy / cd] : shot ? [shot.vx / sv, shot.vy / sv] : [0, 0];
    if (e === direct) { damageEnemy(w, e, dmg, side); knockEnemy(e, ux, uy, kb); continue; }
    const d = cd - e.r;
    if (d < rad) {
      const f = 1 - 0.5 * Math.max(0, d) / rad;
      damageEnemy(w, e, dmg * f, side);
      knockEnemy(e, ux, uy, kb * f);
    }
  }
  w.fx.push({ type: 'boom', x, y, life: 0.45, max: 0.45, size: rad });
  Sound.play('boom', { x, y, size: rad });
  w.fx.push({ type: 'ring', x, y, life: 0.35, max: 0.35, size: rad * 1.4 });
  addScorch(w, x, y, rad * 0.7, 'rgba(30,22,15,0.35)');
}

function updatePlayerShots(w, dt) {
  for (const s of w.pshots) {
    if (s.kind === 'missile') {
      if (!s.target || s.target.hp <= 0 || s.target.invuln) s.target = nearestTo(w, s.x, s.y, 30);
      if (s.target) {
        const want = Math.atan2(s.target.y - s.y, s.target.x - s.x);
        const m = s.turn * dt;
        s.ang += clamp(angDiff(want, s.ang), -m, m);
      }
      s.vx = Math.cos(s.ang) * s.speed;
      s.vy = Math.sin(s.ang) * s.speed;
      s.smokeT -= dt;
      if (s.smokeT <= 0) {
        s.smokeT = 0.03;
        w.fx.push({ type: 'smoke', x: s.x, y: s.y, vx: 0, vy: 0, life: 0.6, max: 0.6, size: 0.3 });
      }
    } else if (s.kind === 'flame') {
      for (const wb of w.webs) if (Math.hypot(wb.x - s.x, wb.y - s.y) < wb.r) wb.t = Math.min(wb.t, 0.4);   // 巣を焼き払う
      s.vx *= (1 - 1.2 * dt);
      s.vy *= (1 - 1.2 * dt);
      s.r += dt * 2.2;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    // 移動経路（線分）で当たり判定する（高速弾のすり抜け防止）
    const sx0 = s.px, sy0 = s.py, sdx = s.x - sx0, sdy = s.y - sy0;
    const sl2 = sdx * sdx + sdy * sdy || 1e-6;
    s.px = s.x; s.py = s.y;

    for (const e of w.enemies) {
      if (e.hp <= 0 || e.invuln || e.air > 0) continue;   // ジャンプ中の対戦相手の頭上は越える
      const rr = e.r + s.r;
      const tt = clamp(((e.x - sx0) * sdx + (e.y - sy0) * sdy) / sl2, 0, 1);
      const hx = sx0 + sdx * tt, hy = sy0 + sdy * tt;
      const dx = e.x - hx, dy = e.y - hy;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (s.pierce) {
        // 貫通弾：当たった敵ごとにその場で爆発し、止まらずに飛び続ける（同じ敵には1回だけ）
        if (s.hitSet.has(e)) continue;
        s.hitSet.add(e);
        if (!s.counted) { s.counted = true; w.stats.hits[s.arm]++; }
        explode(w, hx, hy, s.splash, s.dmg, s.arm, e, s);
        continue;
      }
      if (s.kind !== 'flame') { s.x = hx; s.y = hy; }
      if (s.kind === 'flame') {
        if (s.hitSet.has(e)) continue;
        s.hitSet.add(e);
        damageEnemy(w, e, s.dmg, s.arm);
        if (!s.counted) { s.counted = true; w.stats.hits[s.arm]++; }
        continue;
      }
      if (!s.counted) { s.counted = true; w.stats.hits[s.arm]++; }
      if (s.kind === 'missile') { s.x = e.x; s.y = e.y; }   // 近接信管：目標の真上で炸裂
      if (s.splash) explode(w, s.x, s.y, s.splash, s.dmg, s.arm, e, s);
      else {
        damageEnemy(w, e, s.dmg, s.arm);
        const sv = Math.hypot(s.vx, s.vy) || 1;
        knockEnemy(e, s.vx / sv, s.vy / sv, KNOCK[s.kind] || 0);
        w.fx.push({ type: 'spark', x: s.x, y: s.y, vx: rand(-5, 5), vy: rand(-5, 5), life: 0.15, max: 0.15, size: 0.15 });
      }
      s.life = 0;
      s.done = true;
      break;
    }
    if (!s.done && s.life <= 0 && s.splash && s.kind !== 'flame') explode(w, s.x, s.y, s.splash, s.dmg, s.arm, null, s);
  }
  w.pshots = w.pshots.filter(s => s.life > 0 && w.geo.inside(w, s.x, s.y, -0.5));   // 岩壁・封鎖線で消える
}

function hurtPlayer(w, dmg) {
  const P = w.player;
  if (w.result || P.air > 0) return;   // ジャンプ中は無敵
  const real = dmg * w.fm.dmg * (1 + SURGE.dmg * w.surge.k) * 100 / (100 + P.st.def * 4);   // 下の層ほど・脈動中は被ダメージ増
  P.hp -= real;
  P.hit = 0.12;
  Sound.play('hurt');
  w.stats.dmgTaken += Math.min(real, P.hp + real);
  w.shake = Math.max(w.shake, Math.min(0.6, real / 40));
  const pct = P.hp / P.maxHp * 100;
  for (const th of [75, 50, 25, 10]) {
    if (P.hpWarn > th && pct <= th) {
      P.hpWarn = th;
      addLog(w, T('B023' /* 警告：機体損傷 HP {th}% 以下 */, { th }), '#ff7a5a');
      Sound.play('alarm');
    }
  }
  if (P.hp <= 0) {
    P.hp = 0;
    P.dead = true;
    for (let i = 0; i < 10; i++) {
      w.fx.push({ type: 'boom', x: P.x + rand(-2, 2), y: P.y + rand(-2, 2), life: rand(0.5, 1.3), max: 1.3, size: rand(1.5, 3.5) });
    }
    w.shake = 1.5;
    Sound.play('die');
    endBattle(w, 'lose');
  }
}

function updateEnemies(w, dt) {
  const P = w.player;
  const frozen = !!w.result;
  const rage = w.surge.k;   // 大地の脈動による活性化（0〜1）
  for (const e of w.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    e.anim += dt;
    e.cd -= dt * (1 + SURGE.rate * rage);
    e.lunge = Math.max(0, e.lunge - dt * 4);
    if (frozen) { e.vx *= 0.9; e.vy *= 0.9; continue; }
    if (e.def.boss) { BOSS_KINDS[e.type].update(w, e, dt * (1 + SURGE.boss * rage)); continue; }

    const dx = P.x - e.x, dy = P.y - e.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const ux = dx / d, uy = dy / d;              // 機体への直線の向き（射撃用）
    const [mx, my] = w.geo.dirTo(w, e, P.x, P.y);  // 機体へ向かう移動の向き
    const sp = e.def.speed * (1 + SURGE.speed * rage);
    let dvx = 0, dvy = 0;
    e.a = Math.atan2(my, mx);

    if (e.type === 'spitter') {
      if (d > 22) { dvx = mx * sp; dvy = my * sp; }
      else if (d < 14) { dvx = -ux * sp; dvy = -uy * sp; }
      else {
        dvx = -uy * sp * 0.6 * e.strafeDir;
        dvy = ux * sp * 0.6 * e.strafeDir;
        if (Math.random() < dt * 0.3) e.strafeDir *= -1;
      }
      if (e.cd <= 0 && d < e.def.range && w.geo.los(w, e.x, e.y, P.x, P.y)) {
        e.cd = e.def.cd * rand(0.8, 1.2);
        e.lunge = 1;
        Sound.play('acid', { x: e.x, y: e.y });
        w.eshots.push({ kind: 'acid', x: e.x + ux * e.r, y: e.y + uy * e.r, vx: ux * 16, vy: uy * 16, r: 0.4, dmg: e.def.dmg, life: 2.2 });
      }
    } else {
      dvx = mx * sp;
      dvy = my * sp;
      const reach = e.r + P.r + e.def.reach;
      if (d < reach + 0.2 && e.cd <= 0) {
        e.cd = e.def.cd;
        e.lunge = 1;
        Sound.play('bite', { x: e.x, y: e.y });
        hurtPlayer(w, e.def.dmg);
        if (e.type === 'troll') w.shake = Math.max(w.shake, 0.4);
      }
      if (d < reach) { dvx *= 0.1; dvy *= 0.1; }
    }
    // 詰まり検知：1.5秒ごとに移動量を確認し、動けていなければ横へ回り込む
    e.chkT -= dt;
    if (e.chkT <= 0) {
      const moved = Math.hypot(e.x - e.cx, e.y - e.cy);
      if (moved < 1 && d > e.r + P.r + 3) { e.unstuck = 1.5; e.strafeDir *= -1; }
      e.cx = e.x; e.cy = e.y; e.chkT = 1.5;
    }
    if (e.unstuck > 0) {
      // 接している岩から離れつつ横へ回り込む
      e.unstuck -= dt;
      let ex = -uy * e.strafeDir, ey = ux * e.strafeDir;
      for (const rk of w.rocks) {
        const ox = e.x - rk.x, oy = e.y - rk.y, od = Math.hypot(ox, oy) || 1;
        if (od - rk.r - e.r < 1.5) { ex += ox / od * 1.5; ey += oy / od * 1.5; }
      }
      const el = Math.hypot(ex, ey) || 1;
      dvx = ex / el * sp;
      dvy = ey / el * sp;
    } else {
      [dvx, dvy] = steerAroundRocks(w, e, dvx, dvy);
    }
    const k = Math.min(1, dt * 5);
    e.vx += (dvx - e.vx) * k;
    e.vy += (dvy - e.vy) * k;
  }

  for (const e of w.enemies) { e.x += e.vx * dt; e.y += e.vy * dt; }

  // 群れ同士の押し合い
  const es = w.enemies;
  for (let i = 0; i < es.length; i++) {
    const a = es[i];
    for (let j = i + 1; j < es.length; j++) {
      const b = es[j];
      if (a.buried || b.buried || a.airborne || b.airborne) continue;   // 地中・空中のボスとは押し合わない
      const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2), ov = rr - d;
      const ma = a.r * a.r, mb = b.r * b.r;
      const ta = mb / (ma + mb), tb = ma / (ma + mb);
      const ux = dx / d, uy = dy / d;
      a.x -= ux * ov * ta; a.y -= uy * ov * ta;
      b.x += ux * ov * tb; b.y += uy * ov * tb;
    }
  }
  for (const e of es) {
    const dx = e.x - P.x, dy = e.y - P.y, rr = e.r + P.r;
    const d = Math.hypot(dx, dy);
    if (d < rr && d > 0.0001 && !e.buried && !e.airborne) {
      const ov = rr - d, ux = dx / d, uy = dy / d;
      const tp = e.def.boss ? 1 : e.type === 'troll' ? 0.4 : 0.12;
      e.x += ux * ov * (1 - tp); e.y += uy * ov * (1 - tp);
      P.x -= ux * ov * tp; P.y -= uy * ov * tp;
    }
    if (!e.buried && !e.airborne) collideRocks(w, e);   // 跳躍中は岩を飛び越える
    clampField(w, e);
  }
  collideRocks(w, P);
  clampField(w, P);
  w.enemies = w.enemies.filter(e => e.hp > 0);
}

// 進行方向の前方にある岩を接線方向へ回り込む
function steerAroundRocks(w, e, dvx, dvy) {
  const sp = Math.hypot(dvx, dvy);
  if (sp < 0.01) return [dvx, dvy];
  const ux0 = dvx / sp, uy0 = dvy / sp;
  let ux = ux0, uy = uy0;
  for (const k of w.rocks) {
    const rx = k.x - e.x, ry = k.y - e.y;
    const d = Math.hypot(rx, ry);
    const gap = d - k.r - e.r;
    if (gap > 3 || d < 0.001) continue;
    if (rx * ux0 + ry * uy0 <= 0) continue;
    let tx = -ry / d, ty = rx / d;
    const dot = tx * ux0 + ty * uy0;
    if (Math.abs(dot) < 0.05) { tx *= e.strafeDir; ty *= e.strafeDir; }
    else if (dot < 0) { tx = -tx; ty = -ty; }
    const wgt = 2 * (1 - Math.max(0, gap) / 3);
    ux += tx * wgt;
    uy += ty * wgt;
  }
  const l = Math.hypot(ux, uy) || 1;
  return [ux / l * sp, uy / l * sp];
}

function turnToward(a, target, m) {
  return a + clamp(angDiff(target, a), -m, m);
}

// ボスの行動を切り替える。st0（行動の長さ）は予備モーションの進み具合の計算に使う
function bossSet(e, state, st) {
  e.state = state;
  e.st = e.st0 = st;
}

// 現在の行動の進み具合 0→1（予備モーションの大きさ）
function bossWind(e) {
  return e.st0 ? clamp(1 - e.st / e.st0, 0, 1) : 1;
}

// 弾を放つ前の予備動作：周囲の砂礫を吸い込む
function bossInhale(w, e) {
  const p = bossWind(e);
  if (Math.random() < 0.9) {
    const a = rand(0, Math.PI * 2), r = e.r + 4.5;
    w.fx.push({ type: 'gib', x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r, vx: -Math.cos(a) * 18, vy: -Math.sin(a) * 18, life: 0.35, max: 0.35, size: 0.22, color: '#d9a066' });
  }
  w.shake = Math.max(w.shake, 0.15 * p);
}

// 全方位へ岩弾を放つ
function bossRing(w, e, n, off, speed, dmg) {
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + off;
    w.eshots.push({ kind: 'rock', x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 0.5, dmg, life: 4 });
  }
}

function updateBoss(w, e, dt) {
  const P = w.player;
  const dx = P.x - e.x, dy = P.y - e.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const toP = Math.atan2(dy, dx);
  // HP が半分を切ったら赤熱形態へ。行動を中断して激昂し、以後は別の行動パターンになる
  if (!e.phase2 && e.hp < e.maxHp * 0.5 && !e.invuln) {
    e.phase2 = true;
    e.chain = 0;
    bossSet(e, 'rage', 2);
    w.shake = 0.8;
    // 激昂の中身（何が変わったか）は見せない：名前だけを出す
    const rage = T('B024' /* {name} 激昂 */, { name: e.def.name });
    w.banner = { title: rage, sub: '', t: 3 };
    addLog(w, rage, '#ff6a4a');
    Sound.play('roar');
    Sound.play('quake');
  }
  const p2 = e.phase2;
  const spd = e.def.speed * (p2 ? 1.35 : 1);
  let dvx = 0, dvy = 0;
  e.st -= dt;

  switch (e.state) {
    case 'emerge':
      e.a = toP;
      if (Math.random() < 0.6) {
        const a = rand(0, Math.PI * 2);
        w.fx.push({ type: 'dust', x: e.x + Math.cos(a) * 5, y: e.y + Math.sin(a) * 5, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, life: 1, max: 1, size: rand(1, 2) });
      }
      if (e.st <= 0) { e.invuln = false; bossSet(e, 'chase', 2); }
      break;
    case 'chase': {
      const [cx, cy] = w.geo.dirTo(w, e, P.x, P.y);
      e.a = turnToward(e.a, Math.atan2(cy, cx), 2 * dt);
      dvx = Math.cos(e.a) * spd;
      dvy = Math.sin(e.a) * spd;
      if (d < e.r + P.r + 0.4 && e.cd <= 0) { e.cd = 1; hurtPlayer(w, e.def.dmg); }
      if (e.st <= 0) bossPick(w, e, d);
      break;
    }
    case 'rage': {
      // 形態変化：その場で身を震わせて熱を溜め、最後に衝撃波で機体を押し返す
      const p = bossWind(e);
      e.a = turnToward(e.a, toP, 1.5 * dt);
      w.shake = Math.max(w.shake, 0.3 * p);
      if (Math.random() < 0.6) {
        w.fx.push({ type: 'gib', x: e.x + rand(-4, 4), y: e.y + rand(-4, 4), vx: rand(-2, 2), vy: rand(-2, 2), life: 0.5, max: 0.5, size: 0.25, color: '#ff6a20' });
      }
      if (e.st <= 0) {
        w.fx.push({ type: 'ring', x: e.x, y: e.y, life: 0.6, max: 0.6, size: 16 });
        if (d < 14) { P.vx += dx / d * 24; P.vy += dy / d * 24; }
        w.shake = 1;
        Sound.play('slam');
        bossSet(e, 'chase', 1.2);
      }
      break;
    }
    case 'charge_wind': {
      // 予備動作：頭を引いて後ずさりしながら狙いを定め、足元の砂を掻く
      e.a = turnToward(e.a, toP, (e.chainN ? 4 : 3) * dt);
      const back = 2.5 * (1 - bossWind(e));
      dvx = -Math.cos(e.a) * back;
      dvy = -Math.sin(e.a) * back;
      if (Math.random() < 0.5) {
        w.fx.push({ type: 'dust', x: e.x - Math.cos(e.a) * 3 + rand(-2, 2), y: e.y - Math.sin(e.a) * 3 + rand(-2, 2), vx: -Math.cos(e.a) * 4, vy: -Math.sin(e.a) * 4, life: 0.6, max: 0.6, size: rand(0.6, 1.2) });
      }
      if (e.st <= 0) { bossSet(e, 'charge', e.chainN ? 0.9 : 1.1); e.cdir = e.a; e.hitDone = false; }
      break;
    }
    case 'charge': {
      const cs = p2 ? 34 : 28;
      dvx = Math.cos(e.cdir) * cs;
      dvy = Math.sin(e.cdir) * cs;
      if (!e.hitDone && d < e.r + P.r + 0.6) {
        e.hitDone = true;
        hurtPlayer(w, 55);
        P.vx += Math.cos(e.cdir) * 18;
        P.vy += Math.sin(e.cdir) * 18;
      }
      if (Math.random() < 0.7) w.fx.push({ type: 'dust', x: e.x + rand(-3, 3), y: e.y + rand(-3, 3), vx: 0, vy: 0, life: 0.8, max: 0.8, size: rand(1, 2) });
      // 進行方向の先が外周・岩壁なら止まる（壁際から離れる向きの突進は止めない）
      const wall = !w.geo.inside(w, e.x + Math.cos(e.cdir) * 1.2, e.y + Math.sin(e.cdir) * 1.2, e.r + 0.3);
      if (e.st <= 0 || wall) {
        if (wall) { w.shake = 0.6; Sound.play('slam', { vol: 0.6 }); }
        if (e.chain > 0) {
          // 赤熱形態：短い予備動作を挟んで連続突進
          e.chain--;
          e.chainN++;
          bossSet(e, 'charge_wind', 0.5);
          Sound.play('charge');
        } else {
          bossSet(e, 'recover', p2 ? 0.9 : 1.2);
        }
      }
      break;
    }
    case 'recover':
      if (e.st <= 0) bossSet(e, 'chase', p2 ? rand(1, 1.8) : rand(1.5, 2.5));
      break;
    case 'ring_wind':
      // 予備動作：甲殻を膨らませて砂礫を吸い込む
      e.a = turnToward(e.a, toP, 1 * dt);
      bossInhale(w, e);
      if (e.st <= 0) { bossSet(e, 'ring', 0); e.waves = 2; }
      break;
    case 'ring':
      e.a = turnToward(e.a, toP, 1 * dt);
      if (e.st <= 0) {
        bossRing(w, e, 24, e.waves * 0.13, 13, 12);
        w.shake = Math.max(w.shake, 0.3);
        Sound.play('volley', { x: e.x, y: e.y });
        e.waves--;
        if (e.waves <= 0) bossSet(e, 'chase', 2);
        else bossSet(e, 'ring', 0.45);
      }
      break;
    case 'spiral_wind':
      e.a = turnToward(e.a, toP, 1 * dt);
      bossInhale(w, e);
      if (e.st <= 0) {
        bossSet(e, 'spiral', 2.4);
        e.spinA = toP;
        e.spinDir = Math.random() < 0.5 ? -1 : 1;
        e.emitT = 0;
      }
      break;
    case 'spiral':
      // 赤熱形態：3本の腕が回転しながら岩弾を撒き散らす
      e.spinA += e.spinDir * 2.2 * dt;
      e.emitT -= dt;
      if (e.emitT <= 0) {
        e.emitT = 0.08;
        bossRing(w, e, 3, e.spinA, 12, 10);
        Sound.play('volley', { x: e.x, y: e.y, vol: 0.5 });
      }
      w.shake = Math.max(w.shake, 0.12);
      if (e.st <= 0) bossSet(e, 'recover', 0.8);
      break;
    case 'dive':
      // 赤熱形態：地中へ潜る（潜行中は無敵）
      if (Math.random() < 0.8) {
        const a = rand(0, Math.PI * 2);
        w.fx.push({ type: 'dust', x: e.x + Math.cos(a) * 4, y: e.y + Math.sin(a) * 4, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, life: 0.8, max: 0.8, size: rand(1, 2) });
      }
      if (e.st <= 0) { e.buried = true; bossSet(e, 'under', 2); }
      break;
    case 'under':
      // 地中を進んで機体の真下へ回り込む。地表には土煙が走る
      if (d > 1) {
        const [ux2, uy2] = w.geo.dirTo(w, e, P.x, P.y);
        dvx = ux2 * 14; dvy = uy2 * 14;
      }
      if (Math.random() < 0.5) w.fx.push({ type: 'dust', x: e.x + rand(-1.5, 1.5), y: e.y + rand(-1.5, 1.5), vx: 0, vy: 0, life: 0.7, max: 0.7, size: rand(0.6, 1.2) });
      if (e.st <= 0) {
        // 噴出地点を機体の現在位置に固定する
        e.x = P.x; e.y = P.y;
        e.vx = e.vy = 0;
        bossSet(e, 'erupt_wind', 0.9);
        Sound.play('rumble', { x: e.x, y: e.y });
      }
      break;
    case 'erupt_wind':
      if (Math.random() < 0.3 + 0.6 * bossWind(e)) {
        const a = rand(0, Math.PI * 2), r = rand(0, 6);
        w.fx.push({ type: 'dust', x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r, vx: 0, vy: 0, life: 0.5, max: 0.5, size: rand(0.5, 1) });
      }
      w.shake = Math.max(w.shake, 0.2 * bossWind(e));
      if (e.st <= 0) {
        e.buried = false;
        e.invuln = false;
        for (const s of e.segs) { s.x = e.x; s.y = e.y; }
        if (d < 7 + P.r) {
          hurtPlayer(w, 40);
          P.vx += dx / d * 20;
          P.vy += dy / d * 20;
        }
        bossRing(w, e, 16, rand(0, 1), 11, 10);
        w.fx.push({ type: 'ring', x: e.x, y: e.y, life: 0.5, max: 0.5, size: 9 });
        addScorch(w, e.x, e.y, 6, 'rgba(40,25,15,0.35)');
        w.shake = 1;
        Sound.play('slam');
        Sound.play('volley', { x: e.x, y: e.y });
        bossSet(e, 'recover', 1.2);
      }
      break;
    case 'summon':
      if (e.st <= 0) {
        const n = p2 ? 8 : 5;
        if (w.enemies.length < 120) {
          for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2;
            const m = spawnEnemy(w, 'scarab', { x: e.x + Math.cos(a) * (e.r + 2), y: e.y + Math.sin(a) * (e.r + 2) });
            clampField(w, m);
            m.cd = 1;
            w.fx.push({ type: 'dust', x: m.x, y: m.y, vx: 0, vy: 0, life: 0.8, max: 0.8, size: 1.2 });
          }
          addLog(w, T('B027' /* ボスが眷属を呼び出した（+{n}体） */, { n }), '#ffb070');
          Sound.play('summon', { x: e.x, y: e.y });
        }
        bossSet(e, 'chase', 2);
      }
      break;
    case 'slam_wind':
      // 予備動作：頭部を高く持ち上げる（描画側）
      if (e.st <= 0) {
        if (d < 10 + P.r) hurtPlayer(w, 45);
        w.fx.push({ type: 'ring', x: e.x, y: e.y, life: 0.5, max: 0.5, size: 11 });
        addScorch(w, e.x, e.y, 6, 'rgba(40,25,15,0.3)');
        if (p2) bossRing(w, e, 16, rand(0, 1), 10, 10);   // 赤熱形態は叩きつけと同時に岩弾も飛ぶ
        w.shake = 0.9;
        Sound.play('slam');
        bossSet(e, 'recover', 0.8);
      }
      break;
  }
  const k = Math.min(1, dt * (e.state === 'charge' ? 10 : 4));
  e.vx += (dvx - e.vx) * k;
  e.vy += (dvy - e.vy) * k;

  // 尾の体節
  let px = e.x - Math.cos(e.a) * e.r * 0.6, py = e.y - Math.sin(e.a) * e.r * 0.6;
  for (const s of e.segs) {
    const sx = s.x - px, sy = s.y - py, sd = Math.hypot(sx, sy) || 0.001;
    const gap = 2.4;
    if (sd > gap) { s.x = px + sx / sd * gap; s.y = py + sy / sd * gap; }
    px = s.x; py = s.y;
  }
}

// 形態ごとの行動の組み合わせと選ばれる確率
const BOSS_MOVES = {
  normal: [['charge', 0.4], ['ring', 0.35], ['summon', 0.25]],
  rage: [['charge', 0.35], ['spiral', 0.3], ['burrow', 0.25], ['summon', 0.1]],
};

// 確率表 [[行動, 確率], ...] から次の行動を選ぶ。同じ行動はなるべく続けない
function chooseMove(e, table) {
  let move;
  for (let i = 0; i < 2; i++) {
    let r = Math.random();
    move = table[table.length - 1][0];
    for (const [m, prob] of table) { r -= prob; if (r < 0) { move = m; break; } }
    if (move !== e.lastMove) break;
  }
  e.lastMove = move;
  return move;
}

// 次の行動を選ぶ。近くに寄られたら叩きつける
function bossPick(w, e, d) {
  const p2 = e.phase2;
  if (d < 10) { bossSet(e, 'slam_wind', p2 ? 0.8 : 1.0); return; }
  switch (chooseMove(e, BOSS_MOVES[p2 ? 'rage' : 'normal'])) {
    case 'charge':
      e.chain = p2 ? 2 : 0;   // 赤熱形態は3連続突進
      e.chainN = 0;
      bossSet(e, 'charge_wind', p2 ? 0.8 : 1.0);
      Sound.play('charge');
      break;
    case 'ring':
      bossSet(e, 'ring_wind', 1.0);
      Sound.play('inhale', { x: e.x, y: e.y });
      break;
    case 'spiral':
      bossSet(e, 'spiral_wind', 1.0);
      Sound.play('inhale', { x: e.x, y: e.y });
      break;
    case 'burrow':
      e.invuln = true;
      bossSet(e, 'dive', 0.8);
      addLog(w, T('B028' /* ボスが地中に潜った！ */), '#ffb070');
      Sound.play('burrow', { x: e.x, y: e.y });
      break;
    case 'summon':
      bossSet(e, 'summon', 0.8);
      break;
  }
}

// ボスの種類ごとの処理。キーは ENEMY_DEFS の種類名（boss: true のもの）
//   emergeT 出現演出の長さ / cry 出現時の鳴き声 / init 出現時の準備 / update 行動 / telegraph 地面の攻撃予告
const BOSS_KINDS = {
  boss: {
    emergeT: 2.2,
    cry: 'roar',
    init(w, e) {
      e.segs = [];
      for (let i = 0; i < 6; i++) e.segs.push({ x: e.x, y: e.y });
    },
    update: updateBoss,
    telegraph: drawBossTelegraph,
  },
};

function updateEnemyShots(w, dt) {
  const P = w.player;
  for (const s of w.eshots) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (!P.dead && !(P.air > 0) && Math.hypot(P.x - s.x, P.y - s.y) < P.r + s.r) {   // ジャンプ中は頭上を越える
      hurtPlayer(w, s.dmg);
      s.life = 0;
      if (s.web) { addWeb(w, P.x, P.y); s.web = false; }
      const col = enemyShotArtOf(s.kind).hitColor;
      for (let i = 0; i < 5; i++) w.fx.push({ type: 'gib', x: s.x, y: s.y, vx: rand(-5, 5), vy: rand(-5, 5), life: 0.3, max: 0.3, size: 0.15, color: col });
    }
  }
  for (const s of w.eshots) if (s.web && s.life <= 0) addWeb(w, s.x, s.y);
  w.eshots = w.eshots.filter(s => s.life > 0 && w.geo.inside(w, s.x, s.y, -0.5));
}

function updateFx(w, dt) {
  for (const f of w.fx) {
    f.life -= dt;
    if (f.vx != null) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= (1 - 3 * dt);
      f.vy *= (1 - 3 * dt);
    }
  }
  w.fx = w.fx.filter(f => f.life > 0);
  if (w.fx.length > 1500) w.fx.splice(0, w.fx.length - 1500);
}

// ---------------------------------------------------------------------
//  鉱石：撃破したエネミーが落とし、近づくと機体に吸い寄せられて回収される
// ---------------------------------------------------------------------
function dropOre(w, e) {
  const drop = ORE_DROPS[e.type];
  if (!drop) return;
  const big = e.def.boss ? 2.5 : 1;
  const mul = (!e.def.boss && w.surge.k > 0.5 ? 2 : 1) * (e.rare ? RARE.ore : 1) * w.fm.ore;   // 脈動中に倒すと鉱石 2倍 / レアは RARE.ore 倍 / 下の層ほど多い
  for (const [kind, n] of Object.entries(drop)) {
    const v = n * mul, cnt = Math.floor(v) + (Math.random() < v % 1 ? 1 : 0);   // 端数は確率で1個
    for (let i = 0; i < cnt; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(1.5, 5) * big;
      w.ores.push({
        kind, x: e.x + rand(-0.3, 0.3) * e.r, y: e.y + rand(-0.3, 0.3) * e.r,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: rand(0, 6.283), t: 0, pull: 0,
      });
    }
  }
}

function updateOres(w, dt) {
  const P = w.player;
  // ボス撃破後は残りの鉱石もすべて機体へ集まる
  const sweep = w.result === 'win';
  const canPick = !P.dead && (!w.result || sweep);
  const step = (o, delay, collect) => {
    o.t += dt;
    const dx = P.x - o.x, dy = P.y - o.y, d = Math.hypot(dx, dy) || 0.001;
    if (canPick && o.t > delay && (d < ORE_MAGNET_R || sweep)) o.pull += dt;
    if (o.pull > 0) {
      const sp = 10 + o.pull * 45;
      o.vx = dx / d * sp;
      o.vy = dy / d * sp;
      if (d < P.r + 0.3 || d < sp * dt) { collect(w, o); return; }
    } else {
      o.vx *= 1 - Math.min(1, 4 * dt);
      o.vy *= 1 - Math.min(1, 4 * dt);
    }
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    if (!o.pull) { o.r = 0.5; clampField(w, o); }   // 吸い寄せ中は岩壁を越えて機体へ飛んでいく
  };
  for (const o of w.ores) step(o, 0.35, collectOre);
  for (const o of w.loot) step(o, 0.8, collectPart);
  if (w.ores.some(o => o.got)) w.ores = w.ores.filter(o => !o.got);
  if (w.loot.some(o => o.got)) w.loot = w.loot.filter(o => !o.got);
  for (const k in w.orePulse) w.orePulse[k] = Math.max(0, w.orePulse[k] - dt);
  w.partPulse = Math.max(0, w.partPulse - dt);
}

// レアエネミーが落とすブースター（光る容器。鉱石と同じく近づくと吸い寄せられる）
function dropPart(w, e) {
  const part = randomDropPart(w.floor);   // 下の層ほど＋値が高いものが出やすい
  const a = rand(0, Math.PI * 2);
  w.loot.push({ part, x: e.x, y: e.y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, rot: rand(0, 6.283), t: 0, pull: 0 });
  w.stats.rareKills++;
  addLog(w, T('B029' /* {name} 撃破 ― ブースターを落とした */, { name: e.def.name }), bonusTier(part.bonus).color);
}

function collectPart(w, o) {
  o.got = true;
  w.parts.push(o.part);
  w.partPulse = 0.6;
  Sound.play('partGet');
  addLog(w, T('B030' /* ブースターを回収（{tier}） */, { tier: bonusTier(o.part.bonus).name }), bonusTier(o.part.bonus).color);   // 詳しい名前は出さない
  for (let i = 0; i < 6; i++) {
    w.fx.push({ type: 'gib', x: w.player.x, y: w.player.y, vx: rand(-4, 4), vy: rand(-4, 4), life: 0.35, max: 0.35, size: 0.2, color: bonusTier(o.part.bonus).color });
  }
}

function collectOre(w, o) {
  o.got = true;
  w.ore[o.kind]++;
  w.orePulse[o.kind] = 0.35;
  Sound.play('ore', { kind: o.kind });
  const col = ORES.find(k => k.id === o.kind).color;
  w.fx.push({ type: 'gib', x: w.player.x, y: w.player.y, vx: rand(-3, 3), vy: rand(-3, 3), life: 0.25, max: 0.25, size: 0.18, color: col });
}

// 地区掃討時など：フィールドに残った鉱石を回収ドローンがまとめて回収
function collectAllOres(w) {
  if (w.loot.length) {
    for (const o of w.loot) w.parts.push(o.part);
    addLog(w, T('B031' /* 回収ドローン：残りのブースター {n}個を回収 */, { n: w.loot.length }), '#ffd84a');
    w.loot = [];
  }
  if (!w.ores.length) return;
  const got = emptyOre();
  for (const o of w.ores) { got[o.kind]++; w.ore[o.kind]++; }
  w.ores = [];
  const oreTxt = ORES.filter(k => got[k.id]).map(k => `${k.name}×${got[k.id]}`).join(' ');
  addLog(w, T('B032' /* 回収ドローン：残りの鉱石を回収（{oreTxt}） */, { oreTxt }), '#c9e0ff');
}

// 戦闘終了時の鉱石の精算。帰還・勝利は全回収、撤退は拾った分のみ、大破は拾った分の半分を失う
function finishOre(w) {
  if (w.oreResult) return w.oreResult;
  let field = 0, fieldParts = 0;
  if (w.result === 'win' || w.result === 'return' || w.result === 'timeout') collectAllOres(w);
  else { field = w.ores.length; fieldParts = w.loot.length; }
  const lost = emptyOre(), gain = emptyOre();
  for (const k of ORES) {
    lost[k.id] = w.result === 'lose' ? Math.floor(w.ore[k.id] / 2) : 0;
    gain[k.id] = w.ore[k.id] - lost[k.id];
  }
  // ブースター：大破すると回収したうちの半分（切り捨て）をランダムに失う
  const keep = w.parts.slice(), lostParts = [];
  if (w.result === 'lose') {
    for (let n = Math.floor(keep.length / 2); n > 0; n--) lostParts.push(keep.splice((Math.random() * keep.length) | 0, 1)[0]);
  }
  w.oreResult = { collected: Object.assign({}, w.ore), lost, gain, field, parts: keep, lostParts, fieldParts };
  return w.oreResult;
}

// ---------------------------------------------------------------------
//  描画
// ---------------------------------------------------------------------
let groundPattern = null;

function makeGroundPattern(ctx) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#a7804f';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = rand(12, 44);
    const col = Math.random() < 0.5 ? 'rgba(120,80,45,0.2)' : 'rgba(205,165,115,0.18)';
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rand(70, 210) | 0},${rand(45, 155) | 0},${rand(25, 95) | 0},${rand(0.1, 0.35)})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, rand(1, 2.5), rand(1, 2.5));
  }
  const pat = ctx.createPattern(c, 'repeat');
  if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / 8));
  return pat;
}

// ボスの攻撃予告（地面に描く）。予備モーションが進むほど強く表示する
function drawBossTelegraph(ctx, w, b) {
  const p = bossWind(b);
  const blink = 0.5 + 0.5 * Math.sin(w.time * 30);
  ctx.save();
  switch (b.state) {
    case 'charge_wind': {
      // 突進の進路：予備動作が進むほど伸びる帯と矢印
      const len = 8 + 34 * p;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      ctx.fillStyle = `rgba(255,60,30,${0.1 + 0.15 * p + 0.08 * blink})`;
      ctx.fillRect(0, -b.r, len, b.r * 2);
      ctx.strokeStyle = `rgba(255,120,60,${0.4 + 0.4 * p})`;
      ctx.lineWidth = 0.35;
      for (let x = 6; x < len - 1; x += 5) {
        ctx.beginPath();
        ctx.moveTo(x, -b.r * 0.6); ctx.lineTo(x + 2, 0); ctx.lineTo(x, b.r * 0.6);
        ctx.stroke();
      }
      break;
    }
    case 'slam_wind':
      // 叩きつけの範囲：外周の輪の内側が埋まっていく
      ctx.fillStyle = `rgba(255,60,30,${0.08 + 0.08 * blink})`;
      circle(ctx, b.x, b.y, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,60,30,0.22)';
      circle(ctx, b.x, b.y, 10 * p);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,40,0.7)';
      ctx.lineWidth = 0.2;
      circle(ctx, b.x, b.y, 10);
      ctx.stroke();
      break;
    case 'ring_wind':
    case 'spiral_wind':
      // 弾の放出：外から収束していく輪
      ctx.strokeStyle = `rgba(255,${b.state === 'spiral_wind' ? 90 : 170},40,${0.3 + 0.5 * p})`;
      ctx.lineWidth = 0.3 + 0.3 * p;
      for (const k of [0, 0.5]) {
        const q = (p * 2 + k) % 1;
        circle(ctx, b.x, b.y, b.r + 10 * (1 - q));
        ctx.stroke();
      }
      break;
    case 'under':
      // 地中を進む盛り上がり
      ctx.fillStyle = 'rgba(90,60,35,0.55)';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, 2.6, 2.2, b.anim * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(50,30,15,0.7)';
      ctx.lineWidth = 0.15;
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26 + b.anim * 2;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * 0.8, b.y + Math.sin(a) * 0.8);
        ctx.lineTo(b.x + Math.cos(a + 0.3) * 2.4, b.y + Math.sin(a + 0.3) * 2.4);
        ctx.stroke();
      }
      break;
    case 'erupt_wind':
      // 噴出地点：ひび割れた地面と範囲予告
      ctx.fillStyle = `rgba(255,60,30,${0.1 + 0.1 * blink})`;
      circle(ctx, b.x, b.y, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,60,30,0.25)';
      circle(ctx, b.x, b.y, 7 * p);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,40,0.8)';
      ctx.lineWidth = 0.25;
      circle(ctx, b.x, b.y, 7);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(40,20,10,0.8)';
      ctx.lineWidth = 0.2;
      for (let i = 0; i < 8; i++) {
        const a = i * 0.785 + 0.3;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x + Math.cos(a) * 6 * p, b.y + Math.sin(a) * 6 * p);
        ctx.stroke();
      }
      break;
    case 'rage': {
      // 形態変化：赤熱した熱気が広がる
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 14);
      g.addColorStop(0, `rgba(255,90,20,${0.35 * p})`);
      g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g;
      circle(ctx, b.x, b.y, 14);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function drawWorld(ctx, w, B, VW, VH) {
  const z = B.zoom;
  const P = w.player;
  const rot = B.viewRot();   // 背後の向きでは、カメラの向きが画面の上になるよう回す（北が上なら 0）
  const sx = w.shake > 0 ? rand(-1, 1) * w.shake * 6 : 0;
  const sy = w.shake > 0 ? rand(-1, 1) * w.shake * 6 : 0;
  ctx.fillStyle = w.field.dark ? '#141216' : '#3b2a1c';
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(VW / 2 + sx, VH / 2 + sy);
  if (rot) ctx.rotate(rot);
  ctx.scale(z, z);
  ctx.translate(-B.cam.x, -B.cam.y);

  // 描く範囲（回しているときは画面の対角線を直径とする正方形）
  const hw = (rot ? Math.hypot(VW, VH) : VW) / 2 / z + 4, hh = (rot ? Math.hypot(VW, VH) : VH) / 2 / z + 4;
  const vx0 = B.cam.x - hw, vy0 = B.cam.y - hh;
  const vx1 = B.cam.x + hw, vy1 = B.cam.y + hh;
  const inView = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

  drawFloor(ctx, w, { x0: vx0, y0: vy0, x1: vx1, y1: vy1 }, inView);

  // 岩
  for (const k of w.rocks) {
    if (!inView(k.x, k.y, k.r)) continue;
    drawRock(ctx, k);
  }

  drawFloorItems(ctx, w, inView);

  // 敵（脈動中は足元に赤い揺らめき）
  const sk = w.surge.k, sb = sk > 0 ? surgeBreath(w) : 0;
  for (const e of w.enemies) {
    if (e.robot) { drawMech(ctx, w, e, false); continue; }   // 対戦相手の機体
    if (!inView(e.x, e.y, e.def.boss ? 20 : 3)) continue;
    if (sk > 0.05 && !e.buried) drawSurgeAura(ctx, e, sk, sb);
    if (e.rare) drawRareAura(ctx, e, w.time, false);
    drawEnemy(ctx, e, !rot);   // 回しているときの HP バーは、あとで画面に対して水平に描く
    if (e.rare) drawRareAura(ctx, e, w.time, true);
  }

  // プレイヤー
  drawMech(ctx, w, P, B.xray);

  drawShotsFx(ctx, w, inView);

  w.geo.drawSealed(ctx, w);
  ctx.restore();

  if (rot) {
    drawEnemyBars(ctx, w, e => {
      const p = B.toScreen(e.x, e.y);
      return p.x < -60 || p.x > VW + 60 || p.y < -60 || p.y > VH + 60 ? null : { x: p.x, top: p.y - e.r * z, k: z };
    });
  }
  const ps = B.toScreen(P.x, P.y);
  drawScreenTint(ctx, w, VW, VH, ps.x, ps.y);
}

// エネミーの HP バーを画面に対して水平に描く（2D の背後の向き・3D 表示）。
// place(e) = { x: 画面の横位置, top: エネミーの上の縁の画面の高さ, k: その場所の 1m あたりのピクセル数 }。描かないなら null
function drawEnemyBars(ctx, w, place) {
  for (const e of w.enemies) {
    if (e.robot || e.buried || e.hp >= e.maxHp || !enemyArtOf(e.type).hpBar) continue;
    const p = place(e);
    if (!p) continue;
    const bw = Math.max(16, e.r * 2 * p.k), bh = Math.max(3, 0.25 * p.k);
    const x = p.x - bw / 2, y = p.top - bh - Math.max(3, 0.45 * p.k);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = '#ff6a4a';
    ctx.fillRect(x, y, bw * Math.max(0, e.hp / e.maxHp), bh);
  }
}

// カメラの向きを機体の向きに遅れてついていかせる（背後からの視点：3D 表示と 2D の背後の向き）。yaw = いまのカメラの向き
// 少しの向きの変化（狙いの微調整など）では回らない。手動操作中は遊びを広くとる（マウスで狙う向きにカメラが回り続けないように）
function chaseYaw(yaw, P, manual, dt) {
  if (yaw == null) return P.a;
  if (P.dead) return yaw;
  const d = angDiff(P.a, yaw), ex = Math.abs(d) - (manual ? 0.6 : 0.26);
  return ex > 0 ? yaw + Math.sign(d) * Math.min(ex, Math.min(ex * 2.5 + 0.3, 1.8) * dt) : yaw;
}

// 地面とそこに描くもの（地面・脈動・装飾・焦げ跡・蜘蛛の巣・センサー範囲・ボスの予兆）。
// v = 描く範囲 { x0, y0, x1, y1 }（m）。3D 表示（view3d.js）も地面の絵としてこれを使う
function drawFloor(ctx, w, v, inView) {
  const P = w.player;
  w.geo.drawGround(ctx, w, v);
  const sk = w.surge.k, sb = sk > 0 ? surgeBreath(w) : 0;
  if (sk > 0) drawSurgeGround(ctx, w, sk, sb, v.x0, v.y0, v.x1, v.y1, inView);

  // 地面の装飾
  for (const d of w.decor) {
    if (!inView(d.x, d.y, 3)) continue;
    drawDecor(ctx, d);
  }
  for (const s of w.scorch) {
    if (!inView(s.x, s.y, s.r)) continue;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, s.r, s.r * 0.8, s.rot, 0, Math.PI * 2);
    ctx.fill();
  }
  if (w.webs.length) drawWebs(ctx, w);

  // センサー範囲
  if (!w.result) {
    ctx.save();
    ctx.strokeStyle = 'rgba(140,255,190,0.18)';
    ctx.lineWidth = 0.15;
    ctx.setLineDash([1.2, 1.2]);
    circle(ctx, P.x, P.y, P.st.sensor);
    ctx.stroke();
    if (w.vs && !w.rival.dead) {   // 対戦：相手のセンサー範囲は赤で
      ctx.strokeStyle = 'rgba(255,120,100,0.16)';
      circle(ctx, w.rival.x, w.rival.y, w.rival.st.sensor);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ボスの予兆
  const boss = w.boss;
  if (boss && boss.hp > 0 && !w.result) BOSS_KINDS[boss.type].telegraph(ctx, w, boss);
  if (w.hazards.length) drawHazards(ctx, w);
}

// 地面に落ちているもの（土煙・鉱石・ブースター）
function drawFloorItems(ctx, w, inView) {
  for (const f of w.fx) if (f.type === 'dust' && inView(f.x, f.y, 3)) drawFx(ctx, f);

  // 鉱石
  for (const o of w.ores) {
    if (inView(o.x, o.y, 1)) drawOre(ctx, o, w.time);
  }
  for (const o of w.loot) {
    if (inView(o.x, o.y, 4)) drawLoot(ctx, o, w.time);
  }
}

// 弾（対戦では相手の弾も機体の弾）と爆発などの効果
function drawShotsFx(ctx, w, inView) {
  for (const s of w.pshots) drawPShot(ctx, s);
  for (const s of w.eshots) {
    if (inView(s.x, s.y)) w.vs ? drawPShot(ctx, s) : drawEnemyShot(ctx, s);
  }
  for (const f of w.fx) if (f.type !== 'dust' && inView(f.x, f.y, 12)) drawFx(ctx, f);
}

// 画面全体にかける色（洞窟の暗さ・大地の脈動）。px, py = 自機の画面上の位置
function drawScreenTint(ctx, w, VW, VH, px, py) {
  // 洞窟：機体のまわり以外を暗くする
  if (w.field.dark) {
    const g = ctx.createRadialGradient(px, py, Math.min(VW, VH) * 0.3, px, py, Math.max(VW, VH) * 0.75);
    g.addColorStop(0, 'rgba(0,0,6,0)');
    g.addColorStop(1, 'rgba(0,0,6,0.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
  }
  // 大地の脈動：画面の縁が呼吸に合わせて赤く脈打つ
  const sk = w.surge.k;
  if (sk > 0) {
    const sb = surgeBreath(w);
    const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * (0.42 - 0.08 * sb), VW / 2, VH / 2, Math.max(VW, VH) * 0.72);
    g.addColorStop(0, 'rgba(120,0,0,0)');
    g.addColorStop(1, `rgba(110,0,0,${sk * (0.3 + 0.3 * sb)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
  }
}

// 機体（自機・対戦相手）。対戦では足元に色の輪（自機は青、相手は赤）を描く
function drawMech(ctx, w, P, xray) {
  if (P.dead) return;
  // ジャンプ中：地面に影を残し、機体は高さに応じて大きく描く
  const lift = P.air > 0 ? Math.sin(Math.PI * (1 - P.air / P.airMax)) : 0;
  if (lift > 0) {
    ctx.fillStyle = `rgba(0,0,0,${0.25 - 0.1 * lift})`;
    ctx.beginPath();
    ctx.ellipse(P.x + 0.6 * lift, P.y + 1.4 * lift, 1.5 * (1 - 0.25 * lift), 1.4 * (1 - 0.25 * lift), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (w.vs) {
    ctx.save();
    ctx.strokeStyle = P.rival ? 'rgba(255,90,70,0.8)' : 'rgba(90,180,255,0.8)';
    ctx.lineWidth = 0.18;
    circle(ctx, P.x, P.y, 2.1); ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.rotate(P.a);
  if (lift > 0) ctx.scale(1 + 0.35 * lift, 1 + 0.35 * lift);
  drawRobot(ctx, P.st.parts, {
    time: w.time, walk: P.walk, hit: P.hit, xray, noShadow: lift > 0,
    armL: { recoil: P.arms.L.recoil, flash: P.arms.L.flash },
    armR: { recoil: P.arms.R.recoil, flash: P.arms.R.flash },
  });
  ctx.restore();
}

// 脈動中の地面：全体を赤く染め、亀裂が呼吸に合わせて光る
function drawSurgeGround(ctx, w, k, b, x0, y0, x1, y1, inView) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgba(${(225 - 25 * b) | 0},${(80 - 40 * b) | 0},${(70 - 35 * b) | 0},${k * (0.35 + 0.25 * b)})`;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(90,0,0,${k * 0.12 * b})`;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pass = (width, color) => {
    ctx.strokeStyle = color;
    for (const v of w.veins) {
      if (!inView(v.x, v.y, v.r)) continue;
      ctx.lineWidth = width * v.w;
      ctx.beginPath();
      for (const pts of v.lines) {
        pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      }
      ctx.stroke();
    }
  };
  pass(0.45 + 0.45 * b, `rgba(200,20,0,${k * (0.08 + 0.22 * b)})`);                        // にじむ光
  pass(0.07 + 0.08 * b, `rgba(255,${(90 + 110 * b) | 0},50,${k * (0.3 + 0.55 * b)})`);   // 亀裂の芯
  ctx.restore();
}

// 活性化したエネミーの足元の赤い揺らめき
function drawSurgeAura(ctx, e, k, b) {
  const r = e.r * (1.5 + 0.35 * b);
  const g = ctx.createRadialGradient(e.x, e.y, e.r * 0.3, e.x, e.y, r);
  g.addColorStop(0, `rgba(255,40,20,${k * (0.35 + 0.25 * b)})`);
  g.addColorStop(1, 'rgba(255,40,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fill();
}

// レア個体（輝晶個体）の輝き。front=false で足元の光輪、true で体の上に舞う光の粒
function drawRareAura(ctx, e, time, front) {
  const t = time + e.anim;
  ctx.save();
  ctx.translate(e.x, e.y);
  if (!front) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    const g = ctx.createRadialGradient(0, 0, e.r * 0.4, 0, 0, e.r * 2.2);
    g.addColorStop(0, `rgba(255,220,90,${0.45 + 0.2 * pulse})`);
    g.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.fillStyle = g;
    circle(ctx, 0, 0, e.r * 2.2); ctx.fill();
    ctx.strokeStyle = `rgba(255,230,120,${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 0.12;
    ctx.setLineDash([0.5, 0.35]);
    ctx.rotate(t * 1.2);
    circle(ctx, 0, 0, e.r * 1.45); ctx.stroke();
  } else {
    // 体を金色に染める
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,190,40,${0.22 + 0.1 * Math.sin(t * 6)})`;
    circle(ctx, 0, 0, e.r * 0.95); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 5; i++) {
      const a = t * 1.7 + i * 1.2566, rr = e.r * (1 + 0.35 * Math.sin(t * 2.3 + i));
      const tw = 0.5 + 0.5 * Math.sin(t * 7 + i * 2);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr, s = 0.12 + 0.12 * tw;
      ctx.fillStyle = `rgba(255,250,210,${0.5 + 0.5 * tw})`;
      ctx.beginPath();
      ctx.moveTo(x, y - s * 2); ctx.lineTo(x + s * 0.5, y); ctx.lineTo(x, y + s * 2); ctx.lineTo(x - s * 0.5, y);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - s * 2, y); ctx.lineTo(x, y + s * 0.5); ctx.lineTo(x + s * 2, y); ctx.lineTo(x, y - s * 0.5);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// 落ちているパーツ（等級の色に光る容器と、遠くからでも見える光の柱）
function drawLoot(ctx, o, time) {
  const col = bonusTier(o.part.bonus).color;
  const glint = 0.5 + 0.5 * Math.sin(time * 4 + o.rot * 3);
  ctx.save();
  ctx.translate(o.x, o.y);
  const g = ctx.createRadialGradient(0, 0, 0.2, 0, 0, 2.4);
  g.addColorStop(0, col + 'aa');
  g.addColorStop(1, col + '00');
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.55 + 0.35 * glint;
  circle(ctx, 0, 0, 2.4); ctx.fill();
  // 光の柱（見下ろしなので上方向へ伸びる帯で表現）
  const bg = ctx.createLinearGradient(0, 0, 0, -6);
  bg.addColorStop(0, col + 'cc');
  bg.addColorStop(1, col + '00');
  ctx.fillStyle = bg;
  ctx.fillRect(-0.25, -6, 0.5, 6);
  ctx.globalAlpha = 1;
  ctx.rotate(o.rot + o.t * (o.pull > 0 ? 8 : 0.6));
  ctx.fillStyle = '#3a3a40';
  ctx.strokeStyle = col;
  ctx.lineWidth = 0.1;
  rr(ctx, -0.55, -0.4, 1.1, 0.8, 0.14);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = col;
  ctx.fillRect(-0.4, -0.08, 0.8, 0.16);
  ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.5 * glint})`;
  circle(ctx, 0.25, -0.18, 0.08); ctx.fill();
  ctx.restore();
}

// 落ちている鉱石（種類ごとに形を変える。きらめきで地面と見分けやすくする）
function drawOre(ctx, o, time) {
  const col = ORES.find(k => k.id === o.kind).color;
  const glint = 0.5 + 0.5 * Math.sin(time * 5 + o.rot * 3);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.fillStyle = `rgba(255,240,200,${0.15 + 0.2 * glint})`;
  circle(ctx, 0, 0, 0.55); ctx.fill();
  ctx.rotate(o.rot + o.t * (o.pull > 0 ? 8 : 0));
  ctx.fillStyle = col;
  ctx.strokeStyle = 'rgba(20,15,10,0.85)';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  if (o.kind === 'crystal') {          // 細長い結晶
    ctx.moveTo(0.42, 0); ctx.lineTo(0.05, -0.17); ctx.lineTo(-0.3, 0); ctx.lineTo(0.05, 0.17);
  } else if (o.kind === 'core') {      // 丸い鉱核
    ctx.arc(0, 0, 0.24, 0, Math.PI * 2);
  } else {                             // ごつごつした鉱塊
    ctx.moveTo(0.28, -0.05); ctx.lineTo(0.12, -0.24); ctx.lineTo(-0.2, -0.2);
    ctx.lineTo(-0.3, 0.06); ctx.lineTo(-0.08, 0.24); ctx.lineTo(0.22, 0.17);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.5 * glint})`;
  circle(ctx, -0.05, -0.06, 0.06); ctx.fill();
  ctx.restore();
}

function drawDecor(ctx, d) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rot);
  switch (d.type) {
    case 'pebble':
      ctx.fillStyle = 'rgba(95,75,55,0.7)';
      circle(ctx, 0, 0, 0.22 * d.s); ctx.fill();
      ctx.fillStyle = 'rgba(190,165,130,0.5)';
      circle(ctx, -0.06 * d.s, -0.06 * d.s, 0.1 * d.s); ctx.fill();
      break;
    case 'bush':
      ctx.strokeStyle = 'rgba(95,80,40,0.85)';
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 0.7 * d.s, Math.sin(a) * 0.7 * d.s);
      }
      ctx.stroke();
      break;
    case 'crack':
      ctx.strokeStyle = 'rgba(70,48,28,0.5)';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(-1.5 * d.s, 0);
      ctx.lineTo(-0.6 * d.s, 0.3 * d.s);
      ctx.lineTo(0.2 * d.s, -0.2 * d.s);
      ctx.lineTo(1.4 * d.s, 0.25 * d.s);
      ctx.moveTo(0.2 * d.s, -0.2 * d.s);
      ctx.lineTo(0.5 * d.s, -0.9 * d.s);
      ctx.stroke();
      break;
    case 'crystal':   // 洞窟：青く光る結晶の群れ
      ctx.fillStyle = 'rgba(90,170,255,0.18)';
      circle(ctx, 0, 0, 0.9 * d.s); ctx.fill();
      ctx.fillStyle = 'rgba(140,210,255,0.85)';
      for (const [a, l] of [[0, 0.7], [2.1, 0.5], [4.0, 0.6]]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a + 0.25) * 0.12 * d.s, Math.sin(a + 0.25) * 0.12 * d.s);
        ctx.lineTo(Math.cos(a) * l * d.s, Math.sin(a) * l * d.s);
        ctx.lineTo(Math.cos(a - 0.25) * 0.12 * d.s, Math.sin(a - 0.25) * 0.12 * d.s);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 'stalag':    // 洞窟：小さな石筍
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      circle(ctx, 0.12 * d.s, 0.15 * d.s, 0.42 * d.s); ctx.fill();
      ctx.fillStyle = '#56525e';
      circle(ctx, 0, 0, 0.38 * d.s); ctx.fill();
      ctx.fillStyle = '#8a8496';
      circle(ctx, -0.08 * d.s, -0.08 * d.s, 0.16 * d.s); ctx.fill();
      break;
    case 'bone':
      ctx.strokeStyle = 'rgba(225,215,190,0.75)';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(-0.5 * d.s, 0); ctx.lineTo(0.5 * d.s, 0);
      ctx.moveTo(-0.2 * d.s, -0.3 * d.s); ctx.lineTo(-0.2 * d.s, 0.3 * d.s);
      ctx.moveTo(0.1 * d.s, -0.28 * d.s); ctx.lineTo(0.1 * d.s, 0.28 * d.s);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawRock(ctx, k) {
  ctx.save();
  ctx.translate(k.x, k.y);
  const path = (s, ox, oy) => {
    ctx.beginPath();
    k.pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x * s + ox, y * s + oy); else ctx.lineTo(x * s + ox, y * s + oy); });
    ctx.closePath();
  };
  const pal = k.cave ? ['#45414c', '#5b5664', '#75707f'] : ['#6b5440', '#86694f', '#9c7d5e'];   // 洞窟は石筍の色
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  path(1, 0.7, 0.9); ctx.fill();
  ctx.fillStyle = pal[0];
  path(1, 0, 0); ctx.fill();
  ctx.fillStyle = pal[1];
  path(0.72, -0.25, -0.3); ctx.fill();
  ctx.fillStyle = pal[2];
  path(0.38, -0.45, -0.5); ctx.fill();
  ctx.restore();
}

// エネミーの見た目は enemy-art.js の ENEMY_ART に定義する
const PLACEHOLDER_ENEMY_ART = {
  hpBar: true, gibColor: '#999', scorchColor: 'rgba(60,40,25,0.35)', mapColor: '#ff4adf', mapSize: 3,
  draw(ctx, e) { circle(ctx, 0, 0, e.r); placeholderPaint(ctx); enemyFlash(ctx, e, 0.65); },
};
const PLACEHOLDER_SHOT_ART = {
  hitColor: '#ff4adf',
  draw(ctx, s) { circle(ctx, 0, 0, s.r); placeholderPaint(ctx); },
};

function enemyArtOf(type) {
  const a = ENEMY_ART[type];
  if (a) return a;
  if (!warnedArt.has('enemy:' + type)) {
    warnedArt.add('enemy:' + type);
    console.warn(`エネミーデザイン未登録：ENEMY_ART.${type}（仮の図形で表示します）`);
  }
  return PLACEHOLDER_ENEMY_ART;
}

function enemyShotArtOf(kind) {
  const a = ENEMY_SHOT_ART[kind];
  if (a) return a;
  if (!warnedArt.has('eshot:' + kind)) {
    warnedArt.add('eshot:' + kind);
    console.warn(`エネミー弾デザイン未登録：ENEMY_SHOT_ART.${kind}（仮の図形で表示します）`);
  }
  return PLACEHOLDER_SHOT_ART;
}

// bar = false なら HP バーを描かない（呼び出し側が画面に対して水平に描く）
function drawEnemy(ctx, e, bar = true) {
  const art = enemyArtOf(e.type);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.save();
  if (art.rotate !== false) {
    ctx.rotate(e.a);
    ctx.translate(e.lunge * 0.3, 0);
  }
  art.draw(ctx, e);
  ctx.restore();
  if (bar && art.hpBar && e.hp < e.maxHp) {
    const bw = e.r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-bw / 2, -e.r - 0.7, bw, 0.25);
    ctx.fillStyle = '#ff6a4a';
    ctx.fillRect(-bw / 2, -e.r - 0.7, bw * Math.max(0, e.hp / e.maxHp), 0.25);
  }
  ctx.restore();
}

function drawEnemyShot(ctx, s) {
  ctx.save();
  ctx.translate(s.x, s.y);
  enemyShotArtOf(s.kind).draw(ctx, s);
  ctx.restore();
}

function drawPShot(ctx, s) {
  switch (s.kind) {
    case 'gun':
      ctx.strokeStyle = '#ffe680';
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.moveTo(s.x - s.vx * 0.025, s.y - s.vy * 0.025);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      break;
    case 'shell':
      ctx.fillStyle = 'rgba(255,170,60,0.5)';
      circle(ctx, s.x, s.y, 0.55); ctx.fill();
      ctx.fillStyle = '#3a3630';
      circle(ctx, s.x, s.y, 0.3); ctx.fill();
      break;
    case 'missile':
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.ang);
      ctx.fillStyle = 'rgba(255,180,80,0.9)';
      circle(ctx, -0.4, 0, 0.18); ctx.fill();
      ctx.fillStyle = '#e8e4da';
      ctx.fillRect(-0.35, -0.1, 0.7, 0.2);
      ctx.fillStyle = '#c94a3a';
      ctx.fillRect(0.25, -0.1, 0.12, 0.2);
      ctx.restore();
      break;
    case 'flame': {
      const k = s.life / s.max;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = k > 0.6 ? `rgba(255,220,120,${0.5 * k})` : `rgba(230,90,30,${0.55 * k + 0.1})`;
      circle(ctx, s.x, s.y, s.r); ctx.fill();
      ctx.restore();
      break;
    }
  }
}

function drawFx(ctx, f) {
  const k = f.life / f.max;
  switch (f.type) {
    case 'dust':
      ctx.fillStyle = `rgba(200,170,125,${0.35 * k})`;
      circle(ctx, f.x, f.y, f.size * (1.6 - k * 0.6)); ctx.fill();
      break;
    case 'smoke':
      ctx.fillStyle = `rgba(150,145,135,${0.45 * k})`;
      circle(ctx, f.x, f.y, f.size * (2 - k)); ctx.fill();
      break;
    case 'spark':
      ctx.fillStyle = `rgba(255,220,130,${k})`;
      circle(ctx, f.x, f.y, f.size); ctx.fill();
      break;
    case 'gib':
      ctx.fillStyle = f.color;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
      ctx.globalAlpha = 1;
      break;
    case 'boom': {
      const r = f.size * (1.1 - k * 0.6);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(255,250,210,${k})`);
      g.addColorStop(0.4, `rgba(255,160,50,${0.8 * k})`);
      g.addColorStop(1, 'rgba(120,40,10,0)');
      ctx.fillStyle = g;
      circle(ctx, f.x, f.y, r); ctx.fill();
      break;
    }
    case 'ring':
      ctx.strokeStyle = `rgba(255,230,180,${0.7 * k})`;
      ctx.lineWidth = 0.3;
      circle(ctx, f.x, f.y, f.size * (1 - k * 0.85)); ctx.stroke();
      break;
    case 'slash':
      ctx.strokeStyle = `rgba(255,150,60,${k})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.range * (0.8 + 0.2 * (1 - k)), f.a - f.arc / 2, f.a + f.arc / 2);
      ctx.stroke();
      break;
  }
}

// ---------------------------------------------------------------------
//  HUD
// ---------------------------------------------------------------------
function hudPanel(ctx, x, y, w, h, title) {
  ctx.fillStyle = 'rgba(12,18,15,0.78)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(120,200,150,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (title) {
    ctx.fillStyle = '#8fe0a8';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, x + 8, y + 6);
  }
}

function hudBar(ctx, x, y, w, h, k, col, bg = 'rgba(255,255,255,0.1)') {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w * clamp(k, 0, 1), h);
}

// レポートログ（左下）
function drawLogPanel(ctx, w, VW, VH) {
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  const lines = w.log.slice(-8).map(l => {
    const ts = Math.floor(l.t);
    return { l, text: `[${String(Math.floor(ts / 60)).padStart(2, '0')}:${String(ts % 60).padStart(2, '0')}] ${l.msg}` };
  });
  // 長い行（英語など）がはみ出さないよう、一番長い行に合わせて広げる（420px〜画面幅の45%）
  const widest = Math.max(0, ...lines.map(o => ctx.measureText(o.text).width));
  const lw = Math.round(clamp(widest + 18, 420, Math.max(420, VW * 0.45))), lh = 150, lx = 12, ly = VH - lh - Math.max(40, Battle.ctl.h + 16);   // 操作ボタンを出しているときはその上に
  hudPanel(ctx, lx, ly, lw, lh, 'REPORT');
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach(({ l, text }, i) => {
    const age = w.time - l.t;
    ctx.globalAlpha = age < 8 ? 1 : 0.55;
    ctx.fillStyle = l.color;
    ctx.fillText(text, lx + 8, ly + 24 + i * 15);
  });
  ctx.globalAlpha = 1;
}

// 機体ステータスの枠（左上 x0, y0 に幅 310）。ジャンプが使える脚なら1行増える → 増えた高さを返す
function drawMechPanel(ctx, P, x0, y0, title, manual) {
  const JP = P.st.jump, jh = JP ? 18 : 0;
  const x = x0 + 8;
  hudPanel(ctx, x0, y0, 310, 172 + jh, title);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#e8f0ea';
  ctx.fillText(`HP ${Math.ceil(P.hp)} / ${P.maxHp}`, x, y0 + 18);
  hudBar(ctx, x, y0 + 34, 294, 10, P.hp / P.maxHp, P.hp / P.maxHp > 0.3 ? '#5dde7a' : '#ff5a4a');
  const r = P.st.ratio;
  ctx.fillStyle = '#e8f0ea';
  ctx.fillText(T('B034' /* 出力配分 腕 {arm}% / 脚 {leg}% 総出力 {… */, { arm: Math.round(r * 100), leg: Math.round((1 - r) * 100), power: Math.round(P.st.power) }), x, y0 + 50);
  ctx.fillStyle = '#e0604a';
  ctx.fillRect(x, y0 + 66, 294 * r, 8);
  ctx.fillStyle = '#4a9ae0';
  ctx.fillRect(x + 294 * r, y0 + 66, 294 * (1 - r), 8);
  let y = y0 + 82;
  for (const arm of [P.arms.L, P.arms.R]) {
    ctx.fillStyle = '#e8f0ea';
    const nm = arm.side === 'L' ? T('B072' /* 左腕：{name} */, { name: partLabel(arm.def) }) : T('B073' /* 右腕：{name} */, { name: partLabel(arm.def) });
    ctx.fillText(nm, x, y);
    if (arm.def.type === 'none') { /* なし */ }
    else if (arm.reloading > 0) {
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(T('B035' /* リロード中 */), x + 220, y);
      hudBar(ctx, x, y + 16, 294, 5, 1 - arm.reloading / arm.perf.reload, '#ffd24a');
    } else if (arm.def.mag > 0) {
      ctx.fillStyle = '#cde';
      ctx.fillText(`${arm.ammo} / ${arm.def.mag}`, x + 230, y);
      hudBar(ctx, x, y + 16, 294, 5, arm.ammo / arm.def.mag, '#9cd6d6');
    } else {
      ctx.fillStyle = '#cde';
      ctx.fillText('∞', x + 250, y);
    }
    y += 28;
  }
  ctx.fillStyle = '#9fb5a5';
  ctx.fillText(T('B074' /* 速度 {speed} m/s 制御：{mode} */, {
    speed: Math.hypot(P.vx, P.vy).toFixed(1), mode: manual ? T('B075' /* 手動操作 */) : T('B076' /* 回路プログラム */),
  }), x, y);
  if (JP) {
    y += 18;
    const air = P.air > 0;
    ctx.fillStyle = air ? '#8fe0ff' : P.jumpCd > 0 ? '#9fb5a5' : '#9fe0b0';
    ctx.fillText(air ? T('B036' /* ジャンプ：跳躍中（無敵） */)
      : P.jumpCd > 0 ? T('B037' /* ジャンプ：再使用まで {cd}s */, { cd: P.jumpCd.toFixed(1) })
      : T('B038' /* ジャンプ：準備完了{manual} */, { manual: manual ? ' [Shift]' : '' }), x, y);
    hudBar(ctx, x + 180, y + 4, 114, 5, air ? 1 : 1 - P.jumpCd / JP.cd, '#8fe0ff');
  }
  return jh;
}

// ミニマップ（右上 right, top）。max は幅の上限。描いた位置と大きさを返す
function drawMinimap(ctx, w, right, top, max) {
  const P = w.player;
  const { mx, my, k } = w.geo.minimap(ctx, w, right, top, max);
  ctx.fillStyle = 'rgba(120,90,60,0.6)';
  for (const rk of w.rocks) { circle(ctx, mx + rk.x * k, my + rk.y * k, Math.max(1.5, rk.r * k)); ctx.fill(); }
  for (const o of w.ores) {
    ctx.fillStyle = ORES.find(k => k.id === o.kind).color;
    ctx.fillRect(mx + o.x * k - 0.75, my + o.y * k - 0.75, 1.5, 1.5);
  }
  for (const e of w.enemies) {
    const art = enemyArtOf(e.type);
    ctx.fillStyle = art.mapColor;
    const s = art.mapSize;
    ctx.fillRect(mx + e.x * k - s / 2, my + e.y * k - s / 2, s, s);
  }
  // レア個体と落ちているブースターは点滅する金色の印
  const blink = 0.5 + 0.5 * Math.sin(w.time * 6);
  ctx.strokeStyle = `rgba(255,216,74,${0.5 + 0.5 * blink})`;
  ctx.lineWidth = 1.5;
  for (const e of w.enemies) if (e.rare) { circle(ctx, mx + e.x * k, my + e.y * k, 4); ctx.stroke(); }
  for (const o of w.loot) {
    ctx.fillStyle = bonusTier(o.part.bonus).color;
    ctx.fillRect(mx + o.x * k - 2, my + o.y * k - 2, 4, 4);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(140,255,190,0.35)';
  circle(ctx, mx + P.x * k, my + P.y * k, P.st.sensor * k); ctx.stroke();
  // 背後からの視点（3D 表示・2D の背後の向き）：カメラの向いている方へ扇形の印
  const yaw = Battle.viewYaw();
  if (yaw != null) {
    const px = mx + P.x * k, py = my + P.y * k;
    ctx.fillStyle = 'rgba(125,255,154,0.28)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 16, yaw - 0.5, yaw + 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#7dff9a';
  circle(ctx, mx + P.x * k, my + P.y * k, 3); ctx.fill();
  return { mx, my, k, w: right - mx, h: w.H * k };
}

function drawHUD(ctx, w, B, VW, VH) {
  if (B.compact) { drawHUDCompact(ctx, w, B, VW, VH); return; }
  const P = w.player;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // --- 機体ステータス ---
  const jh = drawMechPanel(ctx, P, 12, 12, T('B033' /* 機体ステータス [頭部A/B テレメトリ] */), B.manual);

  // --- 回収鉱石 ---
  hudPanel(ctx, 12, 190 + jh, 310, 44, w.ores.length ? T('B078' /* 回収鉱石 （フィールドに {n}個） */, { n: w.ores.length }) : T('B077' /* 回収鉱石 */));
  if (w.parts.length || w.loot.length) {   // レアエネミーのブースター（右上に個数）
    ctx.textAlign = 'right';
    ctx.font = w.partPulse > 0 ? 'bold 13px sans-serif' : 'bold 12px sans-serif';
    ctx.fillStyle = w.partPulse > 0 ? '#fff' : '#ffd84a';
    ctx.fillText(w.loot.length ? T('B080' /* ブースター {n}（+{loot}） */, { n: w.parts.length, loot: w.loot.length })
      : T('B079' /* ブースター {n} */, { n: w.parts.length }), 314, 196 + jh);
    ctx.textAlign = 'left';
  }
  ORES.forEach((k, i) => {
    const ox = 22 + i * 100, oy = 216 + jh;
    const pulse = w.orePulse[k.id] || 0;
    ctx.fillStyle = k.color;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(Math.PI / 4);
    const sz = 4 + pulse * 8;
    ctx.fillRect(-sz, -sz, sz * 2, sz * 2);
    ctx.restore();
    ctx.font = pulse > 0 ? 'bold 13px sans-serif' : '12px sans-serif';
    ctx.fillStyle = pulse > 0 ? '#fff' : '#e8f0ea';
    ctx.fillText(`${k.short} ${w.ore[k.id]}`, ox + 10, oy - 7);
  });
  ctx.font = '12px sans-serif';

  // --- 敵数 / ボス ---
  ctx.textAlign = 'center';
  const remain = w.enemies.filter(e => !e.def.boss).length + w.queue.length;
  const bossPhase = w.phase === 'warn' || w.phase === 'boss';
  const DS = w.field.districts, D = DS[w.district];
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#f0c890';
  if (!bossPhase) ctx.fillText(`${floorName(w.floor)}  ${districtLabel(D)}  ${w.district + 1} / ${DS.length}`, VW / 2, 12);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#f2e6c8';
  if (w.phase === 'fight') ctx.fillText(T('B039' /* 残敵 {remain} / {perDistrict} */, { remain, perDistrict: w.segTotal }), VW / 2, 32);
  else if ((w.phase === 'confirm' || w.phase === 'done') && !w.timeUp) ctx.fillText(T('B040' /* 掃討完了 */), VW / 2, 32);
  else if (remain > 0) ctx.fillText(T('B041' /* 眷属 {remain} */, { remain }), VW / 2, 60);
  // 活動限界までの残り時間（残り10秒で赤く点滅）
  const actLeft = ACT_LIMIT - w.act;
  const urgent = actLeft <= 10 && !w.result && w.phase !== 'confirm';
  ctx.font = urgent ? 'bold 14px sans-serif' : 'bold 12px sans-serif';
  ctx.fillStyle = urgent ? `rgb(255,${(90 + 60 * (0.5 + 0.5 * Math.sin(w.time * 10))) | 0},60)` : '#cbbd9c';
  ctx.fillText(T('B090' /* 活動限界まで {total} */, { total: fmtClock(actLeft) }), VW / 2, bossPhase ? 80 : 56);
  if (w.banner && !w.result) {
    const a = Math.min(1, w.banner.t, (3 - w.banner.t) * 3);
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, VH * 0.28 - 40, VW, 80);
    ctx.font = 'bold 34px sans-serif';
    ctx.fillStyle = '#f0c890';
    ctx.fillText(w.banner.title, VW / 2, VH * 0.28 - 30);
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#ffd24a';
    if (w.banner.sub) ctx.fillText(w.banner.sub, VW / 2, VH * 0.28 + 12);
    ctx.globalAlpha = 1;
  }

  if (w.boss && w.boss.hp > 0) {
    const bw = Math.max(220, Math.min(560, VW - 720));
    const bx = VW / 2 - bw / 2;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ffb090';
    const bd = w.boss.def;
    ctx.fillText(bd.name + (w.boss.phase2 ? T('B043' /* （{phase2Name}） */, { phase2Name: bd.phase2Name }) : ''), VW / 2, 14);
    hudBar(ctx, bx, 34, bw, 14, w.boss.hp / w.boss.maxHp, bd.barColors[w.boss.phase2 ? 1 : 0], 'rgba(0,0,0,0.5)');
    ctx.strokeStyle = '#ffb090';
    ctx.strokeRect(bx + 0.5, 34.5, bw - 1, 13);
  }
  if (w.phase === 'warn' && !w.result) {
    const a = 0.5 + 0.5 * Math.sin(w.time * 12);
    ctx.fillStyle = `rgba(160,20,10,${0.35 * a})`;
    ctx.fillRect(0, VH / 2 - 50, VW, 100);
    ctx.font = 'bold 54px sans-serif';
    ctx.fillStyle = `rgba(255,80,50,${0.6 + 0.4 * a})`;
    ctx.textBaseline = 'middle';
    ctx.fillText('WARNING', VW / 2, VH / 2 - 8);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(T('B044' /* 巨大生体反応 接近中 */), VW / 2, VH / 2 + 30);
    ctx.textBaseline = 'top';
  }

  // --- ミニマップ ---
  drawMinimap(ctx, w, VW - 12, 12);

  // --- 回路モニター ---
  const grid = P.st.grid;
  const cs = Math.floor(200 / grid);
  const cw = cs * grid;
  const cx = VW - cw - 16, cy = VH - cw - 40;
  hudPanel(ctx, cx - 8, cy - 26, cw + 16, cw + 34, T('B045' /* 回路モニター {grid}×{grid} @{clock}H… */, { grid, clock: fmtNum(P.st.clock) }));
  drawCircuit(ctx, w.program, grid, cx, cy, cs, { pc: B.manual ? null : { x: P.vm.x, y: P.vm.y } });
  if (B.manual) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(cx, cy, cw, cw);
    ctx.fillStyle = '#ffd24a';
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(T('B046' /* 手動操作中 */), cx + cw / 2, cy + cw / 2 - 8);
    ctx.textAlign = 'left';
  }

  // --- レポートログ ---
  drawLogPanel(ctx, w, VW, VH);

  // --- 操作説明（タッチ操作の端末では画面下のボタンで操作するので出さない） ---
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(240,230,210,0.8)';
  ctx.textAlign = 'center';
  if (!B.touchUI) ctx.fillText(T('B047' /* [Space]一時停止 [1/2/3]速度 [M]手動/回路… */), VW / 2, VH - 22);
  if (B.manual) ctx.fillText(P.st.jump ? T('B082' /* 手動操作：WASD 移動 / マウス 照準 / 左クリック … */) : T('B081' /* 手動操作：WASD 移動 / マウス 照準 / 左クリック … */), VW / 2, VH - 40);
  if (B.speed !== 1) {
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(`×${B.speed}`, VW / 2, 100);
  }
  if (B.paused) {   // 「PAUSE」の文字は一時停止メニュー（#pause-menu）に出す
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, VW, VH);
  }
  if (w.result) {
    const txt = { win: 'MISSION COMPLETE', lose: 'MACHINE DOWN', retreat: 'RETREAT', return: 'RETURN TO BASE', timeout: 'ACTIVITY LIMIT' }[w.result];
    const col = { win: '#9fffb0', lose: '#ff6a4a', retreat: '#ffd24a', return: '#9fe0ff', timeout: '#ffb070' }[w.result];
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, VH / 2 - 45, VW, 90);
    ctx.font = 'bold 46px sans-serif';
    ctx.fillStyle = col;
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, VW / 2, VH / 2);
    ctx.textBaseline = 'top';
  }
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------
//  狭い画面（スマートフォンなど）の HUD
//   ・左上：HP・出力配分・両腕・回収鉱石 / 右上：ミニマップと地区・残敵・活動限界
//   ・下：回路モニター（小）とレポートログ（短く）。操作は画面下の HTML のボタン（#battle-ctl）
//   ・操作説明・回路モニターの見出し・ログの時刻などは省く
// ---------------------------------------------------------------------
const HUD_PAD = 8;

// 幅 maxW に収まるよう末尾を「…」で切る
function clipText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// 幅 maxW に収まる大きさの太字にする（size が上限）
function fitFont(ctx, text, size, maxW) {
  ctx.font = `bold ${size}px sans-serif`;
  const tw = ctx.measureText(text).width;
  if (tw > maxW) ctx.font = `bold ${Math.max(10, Math.floor(size * maxW / tw))}px sans-serif`;
}

// 小さな機体ステータス（左上 x0, y0 に幅 wd）。extra は呼び出し側が下に書き足す行の高さ。
// 書き足す位置 y と枠の下端 bottom を返す
function drawMechMini(ctx, P, x0, y0, wd, title, extra = 0) {
  const JP = P.st.jump;
  const h = 6 + (title ? 15 : 0) + 22 + 9 + 32 + (JP ? 14 : 0) + extra;
  hudPanel(ctx, x0, y0, wd, h);
  const x = x0 + 6, iw = wd - 12;
  let y = y0 + 5;
  ctx.textBaseline = 'top';
  if (title) {
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8fe0a8';
    ctx.fillText(clipText(ctx, title, iw), x, y);
    y += 15;
  }
  const hk = P.hp / P.maxHp, r = P.st.ratio;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8f0ea';
  ctx.fillText(`HP ${Math.ceil(P.hp)} / ${P.maxHp}`, x, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#cbd8d0';
  ctx.fillText(T('B110' /* 腕{arm}% 脚{leg}% */, { arm: Math.round(r * 100), leg: Math.round((1 - r) * 100) }), x + iw, y);
  hudBar(ctx, x, y + 14, iw, 6, hk, hk > 0.3 ? '#5dde7a' : '#ff5a4a');
  y += 22;
  ctx.fillStyle = '#e0604a';
  ctx.fillRect(x, y, iw * r, 4);
  ctx.fillStyle = '#4a9ae0';
  ctx.fillRect(x + iw * r, y, iw * (1 - r), 4);
  y += 9;
  for (const arm of [P.arms.L, P.arms.R]) {
    let st = '', col = '#cde', k = -1, bar = '#9cd6d6';
    if (arm.def.type === 'none') { /* なし */ }
    else if (arm.reloading > 0) { st = T('B035' /* リロード中 */); col = '#ffd24a'; k = 1 - arm.reloading / arm.perf.reload; bar = '#ffd24a'; }
    else if (arm.def.mag > 0) { st = `${arm.ammo} / ${arm.def.mag}`; k = arm.ammo / arm.def.mag; }
    else st = '∞';
    ctx.textAlign = 'right';
    ctx.fillStyle = col;
    ctx.fillText(st, x + iw, y);
    const sw = st ? ctx.measureText(st).width + 8 : 0;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8f0ea';
    ctx.fillText(clipText(ctx, `${arm.side} ${partLabel(arm.def)}`, iw - sw), x, y);
    if (k >= 0) hudBar(ctx, x, y + 13, iw, 3, k, bar);
    y += 16;
  }
  if (JP) {
    const air = P.air > 0;
    ctx.fillStyle = air ? '#8fe0ff' : P.jumpCd > 0 ? '#9fb5a5' : '#9fe0b0';
    ctx.fillText(clipText(ctx, air ? T('B036' /* ジャンプ：跳躍中（無敵） */)
      : P.jumpCd > 0 ? T('B037' /* ジャンプ：再使用まで {cd}s */, { cd: P.jumpCd.toFixed(1) })
      : T('B038' /* ジャンプ：準備完了{manual} */, { manual: '' }), iw), x, y);
    y += 14;
  }
  return { y, bottom: y0 + h };
}

// 画面下：回路モニター（右下）とレポートログ（左、操作ボタンの上）
function drawCompactBottom(ctx, w, B, VW, VH, prog) {
  const P = w.player, pad = HUD_PAD, ctl = B.ctl;
  const grid = P.st.grid;
  const cs = Math.max(6, Math.floor(clamp(Math.min(VW, VH) * 0.3, 90, 150) / grid)), cw = cs * grid;
  // 操作ボタンの右に入りきれば最下段に、入らなければボタンの上に置く
  const beside = ctl.w + cw + pad * 4 + 8 <= VW;
  const ctlTop = VH - pad - ctl.h - (ctl.h ? pad : 0);
  const cx = VW - pad - 4 - cw, cy = (beside ? VH - pad : ctlTop) - 4 - cw;
  drawCircuit(ctx, prog, grid, cx, cy, cs, { pc: B.manual ? null : { x: P.vm.x, y: P.vm.y } });
  if (B.manual) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(cx, cy, cw, cw);
    ctx.fillStyle = '#ffd24a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, T('B046' /* 手動操作中 */), 12, cw - 4);
    ctx.fillText(T('B046' /* 手動操作中 */), cx + cw / 2, cy + cw / 2);
    ctx.textBaseline = 'top';
  }
  // ログ：低い画面では省く。時刻は付けない
  if (VH < 340) return;
  const n = VH > 700 ? 4 : 3, lh = 8 + n * 14;
  const lw = Math.min(420, (beside ? VW - pad * 2 : cx - 4 - pad * 2));
  if (lw < 140) return;
  const lx = pad, ly = ctlTop - lh;
  hudPanel(ctx, lx, ly, lw, lh);
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  w.log.slice(-n).forEach((l, i) => {
    ctx.globalAlpha = w.time - l.t < 8 ? 1 : 0.55;
    ctx.fillStyle = l.color;
    ctx.fillText(clipText(ctx, l.msg, lw - 12), lx + 6, ly + 5 + i * 14);
  });
  ctx.globalAlpha = 1;
}

// 画面の高さ cy に大きな文字（一時停止・結果など）。文字は画面幅に収める
function drawCompactCenter(ctx, VW, cy, text, col, size) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, text, size, VW - 24);
  ctx.fillStyle = col;
  ctx.fillText(text, VW / 2, cy);
  ctx.textBaseline = 'top';
}

function drawHUDCompact(ctx, w, B, VW, VH) {
  const P = w.player, pad = HUD_PAD;
  ctx.textBaseline = 'top';

  // --- 最上段：ボスの体力（中央に画面幅の半分ほど。狭い画面でも 180px は取る）。ボスがいる間は、ほかの表示をその下に置く ---
  const boss = w.boss && w.boss.hp > 0 ? w.boss : null;
  const top = pad + (boss ? 34 : 0);
  if (boss) {
    const bd = boss.def, bw = Math.round(Math.min(VW - pad * 2, Math.max(180, VW * 0.5))), bx = Math.round((VW - bw) / 2);
    const name = bd.name + (boss.phase2 ? T('B043' /* （{phase2Name}） */, { phase2Name: bd.phase2Name }) : '');
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#ffb090';
    ctx.fillText(clipText(ctx, name, bw), VW / 2, pad);
    hudBar(ctx, bx, pad + 16, bw, 10, boss.hp / boss.maxHp, bd.barColors[boss.phase2 ? 1 : 0], 'rgba(0,0,0,0.5)');
    ctx.strokeStyle = '#ffb090';
    ctx.strokeRect(bx + 0.5, pad + 16.5, bw - 1, 9);
  }

  // --- 右上：ミニマップ ---
  const mm = drawMinimap(ctx, w, VW - pad, top, Math.round(clamp(VW * 0.34, 100, 170)));

  // --- 左上：機体ステータスと回収鉱石 ---
  const lw = Math.min(230, VW - mm.w - pad * 3);
  const m = drawMechMini(ctx, P, pad, top, lw, null, 15);
  let ox = pad + 6;
  ORES.forEach(k => {
    const pulse = w.orePulse[k.id] || 0, oy = m.y + 6;
    ctx.save();
    ctx.translate(ox + 4, oy);
    ctx.rotate(Math.PI / 4);
    const sz = 3.5 + pulse * 6;
    ctx.fillStyle = k.color;
    ctx.fillRect(-sz, -sz, sz * 2, sz * 2);
    ctx.restore();
    ctx.font = pulse > 0 ? 'bold 12px sans-serif' : '11px sans-serif';
    ctx.fillStyle = pulse > 0 ? '#fff' : '#e8f0ea';
    ctx.textAlign = 'left';
    const t = String(w.ore[k.id]);
    ctx.fillText(t, ox + 11, oy - 6);
    ox += 11 + ctx.measureText(t).width + 12;
  });

  // --- 右：ミニマップの下に地区・残敵・活動限界 ---
  const remain = w.enemies.filter(e => !e.def.boss).length + w.queue.length;
  const bossPhase = w.phase === 'warn' || w.phase === 'boss';
  const DS = w.field.districts, D = DS[w.district];
  const rx = VW - pad, iw = VW - lw - pad * 3;
  let y = mm.my + mm.h + 6;
  ctx.textAlign = 'right';
  const line = (text, font, col, h) => {
    ctx.font = font;
    ctx.fillStyle = col;
    ctx.fillText(clipText(ctx, text, iw), rx, y);
    y += h;
  };
  if (!bossPhase) line(`${floorName(w.floor)} ${districtLabel(D)} ${w.district + 1}/${DS.length}`, '11px sans-serif', '#f0c890', 15);
  if (w.phase === 'fight') line(T('B039' /* 残敵 {remain} / {perDistrict} */, { remain, perDistrict: w.segTotal }), 'bold 14px sans-serif', '#f2e6c8', 18);
  else if ((w.phase === 'confirm' || w.phase === 'done') && !w.timeUp) line(T('B040' /* 掃討完了 */), 'bold 14px sans-serif', '#f2e6c8', 18);
  else if (remain > 0) line(T('B041' /* 眷属 {remain} */, { remain }), 'bold 14px sans-serif', '#f2e6c8', 18);
  const actLeft = ACT_LIMIT - w.act;
  const urgent = actLeft <= 10 && !w.result && w.phase !== 'confirm';
  line(T('B090' /* 活動限界まで {total} */, { total: fmtClock(actLeft) }), urgent ? 'bold 12px sans-serif' : '11px sans-serif',
    urgent ? `rgb(255,${(90 + 60 * (0.5 + 0.5 * Math.sin(w.time * 10))) | 0},60)` : '#cbbd9c', 15);
  if (w.parts.length || w.loot.length) {
    line(w.loot.length ? T('B080' /* ブースター {n}（+{loot}） */, { n: w.parts.length, loot: w.loot.length })
      : T('B079' /* ブースター {n} */, { n: w.parts.length }), w.partPulse > 0 ? 'bold 12px sans-serif' : 'bold 11px sans-serif',
    w.partPulse > 0 ? '#fff' : '#ffd84a', 15);
  }
  if (B.speed !== 1) line(`×${B.speed}`, 'bold 14px sans-serif', '#ffd24a', 18);

  // --- 下：回路モニターとログ ---
  drawCompactBottom(ctx, w, B, VW, VH, w.program);

  // --- 中央の表示 ---
  ctx.textAlign = 'center';
  if (w.banner && !w.result) {
    const a = Math.min(1, w.banner.t, (3 - w.banner.t) * 3), by = VH * 0.36;
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, by - 34, VW, 68);
    fitFont(ctx, w.banner.title, 26, VW - 24);
    ctx.fillStyle = '#f0c890';
    ctx.fillText(w.banner.title, VW / 2, by - 26);
    if (w.banner.sub) {
      fitFont(ctx, w.banner.sub, 13, VW - 24);
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(w.banner.sub, VW / 2, by + 8);
    }
    ctx.globalAlpha = 1;
  }
  if (w.phase === 'warn' && !w.result) {
    const a = 0.5 + 0.5 * Math.sin(w.time * 12), col = `rgba(255,80,50,${0.6 + 0.4 * a})`;
    ctx.fillStyle = `rgba(160,20,10,${0.35 * a})`;
    ctx.fillRect(0, VH / 2 - 44, VW, 88);
    drawCompactCenter(ctx, VW, VH / 2 - 8, 'WARNING', col, 48);
    fitFont(ctx, T('B044' /* 巨大生体反応 接近中 */), 14, VW - 24);
    ctx.textAlign = 'center';
    ctx.fillStyle = col;
    ctx.fillText(T('B044' /* 巨大生体反応 接近中 */), VW / 2, VH / 2 + 20);
  }
  if (B.paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, VW, VH);
    // 「PAUSE」の文字は一時停止メニュー（#pause-menu）に出す
  }
  if (w.result) {
    const txt = { win: 'MISSION COMPLETE', lose: 'MACHINE DOWN', retreat: 'RETREAT', return: 'RETURN TO BASE', timeout: 'ACTIVITY LIMIT' }[w.result];
    const col = { win: '#9fffb0', lose: '#ff6a4a', retreat: '#ffd24a', return: '#9fe0ff', timeout: '#ffb070' }[w.result];
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, VH / 2 - 36, VW, 72);
    drawCompactCenter(ctx, VW, VH / 2, txt, col, 38);
  }
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------
//  戦闘画面コントローラー
// ---------------------------------------------------------------------
const Battle = {
  running: false,

  // vs を渡すと対戦（versus.js）：{ opp: 対戦相手, flat: 強化・ブースター無効 }
  start(save, vs) {
    this.canvas = document.getElementById('battle');
    this.ctx = this.canvas.getContext('2d');
    this.save = save;
    this.world = vs ? createVersusWorld(save, vs.opp, vs.flat) : createWorld(save);
    this.speed = 1;
    this.paused = false;
    this.manual = false;
    this.jumpReq = false;   // 手動操作で Shift が押された（次のシミュレーションでジャンプ）
    this.xray = false;
    this.vsMode = !!vs;
    this.zoomK = 1;            // ホイール・ピンチで変えたズームの倍率（1m あたりのピクセル数 zoom は applyZoom で決める）
    this.cam = { x: this.world.player.x, y: this.world.player.y };
    this.yaw2d = null;   // 2D の背後の向きのカメラの向き（null = 機体の向きに合わせる）
    this.camLead = { x: 0, y: 0 };  // 自機の前方へずらすカメラのオフセット（m）
    this.atkHold = 0;               // 攻撃後もしばらく前方を広く見せる残り時間
    this.keys = {};
    this.mouse = { x: 0, y: 0, l: false, r: false, inside: false };
    this.acc = 0;
    this.last = performance.now();
    this.resize();
    this.bind();
    this.bindCtl();
    this.hideConfirm();
    document.getElementById('confirm-yes').onclick = () => this.answerConfirm(true);
    document.getElementById('confirm-no').onclick = () => this.answerConfirm(false);
    this.running = true;
    View3D.attach(this);   // 設定が 3D なら 3D で描く（view3d.js）
    Sound.playBgm(vs ? 'boss' : 'battle');
    requestAnimationFrame(this.loop);
  },

  stop() {
    this.running = false;
    this.syncPauseMenu();
    View3D.detach();
    Sound.duck(false);
    this.unbind();
    this.hideConfirm();
  },

  // 地区掃討後・活動時間の区切りの「次に進みますか？」ダイアログ
  showConfirm() {
    const w = this.world, P = w.player;
    const DS = w.field.districts;
    const last = w.district >= DS.length - 1;
    const D = DS[w.district];
    const hpPct = Math.round(P.hp / P.maxHp * 100);
    const ammo = ['L', 'R'].map(s => {
      const a = P.arms[s];
      if (a.def.type === 'none') return null;
      const st = a.def.mag ? (a.reloading > 0 ? T('B048' /* リロード中 */) : `${a.ammo}/${a.def.mag}`) : '∞';
      return s === 'L' ? T('B083' /* 左腕 {st} */, { st }) : T('B084' /* 右腕 {st} */, { st });
    }).filter(Boolean).join(' / ');
    let next;
    if (last) {
      next = T('B049' /* 次：ボス戦 — {boss}全地区（第1〜第{count}地… */, { boss: ENEMY_DEFS[w.field.boss].name, count: DS.length });
    } else {
      const N = DS[w.district + 1];
      next = T('B050' /* 次：{district} 敵 {perDistrict}体第… */, { district: districtLabel(N), perDistrict: w.perDistrict, n: w.district + 2 });
    }
    const carry = w.enemies.length + w.queue.length;
    document.getElementById('confirm-title').textContent = w.timeUp
      ? T('B092' /* {district} 活動時間の区切り */, { district: districtLabel(D) })
      : T('B051' /* {district} 掃討完了 */, { district: districtLabel(D) });
    document.getElementById('confirm-body').innerHTML = `
      <div class="hpline"><span>${T('B052' /* 機体HP {hp} / {max}（{hpPct}%） */, { hp: Math.ceil(P.hp), max: P.maxHp, hpPct })}</span><i><b style="width:${hpPct}%"></b></i></div>
      <p class="muted">${ammo}${T('B053' /* ※HP・弾薬は持ち越し（補給なし） */)}</p>
      <p class="ore-line">${T('B054' /* 回収鉱石： */)}${oreHTML(w.ore)}</p>
      ${w.parts.length ? `<p class="ore-line">${T('B055' /* 回収ブースター： */)}${w.parts.map(p => partTagHTML(p)).join(' ')}</p>` : ''}
      <p class="act-line">${T('B093' /* 活動限界まで 残り {total} */, { total: fmtClock(ACT_LIMIT - w.act) })}</p>
      ${w.timeUp && carry ? `<p class="carry">${T('B094' /* 残敵 {n}体を倒しきれていません。進むとそのまま残り、次の… */, { n: carry })}</p>` : ''}
      ${next}
      <p class="q">${last ? T('B056' /* ボス戦に進みますか？ */) : T('B057' /* 次に進みますか？ */)}</p>`;
    document.getElementById('confirm-yes').textContent = last ? T('B058' /* ボス戦へ（Enter） */) : T('B059' /* 次の地区へ（Enter） */);
    document.getElementById('confirm').classList.add('show');
    this.confirmOpen = true;
  },

  hideConfirm() {
    const el = document.getElementById('confirm');
    if (el) el.classList.remove('show');
    this.confirmOpen = false;
  },

  answerConfirm(yes) {
    if (!this.confirmOpen) return;
    this.hideConfirm();
    if (yes) advanceDistrict(this.world);
    else returnToBase(this.world);
    this.last = performance.now();
  },

  resize() {
    this.VW = window.innerWidth;
    this.VH = window.innerHeight;
    // 画面の細かさ（devicePixelRatio）には上限をつける。3倍の画面をそのまま描くと 9倍のピクセル数になり重い。
    // 狭い画面（スマートフォン）は 1.5、それ以外は 2 まで（違いはほとんど目に見えない）
    const dpr = Math.min(window.devicePixelRatio || 1, this.VW < 900 || this.VH < 560 ? 1.5 : 2);
    this.dpr = dpr;
    this.canvas.width = Math.floor(this.VW * dpr);
    this.canvas.height = Math.floor(this.VH * dpr);
    this.canvas.style.width = this.VW + 'px';
    this.canvas.style.height = this.VH + 'px';
    // 狭い画面（スマートフォンなど）は情報を絞った HUD にする。タッチ操作の端末か狭い画面なら操作ボタンを出す
    this.compact = this.VW < 900 || this.VH < 560;
    this.touchUI = window.matchMedia('(pointer: coarse)').matches;
    const bar = document.getElementById('battle-ctl');
    bar.classList.toggle('show', this.compact || this.touchUI);
    this.ctl = bar.classList.contains('show') ? { w: bar.offsetWidth, h: bar.offsetHeight } : { w: 0, h: 0 };
    this.applyZoom();
  },

  // 1m あたりのピクセル数。小さい画面ほど引いて広く見せる（1920×1080 前後で 24、対戦は闘技場を見渡せるよう 16）
  applyZoom() {
    const fit = clamp(Math.sqrt(this.VW * this.VH) / 1300, 0.42, 1);
    this.zoom = clamp((this.vsMode ? 16 : 24) * fit * this.zoomK, 4, 48);
    View3D.resize();
  },

  setZoomK(k) {
    this.zoomK = clamp(k, 0.4, 3);
    this.applyZoom();
  },

  // 画面下の操作ボタン（スマートフォンなどキーの無い端末用。キー操作と同じことをする）
  bindCtl() {
    const bar = document.getElementById('battle-ctl');
    bar.querySelector('[data-act=retreat]').textContent = this.vsMode ? T('B113' /* 降参 */) : T('B112' /* 撤退 */);
    bar.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        b.blur();   // 押したボタンにフォーカスが残ると、Space キーでもう一度押されてしまう
        const w = this.world;
        switch (b.dataset.act) {
          case 'pause': this.paused = !this.paused; Sound.play('pause', { on: this.paused }); break;
          case 'speed': this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1; Sound.play('ui'); break;
          case 'leg': if (!w.result) setPlayerRatio(w, w.player, w.player.st.ratio - 0.05); break;
          case 'arm': if (!w.result) setPlayerRatio(w, w.player, w.player.st.ratio + 0.05); break;
          case 'retreat': this.askRetreat(); break;
        }
        this.syncCtl();
      };
    });
    this.syncCtl();
    // 一時停止メニューの「再開」
    const resume = document.querySelector('#pause-menu .pm-resume');
    resume.onclick = () => {
      resume.blur();
      if (!this.paused) return;
      this.paused = false;
      Sound.play('pause', { on: false });
      this.syncCtl();
    };
  },

  // 一時停止・速度のボタンの表示を今の状態に合わせる
  syncCtl() {
    const bar = document.getElementById('battle-ctl');
    bar.querySelector('[data-act=pause]').textContent = this.paused ? '▶' : '❚❚';
    bar.querySelector('[data-act=speed]').textContent = `×${this.speed}`;
  },

  // 2D の向き：北が上 / 背後（一時停止メニューから。3D は常に背後からの視点）
  setTurn2d(v) {
    if (View3D.on || v === View3D.turn2d) return;
    Sound.play('ui');
    View3D.setTurn2d(v);
    this.yaw2d = v ? -Math.PI / 2 : null;   // 北が上から、機体の後ろへ回っていく
    addLog(this.world, v ? T('B123' /* 2D の向き：背後 */) : T('B122' /* 2D の向き：北が上 */), '#ffd24a');
  },

  // 一時停止メニュー：一時停止中だけ出す（地区掃討後の確認・撤退の確認・結果の表示の間は出さない）
  syncPauseMenu() {
    const show = this.running && this.paused && !this.confirmOpen && !this.world.result && !Ask.resolve;
    if (show !== this.pmShown) {
      this.pmShown = show;
      document.getElementById('pause-menu').classList.toggle('show', show);
    }
  },

  // 撤退（対戦では降参）。ボタンは押し間違えやすいので、止めてから確かめる
  async askRetreat() {
    const w = this.world;
    if (w.result || this.confirmOpen) return;
    const was = this.paused;
    this.paused = true;
    this.syncCtl();
    const ok = await Ask.open(w.vs ? T('B115' /* 降参しますか？ */) : T('B114' /* 撤退しますか？ フィールドに残っている鉱石とブースターは持ち… */));
    this.paused = was;
    this.syncCtl();
    this.last = performance.now();
    if (!ok || w.result || !this.running) return;
    if (w.vs) vsEnd(w, 'lose', 'surrender');
    else endBattle(w, 'retreat');
  },

  bind() {
    this.h = {
      key: (e) => this.onKey(e, true),
      keyup: (e) => this.onKey(e, false),
      move: (e) => { const r = this.canvas.getBoundingClientRect(); this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top; },
      down: (e) => { if (e.button === 0) this.mouse.l = true; if (e.button === 2) this.mouse.r = true; },
      up: (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; },
      wheel: (e) => { e.preventDefault(); this.setZoomK(this.zoomK * (e.deltaY > 0 ? 0.9 : 1.1)); },
      ctx: (e) => e.preventDefault(),
      resize: () => this.resize(),
      // 2本指のピンチでズーム
      touch: (e) => {
        if (e.touches.length !== 2) { this.pinch = null; return; }
        e.preventDefault();
        const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (e.type === 'touchstart' || !this.pinch) this.pinch = { d, k: this.zoomK };
        else if (this.pinch.d > 0) this.setZoomK(this.pinch.k * d / this.pinch.d);
      },
    };
    window.addEventListener('keydown', this.h.key);
    window.addEventListener('keyup', this.h.keyup);
    this.canvas.addEventListener('mousemove', this.h.move);
    this.canvas.addEventListener('mousedown', this.h.down);
    window.addEventListener('mouseup', this.h.up);
    this.canvas.addEventListener('wheel', this.h.wheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.h.ctx);
    window.addEventListener('resize', this.h.resize);
    for (const t of ['touchstart', 'touchmove', 'touchend']) this.canvas.addEventListener(t, this.h.touch, { passive: false });
  },

  unbind() {
    if (!this.h) return;
    window.removeEventListener('keydown', this.h.key);
    window.removeEventListener('keyup', this.h.keyup);
    this.canvas.removeEventListener('mousemove', this.h.move);
    this.canvas.removeEventListener('mousedown', this.h.down);
    window.removeEventListener('mouseup', this.h.up);
    this.canvas.removeEventListener('wheel', this.h.wheel);
    this.canvas.removeEventListener('contextmenu', this.h.ctx);
    window.removeEventListener('resize', this.h.resize);
    for (const t of ['touchstart', 'touchmove', 'touchend']) this.canvas.removeEventListener(t, this.h.touch);
    this.h = null;
  },

  onKey(e, down) {
    this.keys[e.code] = down;
    if (!down) return;
    const w = this.world;
    if (this.confirmOpen) {
      if (e.code === 'Enter' || e.code === 'KeyY') this.answerConfirm(true);
      // 基地に帰還は N（ボタンにも N と表示。全画面中の Esc はブラウザが全画面の解除に使うため。Esc も全画面でなければ使える）
      if (e.code === 'Escape' || e.code === 'KeyN') this.answerConfirm(false);
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'Space': this.paused = !this.paused; Sound.play('pause', { on: this.paused }); e.preventDefault(); break;
      case 'Digit1': this.speed = 1; Sound.play('ui'); break;
      case 'Digit2': this.speed = 2; Sound.play('ui'); break;
      case 'Digit3': this.speed = 4; Sound.play('ui'); break;
      case 'KeyM':
        Sound.play('ui');
        this.manual = !this.manual;
        addLog(w, this.manual ? T('B060' /* 制御切替：手動操作 */) : T('B061' /* 制御切替：回路プログラム */), '#ffd24a');
        break;
      case 'KeyQ': if (!w.result) setPlayerRatio(w, w.player, w.player.st.ratio - 0.05); break;
      case 'KeyE': if (!w.result) setPlayerRatio(w, w.player, w.player.st.ratio + 0.05); break;
      case 'KeyX': this.xray = !this.xray; break;
      case 'ShiftLeft': case 'ShiftRight': if (this.manual) this.jumpReq = true; break;
      // 撤退は BackSpace。全画面中の Esc はブラウザが全画面の解除に使ってゲームに届かないため（Esc も全画面でなければ使える）
      case 'Backspace': case 'Escape':
        if (!w.result) { if (w.vs) vsEnd(w, 'lose', 'surrender'); else endBattle(w, 'retreat'); }   // 対戦では降参
        e.preventDefault();
        break;
    }
    this.syncCtl();
  },

  // 2D の画面の回転（背後の向きでは、カメラの向きが画面の上になるよう回す）。北が上なら 0
  viewRot() {
    return !View3D.on && this.yaw2d != null ? -Math.PI / 2 - this.yaw2d : 0;
  },

  // カメラの向き（3D 表示・2D の背後の向き）。北が上の 2D なら null
  viewYaw() {
    return View3D.on ? View3D.yaw : this.yaw2d;
  },

  // 2D：ワールドの位置（m）→ 画面の位置（px）
  toScreen(x, y) {
    const r = this.viewRot(), c = Math.cos(r), s = Math.sin(r), z = this.zoom;
    const dx = (x - this.cam.x) * z, dy = (y - this.cam.y) * z;
    return { x: this.VW / 2 + dx * c - dy * s, y: this.VH / 2 + dx * s + dy * c };
  },

  // 2D：画面の位置（px）→ ワールドの位置（m）
  toWorld(mx, my) {
    const r = this.viewRot(), c = Math.cos(r), s = Math.sin(r), z = this.zoom;
    const dx = (mx - this.VW / 2) / z, dy = (my - this.VH / 2) / z;
    return { x: this.cam.x + dx * c + dy * s, y: this.cam.y - dx * s + dy * c };
  },

  input() {
    return {
      manual: this.manual,
      keys: this.keys,
      // 照準：マウスの下の地点（3D 表示では視線と地面の交点）
      aim: View3D.on ? View3D.screenToWorld(this.mouse.x, this.mouse.y) : this.toWorld(this.mouse.x, this.mouse.y),
      camYaw: this.viewYaw(),   // 背後からの視点では移動キーをカメラの向きに合わせる
      fireL: this.mouse.l,
      fireR: this.mouse.r,
      jump: this.jumpReq,
    };
  },

  loop: (now) => Battle.frame(now),

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = this.world;
    if (!this.paused && w.phase !== 'confirm') {
      this.acc += dt * this.speed;
      let n = 0;
      const inp = this.input();
      while (this.acc >= STEP && n < 12 && w.phase !== 'confirm') {
        if (w.vs) simulateVersus(w, STEP, inp);
        else simulate(w, STEP, inp);
        this.acc -= STEP;
        n++;
      }
      if (n > 0) this.jumpReq = false;   // Shift のジャンプ要求はシミュレーションに渡したら消す
      if (n >= 12 || w.phase === 'confirm') this.acc = 0;
    }
    if (w.phase === 'confirm' && !this.confirmOpen && !w.result) this.showConfirm();
    this.syncPauseMenu();
    const P = w.player;
    // 攻撃中は機体の向いている方向へカメラを先行させ、前方の視界を広げる
    const attacking = ['L', 'R'].some(s => {
      const a = P.arms[s];
      return a.def.type !== 'none' && (a.trigger > 0 || a.flash > 0);
    });
    if (attacking) this.atkHold = 1.2;
    else this.atkHold = Math.max(0, this.atkHold - dt);
    const z = this.zoom;
    let tx, ty;
    if (!View3D.on && View3D.turn2d) {
      // 2D の背後の向き：カメラは機体の向きに遅れて回り、機体を画面の下寄りに置いて前方を広く見せる
      this.yaw2d = chaseYaw(this.yaw2d, P, this.manual, dt);
      const lead = this.atkHold > 0 ? 0.42 : 0.3;   // 画面の高さの半分に対する前方オフセット比
      tx = Math.cos(this.yaw2d) * this.VH / 2 / z * lead;
      ty = Math.sin(this.yaw2d) * this.VH / 2 / z * lead;
    } else {
      this.yaw2d = null;
      const lead = this.atkHold > 0 ? 0.38 : 0.1;  // 画面半分に対する前方オフセット比
      tx = Math.cos(P.a) * this.VW / 2 / z * lead;
      ty = Math.sin(P.a) * this.VH / 2 / z * lead;
    }
    const fl = Math.min(1, dt * 2.5);
    this.camLead.x += (tx - this.camLead.x) * fl;
    this.camLead.y += (ty - this.camLead.y) * fl;
    const f = Math.min(1, dt * 5);
    // 対戦（回路で戦っているとき）は2機の中間を映す。手動操作中は照準しやすいよう自機を追う
    let cx = P.x + this.camLead.x, cy = P.y + this.camLead.y;
    if (w.vs && !this.manual) { cx = (P.x + w.rival.x) / 2; cy = (P.y + w.rival.y) / 2; }
    this.cam.x += (cx - this.cam.x) * f;
    this.cam.y += (cy - this.cam.y) * f;

    // 効果音の聞こえ方：画面の中心で聞き、左右はカメラから見た左右（背後からの視点ではカメラの向きで変わる）
    const lis = View3D.on ? { x: View3D.tx, y: View3D.ty } : this.cam, yaw = this.viewYaw();
    Sound.listen(lis.x, lis.y, this.VW / 2 / z, yaw == null ? 1 : -Math.sin(yaw), yaw == null ? 0 : Math.cos(yaw));
    Sound.duck(this.paused || this.confirmOpen);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (View3D.on) {
      // 3D 表示：世界は下の WebGL キャンバスに描き、このキャンバスには画面の色と HUD だけを重ねる
      ctx.clearRect(0, 0, this.VW, this.VH);
      View3D.render(w, this);
      const p = View3D.screenPos(P.x, P.y);
      drawScreenTint(ctx, w, this.VW, this.VH, p.x, p.y);
      View3D.drawOverlay(ctx, w);   // エネミーの HP バー
    } else {
      drawWorld(ctx, w, this, this.VW, this.VH);
    }
    if (w.vs) drawVersusHUD(ctx, w, this, this.VW, this.VH);
    else drawHUD(ctx, w, this, this.VW, this.VH);

    if (w.vs && w.result && w.endT > 3.2) {
      this.stop();
      Game.endVersus(w);
      return;
    }
    if (w.result && w.endT > 3.2) {
      this.stop();
      const res = finishOre(w);
      Game.addOre(res.gain);
      Game.addParts(res.parts);
      if (w.result === 'win') w.unlocked = Game.unlockFloor(w.field.id, w.floor);
      Report.show(w);
      return;
    }
    requestAnimationFrame(this.loop);
  },
};
