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
  Sound.play('ratio', { up: r > P.st.ratio });
  P.st = computeStats(P.build, r, P.upgrades);
  P.arms.L.perf = P.st.armL;
  P.arms.R.perf = P.st.armR;
  addLog(w, `出力配分：腕 ${Math.round(r * 100)}% / 脚 ${Math.round((1 - r) * 100)}%`, '#c9a0ff');
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

function startJump(w, P, ang) {
  if (w.result || !canJump(P)) return false;
  const J = P.st.jump, v = J.dist / J.dur;
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

function createWorld(save) {
  // field = 出撃するフィールド、geo = その形の処理（field.js）。FW × H = フィールド全体の大きさ
  const F = fieldById(save.field), geo = FIELD_SHAPES[F.shape];
  const { FW, H } = geo.size(F);
  const w = {
    field: F, geo, FW, H, district: 0, open: 1, full: false, perDistrict: save.enemyCount,
    time: 0, enemies: [], pshots: [], eshots: [], fx: [], scorch: [], rocks: [], decor: [],
    webs: [], hazards: [],   // 蜘蛛の巣（機体が減速する）/ 落下予告の出ている攻撃（boss-spider.js）
    phase: 'fight', phaseT: 0, boss: null, log: [], result: null, endT: 0, shake: 0, banner: null,
    program: save.program,
    ores: [], ore: emptyOre(), orePulse: {}, oreResult: null,   // 落ちている鉱石 / 回収した鉱石
    veins: [], surge: { state: 'idle', t: rand(35, 55), k: 0, ph: 0 },   // 大地の脈動（地面の亀裂 / 状態）
    stats: {
      kills: { scarab: 0, spitter: 0, troll: 0, boss: 0 }, dmgDealt: 0, dmgTaken: 0,
      shots: { L: 0, R: 0 }, hits: { L: 0, R: 0 }, dmgBy: { L: 0, R: 0 },
      distance: 0, total: save.enemyCount, bossAt: null, cleared: 0,
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
    const n = 7 + ((Math.random() * 4) | 0);
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2;
      const rr = r * rand(0.8, 1.12);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    w.rocks.push({ x, y, r, pts, cave: !!F.dark });
  }
  for (let i = 0; i < F.decorN; i++) {
    const { x, y } = geo.randomPoint(w, i % nd, 0.5);
    w.decor.push({ x, y, s: rand(0.5, 1.5), rot: rand(0, 6.283), type: pick(F.decor) });
  }
  makeVeins(w);
  addLog(w, `戦闘モード起動。${F.name}へ降下完了。`, '#9fe0b0');
  startDistrict(w);
  return w;
}

// 現在の地区の敵を配置（同時出現上限を超える分は増援キューへ）
function startDistrict(w) {
  const D = w.field.districts[w.district];
  const comp = enemyComposition(w.perDistrict, D);
  for (let i = comp.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [comp[i], comp[j]] = [comp[j], comp[i]];
  }
  w.queue = comp;
  w.reinT = 0;
  w.reinLogged = false;
  while (w.queue.length && w.enemies.length < MAX_ACTIVE_ENEMIES) spawnEnemy(w, w.queue.pop(), null);
  w.phase = 'fight';
  w.banner = { title: `${D.name}「${D.sub}」`, sub: `敵性生体反応 ${w.perDistrict}体`, t: 3 };
  Sound.play('radio');
  addLog(w, `${D.name}「${D.sub}」：敵性生体反応 ${w.perDistrict}体 を確認。`, '#ffd24a');
}

// 確認ダイアログで「進む」を選んだとき
function advanceDistrict(w) {
  const DS = w.field.districts;
  if (w.district < DS.length - 1) {
    w.district++;
    w.open = w.district + 1;
    w.stats.total += w.perDistrict;
    addLog(w, `封鎖線を解除。${DS[w.district].name}へ進攻する。`, '#9fe0b0');
    startDistrict(w);
  } else {
    w.open = DS.length;
    w.full = true;
    w.phase = 'warn';
    w.phaseT = 3;
    addLog(w, `全地区 掃討完了。${w.field.bossWarn}`, '#ffd24a');
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
  dur: [14, 20],               // 脈動が続く秒数
  gap: [45, 80],               // 鎮まってから次の脈動までの秒数
  breath: 2.4,                 // 呼吸1回の秒数
  speed: 0.45, rate: 0.6, dmg: 0.35, boss: 0.2,   // 最大時の強化量（移動速度 / 攻撃頻度 / 与ダメージ / ボスの行動速度）
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
      addLog(w, '警告：地中から鼓動のような振動を検知……', '#ff7a5a');
      Sound.play('quake');
    }
  } else if (S.state === 'rise') {
    S.k = Math.min(1, S.k + dt / SURGE.rise);
    if (!ok) S.state = 'fall';
    else if (S.k >= 1) {
      S.state = 'active';
      S.t = rand(SURGE.dur[0], SURGE.dur[1]);
      w.banner = { title: '大地脈動', sub: '赤く脈打つ大地に呼応し、敵性生体が活性化！（撃破時の鉱石 2倍）', t: 3 };
      addLog(w, '大地が脈動している。敵性生体の活性化を確認！', '#ff5a3a');
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
      if (!w.result) addLog(w, '大地の脈動が鎮まった。', '#9fe0b0');
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
  const e = {
    type, def, x, y, vx: 0, vy: 0, a: 0, r: def.r, hp: def.hp, maxHp: def.hp,
    cd: rand(0, def.cd), flash: 0, anim: rand(0, 10), strafeDir: Math.random() < 0.5 ? -1 : 1, lunge: 0,
    cx: x, cy: y, chkT: rand(1, 1.5), unstuck: 0,
  };
  w.enemies.push(e);
  return e;
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
  e.hp = e.maxHp = e.def.hp + 25 * w.perDistrict;
  bossSet(e, 'emerge', K.emergeT);
  e.invuln = true;
  e.phase2 = false;
  K.init(w, e);
  w.boss = e;
  w.stats.bossAt = w.time;
  w.shake = 1;
  addLog(w, `ボス出現：${e.def.name}`, '#ff6a4a');
  Sound.play('quake');
  Sound.play(K.cry);
  Sound.playBgm('boss');
}

// ---------------------------------------------------------------------
//  シミュレーション
// ---------------------------------------------------------------------
function simulate(w, dt, inp) {
  w.time += dt;
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
  if (w.phase === 'fight' && w.queue.length) {
    w.reinT -= dt;
    if (w.reinT <= 0 && w.enemies.length < MAX_ACTIVE_ENEMIES) {
      spawnEnemy(w, w.queue.pop(), null);
      w.reinT = 0.6;
      if (!w.reinLogged) { w.reinLogged = true; addLog(w, `増援接近：後続 ${w.queue.length + 1}体`, '#ffb070'); }
    }
  }
  if (w.phase === 'fight' && w.enemies.length === 0 && w.queue.length === 0) {
    // 地区掃討 → 確認ダイアログ待ち（Battle 側がダイアログを出す）
    const D = w.field.districts[w.district];
    w.stats.cleared = w.district + 1;
    w.phase = 'confirm';
    w.pshots = [];
    w.eshots = [];
    addLog(w, `${D.name}「${D.sub}」 掃討完了。`, '#9fe0b0');
    Sound.play('clear');
    collectAllOres(w);
  } else if (w.phase === 'warn') {
    w.phaseT -= dt;
    if (w.phaseT <= 0) { w.phase = 'boss'; spawnBoss(w); }
  }
}

function endBattle(w, result) {
  if (w.result) return;
  w.result = result;
  w.endT = 0;
  if (result === 'win') addLog(w, 'ボス撃破を確認。任務完了。', '#9fe0b0');
  if (result === 'lose') addLog(w, '機体大破。通信途絶……', '#ff6a4a');
  if (result === 'retreat') addLog(w, '撤退信号を受信。戦域を離脱する。', '#ffd24a');
  if (result === 'return') addLog(w, `${w.stats.cleared}地区を掃討。基地への帰還を開始する。`, '#9fe0b0');
  Sound.stopBgm(result === 'lose' ? 0.3 : 1);
  Sound.play({ win: 'win', lose: 'lose', retreat: 'retreat', return: 'retreat' }[result]);
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
          addLog(w, `${arm.side === 'L' ? '左' : '右'}腕 弾切れ → リロード ${arm.perf.reload.toFixed(1)}秒`, '#9cd6d6');
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
      w.shake = Math.max(w.shake, 0.25);
    }
    w.pshots.push(shot);
  }
}

function meleeSwing(w, P, arm, dmg) {
  const d = arm.def;
  let hit = false;
  for (const e of w.enemies) {
    if (e.invuln || e.hp <= 0) continue;
    const dx = e.x - P.x, dy = e.y - P.y;
    const len = Math.hypot(dx, dy) || 1;
    const dist = len - e.r;
    if (dist > d.range + 0.8) continue;
    if (Math.abs(angDiff(Math.atan2(dy, dx), P.a)) > d.arc / 2 && dist > 0.5) continue;
    damageEnemy(w, e, dmg, arm.side);
    hit = true;
    const kb = e.def.boss ? 0 : e.type === 'troll' ? 4 : 12;
    e.vx += dx / len * kb;
    e.vy += dy / len * kb;
    for (let i = 0; i < 4; i++) {
      w.fx.push({ type: 'spark', x: e.x - dx / len * e.r, y: e.y - dy / len * e.r, vx: rand(-8, 8), vy: rand(-8, 8), life: 0.25, max: 0.25, size: 0.15 });
    }
  }
  if (hit) { w.stats.hits[arm.side]++; Sound.play('meleeHit', { x: P.x, y: P.y }); }
  w.fx.push({ type: 'slash', x: P.x, y: P.y, a: P.a, range: d.range + 1.2, arc: d.arc, life: 0.18, max: 0.18 });
}

function damageEnemy(w, e, dmg, side) {
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
    if (remain > 0 && (remain <= 3 || killed % 10 === 0)) addLog(w, `撃破 ${killed} / 残敵 ${remain}体`);
  }
}

