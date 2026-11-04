#!/usr/bin/env node
'use strict';
// =====================================================================
//  翻訳の確認：js/lang.js と、それを使う JS・index.html がそろっているかを調べる
//   node tools/check-lang.js        … 調べるだけ（問題があれば終了コード 1）
//   node tools/check-lang.js --fix  … 呼び出しのコメントと index.html の日本語を lang.js の ja に合わせて書き直す
//  調べること
//   ・T('キー') / data-i18n のキーが lang.js にあるか、lang.js のキーがどこかで使われているか
//   ・ja と en の両方があるか、{名前} が ja と en でそろっているか、呼び出しでその値を渡しているか
//   ・呼び出しのコメント /* … */ と index.html の中身が ja の写しになっているか（--fix で直せる）
//  コミット時にも .githooks/pre-commit から実行される
// =====================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = process.argv.includes('--fix');
const errors = [];
let fixed = 0;
const err = (where, msg) => errors.push(`${where}: ${msg}`);

// ---- lang.js を読む
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/lang.js'), 'utf8') + '\nthis.TEXT = TEXT;', ctx);
const TEXT = ctx.TEXT;
const used = new Set();
const holes = s => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]));

for (const [key, e] of Object.entries(TEXT)) {
  const where = `lang.js ${key}`;
  if (!/^[CGBR]\d{3}$/.test(key) && !/^[a-z]+(\.\w+)+$/.test(key)) err(where, 'キーの形が「接頭語＋3桁の番号」でも「名前空間.id.項目」でもない');
  for (const l of ['ja', 'en']) {
    // 空白だけ・空文字は、わざとそうしている場合がある（英語では付けない助数詞など）ので、書いてあれば良しとする
    if (typeof e[l] !== 'string' && typeof e[l] !== 'function') err(where, `${l} がない`);
  }
  if (typeof e.ja === 'string' && typeof e.en === 'string') {
    const a = [...holes(e.ja)].sort().join(','), b = [...holes(e.en)].sort().join(',');
    if (a !== b) err(where, `{名前} が ja（${a || 'なし'}）と en（${b || 'なし'}）で違う`);
  }
}

// コメントにする日本語（タグを除き、空白をまとめ、30文字で切る）
const commentOf = ja => {
  let s = String(ja).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > 30) s = s.slice(0, 30) + '…';
  return s.replace(/\*\//g, '* /');
};

// 式を読み飛ばす（文字列・テンプレート・括弧の入れ子を追う）。深さ0の end の位置を返す
function scanTo(src, i, ends) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') { i++; while (src[i] !== c) i += src[i] === '\\' ? 2 : 1; i++; continue; }
    if (c === '`') {
      i++;
      while (src[i] !== '`') {
        if (src[i] === '\\') i += 2;
        else if (src[i] === '$' && src[i + 1] === '{') i = scanTo(src, i + 2, '}') + 1;
        else i++;
      }
      i++; continue;
    }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (depth === 0 && ends.includes(c)) return i;
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    i++;
  }
  return i;
}

// 行コメント（// …）を同じ長さの空白にする。文字列・テンプレート・ブロックコメントの中の // はそのまま
function maskLineComments(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') { i++; while (i < src.length && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1; i++; continue; }
    if (c === '`') { i++; while (i < src.length && src[i] !== '`') i += src[i] === '\\' ? 2 : 1; i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') out[i++] = ' '; continue; }
    // 正規表現リテラル（/…/）の中の ' や ` で迷わないよう、/ の前が値でなければ読み飛ばす
    if (c === '/' && !/[\w$)\]]\s*$/.test(src.slice(Math.max(0, i - 20), i))) {
      let j = i + 1, cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
        j++;
      }
      if (src[j] === '/') { i = j + 1; continue; }
    }
    i++;
  }
  return out.join('');
}

