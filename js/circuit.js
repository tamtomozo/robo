'use strict';
// =====================================================================
//  回路プログラム：実行VM と キャンバス描画
//  ・STARTから矢印に沿って1クロックに1タイルずつ実行
//  ・判定タイルは YES(緑) / NO(赤) で分岐
//  ・空きマスや回路盤の外に出るとSTARTに戻る
//  ・移動系コマンドは動作が終わるまで次のタイルに進まない
// =====================================================================

function getTile(prog, x, y, grid) {
  if (x < 0 || y < 0 || x >= grid || y >= grid) return null;
  return prog[y * MAX_GRID + x];
}

// STARTから矢印をたどって到達できるタイルの位置（判定タイルは YES・NO 両方の出口をたどる）
function reachableTiles(prog, grid) {
  const seen = new Set(), stack = [[0, 0]];
  while (stack.length) {
    const [x, y] = stack.pop();
    const t = getTile(prog, x, y, grid);
    if (!t) continue;
    const i = y * MAX_GRID + x;
    if (seen.has(i)) continue;
    seen.add(i);
    const dirs = TILE_DEFS[t.t].kind === 'cond' ? [t.d, t.n] : [t.d];
    for (const d of dirs) stack.push([x + DX[d], y + DY[d]]);
  }
  return seen;
}

// 回路盤の中にあるのに、STARTから到達できない（決して実行されない）タイルの位置
// 回路盤の外のタイルは、大きい頭部Aに付け替えたとき用に残すので含めない
function orphanTiles(prog, grid) {
  const reach = reachableTiles(prog, grid), out = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const i = y * MAX_GRID + x;
      if (prog[i] && !reach.has(i)) out.push(i);
    }
  }
  return out;
}

// ---------------------------------------------------------------------
//  回路のファイル（書き出し・読み込み）
//   ・形式：{ game, kind: 'circuit', version, tiles: [{ x, y, t, d, n, p }, …] }（空きマスは書かない）
//   ・回路盤の外のタイルも含め、10×10 をそのまま書き出す（小さい頭部で読み込んでも外側が使われないだけ）
// ---------------------------------------------------------------------
const CIRCUIT_FILE = { game: 'iron-wasteland', kind: 'circuit', version: 1 };

// 回路 → ファイルに書くタイルの並び（空きマスは書かない。対戦用データ versus.js でも使う）
function progToTiles(prog) {
  const tiles = [];
  for (let y = 0; y < MAX_GRID; y++) {
    for (let x = 0; x < MAX_GRID; x++) {
      const t = prog[y * MAX_GRID + x];
      if (t) tiles.push({ x, y, t: t.t, d: t.d, n: t.n, p: t.p });
    }
  }
  return tiles;
}

// 中身を見て分かるよう、タイル1枚を1行にする（head = タイルより前に書く項目）
function fileWithTiles(head, tiles) {
  const h = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n');
  return `{${h},\n"tiles":[\n${tiles.map(t => JSON.stringify(t)).join(',\n')}\n]}\n`;
}

function circuitToFile(prog) {
  return fileWithTiles(CIRCUIT_FILE, progToTiles(prog));
}

// ファイルの文字列から回路を作る。回路のファイルでなければ null
//   → { prog, skipped（空きマスにしたタイルの数） }
function circuitFromFile(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return null; }
  if (!o || o.game !== CIRCUIT_FILE.game || o.kind !== CIRCUIT_FILE.kind || !Array.isArray(o.tiles)) return null;
  return tilesToProg(o.tiles);
}

