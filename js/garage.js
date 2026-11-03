'use strict';
// =====================================================================
//  ガレージ：組立 / 強化 / 回路プログラム / 出力配分 / 出撃
// =====================================================================

const SKELETON_SVG = `
<svg viewBox="0 0 200 260" class="skel-svg">
  <g class="lead">
    <line x1="92" y1="34" x2="40" y2="21"/><line x1="108" y1="34" x2="160" y2="21"/>
    <line x1="35" y1="160" x2="28" y2="161"/><line x1="165" y1="160" x2="172" y2="161"/>
    <line x1="100" y1="200" x2="100" y2="225"/>
  </g>
  <g class="bone">
    <line x1="100" y1="52" x2="100" y2="165"/>
    <line x1="55" y1="75" x2="145" y2="75"/>
    <polyline points="55,75 40,120 35,160"/><polyline points="145,75 160,120 165,160"/>
    <line x1="80" y1="165" x2="120" y2="165"/>
    <polyline points="85,165 78,210 80,248"/><polyline points="115,165 122,210 120,248"/>
    <rect x="78" y="88" width="44" height="58" rx="6"/>
  </g>
  <circle class="headj" cx="100" cy="38" r="15"/>
  <g class="joint">
    <circle cx="92" cy="34" r="4"/><circle cx="108" cy="34" r="4"/>
    <circle cx="100" cy="70" r="4"/><circle cx="55" cy="75" r="5"/><circle cx="145" cy="75" r="5"/>
    <circle cx="40" cy="120" r="4"/><circle cx="160" cy="120" r="4"/>
    <circle cx="100" cy="117" r="6"/>
    <circle cx="85" cy="165" r="5"/><circle cx="115" cy="165" r="5"/>
    <circle cx="78" cy="210" r="4"/><circle cx="122" cy="210" r="4"/>
  </g>
</svg>`;

const UNDO_MAX = 100;   // 元に戻せる回数

const SLOT_POS = {
  headCpu: [20, 8], headReg: [80, 8], torso: [50, 45], armL: [14, 62], armR: [86, 62], legs: [50, 88],
};

function statChips(cat, p) {
  const c = (k, v) => `<span class="chip"><em>${k}</em>${v}</span>`;
  switch (cat) {
    case 'headCpu': return c('回路盤', `${p.grid}×${p.grid}`) + c('処理', `${fmtNum(p.clock)}Hz`) + c('センサー', `${p.sensor}m`) + c('耐久', p.hp) + c('重量', p.weight);
    case 'headReg': return c('配分範囲', `腕${Math.round(p.min * 100)}〜${Math.round(p.max * 100)}%`) + c('出力効率', `×${p.eff.toFixed(2)}`) + c('耐久', p.hp) + c('重量', p.weight);
    case 'torso': return c('耐久', p.hp) + c('防御', p.def) + c('出力', p.power) + c('重量', p.weight);
    case 'arm':
      if (p.type === 'none') return c('重量', 0);
      return c('威力', fmtNum(p.dmg)) + c(p.type === 'melee' ? '振り' : '連射', `${p.rate}/s`) + c('射程', `${p.range}m`) +
        (p.mag ? c('弾数', p.mag) + c('装填', `${p.reload}s`) : '') + (p.splash ? c('爆風', `${p.splash}m`) : '') + c('耐久', p.hp) + c('重量', p.weight);
    case 'legs': return c('速度', `${fmtNum(p.speed)}m/s`) + c('旋回', `${Math.round(p.turn * 57.3)}°/s`) + c('横移動', `${Math.round(p.strafe * 100)}%`) +
      c('積載', p.cap) + c('耐久', p.hp) + c('重量', p.weight) + (p.defBonus ? c('防御+', p.defBonus) : '');
  }
  return '';
}