// ---- JS の T() 呼び出し
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && f !== 'lang.js');
for (const f of jsFiles) {
  const fp = path.join(ROOT, 'js', f);
  let src = fs.readFileSync(fp, 'utf8');
  const code = maskLineComments(src);   // 行コメントの中の T() は数えない（位置は src と同じ）
  const edits = [];
  const re = /(?<![\w$.])T\(\s*/g;
  let m;
  while ((m = re.exec(code))) {
    const line = src.slice(0, m.index).split('\n').length;
    const where = `js/${f}:${line}`;
    const at = m.index + m[0].length;
    const km = src.slice(at).match(/^'([^'\\\n]+)'/);
    if (!km) {
      if (f !== 'i18n.js') err(where, 'T() のキーは文字列でそのまま書く（変数や式にすると確認できない）');
      continue;
    }
    const key = km[1];
    used.add(key);
    const e = TEXT[key];
    if (!e) { err(where, `キー ${key} が lang.js にない`); continue; }
    // コメント
    let p = at + km[0].length;
    const cm = src.slice(p).match(/^\s*\/\*\s?([\s\S]*?)\s?\*\//);
    const want = commentOf(e.ja);
    if (!cm || cm[1].trim() !== want) {
      if (FIX) edits.push([p, p + (cm ? cm[0].length : 0), ` /* ${want} */`]);
      else err(where, `${key} のコメントが ja の写しと違う（期待：/* ${want} */）`);
    }
    if (cm) p += cm[0].length;
    // 渡している値
    const rest = src.slice(p).match(/^\s*,\s*\{/);
    const given = new Set();
    if (rest) {
      const ob = p + rest[0].length;
      const end = scanTo(src, ob, '}');
      const body = src.slice(ob, end);
      let s = 0;
      while (s < body.length) {
        const e2 = scanTo(body, s, ',');
        const k = body.slice(s, e2).trim().match(/^(\w+)/);
        if (k) given.add(k[1]);
        s = e2 + 1;
      }
    }
    const need = new Set([...holes(e.ja), ...(typeof e.en === 'string' ? holes(e.en) : [])]);
    for (const n of need) if (!given.has(n)) err(where, `${key} に必要な値 ${n} を渡していない`);
    if (typeof e.ja === 'string' && typeof e.en === 'string') for (const n of given) if (!need.has(n)) err(where, `${key} は値 ${n} を使わない`);
  }
  if (edits.length) {
    for (const [a, b, t] of edits.sort((x, y) => y[0] - x[0])) src = src.slice(0, a) + t + src.slice(b);
    fs.writeFileSync(fp, src);
    fixed += edits.length;
  }
}

// ---- index.html の data-i18n / data-i18n-title
{
  const fp = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(fp, 'utf8');
  const norm = s => s.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
  const edits = [];
  for (const m of html.matchAll(/data-i18n(-title)?="([^"]+)"/g)) {
    const key = m[2], isTitle = !!m[1];
    const where = `index.html:${html.slice(0, m.index).split('\n').length}`;
    used.add(key);
    const e = TEXT[key];
    if (!e) { err(where, `キー ${key} が lang.js にない`); continue; }
    if (isTitle) {
      const tm = html.slice(0, m.index).match(/title="([^"]*)"\s*$/);
      if (!tm) { err(where, `${key}：data-i18n-title の前に title="…" を書く`); continue; }
      if (tm[1] !== e.ja) {
        if (FIX) { const a = m.index - tm[0].length; edits.push([a, a + tm[0].length, tm[0].replace(tm[1], e.ja)]); }
        else err(where, `${key} の title が ja の写しと違う`);
      }
      continue;
    }
    const tagStart = html.lastIndexOf('<', m.index);
    const tag = html.slice(tagStart + 1).match(/^\w+/)[0];
    const open = html.indexOf('>', m.index) + 1;
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    re.lastIndex = open;
    let depth = 1, close = -1, mm;
    while ((mm = re.exec(html))) { depth += mm[1] ? -1 : 1; if (!depth) { close = mm.index; break; } }
    const inner = html.slice(open, close);
    if (norm(inner) !== norm(e.ja)) {
      if (FIX) {
        let t = e.ja;
        if (t.includes('\n')) {
          const ind = html.slice(html.lastIndexOf('\n', tagStart) + 1, tagStart).match(/^ */)[0];
          t = '\n' + t.split('\n').map(l => ind + '  ' + l).join('\n') + '\n' + ind;
        }
        edits.push([open, close, t]);
      } else err(where, `${key} の中身が ja の写しと違う`);
    }
  }
  if (edits.length) {
    for (const [a, b, t] of edits.sort((x, y) => y[0] - x[0])) html = html.slice(0, a) + t + html.slice(b);
    fs.writeFileSync(fp, html);
    fixed += edits.length;
  }
}

// ---- 使われていないキー
for (const key of Object.keys(TEXT)) if (!used.has(key)) err(`lang.js ${key}`, 'どこからも使われていない（不要なら消して欠番にする）');

if (fixed) console.log(`翻訳の確認：コメント・index.html の写しを ${fixed} か所直しました`);
if (errors.length) {
  console.error(`翻訳の確認：${errors.length} 件の問題があります`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(`翻訳の確認：OK（${Object.keys(TEXT).length} 件）`);
