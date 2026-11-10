'use strict';
// =====================================================================
//  対戦：ほかの人の機体と、回路どうしで1対1で戦う（闘技場 VS_FIELD・形は field.js の arena）
//   ・対戦用データ（ファイル）：機体名・パーツ・出力配分・ブースターの+値・強化レベル・回路
//     ガレージの「対戦」タブで書き出し、受け取ったファイルを読み込んで対戦相手にする
//   ・戦闘は battle.js の仕組みをそのまま使う。
//     w は自機から見た世界（w.player = 自機、w.enemies = [相手]、w.pshots = 自機の弾、w.eshots = 相手の弾）。
//     相手には w を元にした「相手から見た世界」w.rv を作る（player = 相手、enemies = [自機]、pshots = 相手の弾）。
//     地形・演出・時刻などは w.rv から w を読む（Object.create で w を引き継ぐ）
//   ・機体どうしのダメージは hurtRobot（battle.js の damageEnemy から呼ばれる）
//   ・対戦では鉱石もブースターも手に入らない。読み込んだ相手との勝敗は戦績として残る
// =====================================================================

const VERSUS_FILE = { game: 'iron-wasteland', kind: 'versus', version: 1 };

// HTML に入れる文字列（機体名はほかの人が付けたものなので、必ずこれを通す）
function escHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 機体名：制御文字を除き、前後の空白を取って VS.nameMax 文字まで
function cleanName(s) {
  return [...String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, VS.nameMax).join('');
}

function defaultPilot() { return T('G161' /* 名無しの機兵 */); }

// ---------------------------------------------------------------------
//  対戦用データ
//   機体 m = { name, build（セーブの build と同じ形）, upgrades, program }
//   ファイル = { game, kind: 'versus', version, name, parts: { スロット: パーツid }, armRatio,
//               boost: { スロット: +値 }, upgrades: { パーツid: 強化レベル }（装着しているパーツだけ）, tiles }
// ---------------------------------------------------------------------
function machineToData(m) {
  const b = m.build, parts = {}, boost = {}, upgrades = {};
  for (const s of SLOTS) {
    parts[s.key] = b[s.key];
    const g = slotGear(b, s.key);
    if (g) boost[s.key] = g.bonus;
    const lv = upgradeLevel(m.upgrades, b[s.key]);
    if (lv) upgrades[b[s.key]] = lv;
  }
  return Object.assign({}, VERSUS_FILE, { name: m.name, parts, armRatio: b.armRatio, boost, upgrades, tiles: progToTiles(m.program) });
}

function versusToFile(m) {
  const o = machineToData(m), tiles = o.tiles;
  delete o.tiles;
  return fileWithTiles(o, tiles);
}

// 対戦用データ（ファイルの中身を JSON.parse したもの）から機体を作る。読めなければ null
//   → { m: 機体, skipped（空きマスにしたタイルの数） }
// 他の人が作ったファイルを読むので、項目を1つずつ確かめる。知らないパーツがあれば読まない
function versusFromObj(o) {
  if (!o || typeof o !== 'object' || o.game !== VERSUS_FILE.game || o.kind !== VERSUS_FILE.kind) return null;
  if (!o.parts || typeof o.parts !== 'object' || !Array.isArray(o.tiles)) return null;
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const own = (obj, k) => obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;
  const build = { gear: {} }, upgrades = {};
  for (const s of SLOTS) {
    const id = own(o.parts, s.key);
    const p = PARTS[s.cat].find(q => q.id === id);
    if (!p) return null;
    build[s.key] = id;
    const bn = own(o.boost, s.key);
    if (p.type !== 'none' && isInt(bn, BONUS_MIN, BONUS_MAX)) build.gear[s.key] = { uid: 0, id, bonus: bn };
    const lv = own(o.upgrades, id);
    if (isInt(lv, 1, UPGRADE_MAX)) upgrades[id] = lv;
  }
  const r = typeof o.armRatio === 'number' && isFinite(o.armRatio) ? o.armRatio : 0.5;
  build.armRatio = clampRatio(partById('headReg', build.headReg), Math.round(r * 100) / 100);
  const t = tilesToProg(o.tiles);
  return { m: { name: cleanName(o.name) || defaultPilot(), build, upgrades, program: t.prog }, skipped: t.skipped };
}

