'use strict';
// =====================================================================
//  洞窟のボス：蒼晶蜘蛛ノクタラクネ
//  天井の暗闇から糸で降りてくる、背に結晶を生やした巨大蜘蛛。
//  跳躍・晶弾の扇射・糸玉（蜘蛛の巣で減速）・落晶（天井の結晶を落とす）・前脚の薙ぎ払い。
//  HP が半分を切ると「晶化暴走」し、連続跳躍・弾数増加・落晶2波・眷属召喚に変わる。
//  見た目は enemy-art.js の ENEMY_ART.spider
// =====================================================================

const SPIDER_LEAP_R = 6.5;   // 跳躍の着地の衝撃範囲（m）
const SPIDER_SWEEP_R = 9;    // 前脚の薙ぎ払いの届く距離（m）
const SPIDER_SWEEP_ARC = 2.4; // 前脚の薙ぎ払いの角度（rad）
const WEB_SLOW = 0.45;       // 蜘蛛の巣の上での機体の速度の倍率

const SPIDER_MOVES = {
  normal: [['leap', 0.3], ['fan', 0.3], ['web', 0.2], ['rain', 0.2]],
  rage: [['leap', 0.3], ['fan', 0.25], ['web', 0.15], ['rain', 0.2], ['summon', 0.1]],
};

// 結晶の弾を1発撃つ
function spiderShard(w, x, y, a, speed, dmg) {
  w.eshots.push({ kind: 'shard', x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 0.4, dmg, life: 3.5 });
}

// 機体の方向へ扇状に撃つ（off で弾の間を半分ずらす）
function spiderFan(w, e, n, spread, speed, dmg, off = 0) {
  const P = w.player, base = Math.atan2(P.y - e.y, P.x - e.x), step = spread / (n - 1);
  for (let i = 0; i < n; i++) {
    const a = base - spread / 2 + (i + off) * step;
    spiderShard(w, e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, a, speed, dmg);
  }
}

// 全方位へ結晶の弾を撃つ
function spiderNova(w, e, n, speed, dmg) {
  const off = rand(0, 1);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + off;
    spiderShard(w, e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, a, speed, dmg);
  }
}

// 糸玉を (tx,ty) へ投げる。着弾点に蜘蛛の巣が張られる
function spiderWebShot(w, e, tx, ty) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1, sp = 20;
  w.eshots.push({ kind: 'web', x: e.x + dx / d * e.r, y: e.y + dy / d * e.r, vx: dx / d * sp, vy: dy / d * sp, r: 0.6, dmg: 6, life: Math.max(0.2, (d - e.r) / sp), web: true });
}

function addWeb(w, x, y) {
  w.webs.push({ x, y, r: 3.6, t: 9, max: 9, rot: rand(0, 6.28) });
  if (w.webs.length > 24) w.webs.shift();
}

// 機体が蜘蛛の巣の上にいるか
function inWeb(w, P) {
  return w.webs.some(wb => wb.t > 0 && Math.hypot(wb.x - P.x, wb.y - P.y) < wb.r);
}

// 天井から結晶を落とす：機体の位置と、その周りの数か所に落下予告を出す
function spiderRain(w, n) {
  const P = w.player;
  for (let i = 0; i < n; i++) {
    let x = P.x, y = P.y;
    if (i > 0) {
      for (let t = 0; t < 10; t++) {
        const a = rand(0, Math.PI * 2), r = rand(4, 15);
        x = P.x + Math.cos(a) * r;
        y = P.y + Math.sin(a) * r;
        if (w.geo.inside(w, x, y, 1)) break;
      }
    }
    const t = 1.3 + i * 0.07;
    w.hazards.push({ kind: 'crystal', x, y, r: 2.6, t, max: t, dmg: 22 });
  }
}

