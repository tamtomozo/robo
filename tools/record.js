#!/usr/bin/env node
'use strict';
// =====================================================================
//  プレイ動画を MP4（H.264 + AAC・60fps）で録画する
//
//   はじめに一度だけ：  cd tools && npm install
//   node tools/record.js <場面...> [--sec 秒] [--lang ja|en] [--url URL] [--size 1280x720]
//
//   場面：garage … パーツ装備画面（組立・ブースター・強化・回路・出力配分を順に操作して出撃）
//         battle … 通常戦（出撃ボタンを押すところから。地区の掃討後は自動で次の地区へ）
//         boss   … ボス戦（地区の掃討を飛ばして、ボス出現の警報から）
//         versus … 対戦（対戦タブで相手を選んで開始するところから）
//         all    … 上の4つを順に
//         gatling … ガトリングの紹介（前半は強化Lv5・後半は強化Lv10で、スカラベの群れを撃つ。all には入らない）
//         missile … ミサイルポッドの紹介（前半は強化Lv5・後半は強化Lv10で、遠くのスピッターの群れを撃つ。all には入らない）
//         combo  … ガトリング＋ミサイルポッドの紹介（両方とも、前半は強化Lv5・後半は強化Lv10。all には入らない）
//         area   … エリアの紹介（--save のセーブで、--field の --floor 層を、説明の字幕つきで最後まで遊ぶ。all には入らない）
//                  タイトルカード → 出撃タブでフィールドと層を選んで出撃 → 3地区とボス戦 → 戦果レポート
//                  --sec を付けなければ、レポートが出るまで録る（洞窟の第5層なら4分ほど）
//   --save  セーブファイル（.iwsave。タイトル画面で書き出したもの）。area では必須
//   --field area のフィールド（wasteland / cave。既定 cave）
//   --floor area の層（既定 1。セーブで到達している層まで）
//   --sec   1場面の長さ（秒。既定 60）
//   --lang  ゲームの言語（既定 ja。en なら英語版）
//   --url   録るページ（既定はこのフォルダのファイルを手元のサーバーで配って録る＝まだ公開していない変更も映る）
//   --size  画面の大きさ（既定 1280x720）
//   --show  録画用の Edge のウィンドウを画面に出す（既定は画面の外に置くので、録画中も PC を普段どおり使える）
//   出力：dist/rec-<場面>[-en].mp4（area は dist/rec-<フィールド><層>[-en].mp4。例：rec-cave5.mp4）
//
//  しくみ
//  ・Edge（無ければ Chrome）を画面に出して開き、タブキャプチャの映像とゲームの音（Sound の出口）を
//    WebCodecs（mediabunny）で1コマずつ圧縮する。MediaRecorder はコマを捨ててカクつくため使わない
//  ・録画用のウィンドウは画面の外に置く。隠れたウィンドウの描画を止める Windows 向けの仕組みは切ってあるので、
//    外に置いても、ほかのウィンドウに隠れても撮れる（最小化だけは描画が止まるのでしない）
//  ・録るのはゲームのタブだけ。画面全体などが選ばれたら録画を中止する（ほかのウィンドウが映らないように）
//  ・録画を始めてから数秒はコマが捨てられる（圧縮器が動き出すまで。長さは毎回ちがう）ので、圧縮済みのコマが
//    1.5秒続けて出てくるまで先撮りしてから場面を始め、終わったあとで頭を切り落として、毎秒60コマちょうどの動画に作り直す
//  ・マウスのカーソルはタブキャプチャに映らないため、録画用の矢印をページに重ねて動かす
//  ・場面ごとに新しいセーブデータ（ブラウザのプロファイル）から始め、機体・鉱石などはこのファイルの SCENES で用意する
// =====================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
  require.resolve('mediabunny');
} catch (e) {
  console.error('録画に使う部品が入っていません。はじめに一度だけ次を実行してください：\n  cd tools && npm install');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MB_FILE = path.join(path.dirname(require.resolve('mediabunny')), 'mediabunny.min.mjs');
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

// ---------------------------------------------------------------------
//  コマンドライン
// ---------------------------------------------------------------------
const opt = { sec: 60, secGiven: false, lang: 'ja', url: null, size: '1280x720', show: false, scenes: [], save: null, field: 'cave', floor: 1 };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--sec') { opt.sec = +process.argv[++i]; opt.secGiven = true; }
  else if (a === '--save') opt.save = process.argv[++i];
  else if (a === '--field') opt.field = process.argv[++i];
  else if (a === '--floor') opt.floor = +process.argv[++i];
  else if (a === '--lang') opt.lang = process.argv[++i];
  else if (a === '--url') opt.url = process.argv[++i];
  else if (a === '--size') opt.size = process.argv[++i];
  else if (a === '--show') opt.show = true;
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else opt.scenes.push(a);
}
const ALL = ['garage', 'battle', 'boss', 'versus'];
const EXTRA = ['gatling', 'missile', 'combo', 'area'];   // all には含めない場面
if (opt.scenes.includes('all')) opt.scenes = ALL;
if (!opt.scenes.length || opt.scenes.some(s => !ALL.includes(s) && !EXTRA.includes(s)) || !(opt.sec > 0) || !/^\d+x\d+$/.test(opt.size)) { usage(); process.exit(1); }
if (opt.scenes.includes('area')) {
  if (!opt.save || !fs.existsSync(opt.save)) { console.error('area にはセーブファイルが要ります：--save <ファイル.iwsave>'); process.exit(1); }
  if (!['wasteland', 'cave'].includes(opt.field) || !(opt.floor >= 1 && opt.floor <= 8)) { usage(); process.exit(1); }
}
const [VW, VH] = opt.size.split('x').map(Number);

function usage() {
  console.log('使い方：node tools/record.js <garage|battle|boss|versus|gatling|missile|combo|all ...> [--sec 60] [--lang ja|en] [--url URL] [--size 1280x720] [--show]\n' +
    '        node tools/record.js area --save <ファイル.iwsave> [--field cave|wasteland] [--floor 1〜8] [--sec 秒]');
}