function versusFromText(text) {
  try { return versusFromObj(JSON.parse(text)); } catch (e) { return null; }
}

// 自分の機体（slot = 回路の番号。省くと選んでいる回路）
function myMachine(save, slot) {
  const prog = slot == null || slot === save.progSlot ? save.program : save.programs[slot];
  return { name: save.pilot || defaultPilot(), build: save.build, upgrades: save.upgrades, program: prog };
}

// 強化とブースターを外した機体（「強化とブースターを無効にする」ルール）
function flatMachine(m) {
  return Object.assign({}, m, { build: Object.assign({}, m.build, { gear: {} }), upgrades: {} });
}

// 選べる対戦相手：読み込んだ相手 → 練習相手（自分の機体の回路1〜3）
//   → [{ id, m: 機体, rival: セーブの rivals の項目（練習相手は null）, self: 回路の番号 }]
function vsOpponents(save) {
  const list = [];
  for (const r of save.rivals) {
    const v = versusFromObj(r.data);
    if (v) list.push({ id: r.id, m: v.m, rival: r, self: null });
  }
  for (let i = 0; i < PROG_SLOTS; i++) {
    const m = myMachine(save, i);
    list.push({ id: 'self' + i, m: Object.assign({}, m, { name: T('G168' /* {name}（回路{n}） */, { name: m.name, n: i + 1 }) }), rival: null, self: i });
  }
  return list;
}

// ---------------------------------------------------------------------
//  闘技場の世界
// ---------------------------------------------------------------------
function newVsStats() {
  // lost = 相手をセンサーで捉えられなかった時間（秒）
  return { shots: { L: 0, R: 0 }, hits: { L: 0, R: 0 }, dmgBy: { L: 0, R: 0 }, dmgDealt: 0, dmgTaken: 0, distance: 0, lost: 0 };
}

function createVersusWorld(save, opp, flat) {
  const me = flat ? flatMachine(myMachine(save)) : myMachine(save);
  const foe = flat ? flatMachine(opp.m) : opp.m;
  const w = createDuelWorld(VS_FIELD, VS, me, foe);
  w.flat = flat;
  w.opp = { id: opp.id, self: opp.self, name: foe.name };
  addLog(w, T('B096' /* 対戦開始：{me} VS {foe} */, { me: me.name, foe: foe.name }), '#9fe0b0');
  if (flat) addLog(w, T('B109' /* ルール：強化・ブースター無効 */), '#c9a0ff');
  return w;
}