// 落晶の予告と落下（ボスの行動とは別に進む）
function updateHazards(w, dt) {
  const P = w.player;
  for (const h of w.hazards) {
    h.t -= dt;
    if (h.t > 0) continue;
    h.done = true;
    if (!P.dead && Math.hypot(P.x - h.x, P.y - h.y) < h.r + P.r) hurtPlayer(w, h.dmg);
    for (let i = 0; i < 8; i++) {
      const a = rand(0, Math.PI * 2), s = rand(3, 9);
      w.fx.push({ type: 'gib', x: h.x, y: h.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), max: 0.6, size: rand(0.15, 0.3), color: '#9fdcff' });
    }
    w.fx.push({ type: 'ring', x: h.x, y: h.y, life: 0.3, max: 0.3, size: h.r * 1.2 });
    w.decor.push({ x: h.x, y: h.y, s: rand(1, 1.5), rot: rand(0, 6.283), type: 'crystal' });   // 砕けた結晶が残る
    w.shake = Math.max(w.shake, 0.25);
    Sound.play('shatter', { x: h.x, y: h.y });
  }
  if (w.hazards.some(h => h.done)) w.hazards = w.hazards.filter(h => !h.done);
  for (const wb of w.webs) wb.t -= dt;
  if (w.webs.some(wb => wb.t <= 0)) w.webs = w.webs.filter(wb => wb.t > 0);
}