// ---------------------------------------------------------------------
//  場面ごとの用意と台本
//  save  … ゲームの Game.save を書き換える（ページ内で実行する関数。引数は Game.save）
//  setup … 録画を始める前に済ませておく画面の切り替え（ページ内で実行）。
//          タブキャプチャは画面を大きく切り替えた直後に1秒近くコマが途切れることがあるため、
//          場面の始まりに要る切り替えはここで済ませ、その途切れを切り落とす先撮りの中に入れる
//  play  … 台本（r.start() の時点から --sec 秒を残す。garage は最初から）
//  機体と相手の強さは、決着が60秒前後になるよう戦闘を高速に回して決めたもの
// ---------------------------------------------------------------------
const SCENES = {
  // パーツ装備画面：初期の機体から、パーツを付け替え → 各タブを見せて → 出撃（残りは戦闘）
  garage: {
    save: (s) => {
      Object.assign(s.ore, { iron: 2400, crystal: 600, core: 300 });
      const B = [['arm', 'gatling', 7], ['arm', 'missile', 4], ['legs', 'spider', 9], ['torso', 't_std', 3],
        ['arm', 'cannon', 10], ['headCpu', 'cpu_x', 2], ['legs', 'biped', 5], ['arm', 'blade', 6]];
      for (const [cat, id, bonus] of B) s.stock.push({ uid: s.nextUid++, cat, id, bonus, got: Date.now(), isNew: true });
    },
    async play(r) {
      await r.wait(1500);
      // 組立：脚 → キャタピラ → 多脚、右腕 → ミサイル
      await r.click('#skeleton .slot[data-slot="legs"]', 1000);
      await r.hover('#parts-list .part[data-id="tank"]', 500);
      await r.click('#parts-list .part[data-id="tank"]', 1800);
      await r.click('#parts-list .part[data-id="spider"]', 2000);
      await r.click('#skeleton .slot[data-slot="armR"]', 1000);
      await r.click('#parts-list .part[data-id="missile"]', 2000);
      // 骨格の透過表示
      await r.click('#xray', 2200);
      await r.click('#xray', 800);
      // ブースター
      await r.click('.tabs button[data-tab="stock"]', 2500);
      // 強化：強化できるボタンを1つ押す
      await r.click('.tabs button[data-tab="upgrade"]', 1500);
      await r.click('#upgrade .up-btn.primary', 2000);
      // 回路：盤面とタイルの一覧を見せる（盤面はクリックしない＝タイルを置いてしまうため）
      await r.click('.tabs button[data-tab="circuit"]', 1200);
      await r.hover('#circuit-grid', 1300);
      await r.hover('#palette', 1300);
      // 出力配分：つまみを腕寄りに動かす
      await r.click('.tabs button[data-tab="output"]', 1200);
      await r.drag('#ratio', 0.5, 0.7, 1000);
      await r.wait(1800);
      // 出撃
      await r.click('.tabs button[data-tab="sortie"]', 1800);
      await r.click('#btn-sortie', 0);
      await r.battle();
    },
  },

  // 通常戦：出撃ボタンを押すところから（地区の掃討後は自動で次の地区へ）
  battle: {
    save: (s) => {
      Object.assign(s.build, { headCpu: 'cpu_x', headReg: 'reg_p', torso: 't_std', armL: 'gatling', armR: 'missile', legs: 'spider', armRatio: 0.55 });
      for (const id of ['cpu_x', 'reg_p', 't_std', 'gatling', 'missile', 'spider']) s.upgrades[id] = 4;
      s.enemyCount = 30;
    },
    setup: () => Garage.tab('sortie'),
    async play(r) {
      await r.start();
      await r.wait(1500);
      await r.click('#btn-sortie', 0);
      await r.battle();
    },
  },

  // ボス戦：地区の掃討を飛ばして、ボス出現の警報から。強化なしの機体で、警報から57〜59秒ほどで撃破する
  boss: {
    save: (s) => {
      Object.assign(s.build, { headCpu: 'cpu_x', headReg: 'reg_b', torso: 't_heavy', armL: 'gatling', armR: 'missile', legs: 'tank', armRatio: 0.5 });
    },
    // 戦闘画面に切り替えて一時停止しておく
    setup: () => { Game.sortie(); Battle.paused = true; },
    async play(r) {
      await r.page.evaluate(() => {
        const w = Battle.world;
        w.enemies = []; w.queue = []; w.pshots = []; w.eshots = [];
        w.banner = null;   // 第1地区の見出しは出さない
        w.district = w.field.districts.length - 1;
        w.stats.res = w.stats.res.map(() => 'clear');
        w.stats.cleared = w.stats.res.length;
        advanceDistrict(w);   // 全地区の封鎖を解除 → 警報 → ボス出現
        Battle.paused = false;
      });
      await r.start();
      await r.battle();
    },
  },

  // 対戦：対戦タブで相手を選んで開始。重装甲どうしの撃ち合いで、50秒台に僅差で勝つ
  versus: {
    save: (s) => {
      Object.assign(s.build, { headCpu: 'cpu_x', headReg: 'reg_p', torso: 't_heavy', armL: 'gatling', armR: 'missile', legs: 'spider', armRatio: 0.5 });
      s.pilot = LANG === 'en' ? 'Rust Hunter' : '赤錆の狩人';
      const rival = {
        name: LANG === 'en' ? 'Iron Bastion' : '鉄壁のバスティオン',
        build: { headCpu: 'cpu_m', headReg: 'reg_b', torso: 't_heavy', armL: 'missile', armR: 'missile', legs: 'tank', armRatio: 0.4, gear: {} },
        upgrades: {},
        program: defaultProgram(),
      };
      s.rivals.push({ id: 'rec1', data: machineToData(rival), rec: { w: 0, l: 0, d: 0 }, got: Date.now() });
      s.vsSel = 'self0';
    },
    setup: () => Garage.tab('versus'),
    async play(r) {
      await r.start();
      await r.wait(1500);
      await r.click('.vs-card[data-id="rec1"]', 1500);
      await r.click('#btn-versus', 0);
      await r.battle();
    },
  },

  // ガトリングの紹介：両腕ガトリングで、前半は強化Lv5・後半は強化Lv10。スカラベの群れを4秒おきに送り込む
  // 22体×4秒おきだと、Lv5 は倒しきれずに群れが溜まり（最大50体前後）、Lv10 で押し返す（HP は7割以上残る）
  gatling: {
    save: (s) => {
      Object.assign(s.build, { headCpu: 'cpu_x', headReg: 'reg_p', torso: 't_std', armL: 'gatling', armR: 'gatling', legs: 'spider', armRatio: 0.55 });
    },
    setup: () => { Game.sortie(); Battle.paused = true; },
    play: (r) => playWeaponDemo(r, 'gatling', { gap: 4, wave: { scarab: 22 }, dist: 34 }),
  },

  // ミサイルポッドの紹介：両腕ミサイルで、前半は強化Lv5・後半は強化Lv10。55m 先からスピッターとスカラベの群れを4秒おきに送り込む
  // 回路の「敵が○m以内か」を射程いっぱいの60mにして、遠くの群れへ撃ち始めるようにする
  // ミサイルは爆風でまとめて倒すので、第1層では Lv5 でも全滅させてしまう。第3層（耐久×1.6）にすると、Lv5 は倒しきれずに
  // 50体前後が溜まり、Lv10 で押し返す。スピッターの酸で HP が削られるため胴体は重装甲（HP は5割以上残る）
  missile: {
    save: (s) => {
      Object.assign(s.build, { headCpu: 'cpu_x', headReg: 'reg_p', torso: 't_heavy', armL: 'missile', armR: 'missile', legs: 'spider', armRatio: 0.55 });
      const prog = defaultProgram();
      prog[1 * MAX_GRID + 1].p = TILE_DEFS.c_near.params.indexOf(60);
      s.programs[s.progSlot] = s.program = prog;
      s.floor[s.field] = 3;
    },
    setup: () => { Game.sortie(); Battle.paused = true; },
    play: (r) => playWeaponDemo(r, 'missile', { gap: 4, wave: { spitter: 12, scarab: 16 }, dist: 55 }),
  },

  // ガトリング＋ミサイルポッドの紹介：左腕ガトリング・右腕ミサイルで、前半は両方とも強化Lv5・後半は両方とも強化Lv10
  // 回路は、30m以内なら両腕で攻撃・30〜60mなら右腕（ミサイル）だけで攻撃・それより遠ければ前進
  // 第1層で、Lv5 は倒しきれずに50〜70体が溜まり、Lv10 で押し返す（HP は6割以上残る。第3層だと大破する）
  combo: {
    save: (s) => {
      Object.assign(s.build, { headCpu: 'cpu_x', headReg: 'reg_p', torso: 't_heavy', armL: 'gatling', armR: 'missile', legs: 'spider', armRatio: 0.55 });
      const prog = defaultProgram();
      const put = (x, y, t, d, n = 1, p = 0) => { prog[y * MAX_GRID + x] = { t, d, n, p }; };
      put(1, 2, 'c_near', 1, 2, TILE_DEFS.c_near.params.indexOf(60));   // 60m以内？ YES→右腕で攻撃 / NO→前進
      put(2, 2, 'fire_r', 2);
      put(1, 3, 'move_f', 1);
      s.programs[s.progSlot] = s.program = prog;
    },
    setup: () => { Game.sortie(); Battle.paused = true; },
    play: (r) => playWeaponDemo(r, ['gatling', 'missile'], { gap: 4, wave: { spitter: 10, scarab: 20 }, dist: 50 }),
  },

  // エリアの紹介：--save のセーブ（機体・強化・回路・エネミー数はそのまま）で、--field の --floor 層を最後まで遊ぶ
  // タイトルカード（エリアの説明）→ 出撃タブでフィールドと層を選ぶ → 出撃 → 3地区とボス戦（字幕で説明）→ 戦果レポート
  // 出撃タブでフィールドを選ぶところを見せるため、セーブのフィールドはいったん別のものにしておく
  area: {
    load: async (page) => {
      const b64 = fs.readFileSync(opt.save).toString('base64');
      const err = await page.evaluate(async ([b64, field, floor]) => {
        const r = await SaveFile.decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
        if (r.error) return `セーブファイルを読めませんでした（${r.error}）`;
        const s = r.save;
        if ((s.reached[field] | 0) < floor) return `このセーブは ${field} の第${s.reached[field]}層までしか到達していません`;
        for (const k of Object.keys(Game.save)) delete Game.save[k];
        Object.assign(Game.save, s);
        Game.save.field = FIELDS.find(f => f.id !== field && !f.duel).id;
        Game.save.floor[field] = 1;
        Game.persist();
        return null;
      }, [b64, opt.field, opt.floor]);
      if (err) throw new Error(err);
    },
    setup: () => { Garage.tab('sortie'); },
    async play(r) {
      await r.page.evaluate(`(${areaCaptions.toString()})(${JSON.stringify({ field: opt.field, floor: opt.floor, lang: opt.lang })})`);
      await r.start();
      await r.wait(7000);   // タイトルカード
      await r.page.evaluate(() => window.__cap.hideTitle());
      await r.wait(900);
      await r.page.evaluate(() => window.__cap.say('pick'));
      await r.click(`.field-card[data-id="${opt.field}"]`, 1500);
      await r.click(`#floor-select button[data-f="${opt.floor}"]`, 2200);
      await r.page.evaluate(() => window.__cap.say('comp'));
      await r.hover('#composition', 4200);
      await r.page.evaluate(() => window.__cap.clear());
      await r.click('#btn-sortie', 0);
      await r.page.evaluate(() => window.__cap.watch());
      // 戦闘：確認ダイアログには「次の地区へ」で答え、戦果レポートが出たら少し見せて終える
      for (;;) {
        await r.wait(250);
        const st = await r.page.evaluate(() => ({
          ask: document.getElementById('confirm').classList.contains('show'),
          report: document.getElementById('screen-report').classList.contains('active'),
        }));
        if (st.report) {
          await r.page.evaluate(() => window.__cap.clear());   // 戦果レポートは画面そのものが説明になるので字幕は出さない
          await r.moveTo(VW * 0.5, VH * 0.6, 900);
          await r.wait(8000);
          r.finish();
        }
        if (st.ask) {
          await r.wait(1800);
          await r.click('#confirm-yes', 300);
          await r.moveTo(VW * 0.85, VH * 0.85, 500);
        }
      }
    },
  },
};