// 1対1の世界（対戦・地底エリア abyss.js で共通）。F = フィールド、cfg = 時間と広さ（VS / ABYSS）、me / foe = 機体
function createDuelWorld(F, cfg, me, foe) {
  const geo = FIELD_SHAPES[F.shape];
  const { FW, H } = geo.size(F);
  const w = {
    vs: true, cfg, field: F, floor: 1, fm: floorMul(1), geo, FW, H, district: 0, open: 1, full: true, perDistrict: 0,
    time: 0, act: 0, enemies: [], pshots: [], fx: [], scorch: [], rocks: [], decor: [], webs: [], hazards: [], queue: [],
    phase: 'fight', boss: null, log: [], result: null, endT: 0, shake: 0, banner: null,
    program: me.program, ores: [], ore: emptyOre(), orePulse: {}, loot: [], parts: [], partPulse: 0,
    veins: [], surge: { state: 'idle', t: Infinity, k: 0, ph: 0 },   // 対戦に大地の脈動は起きない（地底エリアは abyss.js で起こす）
    stats: newVsStats(),
    vsT: -cfg.count,           // 対戦の経過時間（開始前のカウントダウン中は負）
    arenaR: cfg.r0,            // 電磁柵の内側の半径
    flat: false, opp: { name: foe.name }, meName: me.name, shrinkLogged: false,
  };
  w.root = w;
  const c = FW / 2;
  w.start = { x: c - cfg.gap / 2, y: c, a: 0 };
  geo.init(w);

  const P = w.player = createPlayer(me);
  const R = w.rival = createPlayer(foe);
  P.x = c - cfg.gap / 2; P.y = c; P.a = 0;
  R.x = c + cfg.gap / 2; R.y = c; R.a = Math.PI;
  P.robot = R.robot = true;
  R.rival = true;
  w.enemies = [R];

  // 相手から見た世界（自機の世界を引き継ぎ、自分と相手・弾・記録・ログだけ入れ替える）
  const rv = w.rv = Object.create(w);
  rv.player = R;
  rv.enemies = [P];
  rv.pshots = [];
  rv.stats = newVsStats();
  rv.log = [];        // 相手のログ（弾切れなど）は表示しない
  rv.shake = 0;       // 相手の砲撃・着地では画面を揺らさない
  Object.defineProperty(w, 'eshots', { get: () => rv.pshots, set() {} });
  Object.defineProperty(rv, 'eshots', { get: () => w.pshots, set() {} });

  // 岩：中心に対して点対称に置く（どちらの開始位置からも同じ地形になる）
  for (let i = 0, tries = 0; i < F.rockPairs && tries < 300; tries++) {
    const r = rand(F.rockR[0], F.rockR[1]), d = rand(7, cfg.r0 - r - 4), a = rand(0, Math.PI * 2);
    const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, mx = 2 * c - x, my = 2 * c - y;
    if (Math.hypot(x - mx, y - my) < 2 * r + 4.5) continue;
    if ([P, R].some(o => Math.hypot(o.x - x, o.y - y) < r + 7 || Math.hypot(o.x - mx, o.y - my) < r + 7)) continue;
    if (w.rocks.some(k => Math.hypot(k.x - x, k.y - y) < k.r + r + 4.5 || Math.hypot(k.x - mx, k.y - my) < k.r + r + 4.5)) continue;
    const pts = rockPoints(r), cave = !!F.dark;
    w.rocks.push({ x, y, r, pts, cave });
    w.rocks.push({ x: mx, y: my, r, pts: pts.map(([px, py]) => [-px, -py]), cave });
    i++;
  }
  for (let i = 0; i < F.decorN; i++) {
    const { x, y } = geo.randomPoint(w, 0, 0.5);
    w.decor.push({ x, y, s: rand(0.5, 1.5), rot: rand(0, 6.283), type: pick(F.decor) });
  }
  return w;
}

// 経過時間 t の電磁柵の半径（cfg = VS / ABYSS）
function vsArenaR(cfg, t) {
  const k = clamp((t - cfg.shrinkAt) / (cfg.shrinkEnd - cfg.shrinkAt), 0, 1);
  return cfg.r0 + (cfg.rMin - cfg.r0) * k;
}

const RIVAL_INPUT = { manual: false };