function addScorch(w, x, y, r, color) {
  w.scorch.push({ x, y, r, color, rot: rand(0, 6.28) });
  if (w.scorch.length > 160) w.scorch.shift();
}

function explode(w, x, y, rad, dmg, side, direct) {
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.invuln) continue;
    if (e === direct) { damageEnemy(w, e, dmg, side); continue; }
    const d = Math.hypot(e.x - x, e.y - y) - e.r;
    if (d < rad) damageEnemy(w, e, dmg * (1 - 0.5 * Math.max(0, d) / rad), side);
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
      if (e.hp <= 0 || e.invuln) continue;
      const rr = e.r + s.r;
      const tt = clamp(((e.x - sx0) * sdx + (e.y - sy0) * sdy) / sl2, 0, 1);
      const hx = sx0 + sdx * tt, hy = sy0 + sdy * tt;
      const dx = e.x - hx, dy = e.y - hy;
      if (dx * dx + dy * dy > rr * rr) continue;
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
      if (s.splash) explode(w, s.x, s.y, s.splash, s.dmg, s.arm, e);
      else {
        damageEnemy(w, e, s.dmg, s.arm);
        w.fx.push({ type: 'spark', x: s.x, y: s.y, vx: rand(-5, 5), vy: rand(-5, 5), life: 0.15, max: 0.15, size: 0.15 });
      }
      s.life = 0;
      s.done = true;
      break;
    }
    if (!s.done && s.life <= 0 && s.splash && s.kind !== 'flame') explode(w, s.x, s.y, s.splash, s.dmg, s.arm, null);
  }
  w.pshots = w.pshots.filter(s => s.life > 0 && w.geo.inside(w, s.x, s.y, -0.5));   // 岩壁・封鎖線で消える
}

