'use strict';
// =====================================================================
//  エントリーポイント：画面遷移とセーブ
// =====================================================================

const Game = {
  save: null,

  init() {
    this.save = this.load();
    Sound.init();
    Garage.init();
    document.getElementById('btn-reload').onclick = () => location.reload();
    // 開きっぱなしのタブに戻ってきたときも確認する
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && document.getElementById('screen-garage').classList.contains('active')) this.checkUpdate();
    });
    this.toTitle();
  },

  // タイトル画面：クリックかキーでガレージへ（この操作で音声も有効になる）
  toTitle() {
    this.show('title');
    const scr = document.getElementById('screen-title');
    // プロローグは毎秒 42px ほどの速さで流す（文章の長さが変わっても同じ速さになるよう、高さから時間を決める）
    const crawl = document.getElementById('title-crawl'), inner = crawl.firstElementChild;
    inner.style.animationDuration = ((inner.offsetHeight + crawl.offsetHeight) / 42) + 's';
    const start = (e) => {
      if (e.type === 'keydown' && (e.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key))) return;
      if (e.type === 'keydown' && document.activeElement && document.activeElement.closest('#sound-ctl')) return;
      if (e.type === 'keydown') e.preventDefault();
      scr.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      Sound.play('ui');
      this.toGarage();
    };
    scr.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  },

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.build && Array.isArray(s.program) && s.program.length === MAX_GRID * MAX_GRID) {
        const d = defaultSave();
        const stock = Array.isArray(s.stock) ? s.stock.filter(it => it && PARTS[it.cat] && PARTS[it.cat].some(p => p.id === it.id)) : [];
        const build = Object.assign(d.build, s.build);
        // 装着中のドロップパーツが倉庫に無ければ（分解済みなど）標準パーツ扱いに戻す
        const gear = {};
        for (const [k, g] of Object.entries(build.gear || {})) {
          if (g && build[k] === g.id && stock.some(it => it.uid === g.uid)) gear[k] = g;
        }
        build.gear = gear;
        return {
          build, program: s.program, enemyCount: s.enemyCount || d.enemyCount,
          field: fieldById(s.field).id,
          ore: Object.assign(d.ore, s.ore), upgrades: Object.assign(d.upgrades, s.upgrades),
          stock, nextUid: Math.max(s.nextUid || 1, ...stock.map(it => it.uid + 1)),
        };
      }
    } catch (e) { /* 壊れたセーブは無視 */ }
    return defaultSave();
  },

  persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* 保存不可の環境 */ }
  },

  // 戦闘で持ち帰った鉱石を所持数に加える
  addOre(gain) {
    for (const k of ORES) this.save.ore[k.id] += gain[k.id] || 0;
    this.persist();
  },

  // 戦闘で持ち帰ったパーツを倉庫に加える（uid を振る）
  addParts(list) {
    const now = Date.now();
    for (const p of list) this.save.stock.push({ uid: this.save.nextUid++, cat: p.cat, id: p.id, bonus: p.bonus, got: now, isNew: true });
    this.persist();
  },

  show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  },

  toGarage() {
    this.show('garage');
    Sound.playBgm('garage');
    Garage.onShow();
    this.checkUpdate();
  },

  // Web 版：サーバー上の version.json と自分の版（index.html の game-version）を比べ、
  // 新しい版が公開されていればガレージにお知らせを出す。版の番号はコミット時に自動で書き換わる（.githooks/pre-commit）
  lastCheck: 0,
  async checkUpdate() {
    const meta = document.querySelector('meta[name="game-version"]');
    const cur = meta && meta.content;
    if (!cur || cur === 'dev' || location.protocol === 'file:') return;
    if (performance.now() - this.lastCheck < 30000) return;   // 確認は30秒に1回まで
    this.lastCheck = performance.now();
    try {
      // ブラウザと配信サーバーのキャッシュを通さずに最新の version.json を読む
      const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      const { version } = await r.json();
      if (version && version > cur) document.getElementById('update-banner').classList.add('show');
    } catch (e) { /* オフラインなど */ }
  },

  sortie() {
    Garage.onHide();
    this.show('battle');
    Sound.play('sortie');
    Battle.start(this.save);
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