// ---------------------------------------------------------------------
//  行動
// ---------------------------------------------------------------------
function updateSpider(w, e, dt) {
  const P = w.player;
  const dx = P.x - e.x, dy = P.y - e.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const toP = Math.atan2(dy, dx);
  // HP が半分を切ったら晶化暴走。行動を中断して身を震わせ、以後は別の行動パターンになる
  if (!e.phase2 && e.hp < e.maxHp * 0.5 && !e.invuln && !e.airborne) {
    e.phase2 = true;
    e.chain = 0;
    bossSet(e, 'rage', 2);
    w.shake = 0.8;
    w.banner = { title: T('B062' /* {name} 晶化暴走 */, { name: e.def.name }), sub: T('B063' /* 全身の結晶が共鳴 ― 行動パターンが変化した！ */), t: 3 };
    addLog(w, T('B064' /* ボス 形態変化：全身の結晶が青白く共鳴している！ 行動パター… */), '#7ad8ff');
    Sound.play('screech');
    Sound.play('quake');
  }
  const p2 = e.phase2;
  const spd = e.def.speed * (p2 ? 1.3 : 1);
  let dvx = 0, dvy = 0;
  e.st -= dt;

  // 晶化暴走：落晶の2波目（1波目のあとの機体の位置を狙う）
  if (e.rainAgain > 0) {
    e.rainAgain -= dt;
    if (e.rainAgain <= 0) { spiderRain(w, 5); Sound.play('rumble', { x: P.x, y: P.y }); }
  }

  switch (e.state) {
    case 'emerge':
      // 天井から糸を伝って降りてくる（描画側）。着地で地面が揺れる
      e.a = toP;
      if (e.st <= 0) {
        e.invuln = false;
        w.shake = 0.6;
        w.fx.push({ type: 'ring', x: e.x, y: e.y, life: 0.5, max: 0.5, size: 8 });
        Sound.play('slam', { vol: 0.6 });
        bossSet(e, 'chase', 1.5);
      }
      break;
    case 'chase': {
      const [mx, my] = w.geo.dirTo(w, e, P.x, P.y);
      e.a = turnToward(e.a, Math.atan2(my, mx), 3 * dt);
      dvx = Math.cos(e.a) * spd;
      dvy = Math.sin(e.a) * spd;
      if (d < e.r + P.r + 0.4 && e.cd <= 0) { e.cd = 1; hurtPlayer(w, e.def.dmg); }
      if (e.st <= 0) spiderPick(w, e, d);
      break;
    }
    case 'rage': {
      // 晶化暴走：身を震わせて結晶を共鳴させ、最後に結晶を全方位へ撒いて機体を押し返す
      const p = bossWind(e);
      e.a = turnToward(e.a, toP, 1.5 * dt);
      w.shake = Math.max(w.shake, 0.3 * p);
      if (Math.random() < 0.6) {
        w.fx.push({ type: 'gib', x: e.x + rand(-4, 4), y: e.y + rand(-4, 4), vx: rand(-2, 2), vy: rand(-2, 2), life: 0.5, max: 0.5, size: 0.22, color: '#8fe4ff' });
      }
      if (e.st <= 0) {
        w.fx.push({ type: 'ring', x: e.x, y: e.y, life: 0.6, max: 0.6, size: 16 });
        if (d < 14) { P.vx += dx / d * 24; P.vy += dy / d * 24; }
        spiderNova(w, e, 16, 13, 9);
        w.shake = 1;
        Sound.play('shatter');
        Sound.play('shard', { x: e.x, y: e.y });
        bossSet(e, 'chase', 1.2);
      }
      break;
    }
    case 'leap_wind': {
      // 予備動作：脚を縮めてしゃがみ込み、着地点を定める。終盤は着地点を固定して避ける猶予を作る
      e.a = turnToward(e.a, toP, 4 * dt);
      if (bossWind(e) < 0.7) {
        const t = { x: P.x, y: P.y, r: e.r };
        w.geo.clamp(w, t);
        e.tx = t.x; e.ty = t.y;
      }
      if (e.st <= 0) {
        e.lx = e.x; e.ly = e.y;
        e.airborne = true;
        bossSet(e, 'leap', clamp(Math.hypot(e.tx - e.x, e.ty - e.y) / 40, 0.5, 0.9));
        Sound.play('leap', { x: e.x, y: e.y });
      }
      break;
    }
    case 'leap': {
      const p = bossWind(e);
      e.x = e.lx + (e.tx - e.lx) * p;
      e.y = e.ly + (e.ty - e.ly) * p;
      e.vx = e.vy = 0;
      if (e.st <= 0) {
        e.airborne = false;
        if (d < SPIDER_LEAP_R + P.r) {
          hurtPlayer(w, p2 ? 38 : 32);
          P.vx += dx / d * 18;
          P.vy += dy / d * 18;
        }
        w.fx.push({ type: 'ring', x: e.x, y: e.y, life: 0.45, max: 0.45, size: SPIDER_LEAP_R + 1 });
        addScorch(w, e.x, e.y, 4.5, 'rgba(30,40,60,0.35)');
        if (p2) spiderNova(w, e, 12, 12, 9);   // 晶化暴走：着地のたびに結晶が飛び散る
        w.shake = 0.8;
        Sound.play('slam');
        if (e.chain > 0) {
          e.chain--;
          bossSet(e, 'leap_wind', 0.5);
          Sound.play('charge', { vol: 0.6 });
        } else bossSet(e, 'recover', p2 ? 0.7 : 1.0);
      }
      break;
    }
    case 'fan_wind':
      // 予備動作：後脚で立ち上がり、腹部の結晶を光らせる
      e.a = turnToward(e.a, toP, 2 * dt);
      if (e.st <= 0) { bossSet(e, 'fan', 0); e.waves = p2 ? 3 : 2; }
      break;
    case 'fan':
      e.a = turnToward(e.a, toP, 2 * dt);
      if (e.st <= 0) {
        if (p2) spiderFan(w, e, 11, 1.4, 17, 9, e.waves % 2 ? 0.5 : 0);
        else spiderFan(w, e, 7, 1.0, 17, 9);
        Sound.play('shard', { x: e.x, y: e.y });
        e.waves--;
        if (e.waves <= 0) bossSet(e, 'chase', 1.8);
        else bossSet(e, 'fan', 0.4);
      }
      break;
    case 'web_wind':
      // 予備動作：腹部を持ち上げて糸を溜める
      e.a = turnToward(e.a, toP, 2 * dt);
      if (e.st <= 0) {
        const n = p2 ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const a = i / Math.max(1, n - 1) * Math.PI * 2, r = i ? 5 : 0;
          spiderWebShot(w, e, P.x + Math.cos(a) * r, P.y + Math.sin(a) * r);
        }
        Sound.play('web', { x: e.x, y: e.y });
        bossSet(e, 'chase', 1.5);
      }
      break;
    case 'rain_wind':
      // 予備動作：天井へ向けて叫び、空洞を揺らす
      w.shake = Math.max(w.shake, 0.25 * bossWind(e));
      if (e.st <= 0) {
        spiderRain(w, p2 ? 7 : 5);
        if (p2) e.rainAgain = 1.6;
        addLog(w, T('B065' /* 天井の結晶が崩れ落ちてくる！ */), '#9fdcff');
        bossSet(e, 'chase', p2 ? 1.2 : 1.6);
      }
      break;
    case 'sweep_wind':
      // 予備動作：前脚を高く振り上げる
      e.a = turnToward(e.a, toP, 1.5 * dt);
      if (e.st <= 0) {
        if (d < SPIDER_SWEEP_R + P.r && Math.abs(angDiff(toP, e.a)) < SPIDER_SWEEP_ARC / 2) {
          hurtPlayer(w, 34);
          P.vx += dx / d * 20;
          P.vy += dy / d * 20;
        }
        w.fx.push({ type: 'slash', x: e.x, y: e.y, a: e.a, range: SPIDER_SWEEP_R, arc: SPIDER_SWEEP_ARC, life: 0.22, max: 0.22 });
        if (p2) spiderFan(w, e, 9, 1.6, 15, 8);
        w.shake = Math.max(w.shake, 0.4);
        Sound.play('melee', { x: e.x, y: e.y });
        Sound.play('meleeHit', { x: e.x, y: e.y });
        bossSet(e, 'recover', 0.8);
      }
      break;
    case 'summon':
      // 晶化暴走：腹部から卵を産み落とし、眷属が孵る
      if (e.st <= 0) {
        if (w.enemies.length < 120) {
          for (let i = 0; i < 6; i++) {
            const a = i / 6 * Math.PI * 2;
            const m = spawnEnemy(w, 'scarab', { x: e.x + Math.cos(a) * (e.r + 2), y: e.y + Math.sin(a) * (e.r + 2) });
            clampField(w, m);
            m.cd = 1;
            w.fx.push({ type: 'gib', x: m.x, y: m.y, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 0.6, color: '#d8e8ff' });
          }
          addLog(w, T('B066' /* ボスが眷属を孵化させた（+6体） */), '#ffb070');
          Sound.play('summon', { x: e.x, y: e.y });
        }
        bossSet(e, 'chase', 2);
      }
      break;
    case 'recover':
      if (e.st <= 0) bossSet(e, 'chase', p2 ? rand(0.9, 1.5) : rand(1.4, 2.2));
      break;
  }
  if (!e.airborne) {
    const k = Math.min(1, dt * 6);
    e.vx += (dvx - e.vx) * k;
    e.vy += (dvy - e.vy) * k;
  }
  e.walk = (e.walk || 0) + Math.hypot(e.vx, e.vy) * dt;
}

