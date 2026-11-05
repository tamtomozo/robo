'use strict';
// =====================================================================
//  エントリーポイント：画面遷移とセーブ
// =====================================================================

const Game = {
  save: null,

  init() {
    I18N.apply();   // 英語なら HTML の文章を差し替える（プロローグの高さを測る toTitle より前に）
    this.save = this.load();
    Sound.init();
    Ask.init();
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
      if (e.type === 'keydown' && document.activeElement && document.activeElement.closest('#sound-ctl, #lang-ctl')) return;
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
        for (const it of stock) it.bonus = clamp(it.bonus | 0, BONUS_MIN, BONUS_MAX);   // 範囲を変える前のものは範囲内に丸める
        const build = Object.assign(d.build, s.build);
        // 差し込んだブースターが手元に無ければ（分解済みなど）外す
        const gear = {};
        for (const [k, g] of Object.entries(build.gear || {})) {
          const it = g && stock.find(x => x.uid === g.uid);
          if (it && build[k] === g.id) gear[k] = { uid: it.uid, id: it.id, bonus: it.bonus };
        }
        build.gear = gear;
        // 階層：解放済みの層と出撃する層（階層の無い頃のセーブは第1層から）
        const reached = d.reached, floor = d.floor;
        for (const f of FIELDS) {
          reached[f.id] = clamp((s.reached && s.reached[f.id]) | 0, 1, FLOORS);
          floor[f.id] = clamp((s.floor && s.floor[f.id]) | 0, 1, reached[f.id]);
        }
        // 回路：保存枠（枠の無い頃のセーブは今の回路を1番に入れる）
        const okProg = p => Array.isArray(p) && p.length === MAX_GRID * MAX_GRID;
        const progSlot = clamp(s.progSlot | 0, 0, PROG_SLOTS - 1);
        const programs = d.programs.map((p, i) => (Array.isArray(s.programs) && okProg(s.programs[i]) ? s.programs[i] : p));
        programs[progSlot] = s.program;
        return {
          build, program: s.program, programs, progSlot, enemyCount: s.enemyCount || d.enemyCount,
          field: fieldById(s.field).id, floor, reached,
          ore: Object.assign(d.ore, s.ore), upgrades: Object.assign(d.upgrades, s.upgrades),
          stock, nextUid: Math.max(s.nextUid || 1, ...stock.map(it => it.uid + 1)),
        };
      }
    } catch (e) { /* 壊れたセーブは無視 */ }
    return defaultSave();
  },

  persist() {
    this.save.programs[this.save.progSlot] = this.save.program;   // 回路を丸ごと差し替えたときも保存枠に反映する
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* 保存不可の環境 */ }
  },

  // 戦闘で持ち帰った鉱石を所持数に加える
  addOre(gain) {
    for (const k of ORES) this.save.ore[k.id] += gain[k.id] || 0;
    this.persist();
  },

  // 戦闘で持ち帰ったブースターを所持品に加える（uid を振る）
  addParts(list) {
    const now = Date.now();
    for (const p of list) this.save.stock.push({ uid: this.save.nextUid++, cat: p.cat, id: p.id, bonus: p.bonus, got: now, isNew: true });
    this.persist();
  },

  // ボスを倒した層の次の層を解放する（初めて解放したら次の出撃先にする）。解放した層を返す
  unlockFloor(fieldId, floor) {
    const next = Math.min(FLOORS, floor + 1);
    if (next <= this.save.reached[fieldId]) return 0;
    this.save.reached[fieldId] = next;
    this.save.floor[fieldId] = next;
    this.persist();
    return next;
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

// =====================================================================
//  ゲーム内の確認ダイアログ：if (!await Ask.open('〜しますか？')) return;
//   ・ブラウザの confirm() は全画面表示（itch.io の全画面ボタンなど）を解除してしまうため代わりに使う
//   ・文章の改行はそのまま表示する。Enter で「はい」、Esc で「キャンセル」
//     （全画面中の Esc はブラウザが全画面の解除に使うので、ボタンでも選べるようにしてある）
//   ・開いている間はほかのキー操作（回路の Ctrl+Z など）を通さない
// =====================================================================
const Ask = {
  resolve: null,

  init() {
    document.getElementById('ask-yes').onclick = () => this.close(true);
    document.getElementById('ask-no').onclick = () => this.close(false);
    // 捕捉段階で先に受け取り、ほかの keydown に届かないようにする
    window.addEventListener('keydown', (e) => {
      if (!this.resolve || e.key === 'Tab') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === 'Escape') this.close(false);
      // Tab で「キャンセル」を選んでいるときの Enter はキャンセル
      if (e.key === 'Enter') this.close(document.activeElement !== document.getElementById('ask-no'));
    }, true);
  },

  open(text) {
    this.close(false);   // 開いたままのものがあれば、キャンセル扱いで閉じる
    document.getElementById('ask-body').textContent = text;
    document.getElementById('ask-dialog').classList.add('show');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    Sound.play('ui');
    return new Promise(r => { this.resolve = r; });
  },

  close(ans) {
    if (!this.resolve) return;
    const r = this.resolve;
    this.resolve = null;
    document.getElementById('ask-dialog').classList.remove('show');
    r(ans);
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
