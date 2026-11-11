#!/usr/bin/env node
'use strict';
// =====================================================================
//  投稿サイト（itch.io など）用のカバー画像を書き出す
//   node tools/make-cover.js   … dist/ に日本語版と英語版を、それぞれ 630×500 と 1260×1000 で作る
//                                 （cover-630x500.png / cover-1260x1000.png / cover-en-630x500.png / cover-en-1260x1000.png）
//  ・絵は tools/cover.html が描く（ゲーム本体の js/ の描画コードを使う）
//  ・Edge か Chrome のヘッドレス機能で画面を撮る
// =====================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
const browser = BROWSERS.find(p => fs.existsSync(p));
if (!browser) {
  console.error('Edge か Chrome が見つかりません。tools/cover.html をブラウザで開いて「PNG を保存」を押してください。');
  process.exit(1);
}

fs.mkdirSync(DIST, { recursive: true });
const base = pathToFileURL(path.join(__dirname, 'cover.html')).href;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'iw-cover-'));

for (const lang of ['ja', 'en']) for (const scale of [1, 2]) {
  const url = base + (lang === 'en' ? '?lang=en' : '') + '#shot';
  const out = path.join(DIST, `cover${lang === 'en' ? '-en' : ''}-${630 * scale}x${500 * scale}.png`);
  // ブラウザは日本語などを含む保存先に書けないことがあるので、一時フォルダに撮ってから移す
  const tmp = path.join(profile, 'shot.png');
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--force-device-scale-factor=${scale}`, '--window-size=630,500', '--virtual-time-budget=2000',
    `--user-data-dir=${profile}`, `--screenshot=${tmp}`, url,
  ], { stdio: 'ignore' });
  if (!waitFile(tmp, 30000)) { console.error(`書き出しに失敗しました：${out}`); process.exit(1); }
  fs.copyFileSync(tmp, out);
  console.log(`書き出しました：${path.relative(ROOT, out)}`);
}
sleep(1000);   // ブラウザが一時フォルダを手放すのを待つ
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 残っても害はない */ }

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Edge は起動してすぐ戻り、画像はあとから書かれるため、ファイルができて大きさが落ち着くまで待つ
function waitFile(f, timeout) {
  let last = -1;
  for (const end = Date.now() + timeout; Date.now() < end; sleep(300)) {
    const size = fs.existsSync(f) ? fs.statSync(f).size : -1;
    if (size > 0 && size === last) return true;
    last = size;
  }
  return false;
}