function simulateVersus(w, dt, inp) {
  w.time += dt;
  w.shake = Math.max(0, w.shake - dt * 2.5);
  if (w.banner) { w.banner.t -= dt; if (w.banner.t <= 0) w.banner = null; }
  const P = w.player, R = w.rival, rv = w.rv, C = w.cfg;
  if (w.vsT < 0) {
    // 開始前のカウントダウン（3・2・1 → FIGHT）
    const before = Math.ceil(-w.vsT);
    w.vsT = Math.min(0, w.vsT + dt);
    if (Math.ceil(-w.vsT) !== before) Sound.play(w.vsT >= 0 ? 'siren' : 'radio');
    if (w.vsT >= 0) w.vsT = 1e-9;
  } else if (!w.result) {
    w.vsT += dt;
    w.act = w.vsT;
    updatePlayer(w, P, dt, inp);
    // 地底エリア：脈動中の地底のマシンは回路の処理速度が最大 ×ABYSS.surge（abyss.js）
    if (w.abyss) R.vm.period = 1 / (R.st.clock * abyssSurgeMul(w));
    updatePlayer(rv, R, dt, RIVAL_INPUT);
    // 相手をセンサーで捉えられていない時間（レポートの所見に使う）
    const d = Math.hypot(P.x - R.x, P.y - R.y);
    if (d - R.r > P.st.sensor) w.stats.lost += dt;
    if (d - P.r > R.st.sensor) rv.stats.lost += dt;
    // 電磁柵（地底エリアでは結界）が狭まる
    w.arenaR = vsArenaR(C, w.vsT);
    if (!w.shrinkLogged && w.vsT >= C.shrinkAt) {
      w.shrinkLogged = true;
      const msg = w.abyss ? T('B133' /* 聖域の結界が収縮を開始！ */) : T('B097' /* 外周の電磁柵が収縮を開始！ */);
      addLog(w, msg, '#ffb070');
      w.banner = { title: msg, sub: '', t: 2.5 };
      Sound.play('siren');
    }
    if (w.vsT >= C.time) {
      // 時間切れ：残りHPの割合で判定（差が 0.5% 未満なら引き分け）
      const kp = P.hp / P.maxHp, kr = R.hp / R.maxHp;
      addLog(w, T('B100' /* 時間切れ。残りHPの割合で判定する。 */), '#ffd24a');
      vsEnd(w, Math.abs(kp - kr) < 0.005 ? 'draw' : kp > kr ? 'win' : 'lose', 'time');
    }
  } else {
    for (const o of [P, R]) { o.vx *= 0.9; o.vy *= 0.9; o.action = null; }
  }
  if (w.abyss && w.vsT >= 0) updateSurge(w, dt);   // 地底エリア：大地の脈動（abyss.js）
  updatePlayerShots(w, dt);
  updatePlayerShots(rv, dt);
  // 機体どうしの押し合い（ジャンプ中は飛び越える）
  if (!P.dead && !R.dead && !(P.air > 0) && !(R.air > 0)) {
    const dx = R.x - P.x, dy = R.y - P.y, d = Math.hypot(dx, dy), rr = P.r + R.r;
    if (d < rr && d > 0.0001) {
      const ov = (rr - d) / 2, ux = dx / d, uy = dy / d;
      P.x -= ux * ov; P.y -= uy * ov;
      R.x += ux * ov; R.y += uy * ov;
    }
  }
  for (const o of [P, R]) {
    if (!(o.air > 0)) collideRocks(w, o);
    clampField(w, o);
  }
  updateFx(w, dt);
  if (w.result) w.endT += dt;
}

// 機体へのダメージ（w = 撃った側から見た世界）。防御で軽減、ジャンプ中は無敵
function hurtRobot(w, R, dmg, side) {
  const root = w.root;
  if (root.result || R.dead || R.air > 0) return;
  const real = Math.min(R.hp, dmg * root.cfg.dmg * 100 / (100 + R.st.def * 4));
  if (real <= 0) return;
  R.hp -= real;
  R.hit = 0.12;
  w.stats.dmgDealt += real;
  w.stats.dmgBy[side] += real;
  const mine = R === root.player;
  (mine ? root.stats : root.rv.stats).dmgTaken += real;
  if (mine) {
    Sound.play('hurt');
    root.shake = Math.max(root.shake, Math.min(0.6, real / 40));
    const pct = R.hp / R.maxHp * 100;
    for (const th of [75, 50, 25, 10]) {
      if (R.hpWarn > th && pct <= th) {
        R.hpWarn = th;
        addLog(root, T('B023' /* 警告：機体損傷 HP {th}% 以下 */, { th }), '#ff7a5a');
        Sound.play('alarm');
      }
    }
  } else Sound.play('hit', { x: R.x, y: R.y });
  if (R.hp <= 0.0001) {
    R.hp = 0;
    R.dead = true;
    for (let i = 0; i < 10; i++) {
      root.fx.push({ type: 'boom', x: R.x + rand(-2, 2), y: R.y + rand(-2, 2), life: rand(0.5, 1.3), max: 1.3, size: rand(1.5, 3.5) });
    }
    addScorch(root, R.x, R.y, 2.2, 'rgba(25,18,12,0.5)');
    root.shake = 1.5;
    Sound.play('die');
    vsEnd(root, mine ? 'lose' : 'win', 'ko');
  }
}