// タイルの並び → 回路。他の人が作ったファイルや手で書き換えたファイルも読むので、
// タイルを1枚ずつ確かめ、おかしなものは空きマスにする → { prog, skipped（空きマスにしたタイルの数） }
function tilesToProg(tiles) {
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const prog = new Array(MAX_GRID * MAX_GRID).fill(null);
  let skipped = 0;
  for (const s of tiles) {
    const def = s && Object.prototype.hasOwnProperty.call(TILE_DEFS, s.t) && TILE_DEFS[s.t];
    const i = def && isInt(s.x, 0, MAX_GRID - 1) && isInt(s.y, 0, MAX_GRID - 1) ? s.y * MAX_GRID + s.x : -1;
    // START は左上に1つだけ（左上には必ず START を置く）。同じマスに2枚あれば後のものは捨てる
    if (i < 0 || prog[i] || (s.t === 'start') !== (i === 0) || !isInt(s.d, 0, 3)) { skipped++; continue; }
    const p = def.params ? (isInt(s.p, 0, def.params.length - 1) ? s.p : (def.dp || 0)) : 0;
    prog[i] = { t: s.t, d: s.d, n: isInt(s.n, 0, 3) ? s.n : 1, p };
  }
  if (!prog[0]) prog[0] = { t: 'start', d: 2, n: 1, p: 0 };
  return { prog, skipped };
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

class CircuitVM {
  constructor(prog, grid, clock) {
    this.prog = prog;
    this.grid = grid;
    this.period = 1 / clock;
    this.x = 0; this.y = 0;
    this.timer = 0;
    this.counts = new Array(MAX_GRID * MAX_GRID).fill(0);
    this.steps = 0;
    this.lastResult = null;
  }

  update(dt, P, w) {
    this.timer += dt;
    let guard = 0;
    while (this.timer >= this.period && guard++ < 40) {
      if (P.action && P.action.block) { this.timer = Math.min(this.timer, this.period); return; }
      this.timer -= this.period;
      this.exec(P, w);
    }
  }

  exec(P, w) {
    const tile = getTile(this.prog, this.x, this.y, this.grid);
    if (!tile) { this.x = 0; this.y = 0; return; }
    this.counts[this.y * MAX_GRID + this.x]++;
    this.steps++;
    const def = TILE_DEFS[tile.t];
    let dir = tile.d;
    if (def.kind === 'cond') {
      const ok = evalCond(tile, P, w);
      this.lastResult = ok;
      dir = ok ? tile.d : tile.n;
    } else if (def.kind === 'cmd') {
      execCmd(tile, P, w);
    }
    this.x += DX[dir];
    this.y += DY[dir];
  }
}

function sensedEnemies(w, P) {
  const r = P.st.sensor;
  return w.enemies.filter(e => Math.hypot(e.x - P.x, e.y - P.y) - e.r <= r);
}

function nearestEnemy(w, P, maxD) {
  let best = null, bd = Infinity;
  for (const e of w.enemies) {
    const d = Math.hypot(e.x - P.x, e.y - P.y) - e.r;
    if (d < bd && d <= maxD) { bd = d; best = e; }
  }
  return best ? { e: best, d: bd } : null;
}

function evalCond(tile, P, w) {
  const def = TILE_DEFS[tile.t];
  const prm = def.params ? def.params[tile.p] : 0;
  switch (tile.t) {
    case 'c_near': {
      const n = nearestEnemy(w, P, Math.min(prm, P.st.sensor));
      return !!n;
    }
    case 'c_front': {
      const lim = prm * Math.PI / 180;
      for (const e of sensedEnemies(w, P)) {
        if (Math.abs(angDiff(Math.atan2(e.y - P.y, e.x - P.x), P.a)) <= lim) return true;
      }
      return false;
    }
    case 'c_left': {
      const n = nearestEnemy(w, P, P.st.sensor);
      if (!n) return false;
      return angDiff(Math.atan2(n.e.y - P.y, n.e.x - P.x), P.a) < 0;
    }
    case 'c_count': return sensedEnemies(w, P).length >= prm;
    case 'c_hp': return P.hp / P.maxHp * 100 <= prm;
    case 'c_ready_l': return armReady(P.arms.L);
    case 'c_ready_r': return armReady(P.arms.R);
    case 'c_jump': return canJump(P);
    case 'c_boss': return !!(w.boss && w.boss.hp > 0);
    case 'c_rand': return Math.random() * 100 < prm;
    case 'c_proj': {
      for (const s of w.eshots) {
        const dx = P.x - s.x, dy = P.y - s.y;
        if (Math.hypot(dx, dy) <= prm + P.r && dx * s.vx + dy * s.vy > 0) return true;
      }
      return false;
    }
  }
  return false;
}

function armReady(arm) {
  return arm.def.type !== 'none' && arm.reloading <= 0;
}

function execCmd(tile, P, w) {
  switch (tile.t) {
    case 'move_f':   P.action = { type: 'move', thrust: 1, strafe: 0, t: 0.35, block: true }; break;
    case 'move_b':   P.action = { type: 'move', thrust: -0.75, strafe: 0, t: 0.35, block: true }; break;
    case 'strafe_l': P.action = { type: 'move', thrust: 0, strafe: -1, t: 0.35, block: true }; break;
    case 'strafe_r': P.action = { type: 'move', thrust: 0, strafe: 1, t: 0.35, block: true }; break;
    case 'turn_l':   P.action = { type: 'turn', dir: -1, t: 0.18, block: true }; break;
    case 'turn_r':   P.action = { type: 'turn', dir: 1, t: 0.18, block: true }; break;
    case 'face':     P.action = { type: 'face', t: 0.6, block: true }; break;
    case 'jump':
      // 跳べないとき（脚部 Lv5 以下・再使用待ち）は何もせず次のタイルへ。跳んだら着地まで待つ
      if (startJump(w, P, jumpAngle(w, P, tile.p))) P.action = { type: 'jump', t: P.airMax, block: true };
      break;
    case 'wait':     P.action = { type: 'wait', t: 0.3, block: true }; break;
    case 'fire_l':   P.arms.L.trigger = 0.6; break;
    case 'fire_r':   P.arms.R.trigger = 0.6; break;
    case 'fire_both': P.arms.L.trigger = 0.6; P.arms.R.trigger = 0.6; break;
    case 'power': {
      const v = TILE_DEFS.power.params[tile.p] / 100;
      setPlayerRatio(w, P, v, true);
      break;
    }
  }
}

// ---------------------------------------------------------------------
//  キャンバスに回路盤を描く（戦闘中モニター・レポート用）
// ---------------------------------------------------------------------
function drawCircuit(ctx, prog, grid, x0, y0, cs, opts = {}) {
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,12,0.85)';
  ctx.fillRect(x0 - 4, y0 - 4, grid * cs + 8, grid * cs + 8);
  let maxC = 1;
  if (opts.counts) for (const c of opts.counts) maxC = Math.max(maxC, c);
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const px = x0 + x * cs, py = y0 + y * cs;
      ctx.strokeStyle = 'rgba(90,140,110,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
      const tile = prog[y * MAX_GRID + x];
      if (!tile) continue;
      const def = TILE_DEFS[tile.t];
      ctx.fillStyle = GROUP_COLORS[def.group];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(px + 2, py + 2, cs - 4, cs - 4);
      ctx.globalAlpha = 1;
      if (opts.counts) {
        const h = opts.counts[y * MAX_GRID + x] / maxC;
        if (h > 0) {
          ctx.fillStyle = `rgba(255,${Math.round(220 - 180 * h)},40,${0.15 + 0.6 * h})`;
          ctx.fillRect(px + 2, py + 2, cs - 4, cs - 4);
        }
      }
      // 小さく描くとき（スマートフォンの回路モニターなど）は文字がはみ出すので、色と矢印だけにする
      if (cs >= 16) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(8, Math.floor(cs * 0.36))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = def.kind === 'cond' ? def.mini : def.icon;
        ctx.fillText(label, px + cs / 2, py + cs / 2);
      }
      drawArrowMini(ctx, px, py, cs, tile.d, def.kind === 'cond' ? '#5dff8a' : '#e8f0ea');
      if (def.kind === 'cond') drawArrowMini(ctx, px, py, cs, tile.n, '#ff5a4a');
    }
  }
  if (opts.pc) {
    const { x, y } = opts.pc;
    if (x >= 0 && y >= 0 && x < grid && y < grid) {
      ctx.strokeStyle = '#fffb8a';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#fffb8a';
      ctx.shadowBlur = 8;
      ctx.strokeRect(x0 + x * cs + 1, y0 + y * cs + 1, cs - 2, cs - 2);
    }
  }
  ctx.restore();
}

function drawArrowMini(ctx, px, py, cs, dir, color) {
  const cx = px + cs / 2, cy = py + cs / 2;
  const ex = cx + DX[dir] * cs * 0.5, ey = cy + DY[dir] * cs * 0.5;
  const s = Math.max(2.5, cs * 0.14);
  ctx.fillStyle = color;
  ctx.beginPath();
  const ax = DX[dir], ay = DY[dir];
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ax * s * 1.4 - ay * s, ey - ay * s * 1.4 + ax * s);
  ctx.lineTo(ex - ax * s * 1.4 + ay * s, ey - ay * s * 1.4 - ax * s);
  ctx.closePath();
  ctx.fill();
}
