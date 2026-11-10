'use strict';
// =====================================================================
//  エンディング：地底神殿でレベルごとに3機の地底のマシンをはじめてすべて倒したとき（= そのレベルで最深部の王機をはじめて倒したとき）に流す（main.js の Game.endAbyss）
//   エピローグ（段落を1つずつ浮かび上がらせる）→ スタッフロール（下から上へ流す）→ 終わったら onDone（戦闘結果を見せる）
//   ・クリック / キー：エピローグは次の段落へ。スタッフロールは押している間だけ早送り。最後の画面は先へ進む
//   ・「スキップ」ボタン / Esc：いまの場面を飛ばす（エピローグ → スタッフロール → 終わり）
//   ・文章は lang.js の C030〜C047。スタッフの名前は CREDIT_NAME
// =====================================================================

const CREDIT_NAME = 'tomozo';   // スタッフロールに出す制作者の名前
// 間（秒）：beforeRoll = エピローグが終わってからスタッフロールが始まるまで / afterRoll = ロールが止まってから「押して続ける」を出すまで
const ENDING_GAP = { beforeRoll: 3.5, afterRoll: 4.5 };

const Ending = {
  phase: null,   // 'epi' エピローグ / 'roll' スタッフロール / 'end' 最後の画面（押すと先へ） / null 流していない
  run: 0,        // 場面が変わるたびに増やす（前の場面の待ち時間を無効にする）
  wake: null,    // エピローグの段落の待ち時間を早めに終わらせる関数
  fast: false,   // スタッフロールの早送り中
  raf: 0,

  init() {
    const scr = document.getElementById('screen-ending');
    const skip = document.getElementById('ending-skip');
    skip.textContent = T('C031' /* スキップ ▶▶ */);
    document.getElementById('ending-prompt').textContent = T('C032' /* クリック または キーを押して続ける */);
    document.getElementById('ending-hint').textContent = T('C033' /* 押し続けると早送り */);
    skip.addEventListener('pointerdown', e => e.stopPropagation());
    skip.onclick = () => { Sound.play('ui'); this.skip(); };
    scr.addEventListener('pointerdown', e => { if (e.button === 0 || e.pointerType !== 'mouse') this.press(true); });
    window.addEventListener('pointerup', () => this.press(false));
    window.addEventListener('pointercancel', () => this.press(false));
    window.addEventListener('keydown', (e) => {
      if (!this.phase || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      if (document.activeElement && document.activeElement.closest('#sound-ctl')) return;
      e.preventDefault();
      if (e.repeat) return;
      if (e.key === 'Escape') this.skip();
      else this.press(true);
    });
    window.addEventListener('keyup', () => this.press(false));
  },

  // 流しはじめる。終わったら（飛ばしたときも）onDone を呼ぶ
  play(onDone) {
    this.onDone = onDone;
    Game.show('ending');
    Sound.playBgm('ending');
    this.epilogue();
  },

  // ---- エピローグ：段落を同じ場所に1つずつ出す（長い段落ほど長く見せる）
  async epilogue() {
    const id = this.begin('epi');
    const scr = document.getElementById('screen-ending'), box = document.getElementById('ending-epi');
    scr.classList.remove('dawn');
    document.getElementById('ending-roll').classList.remove('on');
    document.getElementById('ending-prompt').classList.remove('show');
    document.getElementById('ending-hint').classList.remove('show');
    box.innerHTML = T('C030' /* ― 恒星間探査局 記録 第1号 ― 守門機アルケス。祭祀機ヴ… */);
    box.classList.add('on');
    await this.wait(1.2, id, false);
    for (const p of box.children) {
      if (id !== this.run) return;
      p.classList.add('show');
      const len = p.textContent.replace(/\s+/g, '').length;
      await this.wait(clamp(1.6 + len / (LANG === 'en' ? 15 : 6.5), 3, 9), id, true);
      if (id !== this.run) return;
      p.classList.replace('show', 'gone');
      await this.wait(1.1, id, false);
    }
    // スタッフロールの前の間（暗いまま。押せば早めに始まる）
    if (id === this.run) await this.wait(ENDING_GAP.beforeRoll, id, true);
    if (id === this.run) this.roll();
  },

  // sec 秒待つ。canWake なら押したときに早めに終わる。場面が変わっていたら何もせず終わる
  wait(sec, id, canWake) {
    return new Promise((res) => {
      const done = () => { clearTimeout(tm); if (this.wake === done) this.wake = null; res(); };
      const tm = setTimeout(done, sec * 1000);
      if (canWake && id === this.run) this.wake = done;
    });
  },

  // ---- スタッフロール：下から上へ流し、最後の「THANK YOU FOR PLAYING」が画面の中央に来たら止める
  roll() {
    const id = this.begin('roll');
    document.getElementById('ending-epi').classList.remove('on');
    document.getElementById('screen-ending').classList.add('dawn');
    const roll = document.getElementById('ending-roll'), inner = roll.firstElementChild;
    inner.innerHTML = this.creditsHTML();
    roll.classList.add('on');
    document.getElementById('ending-hint').classList.add('show');
    let y = roll.clientHeight, last = performance.now();
    const fin = inner.querySelector('.cr-fin');
    const target = () => roll.clientHeight / 2 - (fin.offsetTop + fin.offsetHeight / 2);
    const step = (now) => {
      if (id !== this.run) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // 画面の高さに合わせた速さ（縦長のスマホでも同じくらいの時間で流れる）
      y -= dt * Math.max(40, roll.clientHeight / 14) * (this.fast ? 6 : 1);
      if (y <= target()) { y = target(); inner.style.transform = `translateY(${y}px)`; this.finale(); return; }
      inner.style.transform = `translateY(${y}px)`;
      this.raf = requestAnimationFrame(step);
    };
    inner.style.transform = `translateY(${y}px)`;
    this.raf = requestAnimationFrame(step);
  },

  creditsHTML() {
    const sec = (h, body) => `<section class="cr-sec"><h3>${h}</h3>${body}</section>`;
    const names = list => list.map(n => `<p class="cr-name">${n}</p>`).join('');
    const rows = list => list.map(([r, n]) => `<div class="cr-row"><span>${r}</span><b>${n}</b></div>`).join('');
    const E = ENEMY_DEFS;
    return `
      <div class="cr-logo"><h1 class="title-logo">IRON<span>WASTELAND</span></h1><p class="title-sub">${T('C001' /* 荒 野 機 兵 戦 記 */)}</p></div>
      ${sec(T('C034' /* あなたの機兵 */), names([escHTML(Game.save.pilot || defaultPilot())]))}
      ${sec(T('C035' /* 地上の生体 */), names([E.scarab.name, E.spitter.name, E.troll.name, E.boss.name, E.spider.name]))}
      ${sec(T('C036' /* 地底のマシン */), names(ABYSS_MECHS.map(M => M.name)))}
      ${sec(T('C037' /* スタッフ */), rows([
        [T('C038' /* ゲームデザイン */), CREDIT_NAME], [T('C039' /* プログラム */), CREDIT_NAME],
        [T('C040' /* グラフィック */), CREDIT_NAME], [T('C041' /* サウンド */), CREDIT_NAME],
      ]))}
      ${sec(T('C042' /* 開発協力 */), names(['Claude (Anthropic)']))}
      ${sec(T('C043' /* 使用ライブラリ */), names(['three.js<br><small>© three.js authors — MIT License</small>']))}
      ${sec(T('C044' /* スペシャルサンクス */), names([T('C045' /* この星に降り立ったすべての機兵と、そのパイロット */)]))}
      <p class="cr-end">${T('C046' /* そして――回路を組んだ、あなたへ。 */)}</p>
      <div class="cr-fin">THANK YOU FOR PLAYING<small>${T('C047' /* ― 探査任務、完了 ― */)}</small></div>`;
  },

  // ---- 最後の画面：少し待ってから「押して続ける」を出す
  async finale() {
    const id = this.begin('end');
    document.getElementById('ending-hint').classList.remove('show');
    await this.wait(ENDING_GAP.afterRoll, id, false);   // ロールが止まってからの間（この間は押しても進まない。スキップでは進む）
    if (id === this.run) document.getElementById('ending-prompt').classList.add('show');
  },

  // ---- 操作
  begin(phase) {
    cancelAnimationFrame(this.raf);
    if (this.wake) this.wake();
    this.phase = phase;
    this.fast = false;
    return ++this.run;
  },

  press(down) {
    if (this.phase === 'roll') { this.fast = down; return; }
    if (!down) return;
    if (this.phase === 'epi' && this.wake) this.wake();
    else if (this.phase === 'end' && document.getElementById('ending-prompt').classList.contains('show')) this.finish();
  },

  skip() {
    if (this.phase === 'epi') this.roll();
    else if (this.phase === 'roll') {
      // 流れ終わった位置まで送る
      const roll = document.getElementById('ending-roll'), inner = roll.firstElementChild, fin = inner.querySelector('.cr-fin');
      inner.style.transform = `translateY(${roll.clientHeight / 2 - (fin.offsetTop + fin.offsetHeight / 2)}px)`;
      this.finale();
    } else if (this.phase === 'end') this.finish();
  },

  finish() {
    this.begin(null);
    this.phase = null;
    Sound.play('ui');
    const done = this.onDone;
    this.onDone = null;
    if (done) done();
  },
};