// エリアの紹介の字幕（ページ内で実行）。window.__cap を作る
//   タイトルカード … 画面全体に出すエリアの説明（hideTitle で消す）
//   字幕 … 画面の下に出す1枚の説明（say で出す・clear で消す）。watch で戦闘を見張り、地区・大地脈動・ボスに合わせて出す
function areaCaptions(cfg) {
  const L = (ja, en) => cfg.lang === 'en' ? en : ja;
  const F = fieldById(cfg.field), floor = cfg.floor, fm = floorMul(floor), n = Game.save.enemyCount;
  const DS = F.districts, boss = ENEMY_DEFS[F.boss];
  const mul = (v) => '×' + String(+v.toFixed(2));
  const comp = (D) => {
    const c = enemyComposition(n, D), k = (t) => c.filter(x => x === t).length;
    return L(`${ENEMY_DEFS.scarab.name} ${k('scarab')}・${ENEMY_DEFS.spitter.name} ${k('spitter')}・${ENEMY_DEFS.troll.name} ${k('troll')} 体`,
      `${ENEMY_DEFS.scarab.name} ${k('scarab')} / ${ENEMY_DEFS.spitter.name} ${k('spitter')} / ${ENEMY_DEFS.troll.name} ${k('troll')}`);
  };
  // 地区の広さ（洞窟は中心の円と外側の輪、荒野は横に並ぶ長方形）
  const area = (i) => F.shape === 'disc'
    ? (i === 0 ? L(`中心の半径${F.radii[0]}mの円`, `the central circle (radius ${F.radii[0]} m)`)
      : L(`半径${F.radii[i - 1]}〜${F.radii[i]}mの${i === DS.length - 1 ? '外周の' : ''}輪`, `the ${i === DS.length - 1 ? 'outer ' : ''}ring at ${F.radii[i - 1]}–${F.radii[i]} m`))
    : L(`横${F.dw}m × 縦${F.h}mの地区`, `a ${F.dw} × ${F.h} m sector`);
  const hp = bossHp(boss, n, floor);
  const B = Game.save.build, part = (cat, id) => partLabel(PARTS[cat].find(p => p.id === id));
  const lvs = ['headCpu', 'headReg', 'torso', 'armL', 'armR', 'legs'].map(k => Game.save.upgrades[B[k]] | 0);
  const lvAll = lvs.every(v => v === lvs[0]) ? lvs[0] : null;
  const bossNote = {
    spider: L('天井の暗闇から糸で降りてくる、背に結晶を生やした巨大蜘蛛。跳びかかり・結晶の弾・糸玉で攻める。蜘蛛の巣の上では機体が減速する',
      'A giant crystal-backed spider that descends on silk from the dark ceiling. It leaps, fires crystal shards and spits silk; its webs slow your mech down'),
    boss: L('地中を潜って迫る巨大な砂礫の怪物。地中から突き上げ、岩を撒き散らす',
      'A giant gravel beast that burrows underground, bursting up and scattering rocks'),
  }[F.boss] || '';

  const T1 = {
    pick: [L('出撃タブで行き先を選ぶ', 'Pick the destination on the Sortie tab'),
      L(`フィールドに「${F.name}」、層に「${floorName(floor)}」を選ぶ。ボスを倒した層の次の層が解放されていく`,
        `Select "${F.name}" and ${floorName(floor)}. Each boss you defeat unlocks the next floor down`)],
    comp: [L(`${floorName(floor)}のエネミー：耐久 ${mul(fm.hp)}・攻撃力 ${mul(fm.dmg)}・鉱石 ${mul(fm.ore)}`, `${floorName(floor)} enemies: HP ${mul(fm.hp)} / Attack ${mul(fm.dmg)} / Ore ${mul(fm.ore)}`),
      L(`1地区あたり ${n} 体。3地区を掃討するとボス「${boss.name}」（HP ${hp}）が現れる`, `${n} enemies per district. Clear all 3 districts and the boss "${boss.name}" (HP ${hp}) appears`)],
    mech: [L('機体は回路プログラムで自動戦闘', 'The mech fights on its own circuit program'),
      L(`${part('arm', B.armL)}（左腕）＋ ${part('arm', B.armR)}（右腕）／ ${part('legs', B.legs)}${lvAll ? `　全パーツ強化 Lv${lvAll}` : ''}`,
        `${part('arm', B.armL)} (L) + ${part('arm', B.armR)} (R) / ${part('legs', B.legs)}${lvAll ? ` — all parts upgraded to Lv${lvAll}` : ''}`)],
    dark: [L('暗闇の洞窟', 'A pitch-dark cave'),
      L('機体のライトが届く範囲のほかは闇に沈む。暗がりから迫るエネミーに注意', 'Beyond your mech\'s lights everything sinks into darkness. Watch for enemies closing in from the dark')],
    surge: [L('大地脈動', 'Earth Pulse'),
      L('地面の亀裂が赤く脈打ち、エネミーが活性化する（移動速度・攻撃の頻度・攻撃力が上がる）。しばらくすると鎮まる',
        'Cracks in the ground pulse red and enemies are energized (faster movement, attacks and harder hits) until it subsides')],
    warn: [L('全地区の封鎖を解除', 'All districts unsealed'), F.bossWarn],
    boss: [L(`ボス：${boss.name}　HP ${hp}`, `Boss: ${boss.name} — HP ${hp}`),
      L(`${bossNote}。戦場は${F.shape === 'disc' ? '空洞全体' : '全地区'}に広がる`, `${bossNote}. The fight spans the ${F.shape === 'disc' ? 'whole cavern' : 'entire field'}`)],
    rage: [boss.phase2Name, L('HPが半分を切り、ボスの行動が変わった', 'Below half HP, the boss changes its behavior')],
  };
  DS.forEach((D, i) => {
    T1['d' + i] = [districtLabel(D), L(`${area(i)}。${comp(D)}`, `${area(i)[0].toUpperCase() + area(i).slice(1)}: ${comp(D)}`)];
  });

  // ---- 見た目
  const accent = F.dark ? '#7cc8ff' : '#ffb35a';
  const st = document.createElement('style');
  st.textContent = `
    #__cap-title{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(ellipse at 50% 40%,rgba(18,26,38,.94),rgba(4,6,10,.97));color:#e8eef5;transition:opacity .9s;
      font-family:"Yu Gothic UI","Meiryo","Hiragino Sans",sans-serif}
    #__cap-title.off{opacity:0}
    #__cap-title .box{width:min(880px,88vw)}
    #__cap-title .k{font-size:15px;letter-spacing:.3em;color:${accent};opacity:.9}
    #__cap-title h1{margin:.25em 0 0;font-size:40px;font-weight:700;letter-spacing:.04em}
    #__cap-title h2{margin:.15em 0 .7em;font-size:26px;font-weight:600;color:${accent}}
    #__cap-title p{margin:0 0 .9em;font-size:18px;line-height:1.65;color:#c9d3de}
    #__cap-title table{border-collapse:collapse;width:100%;font-size:16px;margin-top:.4em}
    #__cap-title td{padding:.42em .6em;border-top:1px solid rgba(255,255,255,.12)}
    #__cap-title td:first-child{white-space:nowrap;color:#fff;font-weight:600;width:1%}
    #__cap-title tr.boss td:first-child{color:${accent}}
    #__cap-title .mul{display:flex;gap:28px;font-size:17px;margin:.2em 0 .9em}
    #__cap-title .mul b{color:#ffd24a;font-size:20px;margin-left:.3em}
    #__cap{position:fixed;left:50%;bottom:28px;z-index:2147482000;transform:translate(-50%,12px);opacity:0;pointer-events:none;
      max-width:min(900px,90vw);padding:12px 22px 13px;border-left:4px solid ${accent};border-radius:6px;
      background:rgba(6,9,14,.9);color:#e8eef5;box-shadow:0 6px 24px rgba(0,0,0,.45);transition:opacity .45s,transform .45s;
      font-family:"Yu Gothic UI","Meiryo","Hiragino Sans",sans-serif}
    #__cap.on{opacity:1;transform:translate(-50%,0)}
    #__cap.bt{left:58.2vw;bottom:40px;max-width:46vw;box-sizing:border-box}
    #__cap b{display:block;font-size:20px;color:${accent};margin-bottom:3px;letter-spacing:.03em}
    #__cap span{display:block;font-size:16px;line-height:1.55;color:#d6dee8}`;
  document.head.appendChild(st);

  // タイトルカード
  const tc = document.createElement('div');
  tc.id = '__cap-title';
  const rows = DS.map((D, i) => `<tr><td>${districtLabel(D)}</td><td>${area(i)}　${comp(D)}</td></tr>`).join('') +
    `<tr class="boss"><td>BOSS ${boss.name}</td><td>${L(`3地区の掃討後に出現　HP ${hp}`, `Appears after the 3 districts — HP ${hp}`)}</td></tr>`;
  tc.innerHTML = `<div class="box">
    <div class="k">${L('エリア紹介', 'AREA GUIDE')}</div>
    <h1>${F.name}</h1>
    <h2>${floorName(floor)}</h2>
    <p>${F.desc}${F.dark ? L('機体のライトが届く範囲のほかは暗闇に包まれている。', ' Beyond your mech\'s lights, all is darkness.') : ''}</p>
    <div class="mul">${L('エネミーの強さ', 'Enemy strength')}：<span>${L('耐久', 'HP')}<b>${mul(fm.hp)}</b></span><span>${L('攻撃力', 'Attack')}<b>${mul(fm.dmg)}</b></span><span>${L('鉱石ドロップ', 'Ore drops')}<b>${mul(fm.ore)}</b></span></div>
    <table>${rows}</table>
    <p style="margin-top:.9em;font-size:15px;color:#9fb0c2">${L(`活動限界は${ACT_LIMIT / 60}分（3地区とボス戦を${ACT_SEG / 60}分ずつで区切る）。1地区あたり ${n} 体`,
      `Activity limit: ${ACT_LIMIT / 60} min (${ACT_SEG / 60} min each for the 3 districts and the boss). ${n} enemies per district`)}</p>
  </div>`;
  document.body.appendChild(tc);

  // 下の字幕
  const cap = document.createElement('div');
  cap.id = '__cap';
  document.body.appendChild(cap);
  let queue = [], until = 0, showing = null;
  const show = (key) => {
    const [t, s] = T1[key];
    cap.innerHTML = `<b>${t}</b><span>${s}</span>`;
    // 戦闘中は左下のログと右下の回路モニターの間に出す
    cap.classList.toggle('bt', document.getElementById('screen-battle').classList.contains('active'));
    cap.classList.add('on');
    showing = key;
  };
  const hide = () => { cap.classList.remove('on'); showing = null; };
  // 字幕を順に流す（1枚を dur 秒見せ、次との間を 0.6 秒あける）
  const pump = () => {
    const now = performance.now();
    if (showing && now >= until) { hide(); until = now + 600; }
    if (!showing && now >= until && queue.length) {
      const [key, dur] = queue.shift();
      show(key);
      until = now + dur * 1000;
    }
  };
  setInterval(pump, 50);

  window.__cap = {
    hideTitle() { tc.classList.add('off'); setTimeout(() => tc.remove(), 1000); },
    say(key, dur = 99) { queue = []; show(key); until = performance.now() + dur * 1000; },
    clear() { queue = []; hide(); until = 0; },
    // 戦闘を見張って、地区の始まり・大地脈動・ボスに合わせて字幕を積む
    watch() {
      const seen = {};
      const once = (key, dur, at) => { if (seen[key]) return; seen[key] = 1; if (at) setTimeout(() => queue.push([key, dur]), at); else queue.push([key, dur]); };
      const iv = setInterval(() => {
        if (!Battle.running) { if (seen.boss) clearInterval(iv); return; }
        const w = Battle.world;
        if (w.phase === 'fight') {
          if (w.district === 0) { once('mech', 6.5, 600); once('d0', 7, 600); if (F.dark) once('dark', 6, 22000); }
          else once('d' + w.district, 7, 400);
        }
        if (w.surge.state === 'active' && !seen['surge' + w.district]) {
          seen['surge' + w.district] = 1;
          if (!seen.surge) once('surge', 7, 2500);
        }
        if (w.phase === 'warn' && !seen.warn) { queue = []; hide(); until = 0; once('warn', 3.4); }
        if (w.phase === 'boss') once('boss', 8.5, 1200);
        if (w.boss && w.boss.phase2) once('rage', 5, 3200);
      }, 100);
    },
  };
}