// 決着。result = win / lose / draw、reason = ko（撃破）/ time（時間切れ判定）/ surrender（降参）
function vsEnd(w, result, reason) {
  w = w.root || w;
  if (w.result) return;
  w.result = result;
  w.vsReason = reason;
  w.endT = 0;
  const foe = w.opp.name, me = w.meName;
  if (reason === 'surrender') addLog(w, w.abyss ? T('B020' /* 撤退信号を受信。戦域を離脱する。 */) : T('B101' /* 降参した。 */), '#ffd24a');
  else if (result === 'win') addLog(w, T('B098' /* {name} を撃破！ */, { name: foe }), '#9fffb0');
  else if (result === 'lose') addLog(w, T('B099' /* 機体大破……{name} の勝利。 */, { name: foe }), '#ff6a4a');
  else addLog(w, T('B102' /* 引き分け。{me} と {foe} は互角だった。 */, { me, foe }), '#ffd24a');
  Sound.stopBgm(result === 'lose' ? 0.3 : 1);
  Sound.play({ win: 'win', lose: 'lose', draw: 'retreat' }[result]);
}

// ---------------------------------------------------------------------
//  HUD
// ---------------------------------------------------------------------
// 相手の枠の見出し
function vsFoeTitle(w) {
  return w.abyss ? T('B134' /* 地底のマシン：{name} */, { name: w.opp.name }) : T('B103' /* 対戦相手：{name} */, { name: w.opp.name });
}

// 柵（地底エリアでは結界）の状態 { txt, col }
function vsFenceLine(w) {
  const C = w.cfg, t = Math.max(0, w.vsT);
  if (t < C.shrinkAt) {
    const left = fmtClock(C.shrinkAt - t);
    return { col: '#9adcf0', txt: w.abyss ? T('B135' /* 結界の収縮まで {t} */, { t: left }) : T('B107' /* 電磁柵の収縮まで {t} */, { t: left }) };
  }
  const r = Math.round(w.arenaR);
  return { col: '#ff9a6a', txt: w.abyss ? T('B136' /* 結界 収縮中（半径 {r}m） */, { r }) : T('B108' /* 電磁柵 収縮中（半径 {r}m） */, { r }) };
}

// 残り時間・柵の下に並べる行：ルール / 地底エリアの層と脈動共鳴
function vsInfoLines(w) {
  const L = [];
  if (w.flat) L.push({ txt: T('B109' /* ルール：強化・ブースター無効 */), col: '#c9a0ff' });
  if (w.abyss) {
    L.push({ txt: `${T('C014' /* {name}「{sub}」 */, { name: floorName(w.abyss.floor), sub: w.abyss.mech.sub })}  ${T('C029' /* レベル{n} */, { n: w.abyss.lv })}`, col: '#cbbd9c' });
    if (w.surge.k > 0.05 && !w.result) {
      const p = 0.5 + 0.5 * Math.sin(w.time * 8);
      L.push({ txt: T('B137' /* 脈動共鳴：{name} 回路の処理速度×{k} */, { name: w.opp.name, k: ABYSS.surge }), col: `rgb(255,${(70 + 70 * p) | 0},${(50 + 40 * p) | 0})` });
    }
  }
  return L;
}

