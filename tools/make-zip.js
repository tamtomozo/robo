#!/usr/bin/env node
'use strict';
// =====================================================================
//  投稿サイト（itch.io・ふりーむ! など）に上げる zip を作る
//   node tools/make-zip.js                       … dist/iron-wasteland-<版>.zip を作る
//   node tools/make-zip.js --push 名前/ゲーム名   … 作ったあと butler で itch.io の html5 チャンネルに上げる
//  ・入れるのは遊ぶのに要るファイルだけ（index.html・version.json・css/・js/）
//    tools/・test_sound.html・.githooks などは入れない
//  ・zip の中は index.html が一番上（itch.io などはこの形でないと起動しない）
//  ・パスの区切りは必ず「/」（Windows の Compress-Archive は「\」になることがあり、サイト側で開けない）
//  ・版の番号は index.html の game-version のまま（コミット時に .githooks/pre-commit が書き換える）
// =====================================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INCLUDE = ['index.html', 'version.json', 'css', 'js'];

// ---- 入れるファイルを集める（フォルダは中身をすべて）
function collect(rel, out) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) collect(rel + '/' + name, out);
  } else {
    out.push(rel);
  }
  return out;
}
const files = INCLUDE.flatMap(rel => collect(rel, []));

// ---- 版の番号
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<meta name="game-version" content="([^"]*)"/);
const version = m ? m[1] : 'dev';

// ---- まだコミットしていない変更があれば知らせる（版の番号が古いままになるため）
try {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...INCLUDE], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty) console.warn('※ コミットしていない変更があります。zip には今のファイルが入りますが、版の番号は前のコミットのままです');
} catch (e) { /* git がなくても zip は作る */ }

// ---- zip を組み立てる（外部のツールに頼らず、Node だけで作る）
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
const parts = [];
const central = [];
let offset = 0;
for (const rel of files) {
  const data = fs.readFileSync(path.join(ROOT, rel));
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const crc = zlib.crc32(data);
  const name = Buffer.from(rel, 'utf8');
  const { time, date } = dosTime(fs.statSync(path.join(ROOT, rel)).mtime);
  const FLAG_UTF8 = 0x0800;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);            // 展開に必要な版
  local.writeUInt16LE(FLAG_UTF8, 6);
  local.writeUInt16LE(8, 8);             // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  parts.push(local, name, comp);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(FLAG_UTF8, 8);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt16LE(time, 12);
  cen.writeUInt16LE(date, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(comp.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(offset, 42);
  central.push(cen, name);

  offset += local.length + name.length + comp.length;
}
const cenBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cenBuf.length, 12);
end.writeUInt32LE(offset, 16);

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `iron-wasteland-${version}.zip`);
fs.writeFileSync(out, Buffer.concat([...parts, cenBuf, end]));
const kb = n => (n / 1024).toFixed(0) + 'KB';
console.log(`作成：dist/${path.basename(out)}（${files.length} ファイル・${kb(fs.statSync(out).size)}）`);

// ---- --push 名前/ゲーム名 … butler（itch.io の公式アップロードツール）で上げる
const i = process.argv.indexOf('--push');
if (i >= 0) {
  const target = process.argv[i + 1];
  if (!target || !target.includes('/')) {
    console.error('--push のあとに itch.io の「ユーザー名/ゲームのURL名」を書いてください（例：--push tamtomozo/iron-wasteland）');
    process.exit(1);
  }
  try {
    execFileSync('butler', ['push', out, `${target}:html5`, '--userversion', version], { stdio: 'inherit' });
  } catch (e) {
    console.error('butler で上げられませんでした。butler を入れて「butler login」を済ませてあるか確認してください');
    process.exit(1);
  }
}