function hurtPlayer(w, dmg) {
  const P = w.player;
  if (w.result || P.air > 0) return;   // ジャンプ中は無敵
  const real = dmg * (1 + SURGE.dmg * w.surge.k) * 100 / (100 + P.st.def * 4);   // 脈動中は被ダメージ増
  P.hp -= real;
  P.hit = 0.12;
  Sound.play('hurt');
  w.stats.dmgTaken += Math.min(real, P.hp + real);
  w.shake = Math.max(w.shake, Math.min(0.6, real / 40));
  const pct = P.hp / P.maxHp * 100;
  for (const th of [75, 50, 25, 10]) {
    if (P.hpWarn > th && pct <= th) {
      P.hpWarn = th;
      addLog(w, `警告：機体損傷 HP ${th}% 以下`, '#ff7a5a');
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
    w.banner = { title: `${e.def.name} 激昂`, sub: '甲殻が赤熱 ― 行動パターンが変化した！', t: 3 };
    addLog(w, 'ボス 形態変化：甲殻が赤熱している！ 行動パターン変化', '#ff6a4a');
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
          addLog(w, `ボスが眷属を呼び出した（+${n}体）`, '#ffb070');
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
      addLog(w, 'ボスが地中に潜った！', '#ffb070');
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
  const mul = !e.def.boss && w.surge.k > 0.5 ? 2 : 1;   // 脈動中に倒すと鉱石 2倍
  for (const [kind, n] of Object.entries(drop)) {
    for (let i = 0; i < n * mul; i++) {
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
  for (const o of w.ores) {
    o.t += dt;
    const dx = P.x - o.x, dy = P.y - o.y, d = Math.hypot(dx, dy) || 0.001;
    if (canPick && o.t > 0.35 && (d < ORE_MAGNET_R || sweep)) o.pull += dt;
    if (o.pull > 0) {
      const sp = 10 + o.pull * 45;
      o.vx = dx / d * sp;
      o.vy = dy / d * sp;
      if (d < P.r + 0.3 || d < sp * dt) { collectOre(w, o); continue; }
    } else {
      o.vx *= 1 - Math.min(1, 4 * dt);
      o.vy *= 1 - Math.min(1, 4 * dt);
    }
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    if (!o.pull) { o.r = 0.5; clampField(w, o); }   // 吸い寄せ中は岩壁を越えて機体へ飛んでいく
  }
  if (w.ores.some(o => o.got)) w.ores = w.ores.filter(o => !o.got);
  for (const k in w.orePulse) w.orePulse[k] = Math.max(0, w.orePulse[k] - dt);
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
  if (!w.ores.length) return;
  const got = emptyOre();
  for (const o of w.ores) { got[o.kind]++; w.ore[o.kind]++; }
  w.ores = [];
  addLog(w, `回収ドローン：残りの鉱石を回収（${ORES.filter(k => got[k.id]).map(k => `${k.name}×${got[k.id]}`).join(' ')}）`, '#c9e0ff');
}

// 戦闘終了時の鉱石の精算。帰還・勝利は全回収、撤退は拾った分のみ、大破は拾った分の半分を失う
function finishOre(w) {
  if (w.oreResult) return w.oreResult;
  let field = 0;
  if (w.result === 'win' || w.result === 'return') collectAllOres(w);
  else field = w.ores.length;
  const lost = emptyOre(), gain = emptyOre();
  for (const k of ORES) {
    lost[k.id] = w.result === 'lose' ? Math.floor(w.ore[k.id] / 2) : 0;
    gain[k.id] = w.ore[k.id] - lost[k.id];
  }
  w.oreResult = { collected: Object.assign({}, w.ore), lost, gain, field };
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
  const sx = w.shake > 0 ? rand(-1, 1) * w.shake * 6 : 0;
  const sy = w.shake > 0 ? rand(-1, 1) * w.shake * 6 : 0;
  ctx.fillStyle = w.field.dark ? '#141216' : '#3b2a1c';
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(VW / 2 + sx, VH / 2 + sy);
  ctx.scale(z, z);
  ctx.translate(-B.cam.x, -B.cam.y);

  const vx0 = B.cam.x - VW / 2 / z - 4, vy0 = B.cam.y - VH / 2 / z - 4;
  const vx1 = B.cam.x + VW / 2 / z + 4, vy1 = B.cam.y + VH / 2 / z + 4;
  const inView = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

  w.geo.drawGround(ctx, w, { x0: vx0, y0: vy0, x1: vx1, y1: vy1 });
  const sk = w.surge.k, sb = sk > 0 ? surgeBreath(w) : 0;
  if (sk > 0) drawSurgeGround(ctx, w, sk, sb, vx0, vy0, vx1, vy1, inView);

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
    ctx.restore();
  }

  // ボスの予兆
  const boss = w.boss;
  if (boss && boss.hp > 0 && !w.result) BOSS_KINDS[boss.type].telegraph(ctx, w, boss);
  if (w.hazards.length) drawHazards(ctx, w);

  // 岩
  for (const k of w.rocks) {
    if (!inView(k.x, k.y, k.r)) continue;
    drawRock(ctx, k);
  }

  for (const f of w.fx) if (f.type === 'dust' && inView(f.x, f.y, 3)) drawFx(ctx, f);

  // 鉱石
  for (const o of w.ores) {
    if (inView(o.x, o.y, 1)) drawOre(ctx, o, w.time);
  }

  // 敵（脈動中は足元に赤い揺らめき）
  for (const e of w.enemies) {
    if (!inView(e.x, e.y, e.def.boss ? 20 : 3)) continue;
    if (sk > 0.05 && !e.buried) drawSurgeAura(ctx, e, sk, sb);
    drawEnemy(ctx, e);
  }

  // プレイヤー
  if (!P.dead) {
    // ジャンプ中：地面に影を残し、機体は高さに応じて大きく描く
    const lift = P.air > 0 ? Math.sin(Math.PI * (1 - P.air / P.airMax)) : 0;
    if (lift > 0) {
      ctx.fillStyle = `rgba(0,0,0,${0.25 - 0.1 * lift})`;
      ctx.beginPath();
      ctx.ellipse(P.x + 0.6 * lift, P.y + 1.4 * lift, 1.5 * (1 - 0.25 * lift), 1.4 * (1 - 0.25 * lift), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.rotate(P.a);
    if (lift > 0) ctx.scale(1 + 0.35 * lift, 1 + 0.35 * lift);
    drawRobot(ctx, P.st.parts, {
      time: w.time, walk: P.walk, hit: P.hit, xray: B.xray, noShadow: lift > 0,
      armL: { recoil: P.arms.L.recoil, flash: P.arms.L.flash },
      armR: { recoil: P.arms.R.recoil, flash: P.arms.R.flash },
    });
    ctx.restore();
  }

  // 弾
  for (const s of w.pshots) drawPShot(ctx, s);
  for (const s of w.eshots) {
    if (inView(s.x, s.y)) drawEnemyShot(ctx, s);
  }
  for (const f of w.fx) if (f.type !== 'dust' && inView(f.x, f.y, 12)) drawFx(ctx, f);

  w.geo.drawSealed(ctx, w);
  ctx.restore();

  // 洞窟：機体のまわり以外を暗くする
  if (w.field.dark) {
    const px = VW / 2 + (P.x - B.cam.x) * z, py = VH / 2 + (P.y - B.cam.y) * z;
    const g = ctx.createRadialGradient(px, py, Math.min(VW, VH) * 0.3, px, py, Math.max(VW, VH) * 0.75);
    g.addColorStop(0, 'rgba(0,0,6,0)');
    g.addColorStop(1, 'rgba(0,0,6,0.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
  }
  // 大地の脈動：画面の縁が呼吸に合わせて赤く脈打つ
  if (sk > 0) {
    const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * (0.42 - 0.08 * sb), VW / 2, VH / 2, Math.max(VW, VH) * 0.72);
    g.addColorStop(0, 'rgba(120,0,0,0)');
    g.addColorStop(1, `rgba(110,0,0,${sk * (0.3 + 0.3 * sb)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
  }
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

function drawEnemy(ctx, e) {
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
  if (art.hpBar && e.hp < e.maxHp) {
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

function drawHUD(ctx, w, B, VW, VH) {
  const P = w.player;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // --- 機体ステータス ---
  const JP = P.st.jump, jh = JP ? 18 : 0;   // ジャンプが使える脚なら1行増やす
  hudPanel(ctx, 12, 12, 310, 172 + jh, '機体ステータス  [頭部A/B テレメトリ]');
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#e8f0ea';
  ctx.fillText(`HP ${Math.ceil(P.hp)} / ${P.maxHp}`, 20, 30);
  hudBar(ctx, 20, 46, 294, 10, P.hp / P.maxHp, P.hp / P.maxHp > 0.3 ? '#5dde7a' : '#ff5a4a');
  const r = P.st.ratio;
  ctx.fillStyle = '#e8f0ea';
  ctx.fillText(`出力配分  腕 ${Math.round(r * 100)}%  /  脚 ${Math.round((1 - r) * 100)}%    総出力 ${Math.round(P.st.power)}`, 20, 62);
  ctx.fillStyle = '#e0604a';
  ctx.fillRect(20, 78, 294 * r, 8);
  ctx.fillStyle = '#4a9ae0';
  ctx.fillRect(20 + 294 * r, 78, 294 * (1 - r), 8);
  let y = 94;
  for (const arm of [P.arms.L, P.arms.R]) {
    ctx.fillStyle = '#e8f0ea';
    const nm = `${arm.side === 'L' ? '左腕' : '右腕'}：${arm.def.name}`;
    ctx.fillText(nm, 20, y);
    if (arm.def.type === 'none') { /* なし */ }
    else if (arm.reloading > 0) {
      ctx.fillStyle = '#ffd24a';
      ctx.fillText('リロード中', 240, y);
      hudBar(ctx, 20, y + 16, 294, 5, 1 - arm.reloading / arm.perf.reload, '#ffd24a');
    } else if (arm.def.mag > 0) {
      ctx.fillStyle = '#cde';
      ctx.fillText(`${arm.ammo} / ${arm.def.mag}`, 250, y);
      hudBar(ctx, 20, y + 16, 294, 5, arm.ammo / arm.def.mag, '#9cd6d6');
    } else {
      ctx.fillStyle = '#cde';
      ctx.fillText('∞', 270, y);
    }
    y += 28;
  }
  ctx.fillStyle = '#9fb5a5';
  ctx.fillText(`速度 ${Math.hypot(P.vx, P.vy).toFixed(1)} m/s   制御：${B.manual ? '手動操作' : '回路プログラム'}`, 20, y);
  if (JP) {
    y += 18;
    const air = P.air > 0;
    ctx.fillStyle = air ? '#8fe0ff' : P.jumpCd > 0 ? '#9fb5a5' : '#9fe0b0';
    ctx.fillText(air ? 'ジャンプ：跳躍中（無敵）' : P.jumpCd > 0 ? `ジャンプ：再使用まで ${P.jumpCd.toFixed(1)}s`
      : `ジャンプ：準備完了${B.manual ? ' [Shift]' : ''}`, 20, y);
    hudBar(ctx, 200, y + 4, 114, 5, air ? 1 : 1 - P.jumpCd / JP.cd, '#8fe0ff');
  }

  // --- 回収鉱石 ---
  hudPanel(ctx, 12, 190 + jh, 310, 44, `回収鉱石${w.ores.length ? `   （フィールドに ${w.ores.length}個）` : ''}`);
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
    ctx.fillText(`${k.name} ${w.ore[k.id]}`, ox + 10, oy - 7);
  });
  ctx.font = '12px sans-serif';

  // --- 敵数 / ボス ---
  ctx.textAlign = 'center';
  const remain = w.enemies.filter(e => !e.def.boss).length + (w.phase === 'fight' ? w.queue.length : 0);
  const bossPhase = w.phase === 'warn' || w.phase === 'boss';
  const DS = w.field.districts, D = DS[w.district];
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#f0c890';
  if (!bossPhase) ctx.fillText(`${D.name}「${D.sub}」  ${w.district + 1} / ${DS.length}`, VW / 2, 12);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#f2e6c8';
  if (w.phase === 'fight') ctx.fillText(`残敵 ${remain} / ${w.perDistrict}`, VW / 2, 32);
  else if (w.phase === 'confirm' || w.phase === 'done') ctx.fillText('掃討完了', VW / 2, 32);
  else if (remain > 0) ctx.fillText(`眷属 ${remain}`, VW / 2, 60);
  const bt = Math.floor(w.time);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#cbbd9c';
  ctx.fillText(`経過 ${String(Math.floor(bt / 60)).padStart(2, '0')}:${String(bt % 60).padStart(2, '0')}`, VW / 2, bossPhase ? 80 : 56);
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
    ctx.fillText(w.banner.sub, VW / 2, VH * 0.28 + 12);
    ctx.globalAlpha = 1;
  }

  if (w.boss && w.boss.hp > 0) {
    const bw = Math.max(220, Math.min(560, VW - 720));
    const bx = VW / 2 - bw / 2;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ffb090';
    const bd = w.boss.def;
    ctx.fillText(bd.name + (w.boss.phase2 ? `（${bd.phase2Name}）` : ''), VW / 2, 14);
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
    ctx.fillText('巨大生体反応 接近中', VW / 2, VH / 2 + 30);
    ctx.textBaseline = 'top';
  }

  // --- ミニマップ ---
  const { mx, my, k } = w.geo.minimap(ctx, w, VW - 12, 12);
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
  ctx.strokeStyle = 'rgba(140,255,190,0.35)';
  circle(ctx, mx + P.x * k, my + P.y * k, P.st.sensor * k); ctx.stroke();
  ctx.fillStyle = '#7dff9a';
  circle(ctx, mx + P.x * k, my + P.y * k, 3); ctx.fill();

  // --- 回路モニター ---
  const grid = P.st.grid;
  const cs = Math.floor(200 / grid);
  const cw = cs * grid;
  const cx = VW - cw - 16, cy = VH - cw - 40;
  hudPanel(ctx, cx - 8, cy - 26, cw + 16, cw + 34, `回路モニター ${grid}×${grid} @${fmtNum(P.st.clock)}Hz`);
  drawCircuit(ctx, w.program, grid, cx, cy, cs, { pc: B.manual ? null : { x: P.vm.x, y: P.vm.y } });
  if (B.manual) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(cx, cy, cw, cw);
    ctx.fillStyle = '#ffd24a';
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('手動操作中', cx + cw / 2, cy + cw / 2 - 8);
    ctx.textAlign = 'left';
  }

  // --- レポートログ ---
  const lw = 420, lh = 150, lx = 12, ly = VH - lh - 40;
  hudPanel(ctx, lx, ly, lw, lh, 'REPORT');
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  const lines = w.log.slice(-8);
  lines.forEach((l, i) => {
    const age = w.time - l.t;
    ctx.globalAlpha = age < 8 ? 1 : 0.55;
    ctx.fillStyle = l.color;
    const ts = Math.floor(l.t);
    ctx.fillText(`[${String(Math.floor(ts / 60)).padStart(2, '0')}:${String(ts % 60).padStart(2, '0')}] ${l.msg}`, lx + 8, ly + 24 + i * 15);
  });
  ctx.globalAlpha = 1;

  // --- 操作説明 ---
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(240,230,210,0.8)';
  ctx.textAlign = 'center';
  ctx.fillText('[Space]一時停止  [1/2/3]速度  [M]手動/回路 切替  [Q/E]出力配分  [ホイール]ズーム  [X]骨格透過  [Esc]撤退', VW / 2, VH - 22);
  if (B.manual) ctx.fillText(`手動操作：WASD 移動 / マウス 照準 / 左クリック 左腕 / 右クリック 右腕${P.st.jump ? ' / Shift ジャンプ' : ''}`, VW / 2, VH - 40);
  if (B.speed !== 1) {
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(`×${B.speed}`, VW / 2, 100);
  }
  if (B.paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, VW, VH);
    ctx.font = 'bold 40px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText('PAUSE', VW / 2, VH / 2);
    ctx.textBaseline = 'top';
  }
  if (w.result) {
    const txt = { win: 'MISSION COMPLETE', lose: 'MACHINE DOWN', retreat: 'RETREAT', return: 'RETURN TO BASE' }[w.result];
    const col = { win: '#9fffb0', lose: '#ff6a4a', retreat: '#ffd24a', return: '#9fe0ff' }[w.result];
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
//  戦闘画面コントローラー
// ---------------------------------------------------------------------
const Battle = {
  running: false,

  start(save) {
    this.canvas = document.getElementById('battle');
    this.ctx = this.canvas.getContext('2d');
    this.save = save;
    this.world = createWorld(save);
    this.speed = 1;
    this.paused = false;
    this.manual = false;
    this.jumpReq = false;   // 手動操作で Shift が押された（次のシミュレーションでジャンプ）
    this.xray = false;
    this.zoom = 24;  // 1m あたりのピクセル数（ホイールで変更可）
    this.cam = { x: this.world.player.x, y: this.world.player.y };
    this.camLead = { x: 0, y: 0 };  // 自機の前方へずらすカメラのオフセット（m）
    this.atkHold = 0;               // 攻撃後もしばらく前方を広く見せる残り時間
    this.keys = {};
    this.mouse = { x: 0, y: 0, l: false, r: false, inside: false };
    this.acc = 0;
    this.last = performance.now();
    this.resize();
    this.bind();
    this.hideConfirm();
    document.getElementById('confirm-yes').onclick = () => this.answerConfirm(true);
    document.getElementById('confirm-no').onclick = () => this.answerConfirm(false);
    this.running = true;
    Sound.playBgm('battle');
    requestAnimationFrame(this.loop);
  },

  stop() {
    this.running = false;
    Sound.duck(false);
    this.unbind();
    this.hideConfirm();
  },

  // 地区掃討後の「次に進みますか？」ダイアログ
  showConfirm() {
    const w = this.world, P = w.player;
    const DS = w.field.districts;
    const last = w.district >= DS.length - 1;
    const D = DS[w.district];
    const hpPct = Math.round(P.hp / P.maxHp * 100);
    const ammo = ['L', 'R'].map(s => {
      const a = P.arms[s];
      if (a.def.type === 'none') return null;
      return `${s === 'L' ? '左腕' : '右腕'} ${a.def.mag ? (a.reloading > 0 ? 'リロード中' : `${a.ammo}/${a.def.mag}`) : '∞'}`;
    }).filter(Boolean).join(' / ');
    let next;
    if (last) {
      next = `<p class="next boss">次：<b>ボス戦 — ${ENEMY_DEFS[w.field.boss].name}</b><br>全地区（第1〜第${DS.length}地区）が戦闘フィールドになります。</p>`;
    } else {
      const N = DS[w.district + 1];
      next = `<p class="next">次：<b>${N.name}「${N.sub}」</b> 敵 ${w.perDistrict}体<br>第1〜第${w.district + 2}地区が戦闘フィールドになります。</p>`;
    }
    document.getElementById('confirm-title').textContent = `${D.name}「${D.sub}」 掃討完了`;
    document.getElementById('confirm-body').innerHTML = `
      <div class="hpline"><span>機体HP ${Math.ceil(P.hp)} / ${P.maxHp}（${hpPct}%）</span><i><b style="width:${hpPct}%"></b></i></div>
      <p class="muted">${ammo}　※HP・弾薬は持ち越し（補給なし）</p>
      <p class="ore-line">回収鉱石：${oreHTML(w.ore)}</p>
      ${next}
      <p class="q">${last ? 'ボス戦に進みますか？' : '次に進みますか？'}</p>`;
    document.getElementById('confirm-yes').textContent = last ? 'ボス戦へ（Enter）' : '次の地区へ（Enter）';
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
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.VW = window.innerWidth;
    this.VH = window.innerHeight;
    this.canvas.width = Math.floor(this.VW * dpr);
    this.canvas.height = Math.floor(this.VH * dpr);
    this.canvas.style.width = this.VW + 'px';
    this.canvas.style.height = this.VH + 'px';
  },

  bind() {
    this.h = {
      key: (e) => this.onKey(e, true),
      keyup: (e) => this.onKey(e, false),
      move: (e) => { const r = this.canvas.getBoundingClientRect(); this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top; },
      down: (e) => { if (e.button === 0) this.mouse.l = true; if (e.button === 2) this.mouse.r = true; },
      up: (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; },
      wheel: (e) => { e.preventDefault(); this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 6, 48); },
      ctx: (e) => e.preventDefault(),
      resize: () => this.resize(),
    };
    window.addEventListener('keydown', this.h.key);
    window.addEventListener('keyup', this.h.keyup);
    this.canvas.addEventListener('mousemove', this.h.move);
    this.canvas.addEventListener('mousedown', this.h.down);
    window.addEventListener('mouseup', this.h.up);
    this.canvas.addEventListener('wheel', this.h.wheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.h.ctx);
    window.addEventListener('resize', this.h.resize);
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
    this.h = null;
  },

  onKey(e, down) {
    this.keys[e.code] = down;
    if (!down) return;
    const w = this.world;
    if (this.confirmOpen) {
      if (e.code === 'Enter' || e.code === 'KeyY') this.answerConfirm(true);
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
        addLog(w, this.manual ? '制御切替：手動操作' : '制御切替：回路プログラム', '#ffd24a');
        break;
      case 'KeyQ': if (!w.result) setPlayerRatio(w, w.player, w.player.st.ratio - 0.05); break;
      case 'KeyE': if (!w.result) setPlayerRatio(w, w.player, w.player.st.ratio + 0.05); break;
      case 'KeyX': this.xray = !this.xray; break;
      case 'ShiftLeft': case 'ShiftRight': if (this.manual) this.jumpReq = true; break;
      case 'Escape': if (!w.result) endBattle(w, 'retreat'); break;
    }
  },

  input() {
    const z = this.zoom;
    return {
      manual: this.manual,
      keys: this.keys,
      aim: { x: this.cam.x + (this.mouse.x - this.VW / 2) / z, y: this.cam.y + (this.mouse.y - this.VH / 2) / z },
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
        simulate(w, STEP, inp);
        this.acc -= STEP;
        n++;
      }
      if (n > 0) this.jumpReq = false;   // Shift のジャンプ要求はシミュレーションに渡したら消す
      if (n >= 12 || w.phase === 'confirm') this.acc = 0;
    }
    if (w.phase === 'confirm' && !this.confirmOpen && !w.result) this.showConfirm();
    const P = w.player;
    // 攻撃中は機体の向いている方向へカメラを先行させ、前方の視界を広げる
    const attacking = ['L', 'R'].some(s => {
      const a = P.arms[s];
      return a.def.type !== 'none' && (a.trigger > 0 || a.flash > 0);
    });
    if (attacking) this.atkHold = 1.2;
    else this.atkHold = Math.max(0, this.atkHold - dt);
    const lead = this.atkHold > 0 ? 0.38 : 0.1;  // 画面半分に対する前方オフセット比
    const z = this.zoom;
    const tx = Math.cos(P.a) * this.VW / 2 / z * lead;
    const ty = Math.sin(P.a) * this.VH / 2 / z * lead;
    const fl = Math.min(1, dt * 2.5);
    this.camLead.x += (tx - this.camLead.x) * fl;
    this.camLead.y += (ty - this.camLead.y) * fl;
    const f = Math.min(1, dt * 5);
    this.cam.x += (P.x + this.camLead.x - this.cam.x) * f;
    this.cam.y += (P.y + this.camLead.y - this.cam.y) * f;

    Sound.listen(this.cam.x, this.cam.y, this.VW / 2 / z);
    Sound.duck(this.paused || this.confirmOpen);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawWorld(ctx, w, this, this.VW, this.VH);
    drawHUD(ctx, w, this, this.VW, this.VH);

    if (w.result && w.endT > 3.2) {
      this.stop();
      Game.addOre(finishOre(w).gain);
      Report.show(w);
      return;
    }
    requestAnimationFrame(this.loop);
  },
};