// 武器の紹介の台本：見せ場を仕込んで戦闘を動かし、終わったら前半・後半の撃破数を知らせる
async function playWeaponDemo(r, id, c) {
  const cfg = Object.assign({
    lv: [5, 10], half: opt.sec / 2, first: 1,
    lvText: opt.lang === 'en' ? 'Upgrade Lv{lv}' : '強化 Lv{lv}',
    upText: opt.lang === 'en' ? '+1 shot' : '弾数+1',
  }, c);
  await r.page.evaluate(`(${weaponDemo.toString()})(${JSON.stringify(id)}, ${JSON.stringify(cfg)})`);
  await r.page.evaluate(() => { Battle.paused = false; });
  await r.start();
  try {
    await r.battle();
  } finally {
    const s = await r.page.evaluate(() => window.__demo);
    console.log(`  撃破数：Lv${cfg.lv[0]} ${s.kills[0]}体 / Lv${cfg.lv[1]} ${s.kills[1]}体（出した敵 ${s.spawned[0]}体 / ${s.spawned[1]}体・最少HP ${s.minHp[0]} / ${s.minHp[1]}）`);
  }
}

// 武器の紹介（ページ内で実行）：地区の進行（増援・掃討・活動時間の区切り）を止めて、
// 機体から dist m ほど離れた所に wave（種類 → 体数）の群れを gap 秒おきに出す。half 秒で強化 lv[0] → lv[1] に上げ、見出しを出す
// id は武器の id、または id の配列（複数の武器を同時に強化する）
function weaponDemo(id, cfg) {
  const w = Battle.world, P = w.player;
  const ids = [].concat(id);
  RARE.chance = 0;   // レア個体は出さない
  w.surge.t = 1e9;   // 大地の脈動を起こさない
  w.enemies = []; w.queue = []; w.pshots = []; w.eshots = []; w.banner = null; w.log = [];
  w.segTotal = 0;
  const names = ids.map(i => PARTS.arm.find(p => p.id === i).name);
  const setLv = (lv) => {
    P.upgrades = Object.assign({}, P.upgrades);
    for (const i of ids) P.upgrades[i] = lv;
    P.st = computeStats(P.build, P.st.ratio, P.upgrades);
    for (const s of ['L', 'R']) {
      const a = P.arms[s];
      a.perf = P.st['arm' + s]; a.def = a.perf.def;
      a.ammo = a.def.mag; a.reloading = 0;
    }
  };
  // 見出し：武器名・強化レベル・1発の威力と弾数（武器が複数なら、型番を除いた名前を付けて並べる）
  const banner = (lv, first) => {
    const stat = ids.map((i, k) => {
      const p = P.arms.L.def.id === i ? P.st.armL : P.st.armR;
      const shots = p.def.shots || 1;
      const s = `${T('upgrade.arm.stat')} ${p.dmg.toFixed(1)}${shots > 1 ? ' ' + T('upgrade.arm.shots', { shots }) : ''}`;
      return ids.length > 1 ? `${names[k].replace(/^\S+\s+/, '')} ${s}` : s;
    }).join(' ／ ');
    const lvT = cfg.lvText.replace('{lv}', lv);
    w.banner = first ? { title: `${names.join(' ＋ ')}　${lvT}`, sub: stat, t: 3 } : { title: lvT, sub: `${cfg.upText} ／ ${stat}`, t: 3 };
  };
  const wave = () => {
    let c = null, bd = Infinity;
    for (let i = 0; i < 60; i++) {
      const pt = w.geo.randomPoint(w, w.district, 12);
      const d = Math.abs(Math.hypot(pt.x - P.x, pt.y - P.y) - cfg.dist);
      if (d < bd) { bd = d; c = pt; }
    }
    for (const [type, size] of Object.entries(cfg.wave)) {
      const er = ENEMY_DEFS[type].r;
      let n = 0;
      for (let i = 0; i < size * 4 && n < size; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 6;
        const x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr;
        if (!w.geo.inside(w, x, y, er + 0.5) || insideRock(w, x, y, er)) continue;
        spawnEnemy(w, type, { x, y });
        n++;
      }
      w.segTotal += n;
      D.spawned[half] += n;
    }
  };
  // 前半・後半の撃破数・出した敵の数・機体の最少HP（録画のあとに知らせる）
  const D = window.__demo = { kills: [0, 0], spawned: [0, 0], minHp: [Math.round(P.hp), Math.round(P.hp)] };
  const kills = () => w.stats.kills.scarab + w.stats.kills.spitter + w.stats.kills.troll;
  setLv(cfg.lv[0]);
  banner(cfg.lv[0], true);
  let t = 0, next = cfg.first, half = 0, k0 = kills();
  window.updatePhase = function (ww, dt) {
    if (ww !== w || w.result) return;
    t += dt;
    if (!half && t >= cfg.half) {
      half = 1;
      k0 = kills();
      setLv(cfg.lv[1]);
      banner(cfg.lv[1], false);
      Sound.play('upgrade');
      w.fx.push({ type: 'ring', x: P.x, y: P.y, life: 0.6, max: 0.6, size: 6 });
    }
    D.kills[half] = kills() - k0;
    D.minHp[half] = Math.min(D.minHp[half], Math.round(P.hp));
    if (t >= next) { wave(); next += cfg.gap; }
  };
}

