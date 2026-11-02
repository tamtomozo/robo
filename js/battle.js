'use strict';
// =====================================================================
//  戦闘：荒野フィールド（見下ろし）・プレイヤー1機 vs エネミー多数 → ボス
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
  return { side, def: perf.def, perf, ammo: perf.def.mag, cd: 0, reloading: 0, trigger: 0, recoil: 0, flash: 0 };
}

function createPlayer(save) {
  const st = computeStats(save.build, null, save.upgrades);
  return {
    x: 0, y: 0, a: -Math.PI / 2, vx: 0, vy: 0, r: 1.2,
    build: save.build, upgrades: save.upgrades, st, hp: st.hp, maxHp: st.hp,
    action: null, walk: 0, hit: 0, dead: false, hpWarn: 100,
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

function insideRock(w, x, y, r) {
  return w.rocks.some(k => Math.hypot(k.x - x, k.y - y) < k.r + r);
}

function createWorld(save) {
  // W = 現在開放されている範囲の幅（掃討済み地区＋現在の地区）、FW = 全地区の幅
  const H = DISTRICT_H, FW = DISTRICT_W * DISTRICTS.length;
  const w = {
    W: DISTRICT_W, H, FW, district: 0, perDistrict: save.enemyCount,
    time: 0, enemies: [], pshots: [], eshots: [], fx: [], scorch: [], rocks: [], decor: [],
    phase: 'fight', phaseT: 0, boss: null, log: [], result: null, endT: 0, shake: 0, banner: null,
    program: save.program,
    ores: [], ore: emptyOre(), orePulse: {}, oreResult: null,   // 落ちている鉱石 / 回収した鉱石
    stats: {
      kills: { scarab: 0, spitter: 0, troll: 0, boss: 0 }, dmgDealt: 0, dmgTaken: 0,
      shots: { L: 0, R: 0 }, hits: { L: 0, R: 0 }, dmgBy: { L: 0, R: 0 },
      distance: 0, total: save.enemyCount, bossAt: null, cleared: 0,
    },
  };
  w.player = createPlayer(save);
  w.player.x = DISTRICT_W / 2;
  w.player.y = H / 2;

  for (let i = 0; i < 10 * DISTRICTS.length; i++) {
    // 岩同士・外周との間に大型エネミーが通れる隙間（4.5m以上）を確保する
    let x, y, tries = 0, ok = false;
    const r = rand(2, 6);
    while (!ok && tries++ < 60) {
      x = rand(r + 5, FW - r - 5);
      y = rand(r + 5, H - r - 5);
      ok = Math.hypot(x - DISTRICT_W / 2, y - H / 2) >= 24 &&
           Math.abs(((x + DISTRICT_W / 2) % DISTRICT_W) - DISTRICT_W / 2) >= 9 &&
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
    w.rocks.push({ x, y, r, pts });
  }
  for (let i = 0; i < 900; i++) {
    w.decor.push({
      x: rand(0, FW), y: rand(0, H), s: rand(0.5, 1.5), rot: rand(0, 6.283),
      type: pick(['pebble', 'pebble', 'pebble', 'bush', 'bush', 'crack', 'bone']),
    });
  }
  addLog(w, '戦闘モード起動。荒野 第7区画へ降下完了。', '#9fe0b0');
  startDistrict(w);
  return w;
}

// 現在の地区の敵を配置（同時出現上限を超える分は増援キューへ）
function startDistrict(w) {
  const D = DISTRICTS[w.district];
  const comp = enemyComposition(w.perDistrict, w.district);
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
  if (w.district < DISTRICTS.length - 1) {
    w.district++;
    w.W = DISTRICT_W * (w.district + 1);
    w.stats.total += w.perDistrict;
    addLog(w, `封鎖線を解除。${DISTRICTS[w.district].name}へ進攻する。`, '#9fe0b0');
    startDistrict(w);
  } else {
    w.W = w.FW;
    w.phase = 'warn';
    w.phaseT = 3;
    addLog(w, '全地区 掃討完了。大型の生体反応が地中を接近中！', '#ffd24a');
    Sound.stopBgm(1.5);
    Sound.play('siren');
  }
}

// 確認ダイアログで「基地に帰還」を選んだとき
function returnToBase(w) {
  w.phase = 'done';
  endBattle(w, 'return');
}

function spawnEnemy(w, type, at) {
  const def = ENEMY_DEFS[type];
  let x, y;
  if (at) { x = at.x; y = at.y; }
  else {
    // 現在の地区の中で、機体から離れた位置に出現
    const x0 = w.district * DISTRICT_W;
    let tries = 0;
    do {
      x = rand(x0 + 5, x0 + DISTRICT_W - 5);
      y = rand(5, w.H - 5);
    } while ((Math.hypot(x - w.player.x, y - w.player.y) < 40 || insideRock(w, x, y, def.r)) && tries++ < 40);
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
  let x, y, t = 0;
  do {
    const a = rand(0, Math.PI * 2);
    x = P.x + Math.cos(a) * 32;
    y = P.y + Math.sin(a) * 32;
  } while ((x < 12 || y < 12 || x > w.W - 12 || y > w.H - 12 || insideRock(w, x, y, 5)) && t++ < 60);
  x = clamp(x, 12, w.W - 12);
  y = clamp(y, 12, w.H - 12);
  const e = spawnEnemy(w, 'boss', { x, y });
  e.hp = e.maxHp = ENEMY_DEFS.boss.hp + 25 * w.perDistrict;
  e.state = 'emerge';
  e.st = 2.2;
  e.invuln = true;
  e.phase2 = false;
  e.segs = [];
  for (let i = 0; i < 6; i++) e.segs.push({ x, y });
  w.boss = e;
  w.stats.bossAt = w.time;
  w.shake = 1;
  addLog(w, `ボス出現：${ENEMY_DEFS.boss.name}`, '#ff6a4a');
  Sound.play('quake');
  Sound.play('roar');
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
    const D = DISTRICTS[w.district];
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
  o.x = clamp(o.x, o.r, w.W - o.r);
  o.y = clamp(o.y, o.r, w.H - o.r);
}

function updatePlayer(w, P, dt, inp) {
  const st = P.st;
  let thrust = 0, strafe = 0, turn = 0, faceTo = null, manualVel = null;

  if (inp.manual) {
    P.action = null;
    let mx = (inp.keys.KeyD ? 1 : 0) - (inp.keys.KeyA ? 1 : 0);
    let my = (inp.keys.KeyS ? 1 : 0) - (inp.keys.KeyW ? 1 : 0);
    const l = Math.hypot(mx, my);
    if (l > 0) { mx /= l; my /= l; }
    manualVel = [mx * st.speed, my * st.speed];
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
  const k = Math.min(1, st.accel * dt);
  P.vx += (dvx - P.vx) * k;
  P.vy += (dvy - P.vy) * k;
  P.x += P.vx * dt;
  P.y += P.vy * dt;
  const sp = Math.hypot(P.vx, P.vy);
  P.walk += sp * dt;
  w.stats.distance += sp * dt;
  // 歩幅ごとに足音
  const stride = Math.floor(P.walk / 2.6);
  if (stride !== P.stride) { P.stride = stride; Sound.play('step', { x: P.x, y: P.y, vol: 0.7 }); }
  collideRocks(w, P);
  clampField(w, P);
  P.hit = Math.max(0, P.hit - dt);

  updateArm(w, P, P.arms.L, dt);
  updateArm(w, P, P.arms.R, dt);

  if (sp > 2 && Math.random() < dt * sp * 0.7) {
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
  w.stats.shots[arm.side]++;
  arm.recoil = 1;
  arm.flash = 0.06;
  const dmg = arm.perf.dmg;
  Sound.play({ gun: 'gun', shell: 'shell', missile: 'missile', flame: 'flame', melee: 'melee' }[d.type], { x: mx, y: my });
  if (d.type === 'melee') { meleeSwing(w, P, arm, dmg); return; }

  const ang = (d.type === 'missile' ? P.a : aimAngle(w, P, mx, my, d.range)) + rand(-d.spread, d.spread);
  const shot = {
    kind: d.type, arm: arm.side, x: mx, y: my, ang, speed: d.speed,
    // 前フレーム位置＝肩。最初の判定で肩〜砲口間の密着した敵にも当たる
    px: P.x + fx * J.x + rx * s * J.y, py: P.y + fy * J.x + ry * s * J.y,
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
    const kb = e.type === 'boss' ? 0 : e.type === 'troll' ? 4 : 12;
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
  w.stats.kills[e.type]++;
  const art = enemyArtOf(e.type);
  const col = art.gibColor;
  const n = e.type === 'boss' ? 60 : e.type === 'troll' ? 16 : 7;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(2, 9) * (e.type === 'boss' ? 2 : 1);
    w.fx.push({ type: 'gib', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), max: 0.9, size: rand(0.15, 0.35) * (e.type === 'boss' ? 2 : 1), color: col });
  }
  addScorch(w, e.x, e.y, e.r * 1.2, art.scorchColor);
  dropOre(w, e);
  Sound.play(e.type === 'boss' ? 'bossDie' : e.type === 'troll' ? 'killBig' : 'kill', { x: e.x, y: e.y });
  if (e.type === 'boss') {
    for (let i = 0; i < 8; i++) {
      w.fx.push({ type: 'boom', x: e.x + rand(-4, 4), y: e.y + rand(-4, 4), life: rand(0.5, 1.2), max: 1.2, size: rand(3, 6) });
    }
    w.shake = 1.5;
    endBattle(w, 'win');
    return;
  }
  const remain = w.enemies.filter(o => o.hp > 0 && o.type !== 'boss').length + w.queue.length;
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
      if (!s.target || s.target.hp <= 0) s.target = nearestTo(w, s.x, s.y, 30);
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
  w.pshots = w.pshots.filter(s => s.life > 0 && s.x > -5 && s.y > -5 && s.x < w.W + 5 && s.y < w.H + 5);
}

function hurtPlayer(w, dmg) {
  const P = w.player;
  if (w.result) return;
  const real = dmg * 100 / (100 + P.st.def * 4);
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
  for (const e of w.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    e.anim += dt;
    e.cd -= dt;
    e.lunge = Math.max(0, e.lunge - dt * 4);
    if (frozen) { e.vx *= 0.9; e.vy *= 0.9; continue; }
    if (e.type === 'boss') { updateBoss(w, e, dt); continue; }

    const dx = P.x - e.x, dy = P.y - e.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const ux = dx / d, uy = dy / d;
    const sp = e.def.speed;
    let dvx = 0, dvy = 0;
    e.a = Math.atan2(dy, dx);

    if (e.type === 'spitter') {
      if (d > 22) { dvx = ux * sp; dvy = uy * sp; }
      else if (d < 14) { dvx = -ux * sp; dvy = -uy * sp; }
      else {
        dvx = -uy * sp * 0.6 * e.strafeDir;
        dvy = ux * sp * 0.6 * e.strafeDir;
        if (Math.random() < dt * 0.3) e.strafeDir *= -1;
      }
      if (e.cd <= 0 && d < e.def.range) {
        e.cd = e.def.cd * rand(0.8, 1.2);
        e.lunge = 1;
        Sound.play('acid', { x: e.x, y: e.y });
        w.eshots.push({ kind: 'acid', x: e.x + ux * e.r, y: e.y + uy * e.r, vx: ux * 16, vy: uy * 16, r: 0.4, dmg: e.def.dmg, life: 2.2 });
      }
    } else {
      dvx = ux * sp;
      dvy = uy * sp;
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
    if (d < rr && d > 0.0001) {
      const ov = rr - d, ux = dx / d, uy = dy / d;
      const tp = e.type === 'boss' ? 1 : e.type === 'troll' ? 0.4 : 0.12;
      e.x += ux * ov * (1 - tp); e.y += uy * ov * (1 - tp);
      P.x -= ux * ov * tp; P.y -= uy * ov * tp;
    }
    collideRocks(w, e);
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

function updateBoss(w, e, dt) {
  const P = w.player;
  const dx = P.x - e.x, dy = P.y - e.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const toP = Math.atan2(dy, dx);
  if (!e.phase2 && e.hp < e.maxHp * 0.5) {
    e.phase2 = true;
    w.shake = 0.8;
    addLog(w, 'ボス 形態変化：甲殻が赤熱している！', '#ff6a4a');
    Sound.play('roar');
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
      if (e.st <= 0) { e.invuln = false; e.state = 'chase'; e.st = 2; }
      break;
    case 'chase':
      e.a = turnToward(e.a, toP, 2 * dt);
      dvx = Math.cos(e.a) * spd;
      dvy = Math.sin(e.a) * spd;
      if (d < e.r + P.r + 0.4 && e.cd <= 0) { e.cd = 1; hurtPlayer(w, e.def.dmg); }
      if (e.st <= 0) bossPick(w, e, d);
      break;
    case 'charge_wind':
      e.a = turnToward(e.a, toP, 3 * dt);
      if (e.st <= 0) { e.state = 'charge'; e.st = 1.1; e.cdir = e.a; e.hitDone = false; }
      break;
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
      const wall = e.x <= e.r + 0.5 || e.y <= e.r + 0.5 || e.x >= w.W - e.r - 0.5 || e.y >= w.H - e.r - 0.5;
      if (e.st <= 0 || wall) { e.state = 'recover'; e.st = 1.2; if (wall) { w.shake = 0.6; Sound.play('slam', { vol: 0.6 }); } }
      break;
    }
    case 'recover':
      if (e.st <= 0) { e.state = 'chase'; e.st = rand(1.5, 2.5); }
      break;
    case 'ring':
      e.a = turnToward(e.a, toP, 1 * dt);
      if (e.st <= 0) {
        const n = p2 ? 36 : 24;
        const off = e.waves * 0.13;
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2 + off;
          w.eshots.push({ kind: 'rock', x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * 13, vy: Math.sin(a) * 13, r: 0.5, dmg: 12, life: 4 });
        }
        w.shake = Math.max(w.shake, 0.3);
        Sound.play('volley', { x: e.x, y: e.y });
        e.waves--;
        e.st = 0.45;
        if (e.waves <= 0) { e.state = 'chase'; e.st = 2; }
      }
      break;
    case 'summon':
      if (e.st <= 0) {
        const n = p2 ? 8 : 5;
        if (w.enemies.length < 120) {
          for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2;
            const m = spawnEnemy(w, 'scarab', { x: clamp(e.x + Math.cos(a) * (e.r + 2), 2, w.W - 2), y: clamp(e.y + Math.sin(a) * (e.r + 2), 2, w.H - 2) });
            m.cd = 1;
            w.fx.push({ type: 'dust', x: m.x, y: m.y, vx: 0, vy: 0, life: 0.8, max: 0.8, size: 1.2 });
          }
          addLog(w, `ボスが眷属を呼び出した（+${n}体）`, '#ffb070');
          Sound.play('summon', { x: e.x, y: e.y });
        }
        e.state = 'chase';
        e.st = 2;
      }
      break;
    case 'slam_wind':
      if (e.st <= 0) {
        if (d < 10 + P.r) hurtPlayer(w, 45);
        w.fx.push({ type: 'ring', x: e.x, y: e.y, life: 0.5, max: 0.5, size: 11 });
        addScorch(w, e.x, e.y, 6, 'rgba(40,25,15,0.3)');
        w.shake = 0.9;
        Sound.play('slam');
        e.state = 'recover';
        e.st = 0.8;
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

function bossPick(w, e, d) {
  const p2 = e.phase2;
  if (d < 10) { e.state = 'slam_wind'; e.st = p2 ? 0.7 : 1.0; return; }
  const r = Math.random();
  if (r < 0.4) { e.state = 'charge_wind'; e.st = p2 ? 0.6 : 0.9; Sound.play('charge'); }
  else if (r < 0.75) { e.state = 'ring'; e.st = 0.5; e.waves = p2 ? 3 : 2; }
  else { e.state = 'summon'; e.st = 0.8; }
}

function updateEnemyShots(w, dt) {
  const P = w.player;
  for (const s of w.eshots) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (!P.dead && Math.hypot(P.x - s.x, P.y - s.y) < P.r + s.r) {
      hurtPlayer(w, s.dmg);
      s.life = 0;
      const col = enemyShotArtOf(s.kind).hitColor;
      for (let i = 0; i < 5; i++) w.fx.push({ type: 'gib', x: s.x, y: s.y, vx: rand(-5, 5), vy: rand(-5, 5), life: 0.3, max: 0.3, size: 0.15, color: col });
    }
  }
  w.eshots = w.eshots.filter(s => s.life > 0 && s.x > -5 && s.y > -5 && s.x < w.W + 5 && s.y < w.H + 5);
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
  const big = e.type === 'boss' ? 2.5 : 1;
  for (const [kind, n] of Object.entries(drop)) {
    for (let i = 0; i < n; i++) {
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
    o.x = clamp(o.x + o.vx * dt, 0.5, w.W - 0.5);
    o.y = clamp(o.y + o.vy * dt, 0.5, w.H - 0.5);
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

function drawWorld(ctx, w, B, VW, VH) {
  const z = B.zoom;
  const P = w.player;
  const sx = w.shake > 0 ? rand(-1, 1) * w.shake * 6 : 0;
  const sy = w.shake > 0 ? rand(-1, 1) * w.shake * 6 : 0;
  if (!groundPattern) groundPattern = makeGroundPattern(ctx);

  ctx.fillStyle = '#3b2a1c';
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(VW / 2 + sx, VH / 2 + sy);
  ctx.scale(z, z);
  ctx.translate(-B.cam.x, -B.cam.y);

  const vx0 = B.cam.x - VW / 2 / z - 4, vy0 = B.cam.y - VH / 2 / z - 4;
  const vx1 = B.cam.x + VW / 2 / z + 4, vy1 = B.cam.y + VH / 2 / z + 4;
  const inView = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

  ctx.fillStyle = groundPattern;
  ctx.fillRect(Math.max(0, vx0), Math.max(0, vy0), Math.min(w.FW, vx1) - Math.max(0, vx0), Math.min(w.H, vy1) - Math.max(0, vy0));
  DISTRICTS.forEach((D, i) => {
    ctx.fillStyle = D.tint;
    ctx.fillRect(i * DISTRICT_W, 0, DISTRICT_W, w.H);
  });
  ctx.strokeStyle = '#5a3d22';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(0, 0, w.FW, w.H);
  // 開放済みの地区境界
  ctx.save();
  ctx.strokeStyle = 'rgba(255,230,180,0.25)';
  ctx.lineWidth = 0.3;
  ctx.setLineDash([2, 2]);
  for (let i = 1; i * DISTRICT_W < w.W; i++) {
    ctx.beginPath(); ctx.moveTo(i * DISTRICT_W, 0); ctx.lineTo(i * DISTRICT_W, w.H); ctx.stroke();
  }
  ctx.restore();

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
  if (boss && boss.hp > 0 && !w.result) {
    if (boss.state === 'charge_wind') {
      ctx.save();
      ctx.translate(boss.x, boss.y);
      ctx.rotate(boss.a);
      ctx.fillStyle = `rgba(255,60,30,${0.15 + 0.15 * Math.sin(w.time * 30)})`;
      ctx.fillRect(0, -boss.r, 40, boss.r * 2);
      ctx.restore();
    } else if (boss.state === 'slam_wind') {
      ctx.fillStyle = `rgba(255,60,30,${0.12 + 0.12 * Math.sin(w.time * 30)})`;
      circle(ctx, boss.x, boss.y, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,40,0.7)';
      ctx.lineWidth = 0.2;
      ctx.stroke();
    }
  }

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

  // 敵
  for (const e of w.enemies) {
    if (!inView(e.x, e.y, e.type === 'boss' ? 20 : 3)) continue;
    drawEnemy(ctx, e);
  }

  // プレイヤー
  if (!P.dead) {
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.rotate(P.a);
    drawRobot(ctx, P.st.parts, {
      time: w.time, walk: P.walk, hit: P.hit, xray: B.xray,
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

  drawSealedArea(ctx, w);
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

// 未開放の地区：暗幕と封鎖線
function drawSealedArea(ctx, w) {
  if (w.W >= w.FW) return;
  ctx.save();
  ctx.fillStyle = 'rgba(12,9,6,0.62)';
  ctx.fillRect(w.W, 0, w.FW - w.W, w.H);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let x = w.W - w.H; x < w.FW; x += 6) {
    ctx.moveTo(Math.max(w.W, x), Math.max(0, w.W - x));
    ctx.lineTo(Math.min(w.FW, x + w.H), Math.min(w.H, w.FW - x));
  }
  ctx.stroke();
  const pulse = 0.55 + 0.45 * Math.sin(w.time * 4);
  ctx.strokeStyle = `rgba(255,140,40,${0.5 + 0.4 * pulse})`;
  ctx.shadowColor = '#ff8a2a';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([1.5, 1]);
  ctx.beginPath(); ctx.moveTo(w.W, 0); ctx.lineTo(w.W, w.H); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = Math.round(w.W / DISTRICT_W); i < DISTRICTS.length; i++) {
    const cx = (i + 0.5) * DISTRICT_W;
    ctx.fillStyle = 'rgba(255,200,140,0.55)';
    ctx.font = 'bold 4.5px sans-serif';
    ctx.fillText(`${DISTRICTS[i].name}「${DISTRICTS[i].sub}」`, cx, w.H / 2 - 3);
    ctx.font = 'bold 3px sans-serif';
    ctx.fillStyle = 'rgba(255,150,80,0.55)';
    ctx.fillText('封鎖中', cx, w.H / 2 + 3);
  }
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
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  path(1, 0.7, 0.9); ctx.fill();
  ctx.fillStyle = '#6b5440';
  path(1, 0, 0); ctx.fill();
  ctx.fillStyle = '#86694f';
  path(0.72, -0.25, -0.3); ctx.fill();
  ctx.fillStyle = '#9c7d5e';
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
  hudPanel(ctx, 12, 12, 310, 172, '機体ステータス  [頭部A/B テレメトリ]');
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

  // --- 回収鉱石 ---
  hudPanel(ctx, 12, 190, 310, 44, `回収鉱石${w.ores.length ? `   （フィールドに ${w.ores.length}個）` : ''}`);
  ORES.forEach((k, i) => {
    const ox = 22 + i * 100, oy = 216;
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
  const remain = w.enemies.filter(e => e.type !== 'boss').length + (w.phase === 'fight' ? w.queue.length : 0);
  const bossPhase = w.phase === 'warn' || w.phase === 'boss';
  const D = DISTRICTS[w.district];
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#f0c890';
  if (!bossPhase) ctx.fillText(`${D.name}「${D.sub}」  ${w.district + 1} / ${DISTRICTS.length}`, VW / 2, 12);
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
    ctx.fillText(ENEMY_DEFS.boss.name + (w.boss.phase2 ? '（赤熱形態）' : ''), VW / 2, 14);
    hudBar(ctx, bx, 34, bw, 14, w.boss.hp / w.boss.maxHp, w.boss.phase2 ? '#ff4a2a' : '#e08a3a', 'rgba(0,0,0,0.5)');
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
  const mmw = 270, k = mmw / w.FW, mmh = w.H * k, mx = VW - mmw - 12, my = 12;
  hudPanel(ctx, mx, my, mmw, mmh);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(mx + w.W * k, my, (w.FW - w.W) * k, mmh);
  ctx.textAlign = 'center';
  ctx.font = '10px sans-serif';
  DISTRICTS.forEach((Dd, i) => {
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,220,170,0.25)';
      ctx.beginPath(); ctx.moveTo(mx + i * DISTRICT_W * k + 0.5, my); ctx.lineTo(mx + i * DISTRICT_W * k + 0.5, my + mmh); ctx.stroke();
    }
    const sealed = i * DISTRICT_W >= w.W;
    const done = i < w.stats.cleared;
    ctx.fillStyle = sealed ? 'rgba(255,150,80,0.6)' : done ? 'rgba(140,255,170,0.6)' : 'rgba(255,230,180,0.6)';
    ctx.fillText(`${Dd.name}${sealed ? '（封鎖）' : done ? '（掃討済）' : ''}`, mx + (i + 0.5) * DISTRICT_W * k, my + mmh + 3);
  });
  ctx.textAlign = 'left';
  if (w.W < w.FW) {
    ctx.strokeStyle = 'rgba(255,140,40,0.9)';
    ctx.beginPath(); ctx.moveTo(mx + w.W * k + 0.5, my); ctx.lineTo(mx + w.W * k + 0.5, my + mmh); ctx.stroke();
  }
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
  if (B.manual) ctx.fillText('手動操作：WASD 移動 / マウス 照準 / 左クリック 左腕 / 右クリック 右腕', VW / 2, VH - 40);
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
    const last = w.district >= DISTRICTS.length - 1;
    const D = DISTRICTS[w.district];
    const hpPct = Math.round(P.hp / P.maxHp * 100);
    const ammo = ['L', 'R'].map(s => {
      const a = P.arms[s];
      if (a.def.type === 'none') return null;
      return `${s === 'L' ? '左腕' : '右腕'} ${a.def.mag ? (a.reloading > 0 ? 'リロード中' : `${a.ammo}/${a.def.mag}`) : '∞'}`;
    }).filter(Boolean).join(' / ');
    let next;
    if (last) {
      next = `<p class="next boss">次：<b>ボス戦 — ${ENEMY_DEFS.boss.name}</b><br>全地区（第1〜第${DISTRICTS.length}地区）が戦闘フィールドになります。</p>`;
    } else {
      const N = DISTRICTS[w.district + 1];
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
