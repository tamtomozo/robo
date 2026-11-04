'use strict';
// =====================================================================
//  言語の切り替え（日本語 / English）
//   ・文章の定義はすべて js/lang.js の TEXT にある（キーの付け方もそちらに説明）
//   ・タイトル画面のボタンで選び、localStorage に保存してページを読み込み直す
//     （ガレージなどの文章は起動時に組み立てるので、読み込み直せばすべてそろって切り替わる）
//   ・JS の文章：T('B015' /* ボス出現：{name} */, { name: e.def.name })
//   ・HTML の文章：data-i18n="G001"（中身）/ data-i18n-title="G011"（title 属性）
// =====================================================================

const LANG_KEY = 'iron_wasteland_lang';
const LANG = (() => {
  try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ja'; } catch (e) { return 'ja'; }
})();

// キーの文章を今の言語で返す。{name} の所に p.name を入れる（en が関数なら p を渡して呼ぶ）
function T(key, p) {
  const e = TEXT[key];
  if (!e) {
    console.error(`翻訳が見つかりません：${key}`);
    return key;
  }
  const v = e[LANG] != null ? e[LANG] : e.ja;
  if (typeof v === 'function') return v(p || {});
  if (!p) return v;
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in p ? p[k] : m));
}

const I18N = {
  // 起動時に一度だけ呼ぶ（main.js の Game.init）。HTML の文章を入れ、切り替えボタンをつなぐ
  apply() {
    document.documentElement.lang = LANG;
    document.title = 'IRON WASTELAND — ' + T('C004' /* 荒野機兵戦記 */);
    document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = T(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = T(el.dataset.i18nTitle); });
    const box = document.getElementById('lang-ctl');
    if (!box) return;
    // タイトル画面はクリックでスタートするので、ここを押したときはスタートさせない
    box.addEventListener('pointerdown', e => e.stopPropagation());
    box.querySelectorAll('button').forEach(b => {
      b.classList.toggle('sel', b.dataset.lang === LANG);
      b.onclick = () => {
        if (b.dataset.lang === LANG) return;
        try { localStorage.setItem(LANG_KEY, b.dataset.lang); } catch (e) { return; /* 保存できない環境では切り替えない */ }
        location.reload();
      };
    });
  },
};