// ---------------------------------------------------------------------
//  ページに入れるもの：録画用のカーソル
// ---------------------------------------------------------------------
const CURSOR_SCRIPT = `
window.addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.id = '__rec-cursor';
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.5 15 L18.5 15 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg><i></i>';
  const st = document.createElement('style');
  st.textContent = '#__rec-cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .4s;will-change:transform;filter:drop-shadow(0 2px 2px rgba(0,0,0,.5))}' +
    '#__rec-cursor i{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,200,120,.95);opacity:0;transform:scale(.3)}' +
    '#__rec-cursor i.on{animation:__recclick .45s ease-out}' +
    '@keyframes __recclick{0%{opacity:1;transform:scale(.3)}100%{opacity:0;transform:scale(1.4)}}';
  document.head.appendChild(st);
  document.body.appendChild(c);
  let idle = 0;
  window.addEventListener('mousemove', (e) => {
    c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    c.style.opacity = 1;
    clearTimeout(idle);
    // 戦闘中は動かなくなったら消す（画面の邪魔にならないよう）
    idle = setTimeout(() => { if (document.getElementById('screen-battle').classList.contains('active')) c.style.opacity = 0; }, 1500);
  }, true);
  window.addEventListener('mousedown', () => { const i = c.querySelector('i'); i.classList.remove('on'); void i.offsetWidth; i.classList.add('on'); }, true);
  // タブキャプチャは画面が変わらないとコマを出さないので、隅の2pxを毎コマわずかに描き替えて常に60コマ出させる
  const tick = document.createElement('div');
  tick.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;z-index:2147483647;pointer-events:none';
  document.body.appendChild(tick);
  let k = 0;
  const loop = () => { k ^= 1; tick.style.background = k ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.03)'; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});`;

