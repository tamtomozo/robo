'use strict';
// =====================================================================
//  セーブファイル：進み具合をファイルに書き出す・ファイルから読み込む（タイトル画面のボタン）
//   ・入れるのはセーブ（Game.save）だけ。音量・言語・2D/3D 表示などの設定は入れない
//   ・中身を読まれず、書き換えたら読み込めないよう暗号化する
//     ファイル（.iwsave）= 目印 'IWSV'(4) ＋ 形式の版(1) ＋ フラグ(1) ＋ salt(16) ＋ iv(12) ＋ 暗号文
//       フラグ：1 = 中身を圧縮している（CompressionStream が無いブラウザでは圧縮せずに書く）
//     暗号文 = { game, kind: 'save', version, at（書き出した時刻）, save } の JSON を圧縮し、AES-GCM（256bit）で暗号化したもの
//     鍵 = ゲームに埋め込んだ秘密の値（secret）と、ファイルごとにランダムな salt から PBKDF2 で作る
//     先頭 34 バイトも AES-GCM の追加認証データに入れるので、ファイルのどこを1バイト変えても復号に失敗する
//   ・鍵の元はコードの中にあるので、コードを読み解けば解ける。防げるのは「中身をのぞく」「数値を書き換える」まで
//     （ランキングなど不正を本当に防ぎたいものは、サーバー側で確かめる）
//   ・読み込んだセーブは Game.fromObj（main.js）で localStorage のセーブと同じように確かめ、回路はタイルを1枚ずつ確かめ直す
//   ・読み込む前のセーブは SAVE_BACKUP_KEY に1つだけ控えておく（画面からは戻せない。困ったときの手当て用）
//   ・Web Crypto（crypto.subtle）は https・localhost でしか使えない。使えない環境ではボタンを押すと知らせる
// =====================================================================

const SAVE_FILE = { game: 'iron-wasteland', kind: 'save', version: 1 };
const SAVE_FILE_EXT = '.iwsave';
const SAVE_FILE_MAX = 4 * 1024 * 1024;   // これより大きいファイルは読まない
const SAVE_BACKUP_KEY = SAVE_KEY + '_backup';

