#!/usr/bin/env node
'use strict';
// =====================================================================
//  ランディングページ（lp/）の画像を書き出す
//   node tools/make-lp-shots.js
//  ・画面写真：dist/rec-*.mp4（tools/record.js で録った動画）から SHOTS のコマを切り出して lp/img/*.webp に
//  ・メイン画像：tools/cover.html の絵を文字なしで描いて lp/img/key-art.webp に
//  ・SNS 用画像（OGP）：カバー絵（文字あり・日本語版）を 1200×630 に収めて lp/img/ogp.jpg に
//  使う部品は record.js と同じ（はじめに一度だけ cd tools && npm install）。Edge か Chrome を使う
//  録り直した動画で絵柄が変わったら、SHOTS の秒数を選び直す
// =====================================================================
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  console.error('部品が入っていません。はじめに一度だけ次を実行してください：\n  cd tools && npm install');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'lp', 'img');
const WIDTH = 1280;      // 画面写真の幅（px）
const QUALITY = 0.8;     // WebP の画質

// 出力名 → [動画, 秒]
const SHOTS = {
  build:   ['rec-garage.mp4', 13.8],   // 組立（スケルトンにパーツを装着）
  circuit: ['rec-garage.mp4', 33.8],   // 回路タイルのプログラム
  power:   ['rec-garage.mp4', 38.8],   // 出力配分
  swarm:   ['rec-combo.mp4', 26.3],    // ガトリング＋ミサイルで群れを掃討
  waste:   ['rec-battle.mp4', 6.3],    // 荒野 第7区画
  worm:    ['rec-boss.mp4', 28.8],     // 砂礫王グラヴォルム
  cave:    ['rec-cave5.mp4', 58.7],    // 奈落の大空洞
  spider:  ['rec-cave5.mp4', 240.3],   // 蒼晶蜘蛛ノクタラクネ
  versus:  ['rec-versus.mp4', 23.8],   // 闘技場での対戦
};

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

(async () => {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('Edge か Chrome が見つかりません'); process.exit(1); }
  for (const [v] of Object.values(SHOTS)) {
    if (!fs.existsSync(path.join(DIST, v))) { console.error(`動画がありません：dist/${v}（node tools/record.js で録ってください）`); process.exit(1); }
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--allow-file-access-from-files'] });
  const save = (name, dataURL) => {
    const f = path.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(dataURL.split(',')[1], 'base64'));
    console.log(`書き出しました：${path.relative(ROOT, f)}（${Math.round(fs.statSync(f).size / 1024)} KB）`);
  };

  // ---------------------------------------------------------------- 画面写真
  // file:// のページから file:// の動画を読む（about:blank からは読めない）
  const pg = await browser.newPage();
  const blank = path.join(DIST, '_lp-shots.html');
  fs.writeFileSync(blank, '<!DOCTYPE html><body></body>');
  await pg.goto(pathToFileURL(blank).href);
  for (const [name, [video, sec]] of Object.entries(SHOTS)) {
    const url = await pg.evaluate(async ({ src, sec, width, q }) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto';
      const wait = (ev, what) => new Promise((ok, ng) => {
        v.addEventListener(ev, ok, { once: true });
        v.addEventListener('error', () => ng(new Error(`${what}：動画を読めません`)), { once: true });
        setTimeout(() => ng(new Error(`${what}：時間切れ`)), 30000);
      });
      const loaded = wait('loadeddata', '読み込み');
      v.src = src; document.body.appendChild(v);
      await loaded;
      // seeked の直後はまだ前のコマのことがあるので、頭出し先のコマが届くまで待つ
      const frame = new Promise(ok => {
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(ok);
        setTimeout(ok, 3000);
      });
      const seeked = wait('seeked', '頭出し');
      v.currentTime = sec;
      await seeked;
      await frame;
      await new Promise(ok => setTimeout(ok, 200));
      const c = document.createElement('canvas');
      c.width = width; c.height = Math.round(v.videoHeight * width / v.videoWidth);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(v, 0, 0, c.width, c.height);
      v.remove();
      return c.toDataURL('image/webp', q);
    }, { src: pathToFileURL(path.join(DIST, video)).href, sec, width: WIDTH, q: QUALITY });
    save(`${name}.webp`, url);
  }
  fs.unlinkSync(blank);
  await pg.close();

  // ---------------------------------------------------------------- カバー絵（文字なし／文字あり）
  const cover = pathToFileURL(path.join(__dirname, 'cover.html')).href + '#shot';
  async function drawCover(noText) {
    const p = await browser.newPage({ viewport: { width: 700, height: 600 } });
    // 文字なし：タイトルとキャッチコピーを描く fillText を何もしないものにする
    if (noText) await p.addInitScript(() => { CanvasRenderingContext2D.prototype.fillText = function () {}; });
    await p.goto(cover);
    await p.waitForTimeout(500);
    const url = await p.evaluate(() => document.getElementById('cv').toDataURL('image/png'));
    await p.close();
    return url;
  }
  const art = await drawCover(true);
  const titled = await drawCover(false);

  const pc = await browser.newPage();
  // メイン画像（1260×1000 の上 860px → WebP）。下は副題の飾り線（fillRect で描くので消えない）があるので切り落とす
  save('key-art.webp', await pc.evaluate(async ({ src, q }) => {
    const img = new Image(); img.src = src; await img.decode();
    const h = 860;
    const c = document.createElement('canvas'); c.width = img.width; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, img.width, h, 0, 0, img.width, h);
    return c.toDataURL('image/webp', q);
  }, { src: art, q: QUALITY }));
  // OGP（1200×630）：文字ありのカバーを中央に、左右は同じ絵をぼかして暗く敷く
  save('ogp.jpg', await pc.evaluate(async ({ bg, fg }) => {
    const load = async s => { const i = new Image(); i.src = s; await i.decode(); return i; };
    const [b, f] = [await load(bg), await load(fg)];
    const W = 1200, H = 630;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.filter = 'blur(18px) brightness(0.45)';
    const s = W / b.width;
    x.drawImage(b, 0, (H - b.height * s) / 2, W, b.height * s);
    x.filter = 'none';
    const fh = H, fw = f.width * fh / f.height;
    x.shadowColor = 'rgba(0,0,0,0.7)'; x.shadowBlur = 40;
    x.drawImage(f, (W - fw) / 2, 0, fw, fh);
    return c.toDataURL('image/jpeg', 0.86);
  }, { bg: art, fg: titled }));
  await pc.close();

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