// ---------------------------------------------------------------------
//  ページ内の録画（タブキャプチャ + ゲームの音 → WebCodecs → MP4）
// ---------------------------------------------------------------------
const RECORDER_SCRIPT = `
window.__rec = {
  // 映像を流し始める（録画はまだ始めない）
  async prepare(w, h) {
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 60, width: w, height: h, displaySurface: 'browser' }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include', monitorTypeSurfaces: 'exclude', surfaceSwitching: 'exclude' });
    this.vt = this.stream.getVideoTracks()[0];
    // 安全装置：このタブ以外（画面全体・ほかのウィンドウ）が選ばれたら録らない
    const surface = this.vt.getSettings().displaySurface;
    if (surface !== 'browser') {
      this.stream.getTracks().forEach(t => t.stop());
      throw new Error('タブ以外（' + surface + '）が選ばれたため録画を中止しました');
    }
    return surface;
  },
  async start() {
    const { Output, Mp4OutputFormat, BufferTarget, MediaStreamVideoTrackSource, MediaStreamAudioTrackSource, canEncodeAudio } = window.MB;
    this.out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    this.vclone = this.vt.clone();
    this.pk = [];
    this.out.addVideoTrack(new MediaStreamVideoTrackSource(this.vclone, {
      codec: 'avc', bitrate: 10e6, latencyMode: 'quality', keyFrameInterval: 2,
      onEncodedPacket: (p) => { this.pk.push(p.timestamp); if (this.pk.length > 600) this.pk.splice(0, 300); } }), { frameRate: 60 });
    Sound.unlock();
    const dest = Sound.ctx.createMediaStreamDestination();
    Sound.comp.connect(dest);
    this.atrack = dest.stream.getAudioTracks()[0];
    const acodec = (await canEncodeAudio('aac')) ? 'aac' : 'opus';
    this.out.addAudioTrack(new MediaStreamAudioTrackSource(this.atrack, { codec: acodec, bitrate: 192e3 }));
    await this.out.start();
    this.t0 = performance.now();
    return acodec;
  },
  // 圧縮済みのコマが minMs ミリ秒ぶん途切れずに出てくるまで待つ
  // （録画を始めた直後は、圧縮器が動き出すまで数秒コマが捨てられることがあり、その長さは毎回ちがうため）
  async waitSteady(minMs, timeout) {
    const t0 = performance.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 50));
      const pk = this.pk, now = (performance.now() - this.t0) / 1000;
      // 直近のコマが新しく、そこから minMs さかのぼるまで 0.06 秒を超える隙間がない
      let ok = pk.length > 1 && now - pk[pk.length - 1] < 0.3;
      let i = pk.length - 1;
      while (ok && i > 0 && pk[pk.length - 1] - pk[i - 1] <= minMs / 1000) {
        if (pk[i] - pk[i - 1] > 0.06) ok = false;
        i--;
      }
      if (ok && i > 0 && pk[pk.length - 1] - pk[i] >= minMs / 1000 - 0.05) return { ms: Math.round(performance.now() - t0), steady: true };
      if (performance.now() - t0 > timeout) return { ms: Math.round(performance.now() - t0), steady: false };
    }
  },
  // 場面の始まりの位置（録画の頭からの秒）を覚え、ここから映像が実際に届いているかを見張る
  // （出来上がりは毎秒60コマに作り直すため、取り込みが止まった所は同じコマの繰り返しになり、コマ数では気づけない）
  async mark() {
    this.markAt = (performance.now() - this.t0) / 1000;
    const v = document.createElement('video');
    v.muted = true;
    v.srcObject = new MediaStream([this.vt.clone()]);
    v.style.cssText = 'position:fixed;left:0;top:0;width:4px;height:4px;opacity:0.01;pointer-events:none;z-index:2147483646';
    document.body.appendChild(v);
    await v.play();
    this.mon = { v, times: [] };
    const cb = () => { this.mon.times.push(performance.now()); if (this.mon.v) v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
    return this.markAt;
  },
  // 見張りの結果：0.1秒を超える途切れの回数・合計・最長（秒）
  report() {
    const t = this.mon.times, gaps = [];
    for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > 100) gaps.push((t[i] - t[i - 1]) / 1000);
    this.mon.v.srcObject.getTracks().forEach(x => x.stop());
    this.mon.v.remove();
    this.mon.v = null;
    return { n: gaps.length, total: gaps.reduce((a, b) => a + b, 0), max: Math.max(0, ...gaps), fps: t.length / ((t[t.length - 1] - t[0]) / 1000) };
  },
  async stop() {
    this.vclone.stop();
    this.atrack.stop();
    this.stream.getTracks().forEach(t => t.stop());
    await this.out.finalize();
    this.buf = new Uint8Array(this.out.target.buffer);
    return this.buf.length;
  },
  // 先撮りした頭の部分を切り落とし、毎秒60コマちょうどに作り直す
  async trim(sec) {
    const { Input, BufferSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, Conversion } = window.MB;
    const input = new Input({ source: new BufferSource(this.buf), formats: ALL_FORMATS });
    const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const conv = await Conversion.init({ input, output: out, trim: { start: this.markAt, end: this.markAt + sec },
      video: { codec: 'avc', bitrate: 10e6, frameRate: 60, keyFrameInterval: 2, forceTranscode: true } });
    if (!conv.isValid) throw new Error('切り落としに失敗しました：' + JSON.stringify(conv.discardedTracks.map(t => t.reason)));
    await conv.execute();
    this.buf = new Uint8Array(out.target.buffer);
    return this.buf.length;
  },
  chunk(o, n) {
    const b = this.buf.subarray(o, o + n);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  },
};`;