// 次の行動を選ぶ。近くに寄られたら前脚で薙ぎ払う
function spiderPick(w, e, d) {
  const p2 = e.phase2;
  if (d < 8) { bossSet(e, 'sweep_wind', p2 ? 0.65 : 0.85); return; }
  switch (chooseMove(e, SPIDER_MOVES[p2 ? 'rage' : 'normal'])) {
    case 'leap':
      e.chain = p2 ? 2 : 0;   // 晶化暴走は3連続跳躍
      e.tx = w.player.x; e.ty = w.player.y;
      bossSet(e, 'leap_wind', p2 ? 0.8 : 1.0);
      Sound.play('charge', { vol: 0.7 });
      break;
    case 'fan':
      bossSet(e, 'fan_wind', 0.9);
      Sound.play('inhale', { x: e.x, y: e.y });
      break;
    case 'web':
      bossSet(e, 'web_wind', 0.7);
      break;
    case 'rain':
      bossSet(e, 'rain_wind', 0.8);
      Sound.play('screech', { vol: 0.7 });
      break;
    case 'summon':
      bossSet(e, 'summon', 0.8);
      break;
  }
}

// ---------------------------------------------------------------------
//  地面に描くもの：攻撃予告・蜘蛛の巣・落晶
// ---------------------------------------------------------------------
function drawSpiderTelegraph(ctx, w, b) {
  const p = bossWind(b);
  const blink = 0.5 + 0.5 * Math.sin(w.time * 30);
  ctx.save();
  switch (b.state) {
    case 'leap_wind':
    case 'leap': {
      // 着地点：狙いを定めている間は点滅、固定されたら内側が埋まっていく
      const locked = b.state === 'leap' || p >= 0.7;
      ctx.setLineDash([1, 1]);
      ctx.strokeStyle = 'rgba(120,210,255,0.45)';
      ctx.lineWidth = 0.25;
      ctx.beginPath(); ctx.moveTo(b.state === 'leap' ? b.lx : b.x, b.state === 'leap' ? b.ly : b.y); ctx.lineTo(b.tx, b.ty); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(80,190,255,${locked ? 0.14 + 0.1 * blink : 0.06 + 0.06 * blink})`;
      circle(ctx, b.tx, b.ty, SPIDER_LEAP_R); ctx.fill();
      if (locked) {
        const q = b.state === 'leap' ? 0.3 + 0.7 * p : 0.3 * (p - 0.7) / 0.3;
        ctx.fillStyle = 'rgba(80,190,255,0.25)';
        circle(ctx, b.tx, b.ty, SPIDER_LEAP_R * q); ctx.fill();
      }
      ctx.strokeStyle = `rgba(140,220,255,${locked ? 0.85 : 0.45})`;
      ctx.lineWidth = 0.25;
      circle(ctx, b.tx, b.ty, SPIDER_LEAP_R); ctx.stroke();
      break;
    }
    case 'fan_wind': {
      // 扇射の範囲：前方の扇形が濃くなっていく
      const spread = b.phase2 ? 1.4 : 1.0, a = Math.atan2(w.player.y - b.y, w.player.x - b.x);
      ctx.fillStyle = `rgba(80,190,255,${0.05 + 0.15 * p})`;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, 8 + 18 * p, a - spread / 2, a + spread / 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'sweep_wind':
      // 薙ぎ払いの範囲：前方の扇形の内側が埋まっていく
      ctx.fillStyle = `rgba(255,70,60,${0.08 + 0.08 * blink})`;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, SPIDER_SWEEP_R, b.a - SPIDER_SWEEP_ARC / 2, b.a + SPIDER_SWEEP_ARC / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,70,60,0.22)';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, SPIDER_SWEEP_R * p, b.a - SPIDER_SWEEP_ARC / 2, b.a + SPIDER_SWEEP_ARC / 2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'web_wind': {
      // 糸玉の狙い：機体のまわりに照準
      const P = w.player;
      ctx.strokeStyle = `rgba(235,235,255,${0.3 + 0.5 * p})`;
      ctx.lineWidth = 0.2;
      circle(ctx, P.x, P.y, 3 + 3 * (1 - p)); ctx.stroke();
      break;
    }
    case 'rage': {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 14);
      g.addColorStop(0, `rgba(90,200,255,${0.35 * p})`);
      g.addColorStop(1, 'rgba(90,200,255,0)');
      ctx.fillStyle = g;
      circle(ctx, b.x, b.y, 14); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// 蜘蛛の巣（地面）
function drawWebs(ctx, w) {
  ctx.save();
  ctx.lineWidth = 0.07;
  for (const wb of w.webs) {
    const a = Math.min(1, wb.t / 1.5) * 0.75;
    ctx.strokeStyle = `rgba(235,240,255,${a})`;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const t = wb.rot + i / 8 * Math.PI * 2;
      ctx.moveTo(wb.x, wb.y);
      ctx.lineTo(wb.x + Math.cos(t) * wb.r, wb.y + Math.sin(t) * wb.r);
    }
    for (const k of [0.35, 0.65, 0.95]) {
      for (let i = 0; i <= 8; i++) {
        const t = wb.rot + i / 8 * Math.PI * 2, x = wb.x + Math.cos(t) * wb.r * k, y = wb.y + Math.sin(t) * wb.r * k;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

// 落晶の予告（地面の円）と落ちてくる結晶
function drawHazards(ctx, w) {
  ctx.save();
  for (const h of w.hazards) {
    const p = 1 - h.t / h.max;
    ctx.fillStyle = `rgba(120,200,255,${0.08 + 0.08 * Math.sin(w.time * 25)})`;
    circle(ctx, h.x, h.y, h.r); ctx.fill();
    ctx.fillStyle = 'rgba(120,200,255,0.22)';
    circle(ctx, h.x, h.y, h.r * p); ctx.fill();
    ctx.strokeStyle = 'rgba(160,225,255,0.8)';
    ctx.lineWidth = 0.18;
    circle(ctx, h.x, h.y, h.r); ctx.stroke();
    if (h.t < 0.45) {
      // 落ちてくる結晶（真上から降ってくるように、上にずらして大きく描く）
      const k = h.t / 0.45, s = 1 + k * 0.8;
      ctx.save();
      ctx.translate(h.x, h.y - k * 14);
      ctx.scale(s, s);
      ctx.fillStyle = 'rgba(150,215,255,0.9)';
      ctx.strokeStyle = 'rgba(230,250,255,0.9)';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(0, -1.4); ctx.lineTo(0.55, -0.2); ctx.lineTo(0, 0.6); ctx.lineTo(-0.55, -0.2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

BOSS_KINDS.spider = {
  emergeT: 2.4,
  cry: 'screech',
  init() {},
  update: updateSpider,
  telegraph: drawSpiderTelegraph,
};