const Garage = {
  slot: 'armL',
  brush: 'select',
  sel: null,
  raf: 0,
  t: 0,
  walk: 0,
  xray: false,
  undoStack: [],   // 回路の編集履歴（元に戻す用。セーブには含めない）
  curTab: 'assembly',
  pendingTab: null, // 未接続タイルの確認ダイアログを閉じたあとに開くタブ

  init() {
    document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => this.tab(b.dataset.tab); });
    document.getElementById('xray').onchange = (e) => { this.xray = e.target.checked; };
    this.buildPalette();
    document.getElementById('btn-sortie').onclick = () => Game.sortie();
    document.getElementById('btn-prog-default').onclick = () => {
      if (!confirm('回路を初期プログラムに戻しますか？（元に戻す で取り消せます）')) return;
      this.editProgram(() => { Game.save.program = defaultProgram(); this.sel = null; });
    };
    document.getElementById('btn-prog-clear').onclick = () => {
      if (!confirm('回路をすべて消去しますか？（STARTは残ります。元に戻す で取り消せます）')) return;
      const p = new Array(MAX_GRID * MAX_GRID).fill(null);
      p[0] = { t: 'start', d: 2, n: 1, p: 0 };
      this.editProgram(() => { Game.save.program = p; this.sel = null; });
    };
    document.getElementById('btn-undo').onclick = () => this.undo();
    document.getElementById('btn-orphans').onclick = () => this.clearOrphans();
    document.getElementById('orphan-stay').onclick = () => this.answerOrphans('stay');
    document.getElementById('orphan-keep').onclick = () => this.answerOrphans('keep');
    document.getElementById('orphan-clear').onclick = () => this.answerOrphans('clear');
    // Ctrl+Z（Mac は ⌘+Z）：回路タブを開いているときだけ有効
    window.addEventListener('keydown', (e) => {
      if (this.pendingTab && e.key === 'Escape') { this.answerOrphans('stay'); return; }
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      if (!document.getElementById('screen-garage').classList.contains('active')) return;
      if (!document.getElementById('tab-circuit').classList.contains('active')) return;
      e.preventDefault();
      this.undo();
    });
    const ec = document.getElementById('enemyCount');
    ec.oninput = () => {
      Game.save.enemyCount = +ec.value;
      Game.persist();
      this.renderSortie();
    };
    const ratio = document.getElementById('ratio');
    ratio.oninput = () => {
      const reg = partById('headReg', Game.save.build.headReg);
      Game.save.build.armRatio = clampRatio(reg, +ratio.value / 100);
      Game.persist();
      this.renderOutput();
      this.renderStats();
    };
  },

  onShow() {
    this.renderAll();
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.t += dt;
      this.walk += dt * 2.5;
      this.drawPreview();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  onHide() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  },

  tab(name) {
    // 回路タブから抜けるとき、未接続のタイルがあれば消去するか確認する
    if (this.curTab === 'circuit' && name !== 'circuit' && this.orphans().length) {
      this.askOrphans(name);
      return;
    }
    this.curTab = name;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    this.renderAll();
  },

  renderAll() {
    this.renderSkeleton();
    this.renderParts();
    this.renderStats();
    this.renderCircuit();
    this.renderInspector();
    this.renderOutput();
    this.renderSortie();
    this.renderUpgrade();
  },

  // ------------------------------------------------------------ 組立
  renderSkeleton() {
    const el = document.getElementById('skeleton');
    const b = Game.save.build;
    el.innerHTML = SKELETON_SVG + SLOTS.map(s => {
      const [x, y] = SLOT_POS[s.key];
      const p = partById(s.cat, b[s.key]);
      return `<button class="slot ${s.key === this.slot ? 'sel' : ''}" data-slot="${s.key}" style="left:${x}%;top:${y}%">
        <span class="sl">${s.label}<small>${s.sub}</small></span><span class="pn">${p.name}</span></button>`;
    }).join('');
    el.querySelectorAll('.slot').forEach(btn => {
      btn.onclick = () => { this.slot = btn.dataset.slot; this.renderSkeleton(); this.renderParts(); };
    });
  },

  renderParts() {
    const s = SLOTS.find(x => x.key === this.slot);
    const b = Game.save.build;
    document.getElementById('parts-title').textContent = `${s.label}（${s.sub}）のパーツ`;
    const el = document.getElementById('parts-list');
    el.innerHTML = PARTS[s.cat].map(p0 => {
      const p = upgradedPart(s.cat, p0, upgradeLevel(Game.save.upgrades, p0.id));
      const eq = b[s.key] === p.id;
      return `<div class="part ${eq ? 'eq' : ''}" data-id="${p.id}">
        <div class="pname">${p.name}${p.lv ? `<span class="lv">強化 Lv${p.lv}</span>` : ''}${eq ? '<span class="tag">装着中</span>' : ''}</div>
        <div class="pstat">${statChips(s.cat, p)}</div>
        <div class="pdesc">${p.desc}</div></div>`;
    }).join('');
    el.querySelectorAll('.part').forEach(d => {
      d.onclick = () => {
        b[s.key] = d.dataset.id;
        Sound.play('equip');
        if (s.key === 'headReg') b.armRatio = clampRatio(partById('headReg', b.headReg), b.armRatio);
        Game.persist();
        this.renderAll();
      };
    });
  },

  renderStats() {
    const st = computeStats(Game.save.build, null, Game.save.upgrades);
    const row = (k, v, f, warn) => `<tr class="${warn ? 'warn' : ''}"><th>${k}</th><td>${v}</td><td class="bar"><i style="width:${Math.round(clamp(f, 0, 1) * 100)}%"></i></td></tr>`;
    document.getElementById('stats').innerHTML = `<table>
      ${row('全高', '2.5 m', 1)}
      ${row('総耐久 HP', st.hp, st.hp / 1300)}
      ${row('防御', st.def, st.def / 25)}
      ${row('総出力', Math.round(st.power), st.power / 190)}
      ${row('重量 / 積載', `${st.weight} / ${st.cap}${st.over ? '  過積載！' : ''}`, st.weight / st.cap, st.over)}
      ${row('最高速度', st.speed.toFixed(1) + ' m/s', st.speed / 18)}
      ${row('旋回速度', Math.round(st.turn * 57.3) + ' °/s', st.turn / 5.5)}
      ${row('左腕 DPS', st.armL.dps.toFixed(1), st.armL.dps / 100)}
      ${row('右腕 DPS', st.armR.dps.toFixed(1), st.armR.dps / 100)}
      ${row('センサー', st.sensor + ' m', st.sensor / 75)}
      ${row('回路盤', `${st.grid}×${st.grid} / ${fmtNum(st.clock)}Hz`, st.clock / 20)}
    </table>`;
  },

  drawPreview() {
    const cv = document.getElementById('preview');
    if (!cv || !cv.offsetParent) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W / 2);
    g.addColorStop(0, '#5a4630');
    g.addColorStop(1, '#1e1812');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,220,160,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const parts = buildParts(Game.save.build);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(62, 62);
    ctx.rotate(-Math.PI / 2 + Math.sin(this.t * 0.4) * 1.2);
    drawRobot(ctx, parts, { time: this.t, walk: this.walk, xray: this.xray });
    ctx.restore();
    ctx.fillStyle = 'rgba(255,230,190,0.6)';
    ctx.font = '12px sans-serif';
    ctx.fillText('上面図（見下ろし）  1マス ≒ 0.4m', 10, H - 10);
  },

  // ------------------------------------------------------------ 強化
  renderUpgrade() {
    const save = Game.save, ore = save.ore;
    document.getElementById('ore-bank').innerHTML = `<b>所持鉱石</b>${oreHTML(ore)}`;
    const el = document.getElementById('upgrade');
    if (!el) return;
    const secs = Object.entries(UPGRADES).map(([cat, U]) => {
      const rows = PARTS[cat].filter(p => p.type !== 'none').map(p => {
        const lv = upgradeLevel(save.upgrades, p.id);
        const eq = SLOTS.some(s => s.cat === cat && save.build[s.key] === p.id);
        const max = lv >= UPGRADE_MAX;
        const cost = max ? null : U.cost(lv + 1);
        const ok = cost && ORES.every(k => (ore[k.id] || 0) >= (cost[k.id] || 0));
        const [name, cur, unit] = U.stat(upgradedPart(cat, p, lv));
        const next = max ? null : U.stat(upgradedPart(cat, p, lv + 1))[1];
        let pips = '';
        for (let i = 0; i < UPGRADE_MAX; i++) pips += `<i class="${i < lv ? 'on' : ''}"></i>`;
        return `<tr class="${eq ? 'eq' : ''}">
          <td class="nm">${p.name}${eq ? '<span class="tag">装着中</span>' : ''}</td>
          <td class="pips">${pips}<small>Lv${lv}</small></td>
          <td class="val">${name} ${fmtNum(cur)}${unit}${max ? '' : ` → <b>${fmtNum(next)}${unit}</b>`}</td>
          <td class="cost">${max ? '<span class="maxed">最大強化</span>' : oreHTML(cost, ore)}</td>
          <td><button class="up-btn ${ok ? 'primary' : ''}" data-id="${p.id}" data-cat="${cat}" ${ok ? '' : 'disabled'}>${max ? 'MAX' : '強化'}</button></td>
        </tr>`;
      }).join('');
      return `<section class="up-sec"><h3>${U.label}<small>${U.where} / ${U.per}</small></h3><table class="up-tbl">${rows}</table></section>`;
    }).join('');
    el.innerHTML = `<h2>パーツ強化</h2>
      <p class="muted">エネミーが落とす鉱石でパーツを強化します（各パーツ最大 Lv${UPGRADE_MAX}）。強化はパーツごとで、付け替えても強化はそのパーツに残ります。<br>
      ${ORES.map(k => `<span class="ore"><i style="background:${k.color}"></i>${k.name}</span>${k.desc}`).join('　')}</p>${secs}`;
    el.querySelectorAll('.up-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id, U = UPGRADES[btn.dataset.cat];
        const lv = upgradeLevel(save.upgrades, id);
        if (lv >= UPGRADE_MAX) return;
        const cost = U.cost(lv + 1);
        if (!ORES.every(k => (ore[k.id] || 0) >= (cost[k.id] || 0))) return;
        for (const k of ORES) ore[k.id] -= cost[k.id] || 0;
        save.upgrades[id] = lv + 1;
        Sound.play('upgrade');
        Game.persist();
        this.renderAll();
      };
    });
  },

  // ------------------------------------------------------------ 回路
  buildPalette() {
    const el = document.getElementById('palette');
    let html = `<div class="pgroup"><h4>ツール</h4>
      <button class="pbtn tool" data-brush="select">✋ 選択・編集</button>
      <button class="pbtn tool" data-brush="erase">⌫ 消しゴム</button></div>`;
    for (const g of TILE_GROUPS) {
      html += `<div class="pgroup"><h4>${g.name}</h4>`;
      for (const [k, d] of Object.entries(TILE_DEFS)) {
        if (d.group !== g.id) continue;
        html += `<button class="pbtn g-${d.group}" data-brush="${k}" title="${d.name}"><b>${d.icon}</b>${d.short}</button>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
    el.querySelectorAll('.pbtn').forEach(b => {
      b.onclick = () => { this.brush = b.dataset.brush; this.updatePalette(); };
      if (!TILE_DEFS[b.dataset.brush]) return;
      // パレットから回路盤へドラッグして配置
      b.draggable = true;
      b.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', 'tile:' + b.dataset.brush);
        e.dataTransfer.effectAllowed = 'copy';
      };
    });
    this.updatePalette();
  },

  updatePalette() {
    document.querySelectorAll('#palette .pbtn').forEach(b => b.classList.toggle('on', b.dataset.brush === this.brush));
    const def = TILE_DEFS[this.brush];
    document.getElementById('brush-info').textContent =
      this.brush === 'select' ? '選択モード：タイルをクリックで編集' :
      this.brush === 'erase' ? '消しゴム：クリックでタイルを削除' :
      `配置モード：「${def.name}」をクリックで配置`;
  },

  tileHTML(tile) {
    const def = TILE_DEFS[tile.t];
    const pm = tileParamText(tile);
    let arrows = `<i class="arr yes a${tile.d}${def.kind === 'cond' ? ' cond' : ''}">${DIR_ARROW[tile.d]}</i>`;
    if (def.kind === 'cond') arrows += `<i class="arr no a${tile.n}${tile.n === tile.d ? ' dup' : ''}">${DIR_ARROW[tile.n]}</i>`;
    return `<div class="tile g-${def.group}"><span class="ic">${def.kind === 'cond' ? '◇' : def.icon}</span>
      <span class="nm">${def.short}</span>${pm ? `<span class="pm">${pm}</span>` : ''}${arrows}</div>`;
  },

  renderCircuit() {
    const st = computeStats(Game.save.build, null, Game.save.upgrades);
    const grid = st.grid;
    const prog = Game.save.program;
    document.getElementById('circuit-info').innerHTML =
      `頭部A <b>${st.parts.headCpu.name}</b>：使用可能 ${grid}×${grid} マス / 処理速度 ${fmtNum(st.clock)} タイル毎秒 / センサー ${st.sensor}m`;
    const el = document.getElementById('circuit-grid');
    const orphans = new Set(orphanTiles(prog, grid));
    let html = '';
    for (let y = 0; y < MAX_GRID; y++) {
      for (let x = 0; x < MAX_GRID; x++) {
        const i = y * MAX_GRID + x;
        const tile = prog[i];
        const off = x >= grid || y >= grid;
        const sel = this.sel && this.sel.x === x && this.sel.y === y;
        const drag = tile && tile.t !== 'start' && !off;
        html += `<div class="cell ${off ? 'off' : ''} ${sel ? 'sel' : ''} ${orphans.has(i) ? 'orphan' : ''}" data-x="${x}" data-y="${y}"` +
          `${drag ? ' draggable="true"' : ''}${orphans.has(i) ? ' title="未接続：STARTからつながっていないため実行されません"' : ''}>${tile ? this.tileHTML(tile) : ''}</div>`;
      }
    }
    el.innerHTML = html;
    const ub = document.getElementById('btn-undo');
    ub.disabled = !this.undoStack.length;
    ub.textContent = `↶ 元に戻す（${this.undoStack.length}）`;
    const ob = document.getElementById('btn-orphans');
    ob.disabled = !orphans.size;
    ob.textContent = `未接続タイルを消去（${orphans.size}）`;
    el.querySelectorAll('.cell').forEach(c => {
      const x = +c.dataset.x, y = +c.dataset.y;
      c.onclick = () => this.cellClick(x, y);
      c.oncontextmenu = (e) => { e.preventDefault(); this.rotateTile(x, y, e.shiftKey); };
      // ドラッグでタイルを移動（移動先にタイルがあれば入れ替え）
      c.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', 'cell:' + (y * MAX_GRID + x));
        e.dataTransfer.effectAllowed = 'move';
        c.classList.add('dragging');
      };
      c.ondragend = () => {
        c.classList.remove('dragging');
        el.querySelectorAll('.drop').forEach(d => d.classList.remove('drop'));
      };
      c.ondragover = (e) => {
        if (!this.canDrop(x, y)) return;
        e.preventDefault();
        c.classList.add('drop');
      };
      c.ondragleave = () => c.classList.remove('drop');
      c.ondrop = (e) => {
        e.preventDefault();
        c.classList.remove('drop');
        this.dropOn(x, y, e.dataTransfer.getData('text/plain'));
      };
    });
  },

  // ドロップできるのは回路盤の中で、START 以外のマス
  canDrop(x, y) {
    const grid = computeStats(Game.save.build, null, Game.save.upgrades).grid;
    if (x >= grid || y >= grid) return false;
    const t = Game.save.program[y * MAX_GRID + x];
    return !(t && t.t === 'start');
  },

  dropOn(x, y, data) {
    if (!data || !this.canDrop(x, y)) return;
    const j = y * MAX_GRID + x;
    const [kind, v] = data.split(':');
    if (kind === 'tile' && TILE_DEFS[v]) {
      Sound.play('place');
      this.editProgram(() => this.placeTile(x, y, v));
    } else if (kind === 'cell') {
      const i = +v;
      if (i === j || !Game.save.program[i]) return;
      Sound.play('place');
      this.editProgram(() => {
        const prog = Game.save.program;
        [prog[i], prog[j]] = [prog[j], prog[i]];
        this.sel = { x, y };
      });
    }
  },

  // タイルを置く（置き換える場合は矢印の向きを引き継ぐ）
  placeTile(x, y, key) {
    const prog = Game.save.program;
    const i = y * MAX_GRID + x;
    const nt = makeTile(key);
    if (prog[i]) { nt.d = prog[i].d; nt.n = prog[i].n; }
    prog[i] = nt;
    this.sel = { x, y };
  },

  // ------------------------------------------------------------ 未接続タイル
  orphans() {
    return orphanTiles(Game.save.program, computeStats(Game.save.build, null, Game.save.upgrades).grid);
  },

  clearOrphans() {
    const list = this.orphans();
    if (!list.length) return;
    this.editProgram(() => {
      for (const i of list) Game.save.program[i] = null;
      if (this.sel && list.includes(this.sel.y * MAX_GRID + this.sel.x)) this.sel = null;
    });
  },

  askOrphans(next) {
    this.pendingTab = next;
    const n = this.orphans().length;
    document.getElementById('orphan-body').innerHTML =
      `<p>STARTからつながっていないタイルが <b>${n}個</b> あります（回路盤で薄く表示されているタイル）。<br>これらは戦闘中に一度も実行されません。</p>
       <p class="muted">消去しても「元に戻す」で取り消せます。</p>`;
    document.getElementById('orphan-dialog').classList.add('show');
  },

  answerOrphans(ans) {
    const next = this.pendingTab;
    this.pendingTab = null;
    document.getElementById('orphan-dialog').classList.remove('show');
    if (ans === 'stay' || !next) return;
    if (ans === 'clear') this.clearOrphans();
    this.curTab = null;   // 確認を繰り返さないよう、回路タブから抜けた扱いにする
    this.tab(next);
  },

  cellClick(x, y) {
    const grid = computeStats(Game.save.build, null, Game.save.upgrades).grid;
    if (x >= grid || y >= grid) return;
    this.editProgram(() => {
      const prog = Game.save.program;
      const i = y * MAX_GRID + x;
      const tile = prog[i];
      if (tile && tile.t === 'start') { this.sel = { x, y }; Sound.play('tick'); }
      else if (this.brush === 'erase') { if (tile) Sound.play('erase'); prog[i] = null; this.sel = null; }
      else if (this.brush !== 'select') {
        Sound.play('place');
        this.placeTile(x, y, this.brush);
        this.brush = 'select';   // 1枚置いたら選択・編集モードに戻る
      }
      else { this.sel = tile ? { x, y } : null; if (tile) Sound.play('tick'); }
    });
    this.updatePalette();
  },

  rotateTile(x, y, no) {
    const tile = Game.save.program[y * MAX_GRID + x];
    if (!tile) return;
    Sound.play('rotate');
    this.editProgram(() => {
      if (no && TILE_DEFS[tile.t].kind === 'cond') tile.n = (tile.n + 1) % 4;
      else tile.d = (tile.d + 1) % 4;
      this.sel = { x, y };
    });
  },

  // 回路を書き換える処理はすべてここを通す。変更があったときだけ、変更前の状態を履歴に積む
  editProgram(fn) {
    const before = JSON.stringify(Game.save.program), sel = this.sel;
    fn();
    if (JSON.stringify(Game.save.program) !== before) {
      this.undoStack.push({ prog: before, sel });
      if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
      Game.persist();
    }
    this.renderCircuit();
    this.renderInspector();
  },

  undo() {
    const h = this.undoStack.pop();
    if (!h) return;
    Sound.play('undo');
    Game.save.program = JSON.parse(h.prog);
    this.sel = h.sel;
    Game.persist();
    this.renderCircuit();
    this.renderInspector();
  },

  renderInspector() {
    const el = document.getElementById('inspector');
    const tile = this.sel ? Game.save.program[this.sel.y * MAX_GRID + this.sel.x] : null;
    if (!tile) {
      el.innerHTML = `<h3>タイル設定</h3><p class="muted">タイルを選択すると、ここでパラメータや矢印の向きを設定できます。</p>
        <h4>回路のルール</h4><ul class="rules">
        <li>STARTから矢印の方向へ1タイルずつ実行します。</li>
        <li><b class="c-move">移動</b>タイルは動作が終わるまで次へ進みません。</li>
        <li><b class="c-atk">攻撃</b>タイルは引き金を引いて（約0.6秒）すぐ次へ進みます。</li>
        <li><b class="c-cond">判定</b>タイルは条件を満たすと<b class="yes">緑▲</b>へ、満たさないと<b class="no">赤▲</b>へ進みます。</li>
        <li>空きマス・回路盤の外へ進むとSTARTに戻ります。</li>
        <li>右クリック：矢印を回転 / Shift+右クリック：NO側の矢印を回転</li>
        <li>ドラッグ：タイルを移動（移動先のタイルとは入れ替え）/ パレットからドラッグして配置</li>
        <li>薄く表示されたタイルはSTARTからつながっておらず実行されません。「未接続タイルを消去」でまとめて消せます。</li>
        <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> または「元に戻す」：直前の編集を取り消す</li>
        </ul>`;
      return;
    }
    const def = TILE_DEFS[tile.t];
    const dirPick = (k, label, cls) => `<div class="dirrow"><span class="${cls}">${label}</span>` +
      [0, 1, 2, 3].map(d => `<button class="dbtn ${tile[k] === d ? 'on' : ''}" data-k="${k}" data-d="${d}">${DIR_ARROW[d]}</button>`).join('') + '</div>';
    let html = `<h3>タイル設定 <small>(${this.sel.x + 1}, ${this.sel.y + 1})</small></h3>
      <div class="insp-name g-${def.group}">${def.kind === 'cond' ? '◇' : def.icon} ${def.name}</div>
      <p class="muted">${{ start: '実行開始位置', cmd: 'コマンド（出口1つ）', cond: '判定（YES / NO の2出口）' }[def.kind]}</p>`;
    if (def.params) {
      html += `<label class="prm">パラメータ <select id="insp-p">${def.params.map((v, i) => `<option value="${i}" ${i === tile.p ? 'selected' : ''}>${v}${def.unit}</option>`).join('')}</select></label>`;
    }
    html += dirPick('d', def.kind === 'cond' ? 'YES →' : '次へ →', def.kind === 'cond' ? 'yes' : '');
    if (def.kind === 'cond') html += dirPick('n', 'NO →', 'no');
    if (tile.t === 'power') {
      const reg = partById('headReg', Game.save.build.headReg);
      html += `<p class="muted">※頭部B「${reg.name}」の配分範囲（腕${Math.round(reg.min * 100)}〜${Math.round(reg.max * 100)}%）に制限されます。</p>`;
    }
    if (tile.t !== 'start') html += `<button id="insp-del" class="danger">このタイルを削除</button>`;
    el.innerHTML = html;
    const sel = document.getElementById('insp-p');
    if (sel) sel.onchange = () => this.editProgram(() => { tile.p = +sel.value; });
    el.querySelectorAll('.dbtn').forEach(b => {
      b.onclick = () => this.editProgram(() => { tile[b.dataset.k] = +b.dataset.d; });
    });
    const del = document.getElementById('insp-del');
    if (del) del.onclick = () => this.editProgram(() => {
      Game.save.program[this.sel.y * MAX_GRID + this.sel.x] = null;
      this.sel = null;
    });
  },

  // ------------------------------------------------------------ 出力配分
  renderOutput() {
    const b = Game.save.build;
    const st = computeStats(b, null, Game.save.upgrades);
    const reg = st.parts.headReg;
    const slider = document.getElementById('ratio');
    slider.value = Math.round(st.ratio * 100);
    document.getElementById('reg-name').textContent = `${reg.name}（配分範囲：腕 ${Math.round(reg.min * 100)}〜${Math.round(reg.max * 100)}%  / 出力効率 ×${reg.eff.toFixed(2)}）`;
    document.getElementById('arm-pct').textContent = Math.round(st.ratio * 100) + '%';
    document.getElementById('leg-pct').textContent = Math.round((1 - st.ratio) * 100) + '%';
    document.getElementById('ratio-arm').style.width = (st.ratio * 100) + '%';
    document.getElementById('ratio-leg').style.width = ((1 - st.ratio) * 100) + '%';
    document.getElementById('lim-l').style.left = (reg.min * 100) + '%';
    document.getElementById('lim-r').style.left = (reg.max * 100) + '%';
    const mid = computeStats(b, 0.5, Game.save.upgrades);
    const cmp = (v, base, unit = '', dig = 1) => {
      const d = v - base;
      const s = Math.abs(d) < 0.05 ? '' : `<small class="${d > 0 ? 'up' : 'down'}">（${d > 0 ? '+' : ''}${d.toFixed(dig)}）</small>`;
      return v.toFixed(dig) + unit + s;
    };
    document.getElementById('output-table').innerHTML = `
      <tr><th>総出力（胴体×頭部B）</th><td>${Math.round(st.power)}</td></tr>
      <tr><th>攻撃倍率（腕）</th><td>×${cmp(st.armMult, mid.armMult, '', 2)}</td></tr>
      <tr><th>機動倍率（脚）</th><td>×${cmp(st.legMult, mid.legMult, '', 2)}</td></tr>
      <tr><th>最高速度</th><td>${cmp(st.speed, mid.speed, ' m/s')}</td></tr>
      <tr><th>旋回速度</th><td>${Math.round(st.turn * 57.3)} °/s</td></tr>
      <tr><th>左腕 DPS</th><td>${cmp(st.armL.dps, mid.armL.dps)}</td></tr>
      <tr><th>右腕 DPS</th><td>${cmp(st.armR.dps, mid.armR.dps)}</td></tr>`;
  },

  // ------------------------------------------------------------ 出撃
  renderSortie() {
    const n = Game.save.enemyCount;
    const F = fieldById(Game.save.field), DS = F.districts;
    document.getElementById('sortie-title').textContent = `出撃準備 — ${F.name}（全${DS.length}地区）`;
    const fs = document.getElementById('field-select');
    fs.innerHTML = FIELDS.map(f => `
      <button class="field-card ${f.id === F.id ? 'sel' : ''}" data-id="${f.id}">
        <canvas width="96" height="72"></canvas>
        <span><b>${f.name}</b><small>全${f.districts.length}地区</small><em>${f.desc}</em></span>
      </button>`).join('');
    fs.querySelectorAll('.field-card').forEach((b, i) => {
      drawFieldThumb(b.querySelector('canvas'), FIELDS[i]);
      b.onclick = () => { Game.save.field = b.dataset.id; Game.persist(); this.renderSortie(); };
    });
    document.getElementById('enemyCount').value = n;
    document.getElementById('enemyCountVal').textContent = n + ' 体';
    const rows = DS.map((D, i) => {
      const comp = enemyComposition(n, D);
      const cnt = t => comp.filter(x => x === t).length;
      return `<tr><td><b>${D.name}</b>「${D.sub}」</td><td>${cnt('scarab')}</td><td>${cnt('spitter')}</td><td>${cnt('troll')}</td><td>第1〜${i + 1}地区</td></tr>`;
    }).join('');
    document.getElementById('composition').innerHTML = `
      <table class="district-tbl">
        <thead><tr><th>地区</th><th>${ENEMY_DEFS.scarab.name}</th><th>${ENEMY_DEFS.spitter.name}</th><th>${ENEMY_DEFS.troll.name}</th><th>戦闘フィールド</th></tr></thead>
        <tbody>${rows}
          <tr class="boss"><td><b>BOSS</b> ${ENEMY_DEFS[F.boss].name}</td><td colspan="3">全地区掃討後に出現 / HP ${ENEMY_DEFS[F.boss].hp + 25 * n}</td><td>全地区</td></tr>
        </tbody>
      </table>
      <p class="muted">各地区を掃討するたびに「次に進みますか？」と確認されます。帰還すればそこまでの戦果で任務終了。HP・弾薬は地区をまたいで持ち越します。<br>
      スカラベ：小型・高速の近接群体 / スピッター：距離を取って酸を吐く / トロール：鈍重だが高耐久・高打撃</p>`;
    const st = computeStats(Game.save.build, null, Game.save.upgrades);
    const prog = Game.save.program;
    const warns = [];
    if (st.over) warns.push(`過積載です（${st.weight} / ${st.cap}）。速度と旋回が大きく低下します。`);
    if (st.parts.armL.type === 'none' && st.parts.armR.type === 'none') warns.push('両腕とも武装がありません。');
    let fire = false, used = 0;
    for (let y = 0; y < st.grid; y++) for (let x = 0; x < st.grid; x++) {
      const t = prog[y * MAX_GRID + x];
      if (!t) continue;
      used++;
      if (t.t.startsWith('fire_')) fire = true;
    }
    if (!fire) warns.push('回路に攻撃タイルがありません（回路制御では攻撃できません）。');
    const hidden = prog.filter((t, i) => t && ((i % MAX_GRID) >= st.grid || Math.floor(i / MAX_GRID) >= st.grid)).length;
    if (hidden) warns.push(`回路盤の外に ${hidden} 個のタイルがあります（現在の頭部Aでは実行されません）。`);
    document.getElementById('sortie-check').innerHTML =
      `<p>回路：${used} タイル使用 / ${st.grid}×${st.grid}</p>` +
      (warns.length ? warns.map(w => `<p class="warn">⚠ ${w}</p>`).join('') : '<p class="ok">✔ 出撃準備完了</p>');
  },
};
