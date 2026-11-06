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
    case 'headCpu': return c(T('G026' /* 回路盤 */), `${p.grid}×${p.grid}`) + c(T('G027' /* 処理 */), `${fmtNum(p.clock)}Hz`) + c(T('G028' /* センサー */), `${fmtNum(p.sensor)}m`) + c(T('G029' /* 耐久 */), p.hp) + c(T('G030' /* 重量 */), p.weight);
    case 'headReg': return c(T('G031' /* 配分範囲 */), T('G032' /* 腕{min}〜{max}% */, { min: Math.round(p.min * 100), max: Math.round(p.max * 100) })) + c(T('G033' /* 出力効率 */), `×${p.eff.toFixed(2)}`) + c(T('G029' /* 耐久 */), p.hp) + c(T('G030' /* 重量 */), p.weight);
    case 'torso': return c(T('G029' /* 耐久 */), p.hp) + c(T('G034' /* 防御 */), fmtNum(p.def)) + c(T('G035' /* 出力 */), p.power) + c(T('G030' /* 重量 */), p.weight);
    case 'arm':
      if (p.type === 'none') return c(T('G030' /* 重量 */), 0);
      return c(T('G036' /* 威力 */), fmtNum(p.dmg) + (p.shots > 1 ? T('G037' /* ×{shots}発 */, { shots: p.shots }) : '')) + c(p.type === 'melee' ? T('G038' /* 振り */) : T('G039' /* 連射 */), `${p.rate}/s`) + c(T('G040' /* 射程 */), `${p.range}m`) +
        (p.mag ? c(T('G041' /* 弾数 */), p.mag) + c(T('G042' /* 装填 */), `${p.reload}s`) : '') + (p.splash ? c(T('G043' /* 爆風 */), `${p.splash}m`) : '') + c(T('G029' /* 耐久 */), p.hp) + c(T('G030' /* 重量 */), p.weight);
    case 'legs': return c(T('G044' /* 速度 */), `${fmtNum(p.speed)}m/s`) + c(T('G045' /* 旋回 */), `${Math.round(p.turn * 57.3)}°/s`) + c(T('G046' /* 横移動 */), `${Math.round(p.strafe * 100)}%`) +
      c(T('G047' /* 積載 */), p.cap) + c(T('G029' /* 耐久 */), p.hp) + c(T('G030' /* 重量 */), p.weight) + (p.defBonus ? c(T('G048' /* 防御+ */), p.defBonus) : '') +
      (p.jump ? c(T('G049' /* ジャンプ */), T('G050' /* {dist}m / 待ち{cd}s */, { dist: p.jump.dist, cd: fmtNum(p.jump.cd) })) : '');
  }
  return '';
}