// ---------------------------------------------------------------------
//  台本で使う操作（カーソルをなめらかに動かす・待つ・戦闘中の確認ダイアログに答える）
// ---------------------------------------------------------------------
class Stop extends Error {}

function makeRunner(page) {
  const r = {
    page, deadline: Infinity, mx: VW * 0.6, my: VH * 0.75, started: false,
    // 場面の始まり（ここから --sec 秒を残す）
    async start() {
      if (r.started) return;
      await page.evaluate(() => window.__rec.mark());
      r.started = true;
      r.t0 = Date.now();
      // area は --sec を付けなければ台本が r.finish() で終えるまで録る
      r.deadline = r.open && !opt.secGiven ? Infinity : r.t0 + opt.sec * 1000;
    },
    // 台本の側で場面を終える（ここまでの長さを残す）
    finish() {
      const t = (Date.now() - r.t0) / 1000;
      r.length = opt.secGiven ? Math.min(opt.sec, t) : t;
      throw new Stop();
    },
    async wait(ms) {
      const end = Math.min(Date.now() + ms, r.deadline);
      while (Date.now() < end) await page.waitForTimeout(Math.max(1, Math.min(100, end - Date.now())));
      if (Date.now() >= r.deadline) throw new Stop();
    },
    // 要素の中の点（fx, fy は 0〜1 の割合）
    async point(sel, fx = 0.5, fy = 0.5) {
      const el = await page.waitForSelector(sel, { state: 'visible', timeout: 5000 });
      await el.scrollIntoViewIfNeeded();
      const b = await el.boundingBox();
      return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    },
    // なめらかに動かす（ease-in-out。時計で位置を決めるので、操作の往復が遅くても所要時間は ms のまま）
    async moveTo(x, y, ms) {
      if (ms == null) ms = Math.min(800, 250 + Math.hypot(x - r.mx, y - r.my) * 0.6);
      const x0 = r.mx, y0 = r.my, t0 = Date.now();
      for (;;) {
        const t = Math.min(1, (Date.now() - t0) / ms), k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        await page.mouse.move(x0 + (x - x0) * k, y0 + (y - y0) * k);
        if (t >= 1) break;
        await page.waitForTimeout(8);
      }
      r.mx = x; r.my = y;
      if (Date.now() >= r.deadline) throw new Stop();
    },
    async hover(sel, after = 0) {
      const p = await r.point(sel);
      await r.moveTo(p.x, p.y);
      await r.wait(after);
    },
    async click(sel, after = 600) {
      const p = await r.point(sel);
      await r.moveTo(p.x, p.y);
      await page.waitForTimeout(120);
      await page.mouse.down();
      await page.waitForTimeout(70);
      await page.mouse.up();
      await r.wait(after);
    },
    // スライダーを割合 f0 → f1 へドラッグ
    async drag(sel, f0, f1, ms) {
      const a = await r.point(sel, f0), b = await r.point(sel, f1);
      await r.moveTo(a.x, a.y);
      await page.mouse.down();
      await r.moveTo(b.x, b.y, ms);
      await page.mouse.up();
    },
    // 戦闘：終わりの時刻まで見守る。地区の確認ダイアログが出たら少し見せてから「次の地区へ」
    async battle() {
      for (;;) {
        await r.wait(250);
        const ask = await page.evaluate(() => document.getElementById('confirm').classList.contains('show'));
        if (ask) {
          await r.wait(1800);
          await r.click('#confirm-yes', 300);
          await r.moveTo(VW * 0.85, VH * 0.85, 500);
        }
      }
    },
  };
  return r;
}