const SaveFile = {
  MAGIC: [0x49, 0x57, 0x53, 0x56],   // 'IWSV'
  FORMAT: 1,     // ファイルの形の版（暗号や並びを変えたら上げる。中身の JSON の版は SAVE_FILE.version）
  HEAD: 34,      // 目印〜iv までのバイト数
  ITER: 120000,  // PBKDF2 の繰り返し回数
  busy: false,

  init() {
    const box = document.getElementById('save-ctl');
    // タイトル画面はクリックでスタートするので、ここを押したときはスタートさせない
    box.addEventListener('pointerdown', e => e.stopPropagation());
    const f = document.getElementById('save-file');
    document.getElementById('btn-save-export').onclick = (e) => { e.currentTarget.blur(); this.exportFile(); };
    document.getElementById('btn-save-import').onclick = (e) => { e.currentTarget.blur(); f.value = ''; f.click(); };
    f.onchange = () => { const file = f.files[0]; f.value = ''; if (file) this.importFile(file); };
  },

  usable() {
    return !!(window.isSecureContext !== false && window.crypto && crypto.subtle && crypto.getRandomValues);
  },

  // 秘密の値（32 バイト）。文字列のまま置かず、種の数と名前から作る（コードを検索しても見つけにくくするだけの目くらまし）
  secret() {
    const seed = [0x5a17c3e9, 0x0b9d4f21, 0x77e2a85c, 0xc4316d0f];
    let x = 0x811c9dc5;
    for (const c of 'iron-wasteland/save') x = Math.imul(x ^ c.charCodeAt(0), 0x01000193);
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      x ^= seed[i & 3];
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      out[i] = (x >>> ((i & 3) * 8)) & 255;
    }
    return out;
  },

  async key(salt, use) {
    const base = await crypto.subtle.importKey('raw', this.secret(), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: this.ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, [use]);
  },

  // バイト列を圧縮・展開のストリームに通す
  async pipe(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  },

  // セーブ → ファイルの中身（Uint8Array）
  async encode(save) {
    let body = new TextEncoder().encode(JSON.stringify(Object.assign({}, SAVE_FILE, { at: Date.now(), save })));
    let flags = 0;
    if (typeof CompressionStream === 'function') {
      try { body = await this.pipe(body, new CompressionStream('deflate')); flags |= 1; } catch (e) { /* 圧縮せずに書く */ }
    }
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const head = new Uint8Array(this.HEAD);
    head.set(this.MAGIC, 0);
    head[4] = this.FORMAT;
    head[5] = flags;
    head.set(salt, 6);
    head.set(iv, 22);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: head }, await this.key(salt, 'encrypt'), body));
    const out = new Uint8Array(head.length + ct.length);
    out.set(head);
    out.set(ct, head.length);
    return out;
  },

  // ファイルの中身 → { save, at } / 読めなければ { error: 'broken'（壊れている・書き換えられている）| 'newer'（新しい版）| 'env'（環境） }
  async decode(bytes) {
    const bad = { error: 'broken' };
    if (bytes.length < this.HEAD + 16 || this.MAGIC.some((v, i) => bytes[i] !== v)) return bad;
    if (bytes[4] > this.FORMAT) return { error: 'newer' };
    if (bytes[4] !== this.FORMAT) return bad;
    const head = bytes.slice(0, this.HEAD), salt = bytes.slice(6, 22), iv = bytes.slice(22, this.HEAD);
    let body;
    try {
      body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: head }, await this.key(salt, 'decrypt'), bytes.slice(this.HEAD)));
    } catch (e) { return bad; }
    if (head[5] & 1) {
      if (typeof DecompressionStream !== 'function') return { error: 'env' };
      try { body = await this.pipe(body, new DecompressionStream('deflate')); } catch (e) { return bad; }
    }
    let o;
    try { o = JSON.parse(new TextDecoder().decode(body)); } catch (e) { return bad; }
    if (!o || o.game !== SAVE_FILE.game || o.kind !== SAVE_FILE.kind) return bad;
    if (!(o.version <= SAVE_FILE.version)) return { error: 'newer' };
    let save = null;
    try { save = Game.fromObj(o.save); } catch (e) { /* 下で bad */ }
    if (!save) return bad;
    // 回路はタイルを1枚ずつ確かめ直す（おかしなタイルは空きマスにする）
    save.programs = save.programs.map(p => { try { return tilesToProg(progToTiles(p)).prog; } catch (e) { return defaultProgram(); } });
    save.program = save.programs[save.progSlot];
    return { save, at: +o.at || 0 };
  },

  async exportFile() {
    if (!this.usable()) { Ask.tell(T('C022' /* この環境ではセーブファイルを使えません。 https で開い… */)); return; }
    if (this.busy) return;
    this.busy = true;
    try {
      Game.persist();
      const bytes = await this.encode(Game.save);
      downloadBlob(`iron-wasteland-save-${dateStamp()}${SAVE_FILE_EXT}`, new Blob([bytes], { type: 'application/octet-stream' }));
      Sound.play('ui');
    } catch (e) {
      console.error(e);
      Ask.tell(T('C023' /* セーブファイルを書き出せませんでした。 */));
    } finally {
      this.busy = false;
    }
  },

  async importFile(file) {
    if (!this.usable()) { Ask.tell(T('C022' /* この環境ではセーブファイルを使えません。 https で開い… */)); return; }
    if (this.busy) return;
    this.busy = true;
    try {
      const r = file.size <= SAVE_FILE_MAX ? await this.decode(new Uint8Array(await file.arrayBuffer())) : { error: 'broken' };
      if (r.error) {
        const name = file.name;
        await Ask.tell(r.error === 'newer' ? T('C025' /* 「{name}」は新しい版のゲームで書き出されたセーブファイ… */, { name })
          : r.error === 'env' ? T('C022' /* この環境ではセーブファイルを使えません。 https で開い… */)
          : T('C024' /* 「{name}」はセーブファイルとして読み込めませんでした。… */, { name }));
        return;
      }
      const date = r.at ? new Date(r.at).toLocaleString(LANG === 'en' ? 'en-US' : 'ja-JP') : '?';
      if (!await Ask.open(T('C026' /* {date} に書き出したセーブを読み込みます。 今の進み具… */, { date }))) return;
      try {
        const cur = localStorage.getItem(SAVE_KEY);
        if (cur) localStorage.setItem(SAVE_BACKUP_KEY, cur);
      } catch (e) { /* 控えが取れなくても読み込みは続ける */ }
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(r.save));
      } catch (e) {
        await Ask.tell(T('C028' /* セーブを保存できませんでした。（ブラウザの保存領域が使えませ… */));
        return;
      }
      await Ask.tell(T('C027' /* セーブを読み込みました。 */));
      location.reload();   // ガレージなどを読み込んだセーブで作り直す
    } catch (e) {
      console.error(e);
      await Ask.tell(T('C024' /* 「{name}」はセーブファイルとして読み込めませんでした。… */, { name: file.name }));
    } finally {
      this.busy = false;
    }
  },
};