function drawVersusHUD(ctx, w, B, VW, VH) {
  if (B.compact) { drawVersusHUDCompact(ctx, w, B, VW, VH); return; }
  const P = w.player, R = w.rival;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  // 2機のステータス（左上 = 自機、右上 = 相手）
  drawMechPanel(ctx, P, 12, 12, T('B104' /* 自機：{name} */, { name: w.meName }), B.manual);
  drawMechPanel(ctx, R, VW - 322, 12, vsFoeTitle(w), false);

  // 上の中央：残り時間と電磁柵
  ctx.textAlign = 'center';
  const left = w.cfg.time - Math.max(0, w.vsT);
  const urgent = left <= 10 && !w.result && w.vsT > 0;
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = urgent ? `rgb(255,${(90 + 60 * (0.5 + 0.5 * Math.sin(w.time * 10))) | 0},60)` : '#f2e6c8';
  ctx.fillText(fmtClock(left), VW / 2, 12);
  ctx.font = 'bold 12px sans-serif';
  const fl = vsFenceLine(w);
  ctx.fillStyle = fl.col;
  ctx.fillText(fl.txt, VW / 2, 44);
  let iy = 62;
  for (const ln of vsInfoLines(w)) {
    ctx.fillStyle = ln.col;
    ctx.fillText(ln.txt, VW / 2, iy);
    iy += 18;
  }

  // 回路モニター（右下 = 自機、その左 = 相手）
  const mon = (M, right, title, pc) => {
    const grid = M.st.grid, cs = Math.floor(180 / grid), cw = cs * grid;
    const cx = right - cw, cy = VH - cw - 40;
    hudPanel(ctx, cx - 8, cy - 26, cw + 16, cw + 34, title);
    drawCircuit(ctx, M.vm.prog, grid, cx, cy, cs, { pc });
    return cx - 8;
  };
  const x1 = mon(P, VW - 16, T('B045' /* 回路モニター {grid}×{grid} @{clock}H… */, { grid: P.st.grid, clock: fmtNum(P.st.clock) }),
    B.manual ? null : { x: P.vm.x, y: P.vm.y });
  if (B.manual) {
    const grid = P.st.grid, cw = Math.floor(180 / grid) * grid;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(VW - 16 - cw, VH - cw - 40, cw, cw);
    ctx.fillStyle = '#ffd24a';
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(T('B046' /* 手動操作中 */), VW - 16 - cw / 2, VH - cw / 2 - 48);
  }
  mon(R, x1 - 12, T('B105' /* 相手の回路 {grid}×{grid} @{clock}Hz */, { grid: R.st.grid, clock: fmtNum(Math.round(1 / R.vm.period * 10) / 10) }), { x: R.vm.x, y: R.vm.y });   // 脈動中は速くなった処理速度

  drawLogPanel(ctx, w, VW, VH);

  // 操作説明
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(240,230,210,0.8)';
  ctx.textAlign = 'center';
  if (!B.touchUI) ctx.fillText(w.abyss ? T('B138' /* [Space]一時停止 [1/2/3]速度 [M]手動/回路… */) : T('B106' /* [Space]一時停止 [1/2/3]速度 [M]手動/回路… */), VW / 2, VH - 22);
  if (B.manual) ctx.fillText(P.st.jump ? T('B082' /* 手動操作：WASD 移動 / マウス 照準 / 左クリック … */) : T('B081' /* 手動操作：WASD 移動 / マウス 照準 / 左クリック … */), VW / 2, VH - 40);
  if (B.speed !== 1) {
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(`×${B.speed}`, VW / 2, Math.max(80, iy + 2));
  }

  // 開始前のカウントダウン → FIGHT
  ctx.textBaseline = 'middle';
  if (w.vsT < 0 || (w.vsT < 1 && !w.result)) {
    const n = Math.ceil(-w.vsT);
    const k = w.vsT < 0 ? (-w.vsT) % 1 || 1 : 1 - w.vsT;   // 数字ごとに大きく出て縮む
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, VH / 2 - 60, VW, 120);
    ctx.font = `bold ${Math.round(56 + 40 * k)}px sans-serif`;
    ctx.fillStyle = w.vsT < 0 ? '#f2e6c8' : `rgba(255,210,74,${Math.min(1, k * 2)})`;
    ctx.fillText(w.vsT < 0 ? String(n) : 'FIGHT!', VW / 2, VH / 2);
    if (w.vsT < 0) {
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = '#cbbd9c';
      ctx.fillText(`${w.meName}  VS  ${w.opp.name}`, VW / 2, VH / 2 - 80);
    }
  } else if (w.banner && !w.result) {
    const a = Math.min(1, w.banner.t, (2.5 - w.banner.t) * 3);
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    const sub = w.banner.sub;
    ctx.fillRect(0, VH * 0.28 - 30, VW, sub ? 84 : 60);
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = '#ffb070';
    ctx.fillText(w.banner.title, VW / 2, VH * 0.28);
    if (sub) {
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = '#ffd0b0';
      ctx.fillText(sub, VW / 2, VH * 0.28 + 32);
    }
    ctx.globalAlpha = 1;
  }
  // 一時停止中の暗幕と「PAUSE」の文字は一時停止メニュー（#pause-menu）が出す
  if (w.result) {
    const txt = { win: 'VICTORY', lose: 'DEFEAT', draw: 'DRAW' }[w.result];
    const col = { win: '#9fffb0', lose: '#ff6a4a', draw: '#ffd24a' }[w.result];
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, VH / 2 - 45, VW, 90);
    ctx.font = 'bold 46px sans-serif';
    ctx.fillStyle = col;
    ctx.fillText(txt, VW / 2, VH / 2);
  }
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
}