// ---------------------------------------------------------------------
//  手元のサーバー（このフォルダを配る）
// ---------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mjs': 'text/javascript' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ページの見える大きさ（innerWidth × innerHeight）が VW × VH になるよう、ウィンドウの大きさを直す
async function fitWindow(page, cdp) {
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  for (let i = 0; i < 6; i++) {
    const [iw, ih] = await page.evaluate(() => [innerWidth, innerHeight]);
    if (iw === VW && ih === VH) return true;
    const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: bounds.width + VW - iw, height: bounds.height + VH - ih } });
    await page.waitForTimeout(300);
  }
  return false;
}

// ---------------------------------------------------------------------
//  1場面を録る
// ---------------------------------------------------------------------
async function recordScene(browser, base, name) {
  let r0 = 0;
  const S = SCENES[name];
  // 画面の大きさは固定しない（viewport: null）で、ウィンドウの大きさで合わせる（fitWindow）。
  // タブキャプチャを始めるとタブの上に「このタブを共有中」の帯（約48px）が出て、その分ページの見える高さが減る。
  // 大きさを固定していると下の48pxが切れて 1280x672 で撮れてしまうため
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.on('pageerror', e => console.log(`  [ページのエラー] ${e.message}`));
  await page.route('**/__rec/mediabunny.mjs', r => r.fulfill({ body: fs.readFileSync(MB_FILE), contentType: 'text/javascript' }));
  await page.addInitScript(`try { localStorage.setItem('iron_wasteland_lang', ${JSON.stringify(opt.lang)}); } catch (e) {}`);
  await page.addInitScript(CURSOR_SCRIPT);
  await page.addInitScript(RECORDER_SCRIPT);
  await page.goto(base, { waitUntil: 'load' });
  await fitWindow(page, cdp);
  await page.addScriptTag({ type: 'module', content: "import * as MB from './__rec/mediabunny.mjs'; window.MB = MB;" });
  await page.waitForFunction(() => window.MB && typeof Game === 'object' && Game.save);

  // セーブデータを用意してからタイトルを抜ける（このクリックで音が鳴るようになる）
  if (S.load) await S.load(page);
  else await page.evaluate(`(${S.save.toString()})(Game.save); Game.persist();`);
  await page.mouse.move(VW / 2, VH * 0.9);
  await page.mouse.click(VW / 2, VH * 0.9);
  await page.waitForTimeout(300);
  if (S.setup) await page.evaluate(`(${S.setup.toString()})()`);
  // 映像を流して録画を始め、出だしの映像が来ない間（先撮り）を待つ
  await page.evaluate(([w, h]) => window.__rec.prepare(w, h), [VW, VH]);
  await page.waitForTimeout(500);   // 共有中の帯が出るのを待つ
  if (!await fitWindow(page, cdp)) console.log('  ※ ページの大きさを合わせきれませんでした（画面が小さい？）。動画の端が切れるかもしれません');
  const acodec = await page.evaluate(() => window.__rec.start());
  const st = await page.evaluate(() => window.__rec.waitSteady(1500, 20000));
  if (!st.steady) console.log('  ※ 映像が安定しないまま始めます（出だしが止まって見えるかもしれません）');
  r0 = st.ms;

  const r = makeRunner(page);
  r.mx = VW / 2; r.my = VH * 0.9;
  r.open = name === 'area';   // 長さを決めずに録る場面
  // garage は最初から。ほかの場面は台本の中で場面の始まりを決める
  if (name === 'garage') await r.start();
  try {
    await S.play(r);
    await r.start();
    await r.wait(Infinity);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }
  // 撮り終えたら戦闘を止める（裏で動き続けると、このあとの仕上げ（動画の作り直し）が遅くなる）
  await page.evaluate(() => { if (Battle.running) Battle.stop(); });
  const q = await page.evaluate(() => window.__rec.report());
  await page.evaluate(() => window.__rec.stop());
  const qs = `取り込み 毎秒${q.fps.toFixed(1)}コマ・0.1秒を超える途切れ ${q.n} 回（合計 ${q.total.toFixed(1)} 秒・最長 ${q.max.toFixed(1)} 秒）`;
  console.log(`  ${qs}`);
  // 画面を大きく切り替えた直後の短い途切れ（0.5秒まで）は、静止した画面の間に起きるので見た目にはほぼわからない
  if (q.max > 0.5 || q.total > 3) console.log('  ※ 途切れが多めです。止まって見える所があるかもしれません（録画中にウィンドウを隠した・PC が忙しかった など）。撮り直しをおすすめします。');
  console.log(`  頭を切り落として仕上げています…（先撮り ${(r0 / 1000).toFixed(1)} 秒）`);
  const sec = r.length || opt.sec;
  const n = await page.evaluate((sec) => window.__rec.trim(sec), sec);
  const parts = [];
  for (let o = 0; o < n; o += 4e6) parts.push(Buffer.from(await page.evaluate(([o]) => window.__rec.chunk(o, 4e6), [o]), 'base64'));
  const file = name === 'area' ? `${opt.field}${opt.floor}` : name;
  const out = path.join(DIST, `rec-${file}${opt.lang === 'en' ? '-en' : ''}.mp4`);
  fs.writeFileSync(out, Buffer.concat(parts));
  console.log(`  → ${path.relative(ROOT, out)}（${(n / 1e6).toFixed(1)} MB・音声 ${acodec}）`);
  await context.close();
}

(async () => {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('Edge か Chrome が見つかりません。'); process.exit(1); }
  fs.mkdirSync(DIST, { recursive: true });
  const srv = opt.url ? null : await serve();
  const base = opt.url || `http://127.0.0.1:${srv.address().port}/`;
  console.log(`録画します：${opt.scenes.join(', ')}（各 ${opt.scenes.includes('area') && !opt.secGiven ? '最後まで' : opt.sec + ' 秒'}・${VW}x${VH}・${opt.lang}）\n  ページ：${base}\n  ` +
    (opt.show ? '録画中は Edge のウィンドウを最小化しないでください。' : '録画用の Edge は画面の外で動きます（--show で画面に出せます）。'));
  const browser = await chromium.launch({
    executablePath: exe, headless: false,
    // タブキャプチャの許可は「このタブ」だけ自動で通す（画面全体を選ぶ --use-fake-ui-for-media-stream は使わない）
    args: ['--autoplay-policy=no-user-gesture-required', '--auto-accept-this-tab-capture',
      '--force-device-scale-factor=1', `--window-size=${VW + 16},${VH + 140}`, ...(opt.show ? [] : ['--window-position=-4000,0']), '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'],
  });
  try {
    for (const name of opt.scenes) {
      console.log(`● ${name}`);
      await recordScene(browser, base, name);
    }
  } finally {
    await browser.close();
    if (srv) srv.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