// 文字列をファイルとして保存させる（ブラウザのダウンロード）
function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ファイル名に付ける日付（20261106）
function dateStamp() {
  const d = new Date(), z = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}`;
}

// 機体の見下ろし図（対戦タブの小さな絵）
function drawMachineThumb(cv, m) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 4, W / 2, H / 2, W / 2);
  g.addColorStop(0, '#5a4630');
  g.addColorStop(1, '#1e1812');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2 + W * 0.04);
  ctx.scale(W / 5, W / 5);
  ctx.rotate(-Math.PI / 2);
  drawRobot(ctx, buildParts(m.build, m.upgrades), { time: 0, walk: 0 });
  ctx.restore();
}

const Garage = {
  slot: 'armL',
  brush: 'select',
  sel: null,
  raf: 0,
  t: 0,
  walk: 0,
  xray: false,
  undoStacks: Array.from({ length: PROG_SLOTS }, () => []),   // 回路ごとの編集履歴（元に戻す用。セーブには含めない）
  get undoStack() { return this.undoStacks[Game.save.progSlot]; },
  curTab: 'assembly',
  pendingTab: null, // 未接続タイルの確認ダイアログを閉じたあとに開くタブ

  init() {
    document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => this.tab(b.dataset.tab); });
    document.getElementById('xray').onchange = (e) => { this.xray = e.target.checked; };
    this.buildPalette();
    document.getElementById('btn-sortie').onclick = () => Game.sortie();
    document.getElementById('btn-prog-default').onclick = async () => {
      if (!await Ask.open(T('G051' /* 回路を初期プログラムに戻しますか？（元に戻す で取り消せます… */))) return;
      this.editProgram(() => { Game.save.program = defaultProgram(); this.sel = null; });
    };
    document.getElementById('btn-prog-clear').onclick = async () => {
      if (!await Ask.open(T('G052' /* 回路をすべて消去しますか？（STARTは残ります。元に戻す … */))) return;
      const p = new Array(MAX_GRID * MAX_GRID).fill(null);
      p[0] = { t: 'start', d: 2, n: 1, p: 0 };
      this.editProgram(() => { Game.save.program = p; this.sel = null; });
    };
    document.getElementById('btn-prog-export').onclick = () => this.exportProgram();
    const pf = document.getElementById('prog-file');
    document.getElementById('btn-prog-import').onclick = () => { pf.value = ''; pf.click(); };
    pf.onchange = () => { if (pf.files[0]) this.importProgram(pf.files[0]); };
    // 対戦：対戦相手のファイル（複数まとめて選べる）
    const vf = document.getElementById('vs-file');
    vf.onchange = () => { const fs = [...vf.files]; vf.value = ''; if (fs.length) this.importRivals(fs); };
    document.getElementById('btn-undo').onclick = () => this.undo();
    document.getElementById('btn-orphans').onclick = () => this.clearOrphans();
    document.getElementById('orphan-stay').onclick = () => this.answerOrphans('stay');
    document.getElementById('orphan-keep').onclick = () => this.answerOrphans('keep');
    document.getElementById('orphan-clear').onclick = () => this.answerOrphans('clear');
    // Ctrl+Z（Mac は ⌘+Z）：回路タブを開いているときだけ有効
    window.addEventListener('keydown', (e) => {
      // 未接続タイルの確認中：N で「回路に戻る」（全画面中の Esc はブラウザが全画面の解除に使うため N を表示。Esc も全画面でなければ使える）
      if (this.pendingTab && (e.code === 'KeyN' || e.key === 'Escape')) { this.answerOrphans('stay'); return; }
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
    // ブースタータブを見終えたら NEW の印を消す
    if (this.curTab === 'stock' && name !== 'stock' && Game.save.stock.some(it => it.isNew)) {
      for (const it of Game.save.stock) delete it.isNew;
      Game.persist();
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
    this.renderStock();
    this.renderVersus();
  },

  // ------------------------------------------------------------ 組立
  renderSkeleton() {
    const el = document.getElementById('skeleton');
    const b = Game.save.build;
    el.innerHTML = SKELETON_SVG + SLOTS.map(s => {
      const [x, y] = SLOT_POS[s.key];
      const p = partById(s.cat, b[s.key]), g = slotGear(b, s.key);
      const bn = g ? ` <b style="color:${bonusTier(g.bonus).color}">+${g.bonus}</b>` : '';
      return `<button class="slot ${s.key === this.slot ? 'sel' : ''}" data-slot="${s.key}" style="left:${x}%;top:${y}%">
        <span class="sl">${s.label}<small>${s.sub}</small></span><span class="pn">${p.name}${bn}</span></button>`;
    }).join('');
    el.querySelectorAll('.slot').forEach(btn => {
      btn.onclick = () => { this.slot = btn.dataset.slot; this.renderSkeleton(); this.renderParts(); };
    });
  },

  renderParts() {
    const s = SLOTS.find(x => x.key === this.slot);
    const b = Game.save.build;
    document.getElementById('parts-title').textContent = T('G053' /* {label}（{sub}）のパーツ */, { label: s.label, sub: s.sub });
    const el = document.getElementById('parts-list');
    const g = slotGear(b, s.key);
    const slotName = k => SLOTS.find(x => x.key === k).label;
    el.innerHTML = PARTS[s.cat].map(p0 => {
      const lv = upgradeLevel(Game.save.upgrades, p0.id);
      const eq = b[s.key] === p0.id;
      // 装着中なら、差し込んだブースターを反映した性能を表示する
      const p = upgradedPart(s.cat, bonusPart(s.cat, p0, eq && g ? g.bonus : 0), lv);
      // このパーツ専用のブースター（+値の高い順）
      const own = Game.save.stock.filter(it => it.cat === s.cat && it.id === p0.id).sort((x, y) => y.bonus - x.bonus);
      const inst = own.map(it => {
        const here = g && g.uid === it.uid;
        const at = SLOTS.find(x => x.key !== s.key && slotGear(b, x.key) && b.gear[x.key].uid === it.uid);
        return `<div class="inst ${here ? 'eq' : ''}" data-uid="${it.uid}" title="${here ? T('G054' /* クリックで外す */) : T('G055' /* クリックで差し込む */)}">
          ${partTagHTML(it, true)}<small>${bonusDesc(s.cat, it.bonus)}</small>
          ${here ? `<span class="tag">${T('G056' /* 差し込み中 */)}</span>` : at ? `<span class="tag other">${T('G057' /* {label}に差し込み中 */, { label: at.label })}</span>` : ''}${it.isNew ? '<span class="new">NEW</span>' : ''}</div>`;
      }).join('');
      return `<div class="part ${eq ? 'eq' : ''}" data-id="${p0.id}">
        <div class="pname">${partLabel(p)}${p.lv ? `<span class="lv">${T('G058' /* 強化 */)} Lv${p.lv}</span>` : ''}${eq ? `<span class="tag">${T('G059' /* 装着中 */)}</span>` : ''}${own.length ? `<span class="own">${T('G060' /* ブースター */)} ×${own.length}</span>` : ''}</div>
        <div class="pstat">${statChips(s.cat, p)}</div>
        <div class="pdesc">${p.desc}</div>
        ${inst ? `<div class="insts"><div class="insts-h">${T('G061' /* ブースター（1つ差し込める。クリックで差し込む / 外す） */)}</div>${inst}</div>` : ''}</div>`;
    }).join('');
    el.querySelectorAll('.part').forEach(d => {
      d.onclick = () => this.equip(s.key, d.dataset.id);
    });
    el.querySelectorAll('.inst').forEach(d => {
      d.onclick = (e) => {
        e.stopPropagation();
        this.setBooster(s.key, Game.save.stock.find(it => it.uid === +d.dataset.uid));
      };
    });
  },

  // スロットにパーツを装着する（別のパーツに替えたら、差し込んでいたブースターは外れる）
  equip(key, id) {
    const b = Game.save.build;
    b.gear = b.gear || {};
    if (b[key] !== id) delete b.gear[key];
    b[key] = id;
    Sound.play('equip');
    if (key === 'headReg') b.armRatio = clampRatio(partById('headReg', b.headReg), b.armRatio);
    Game.persist();
    this.renderAll();
  },

  // スロットにブースターを差し込む（そのパーツが未装着なら装着もする）。差し込み中のものを選ぶと外す
  setBooster(key, item) {
    if (!item) return;
    const b = Game.save.build;
    b.gear = b.gear || {};
    if (b.gear[key] && b.gear[key].uid === item.uid) {
      delete b.gear[key];
    } else {
      // 別のスロット（反対の腕など）に差していたら抜く
      for (const k of Object.keys(b.gear)) if (b.gear[k] && b.gear[k].uid === item.uid) delete b.gear[k];
      b[key] = item.id;
      b.gear[key] = { uid: item.uid, id: item.id, bonus: item.bonus };
      if (key === 'headReg') b.armRatio = clampRatio(partById('headReg', b.headReg), b.armRatio);
    }
    Sound.play('equip');
    Game.persist();
    this.renderAll();
  },

  // ------------------------------------------------------------ ブースター（所持品の一覧・分解）
  stockCat: 'all',
  stockSort: 'bonus',
  stockSel: new Set(),

  equippedUids() {
    const b = Game.save.build, set = new Set();
    for (const s of SLOTS) { const g = slotGear(b, s.key); if (g) set.add(g.uid); }
    return set;
  },

  renderStock() {
    const el = document.getElementById('stock');
    if (!el) return;
    const save = Game.save, eqd = this.equippedUids();
    const nNew = save.stock.filter(it => it.isNew).length;
    const tb = document.querySelector('.tabs button[data-tab="stock"]');
    if (tb) tb.innerHTML = `${T('G062' /* ② ブースター */)}${nNew ? `<span class="new">${nNew}</span>` : ''}`;
    for (const u of [...this.stockSel]) if (!save.stock.some(it => it.uid === u) || eqd.has(u)) this.stockSel.delete(u);
    const cats = [['all', T('G063' /* すべて */)], ...SLOTS.filter(s => s.key !== 'armR').map(s => [s.cat, s.cat === 'arm' ? T('G064' /* 腕 */) : s.label])];
    const catOrder = SLOTS.map(s => s.cat);
    let list = save.stock.filter(it => this.stockCat === 'all' || it.cat === this.stockCat);
    const sorts = {
      bonus: (x, y) => y.bonus - x.bonus || y.uid - x.uid,
      new:   (x, y) => y.uid - x.uid,
      kind:  (x, y) => catOrder.indexOf(x.cat) - catOrder.indexOf(y.cat) || x.id.localeCompare(y.id) || y.bonus - x.bonus,
    };
    list.sort(sorts[this.stockSort]);
    const dup = {};
    for (const it of save.stock) dup[it.id] = (dup[it.id] || 0) + 1;
    const sum = emptyOre();
    for (const it of save.stock) if (this.stockSel.has(it.uid)) { const o = salvageOre(it); for (const k of ORES) sum[k.id] += o[k.id]; }
    const rows = list.map(it => {
      const eq = eqd.has(it.uid), sel = this.stockSel.has(it.uid);
      const slot = SLOTS.find(s => slotGear(save.build, s.key) && save.build.gear[s.key].uid === it.uid);
      return `<tr class="${eq ? 'eq' : ''}${sel ? ' sel' : ''}" data-uid="${it.uid}">
        <td><input type="checkbox" ${sel ? 'checked' : ''} ${eq ? 'disabled' : ''}></td>
        <td class="nm">${partTagHTML(it)}${it.isNew ? '<span class="new">NEW</span>' : ''}${dup[it.id] > 1 ? `<small class="dup">${T('G065' /* 同じパーツ用 */)} ×${dup[it.id]}</small>` : ''}</td>
        <td class="bd">${bonusDesc(it.cat, it.bonus)}</td>
        <td class="cost">${oreHTML(salvageOre(it))}</td>
        <td>${eq ? `<span class="tag">${T('G057' /* {label}に差し込み中 */, { label: slot.label })}</span>` : `<button class="salv" data-uid="${it.uid}">${T('G066' /* 分解 */)}</button>`}</td></tr>`;
    }).join('');
    // 「並」「良以下」「優以下」をまとめて選ぶボタン（差し込み中は除く）
    const asc = BONUS_TIERS.slice().reverse();
    const tierBtns = asc.slice(0, 3).map((t, i) => {
      const max = asc[i + 1].min - 1;
      const what = i ? T('G142' /* {name}以下 */, { name: t.name }) : t.name;
      return `<button class="salv-tier" data-max="${max}" style="--c:${t.color}">${T('G143' /* {what}（+{max}以下）を選択 */, { what, max })}</button>`;
    }).join('');
    el.innerHTML = `<h2>${T('G060' /* ブースター */)} <small>${T('G067' /* {n}個 */, { n: save.stock.length })}</small></h2>
      <p class="muted">${T('G068' /* レアエネミー（金色に輝く輝晶個体）が落とす、特定のパーツ専用… */, { min: BONUS_MIN, max: BONUS_MAX })}<br>
      ${BONUS_TIERS.map((t, i) => {
        // 等級の +値の範囲（日本語は「+8〜」、英語は「+8–9」と書く）
        const lo = Math.max(t.min, BONUS_MIN), hi = i ? BONUS_TIERS[i - 1].min - 1 : BONUS_MAX;
        const range = T('G144' /* +{min}〜 */, { min: t.min, lo, hi });
        return `<span class="ptag" style="--c:${t.color}"><em>${t.name}</em>${range}</span>`;
      }).join(' ')}</p>
      <div class="stock-bar">
        <div class="seg">${cats.map(([k, n]) => `<button class="scat ${this.stockCat === k ? 'on' : ''}" data-cat="${k}">${n}</button>`).join('')}</div>
        <div class="seg">${T('G069' /* 並び順 */)} ${[['bonus', T('G070' /* ボーナス順 */)], ['new', T('G071' /* 新しい順 */)], ['kind', T('G072' /* 種類順 */)]].map(([k, n]) => `<button class="ssort ${this.stockSort === k ? 'on' : ''}" data-sort="${k}">${n}</button>`).join('')}</div>
      </div>
      ${list.length ? `<table class="stock-tbl">
        <thead><tr><th><input type="checkbox" id="stock-all"></th><th>${T('G073' /* ブースター */)}</th><th>${T('G074' /* 効果 */)}</th><th>${T('G075' /* 分解で得る鉱石 */)}</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>` : `<p class="empty">${save.stock.length ? T('G076' /* この部位のブースターはありません。 */) : T('G077' /* まだブースターを持っていません。出撃してレアエネミーを倒しま… */)}</p>`}
      <div class="stock-foot">
        ${tierBtns}<button id="salv-clear" ${this.stockSel.size ? '' : 'disabled'}>${T('G078' /* 選択を解除 */)}</button>
        <span class="sum">${T('G079' /* 選択 {n}個 */, { n: this.stockSel.size })} → ${oreHTML(sum)}</span>
        <button id="salv-sel" class="danger" ${this.stockSel.size ? '' : 'disabled'}>${T('G080' /* 選択したブースターを分解 */)}</button>
      </div>`;
    el.querySelectorAll('.scat').forEach(btn => { btn.onclick = () => { this.stockCat = btn.dataset.cat; this.renderStock(); }; });
    el.querySelectorAll('.ssort').forEach(btn => { btn.onclick = () => { this.stockSort = btn.dataset.sort; this.renderStock(); }; });
    el.querySelectorAll('.stock-tbl tbody tr').forEach(tr => {
      const uid = +tr.dataset.uid;
      const cb = tr.querySelector('input');
      cb.onchange = () => { if (cb.checked) this.stockSel.add(uid); else this.stockSel.delete(uid); Sound.play('tick'); this.renderStock(); };
    });
    const all = document.getElementById('stock-all');
    if (all) {
      const free = list.filter(it => !eqd.has(it.uid));
      all.checked = free.length > 0 && free.every(it => this.stockSel.has(it.uid));
      all.onchange = () => { for (const it of free) all.checked ? this.stockSel.add(it.uid) : this.stockSel.delete(it.uid); this.renderStock(); };
    }
    el.querySelectorAll('.salv').forEach(btn => { btn.onclick = () => this.salvage([+btn.dataset.uid]); });
    el.querySelectorAll('.salv-tier').forEach(btn => {
      btn.onclick = () => {
        for (const it of list) if (it.bonus <= +btn.dataset.max && !eqd.has(it.uid)) this.stockSel.add(it.uid);
        Sound.play('tick');
        this.renderStock();
      };
    });
    document.getElementById('salv-clear').onclick = () => { this.stockSel.clear(); this.renderStock(); };
    document.getElementById('salv-sel').onclick = () => this.salvage([...this.stockSel]);
  },

  // ブースターを分解して鉱石にする（差し込み中のものは分解できない）
  async salvage(uids) {
    const save = Game.save, eqd = this.equippedUids();
    const items = save.stock.filter(it => uids.includes(it.uid) && !eqd.has(it.uid));
    if (!items.length) return;
    const gain = emptyOre();
    for (const it of items) { const o = salvageOre(it); for (const k of ORES) gain[k.id] += o[k.id]; }
    const txt = ORES.filter(k => gain[k.id]).map(k => `${k.name}×${gain[k.id]}`).join(' ');
    const best = Math.max(...items.map(it => it.bonus));
    const what = items.length === 1 ? boosterName(items[0]) : T('G081' /* ブースター {n}個 */, { n: items.length });
    const warn = best >= BONUS_TIERS[2].min ? T('G082' /* ※ +{best} の高い+値のものが含まれています。 */, { best }) : '';
    if (!await Ask.open(T('G083' /* {what} を分解しますか？ 得られる鉱石：{txt}{w… */, { what, txt, warn }))) return;
    const set = new Set(items.map(it => it.uid));
    save.stock = save.stock.filter(it => !set.has(it.uid));
    for (const u of set) this.stockSel.delete(u);
    for (const k of ORES) save.ore[k.id] += gain[k.id];
    Sound.play('upgrade');
    Game.persist();
    this.renderAll();
  },

  renderStats() {
    const st = computeStats(Game.save.build, null, Game.save.upgrades);
    const row = (k, v, f, warn) => `<tr class="${warn ? 'warn' : ''}"><th>${k}</th><td>${v}</td><td class="bar"><i style="width:${Math.round(clamp(f, 0, 1) * 100)}%"></i></td></tr>`;
    document.getElementById('stats').innerHTML = `<table>
      ${row(T('G084' /* 全高 */), '2.5 m', 1)}
      ${row(T('G085' /* 総耐久 HP */), st.hp, st.hp / 1300)}
      ${row(T('G034' /* 防御 */), fmtNum(st.def), st.def / 25)}
      ${row(T('G086' /* 総出力 */), Math.round(st.power), st.power / 190)}
      ${row(T('G087' /* 重量 / 積載 */), `${st.weight} / ${st.cap}${st.over ? T('G088' /* 過積載！ */) : ''}`, st.weight / st.cap, st.over)}
      ${row(T('G089' /* 最高速度 */), st.speed.toFixed(1) + ' m/s', st.speed / 18)}
      ${row(T('G090' /* 旋回速度 */), Math.round(st.turn * 57.3) + ' °/s', st.turn / 5.5)}
      ${st.jump ? row(T('G049' /* ジャンプ */), T('G091' /* {dist} m / 再使用 {cd} s */, { dist: st.jump.dist, cd: fmtNum(st.jump.cd) }), st.jump.dist / 12) : ''}
      ${row(T('G092' /* 左腕 DPS */), st.armL.dps.toFixed(1), st.armL.dps / 100)}
      ${row(T('G093' /* 右腕 DPS */), st.armR.dps.toFixed(1), st.armR.dps / 100)}
      ${row(T('G028' /* センサー */), fmtNum(st.sensor) + ' m', st.sensor / 75)}
      ${row(T('G026' /* 回路盤 */), `${st.grid}×${st.grid} / ${fmtNum(st.clock)}Hz`, st.clock / 20)}
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
    ctx.fillText(T('G094' /* 上面図（見下ろし） 1マス ≒ 0.4m */), 10, H - 10);
  },

  // ------------------------------------------------------------ 強化
  renderUpgrade() {
    const save = Game.save, ore = save.ore;
    document.getElementById('ore-bank').innerHTML = `<b>${T('G095' /* 所持鉱石 */)}</b>${oreHTML(ore, null, true)}`;
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
        const [, next, nunit] = max ? [] : U.stat(upgradedPart(cat, p, lv + 1));
        const note = U.note ? U.note(p, lv) : '';
        let pips = '';
        // Lv6〜 の目盛りは色を変える（弾数+1・ジャンプ解放の段階）
        for (let i = 0; i < UPGRADE_MAX; i++) pips += `<i class="${i < lv ? 'on' : ''}${i >= 5 ? ' ex' : ''}"></i>`;
        return `<tr class="${eq ? 'eq' : ''}">
          <td class="nm">${p.name}${eq ? `<span class="tag">${T('G059' /* 装着中 */)}</span>` : ''}</td>
          <td class="pips">${pips}<small>Lv${lv}</small></td>
          <td class="val">${name} ${fmtNum(cur)}${unit}${max ? '' : ` → <b>${fmtNum(next)}${nunit}</b>`}${note ? `<small class="note">${note}</small>` : ''}</td>
          <td class="cost">${max ? `<span class="maxed">${T('G096' /* 最大強化 */)}</span>` : oreHTML(cost, ore)}</td>
          <td><button class="up-btn ${ok ? 'primary' : ''}" data-id="${p.id}" data-cat="${cat}" ${ok ? '' : 'disabled'}>${max ? 'MAX' : T('G097' /* 強化 */)}</button></td>
        </tr>`;
      }).join('');
      return `<section class="up-sec"><h3>${U.label}<small>${U.where} / ${U.per}</small></h3><table class="up-tbl">${rows}</table></section>`;
    }).join('');
    el.innerHTML = `<h2>${T('G098' /* パーツ強化 */)}</h2>
      <p class="muted">${T('G099' /* エネミーが落とす鉱石でパーツを強化します（各パーツ最大 Lv… */, { max: UPGRADE_MAX })}<br>
      ${ORES.map(k => `<span class="ore"><i style="background:${k.color}"></i>${k.name}</span>${k.desc}`).join(T('G100' /*  */))}</p>${secs}`;
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
    let html = `<div class="pgroup"><h4>${T('G101' /* ツール */)}</h4>
      <button class="pbtn tool" data-brush="select">✋ ${T('G102' /* 選択・編集 */)}</button>
      <button class="pbtn tool" data-brush="erase">⌫ ${T('G103' /* 消しゴム */)}</button></div>`;
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
      this.brush === 'select' ? T('G104' /* 選択モード：タイルをクリックで編集 */) :
      this.brush === 'erase' ? T('G105' /* 消しゴム：クリックでタイルを削除 */) :
      T('G106' /* 配置モード：「{name}」をクリックで配置 */, { name: def.name });
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
      T('G107' /* 頭部A {name}：使用可能 {grid}×{grid} … */, { name: partLabel(st.parts.headCpu), grid, clock: fmtNum(st.clock), sensor: fmtNum(st.sensor) });
    document.getElementById('prog-slots').innerHTML = Array.from({ length: PROG_SLOTS }, (_, i) =>
      `<button data-slot="${i}" class="${i === Game.save.progSlot ? 'active' : ''}" title="${T('G148' /* 出撃では選んでいる回路を使います */)}">${T('G147' /* 回路{n} */, { n: i + 1 })}</button>`).join('');
    document.querySelectorAll('#prog-slots button').forEach(b => { b.onclick = () => this.selectSlot(+b.dataset.slot); });
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
          `${drag ? ' draggable="true"' : ''}${orphans.has(i) ? ` title="${T('G108' /* 未接続：STARTからつながっていないため実行されません */)}"` : ''}>${tile ? this.tileHTML(tile) : ''}</div>`;
      }
    }
    el.innerHTML = html;
    const ub = document.getElementById('btn-undo');
    ub.disabled = !this.undoStack.length;
    ub.textContent = T('G109' /* ↶ 元に戻す（{n}） */, { n: this.undoStack.length });
    const ob = document.getElementById('btn-orphans');
    ob.disabled = !orphans.size;
    ob.textContent = T('G110' /* 未接続タイルを消去（{n}） */, { n: orphans.size });
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
      T('G111' /* STARTからつながっていないタイルが {n}個 あります（… */, { n });
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

  // 保存してある回路を切り替える（出撃にはこの回路を使う）
  selectSlot(i) {
    if (i === Game.save.progSlot) return;
    Sound.play('ui');
    Game.persist();   // 今の回路を保存枠へ
    Game.save.progSlot = i;
    Game.save.program = Game.save.programs[i];
    this.sel = null;
    Game.persist();
    this.renderCircuit();
    this.renderInspector();
    this.renderSortie();
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

  // 選んでいる回路をファイルに書き出す（ブラウザのダウンロードとして保存される）
  exportProgram() {
    downloadText(`iron-wasteland-circuit${Game.save.progSlot + 1}-${dateStamp()}.json`, circuitToFile(Game.save.program));
    Sound.play('ui');
  },

  // ファイルの回路を、選んでいる回路枠に読み込む（元に戻す で取り消せる）
  async importProgram(file) {
    const r = file.size <= 200000 ? circuitFromFile(await file.text().catch(() => '')) : null;
    if (!r) { await Ask.tell(T('G153' /* 「{name}」は回路のファイルとして読み込めませんでした。 */, { name: file.name })); return; }
    if (!await Ask.open(T('G152' /* 「{name}」を回路{n}に読み込みますか？ 今の回路は上… */, { name: file.name, n: Game.save.progSlot + 1 }))) return;
    this.editProgram(() => { Game.save.program = r.prog; this.sel = null; });
    if (r.skipped) await Ask.tell(T('G154' /* 読み込めないタイルが {n} 個あったため、空きマスにしまし… */, { n: r.skipped }));
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
      el.innerHTML = T('G112' /* タイル設定タイルを選択すると、ここでパラメータや矢印の向きを… */);
      return;
    }
    const def = TILE_DEFS[tile.t];
    const dirPick = (k, label, cls) => `<div class="dirrow"><span class="${cls}">${label}</span>` +
      [0, 1, 2, 3].map(d => `<button class="dbtn ${tile[k] === d ? 'on' : ''}" data-k="${k}" data-d="${d}">${DIR_ARROW[d]}</button>`).join('') + '</div>';
    let html = `<h3>${T('G113' /* タイル設定 */)} <small>(${this.sel.x + 1}, ${this.sel.y + 1})</small></h3>
      <div class="insp-name g-${def.group}">${def.kind === 'cond' ? '◇' : def.icon} ${def.name}</div>
      <p class="muted">${{ start: T('G114' /* 実行開始位置 */), cmd: T('G115' /* コマンド（出口1つ） */), cond: T('G116' /* 判定（YES / NO の2出口） */) }[def.kind]}</p>`;
    if (def.params) {
      html += `<label class="prm">${T('G117' /* パラメータ */)} <select id="insp-p">${def.params.map((v, i) => `<option value="${i}" ${i === tile.p ? 'selected' : ''}>${v}${def.unit}</option>`).join('')}</select></label>`;
    }
    html += dirPick('d', def.kind === 'cond' ? 'YES →' : T('G118' /* 次へ → */), def.kind === 'cond' ? 'yes' : '');
    if (def.kind === 'cond') html += dirPick('n', 'NO →', 'no');
    if (tile.t === 'power') {
      const reg = partById('headReg', Game.save.build.headReg);
      html += `<p class="muted">${T('G119' /* ※頭部B「{name}」の配分範囲（腕{min}〜{max}… */, { name: reg.name, min: Math.round(reg.min * 100), max: Math.round(reg.max * 100) })}</p>`;
    }
    if (tile.t !== 'start') html += `<button id="insp-del" class="danger">${T('G120' /* このタイルを削除 */)}</button>`;
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
    document.getElementById('reg-name').textContent = T('G121' /* {name}（配分範囲：腕 {min}〜{max}% / 出… */, { name: partLabel(reg), min: Math.round(reg.min * 100), max: Math.round(reg.max * 100), eff: reg.eff.toFixed(2) });
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
      <tr><th>${T('G122' /* 総出力（胴体×頭部B） */)}</th><td>${Math.round(st.power)}</td></tr>
      <tr><th>${T('G123' /* 攻撃倍率（腕） */)}</th><td>×${cmp(st.armMult, mid.armMult, '', 2)}</td></tr>
      <tr><th>${T('G124' /* 機動倍率（脚） */)}</th><td>×${cmp(st.legMult, mid.legMult, '', 2)}</td></tr>
      <tr><th>${T('G089' /* 最高速度 */)}</th><td>${cmp(st.speed, mid.speed, ' m/s')}</td></tr>
      <tr><th>${T('G090' /* 旋回速度 */)}</th><td>${Math.round(st.turn * 57.3)} °/s</td></tr>
      <tr><th>${T('G092' /* 左腕 DPS */)}</th><td>${cmp(st.armL.dps, mid.armL.dps)}</td></tr>
      <tr><th>${T('G093' /* 右腕 DPS */)}</th><td>${cmp(st.armR.dps, mid.armR.dps)}</td></tr>`;
  },

  // ------------------------------------------------------------ 対戦
  renderVersus() {
    const el = document.getElementById('versus');
    if (!el) return;
    const save = Game.save;
    const opps = vsOpponents(save);
    if (!opps.some(o => o.id === save.vsSel)) save.vsSel = opps[0].rival ? opps[0].id : 'self' + save.progSlot;
    const me = myMachine(save);
    const summary = (m) => {
      const mm = save.vsFlat ? flatMachine(m) : m;
      const st = computeStats(mm.build, null, mm.upgrades), p = st.parts;
      return `<small>${partLabel(p.armL)} ／ ${partLabel(p.armR)}</small>
        <small>${partLabel(p.torso)} ・ ${partLabel(p.legs)} ・ ${partLabel(p.headCpu)}</small>
        <small class="vs-st">${T('G178' /* HP {hp} / 速度 {speed}m/s / 火力 {… */, { hp: st.hp, speed: st.speed.toFixed(1), dps: Math.round(st.armL.dps + st.armR.dps) })}</small>`;
    };
    const card = (o) => `<div class="vs-card ${o.id === save.vsSel ? 'sel' : ''}" data-id="${o.id}">
        <canvas class="vs-thumb" width="76" height="76"></canvas>
        <div class="vs-info"><b>${escHTML(o.m.name)}</b>${summary(o.m)}
          ${o.rival ? `<small class="vs-rec">${T('G169' /* 戦績 {w}勝 {l}敗 {d}分 */, { w: o.rival.rec.w, l: o.rival.rec.l, d: o.rival.rec.d })}</small>` : ''}</div>
        ${o.rival ? `<button class="vs-del danger" data-id="${o.id}">${T('G170' /* 削除 */)}</button>` : ''}</div>`;
    const stored = opps.filter(o => o.rival), selfs = opps.filter(o => !o.rival);
    el.innerHTML = `<h2>${T('G157' /* 対戦 */)}</h2>
      <p class="muted">${T('G158' /* ほかの人と機体データ（パーツ・強化・ブースター・回路）をファ… */)}</p>
      <section class="vs-sec">
        <h3>${T('G159' /* 自分の対戦用データ */)}</h3>
        <div class="vs-me">
          <canvas class="vs-thumb" id="vs-me-thumb" width="96" height="96"></canvas>
          <div class="vs-info">
            <label class="vs-name">${T('G160' /* 機体名 */)} <input id="vs-name" maxlength="${VS.nameMax}" value="${escHTML(save.pilot)}" placeholder="${escHTML(defaultPilot())}"></label>
            ${summary(me)}
            <small>${T('G162' /* 書き出す内容：今のパーツ・出力配分・強化レベル・差し込んだブ… */, { n: save.progSlot + 1, used: progToTiles(save.program).length })}</small>
          </div>
          <button id="vs-export" class="primary">${T('G163' /* 対戦用データを書き出す */)}</button>
        </div>
      </section>
      <section class="vs-sec">
        <h3>${T('G164' /* 対戦相手 */)} <small>${stored.length} / ${VS.rivals}</small><button id="vs-import">${T('G165' /* 対戦相手を読み込む */)}</button></h3>
        <div class="vs-list">${stored.length ? stored.map(card).join('') : `<p class="empty">${T('G166' /* まだ対戦相手がいません。友だちから受け取った対戦用データ（.… */)}</p>`}</div>
        <h4>${T('G167' /* 練習相手（自分の機体） */)}</h4>
        <div class="vs-list">${selfs.map(card).join('')}</div>
      </section>
      <section class="vs-sec">
        <label class="chk"><input type="checkbox" id="vs-flat" ${save.vsFlat ? 'checked' : ''}> ${T('G171' /* 強化とブースターを無効にする（パーツと回路だけで勝負） */)}</label>
        <p class="muted"><b>${VS_FIELD.name}</b> ${VS_FIELD.desc}</p>
        <button id="btn-versus" class="big primary">${T('G172' /* 対 戦 開 始 */)}</button>
      </section>`;
    drawMachineThumb(document.getElementById('vs-me-thumb'), save.vsFlat ? flatMachine(me) : me);
    el.querySelectorAll('.vs-card').forEach(c => {
      const o = opps.find(x => x.id === c.dataset.id);
      drawMachineThumb(c.querySelector('canvas'), save.vsFlat ? flatMachine(o.m) : o.m);
      c.onclick = () => { save.vsSel = o.id; Sound.play('tick'); Game.persist(); this.renderVersus(); };
    });
    el.querySelectorAll('.vs-del').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const o = opps.find(x => x.id === b.dataset.id);
        if (!await Ask.open(T('G173' /* 「{name}」を対戦相手から削除しますか？（戦績も消えます… */, { name: o.m.name }))) return;
        save.rivals = save.rivals.filter(r => r.id !== o.id);
        Sound.play('erase');
        Game.persist();
        this.renderVersus();
      };
    });
    const nm = document.getElementById('vs-name');
    nm.oninput = () => { save.pilot = cleanName(nm.value); Game.persist(); };
    nm.onchange = () => this.renderVersus();
    document.getElementById('vs-export').onclick = () => this.exportVersus();
    document.getElementById('vs-import').onclick = () => document.getElementById('vs-file').click();
    document.getElementById('vs-flat').onchange = (e) => { save.vsFlat = e.target.checked; Sound.play('tick'); Game.persist(); this.renderVersus(); };
    document.getElementById('btn-versus').onclick = () => Game.versus();
  },

  // 自分の機体（選んでいる回路）を対戦用データとして書き出す
  exportVersus() {
    const m = myMachine(Game.save);
    const safe = m.name.replace(/[\\/:*?"<>|\s]+/g, '_');
    downloadText(`iron-wasteland-vs-${safe}-${dateStamp()}.json`, versusToFile(m));
    Sound.play('ui');
  },

  // 対戦用データのファイルを読み込んで対戦相手に加える（同じ機体名の相手がいれば、置き換えるか確かめる）
  async importRivals(files) {
    const save = Game.save;
    let last = null;
    for (const file of files) {
      const v = file.size <= 200000 ? versusFromText(await file.text().catch(() => '')) : null;
      if (!v) { await Ask.tell(T('G174' /* 「{name}」は対戦用データとして読み込めませんでした。 */, { name: file.name })); continue; }
      const data = machineToData(v.m);
      const same = save.rivals.find(r => r.data.name === data.name);
      if (same) {
        if (!await Ask.open(T('G175' /* 「{name}」はすでに対戦相手にいます。新しいデータで置き… */, { name: data.name }))) continue;
        same.data = data;
        same.got = Date.now();
        last = same.id;
      } else {
        if (save.rivals.length >= VS.rivals) { await Ask.tell(T('G176' /* 対戦相手は {max} 機まで登録できます。いらない相手を削… */, { max: VS.rivals })); break; }
        const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        save.rivals.push({ id, data, rec: { w: 0, l: 0, d: 0 }, got: Date.now() });
        last = id;
      }
      if (v.skipped) await Ask.tell(T('G177' /* 「{name}」の回路に読み込めないタイルが {n} 個あっ… */, { name: data.name, n: v.skipped }));
    }
    if (last) { save.vsSel = last; Sound.play('equip'); }
    Game.persist();
    this.renderVersus();
  },

  // ------------------------------------------------------------ 出撃
  renderSortie() {
    const n = Game.save.enemyCount;
    const F = fieldById(Game.save.field), DS = F.districts;
    const reached = Game.save.reached, floor = Game.save.floor[F.id], fm = floorMul(floor);
    document.getElementById('sortie-title').textContent = T('G125' /* 出撃準備 — {name} {floor}（全{count}… */, { name: F.name, floor: floorName(floor), count: DS.length });
    const fs = document.getElementById('field-select');
    fs.innerHTML = FIELDS.map(f => `
      <button class="field-card ${f.id === F.id ? 'sel' : ''}" data-id="${f.id}">
        <canvas width="96" height="72"></canvas>
        <span><b>${f.name}</b><small>${T('G126' /* 全{floors}層 × {districts}地区（到達 … */, { floors: FLOORS, districts: f.districts.length, reached: floorName(reached[f.id]) })}</small><em>${f.desc}</em></span>
      </button>`).join('');
    fs.querySelectorAll('.field-card').forEach((b, i) => {
      drawFieldThumb(b.querySelector('canvas'), FIELDS[i]);
      b.onclick = () => { Game.save.field = b.dataset.id; Game.persist(); this.renderSortie(); };
    });
    // 層の選択：ボスを倒すと次の層が解放される
    const fl = document.getElementById('floor-select');
    let btns = '';
    for (let f = 1; f <= FLOORS; f++) {
      const lock = f > reached[F.id];
      btns += `<button class="${f === floor ? 'sel' : ''}${lock ? ' lock' : ''}" data-f="${f}" ${lock ? 'disabled' : ''}
        title="${lock ? T('G127' /* 一つ上の層のボスを倒すと解放 */) : T('G128' /* 耐久 {hp} / 攻撃力 {dmg} */, { hp: fmtMul(floorMul(f).hp), dmg: fmtMul(floorMul(f).dmg) })}">${lock ? '🔒' : ''}${floorName(f)}</button>`;
    }
    fl.innerHTML = `<div class="floor-btns">${btns}</div>
      <p>${T('G129' /* {floor}のエネミー（ボス含む）：耐久 {hp} / 攻… */, { floor: floorName(floor), hp: fmtMul(fm.hp), dmg: fmtMul(fm.dmg), ore: fmtMul(fm.ore) })}</p>`;
    fl.querySelectorAll('button:not([disabled])').forEach(b => {
      b.onclick = () => { Game.save.floor[F.id] = +b.dataset.f; Game.persist(); this.renderSortie(); };
    });
    document.getElementById('enemyCount').value = n;
    document.getElementById('enemyCountVal').textContent = T('G145' /* {n} 体 */, { n });
    const rows = DS.map((D, i) => {
      const comp = enemyComposition(n, D);
      const cnt = t => comp.filter(x => x === t).length;
      return `<tr><td>${T('G130' /* {name}「{sub}」 */, { name: D.name, sub: D.sub })}</td><td>${cnt('scarab')}</td><td>${cnt('spitter')}</td><td>${cnt('troll')}</td><td>${T('G146' /* 第1〜{n}地区 */, { n: i + 1 })}</td></tr>`;
    }).join('');
    document.getElementById('composition').innerHTML = `
      <table class="district-tbl">
        <thead><tr><th>${T('G131' /* 地区 */)}</th><th>${ENEMY_DEFS.scarab.name}</th><th>${ENEMY_DEFS.spitter.name}</th><th>${ENEMY_DEFS.troll.name}</th><th>${T('G132' /* 戦闘フィールド */)}</th></tr></thead>
        <tbody>${rows}
          <tr class="boss"><td><b>BOSS</b> ${ENEMY_DEFS[F.boss].name}</td><td colspan="3">${T('G133' /* 3地区の後に出現 */)} / HP ${bossHp(ENEMY_DEFS[F.boss], n, floor)}</td><td>${T('G134' /* 全地区 */)}</td></tr>
        </tbody>
      </table>
      <p class="muted">${T('G135' /* 活動限界は{limit}分。3地区とボス戦を{seg}分ずつ… */, { chance: Math.round(RARE.chance * 100), prefix: RARE.prefix, surge: RARE.surgeMul, hp: RARE.hp, min: BONUS_MIN, max: BONUS_MAX, limit: ACT_LIMIT / 60, seg: ACT_SEG / 60 })}</p>`;
    const st = computeStats(Game.save.build, null, Game.save.upgrades);
    const prog = Game.save.program;
    const warns = [];
    if (st.over) warns.push(T('G136' /* 過積載です（{weight} / {cap}）。速度と旋回が… */, { weight: st.weight, cap: st.cap }));
    if (st.parts.armL.type === 'none' && st.parts.armR.type === 'none') warns.push(T('G137' /* 両腕とも武装がありません。 */));
    let fire = false, used = 0;
    for (let y = 0; y < st.grid; y++) for (let x = 0; x < st.grid; x++) {
      const t = prog[y * MAX_GRID + x];
      if (!t) continue;
      used++;
      if (t.t.startsWith('fire_')) fire = true;
    }
    if (!fire) warns.push(T('G138' /* 回路に攻撃タイルがありません（回路制御では攻撃できません）。 */));
    const hidden = prog.filter((t, i) => t && ((i % MAX_GRID) >= st.grid || Math.floor(i / MAX_GRID) >= st.grid)).length;
    if (hidden) warns.push(T('G139' /* 回路盤の外に {n} 個のタイルがあります（現在の頭部Aでは… */, { n: hidden }));
    document.getElementById('sortie-check').innerHTML =
      T('G140' /* 回路{n}：{used} タイル使用 / {grid}×{g… */, { n: Game.save.progSlot + 1, used, grid: st.grid }) +
      (warns.length ? warns.map(w => `<p class="warn">⚠ ${w}</p>`).join('') : `<p class="ok">✔ ${T('G141' /* 出撃準備完了 */)}</p>`);
  },
};