// 狭い画面（スマートフォンなど）の対戦 HUD：上に2機の小さなステータス、その下に残り時間。
// 回路モニターは自機の分だけ（相手の回路・操作説明は省く）
function drawVersusHUDCompact(ctx, w, B, VW, VH) {
  const P = w.player, R = w.rival, pad = HUD_PAD;
  const pw = Math.min(230, (VW - pad * 3) / 2);
  const a = drawMechMini(ctx, P, pad, pad, pw, T('B104' /* 自機：{name} */, { name: w.meName }));
  const b = drawMechMini(ctx, R, VW - pad - pw, pad, pw, vsFoeTitle(w));
  // 2機の枠の間に入りきれば上の中央、入らなければ枠の下に残り時間
  const gap = VW - pw * 2 - pad * 4;
  let y = gap >= 110 ? pad : Math.max(a.bottom, b.bottom) + 6;
  const tw = gap >= 110 ? gap : VW - pad * 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const left = w.cfg.time - Math.max(0, w.vsT);
  const urgent = left <= 10 && !w.result && w.vsT > 0;
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = urgent ? `rgb(255,${(90 + 60 * (0.5 + 0.5 * Math.sin(w.time * 10))) | 0},60)` : '#f2e6c8';
  ctx.fillText(fmtClock(left), VW / 2, y);
  y += 26;
  ctx.font = 'bold 11px sans-serif';
  for (const ln of [vsFenceLine(w), ...vsInfoLines(w)]) {
    ctx.fillStyle = ln.col;
    ctx.fillText(clipText(ctx, ln.txt, tw), VW / 2, y);
    y += 15;
  }
  if (B.speed !== 1) {
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(`×${B.speed}`, VW / 2, y);
  }

  drawCompactBottom(ctx, w, B, VW, VH, P.vm.prog);

  // 開始前のカウントダウン → FIGHT
  if (w.vsT < 0 || (w.vsT < 1 && !w.result)) {
    const n = Math.ceil(-w.vsT);
    const k = w.vsT < 0 ? (-w.vsT) % 1 || 1 : 1 - w.vsT;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, VH / 2 - 50, VW, 100);
    drawCompactCenter(ctx, VW, VH / 2, w.vsT < 0 ? String(n) : 'FIGHT!',
      w.vsT < 0 ? '#f2e6c8' : `rgba(255,210,74,${Math.min(1, k * 2)})`, Math.round(48 + 30 * k));
    if (w.vsT < 0) {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#cbbd9c';
      ctx.textAlign = 'center';
      ctx.fillText(clipText(ctx, `${w.meName}  VS  ${w.opp.name}`, VW - 24), VW / 2, VH / 2 - 76);
    }
  } else if (w.banner && !w.result) {
    const al = Math.min(1, w.banner.t, (2.5 - w.banner.t) * 3);
    ctx.globalAlpha = Math.max(0, al);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, VH * 0.36 - 26, VW, w.banner.sub ? 76 : 52);
    drawCompactCenter(ctx, VW, VH * 0.36, w.banner.title, '#ffb070', 22);
    if (w.banner.sub) drawCompactCenter(ctx, VW, VH * 0.36 + 30, w.banner.sub, '#ffd0b0', 13);
    ctx.globalAlpha = 1;
  }
  // 一時停止中の暗幕と「PAUSE」の文字は一時停止メニュー（#pause-menu）が出す
  if (w.result) {
    const txt = { win: 'VICTORY', lose: 'DEFEAT', draw: 'DRAW' }[w.result];
    const col = { win: '#9fffb0', lose: '#ff6a4a', draw: '#ffd24a' }[w.result];
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, VH / 2 - 36, VW, 72);
    drawCompactCenter(ctx, VW, VH / 2, txt, col, 40);
  }
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
}
