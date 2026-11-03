'use strict';
// =====================================================================
//  データ定義：パーツ / エネミー / 回路タイル
// =====================================================================

const DX = [0, 1, 0, -1];          // 0:上 1:右 2:下 3:左
const DY = [-1, 0, 1, 0];
const DIR_ARROW = ['▲', '▶', '▼', '◀'];
const MAX_GRID = 10;
const SAVE_KEY = 'iron_wasteland_save_v1';

// スケルトンジョイントのスロット
const SLOTS = [
  { key: 'headCpu', cat: 'headCpu', label: '頭部A', sub: '回路ユニット' },
  { key: 'headReg', cat: 'headReg', label: '頭部B', sub: '出力レギュレーター' },
  { key: 'torso',   cat: 'torso',   label: '胴体',  sub: '防御' },
  { key: 'armL',    cat: 'arm',     label: '左腕',  sub: '攻撃' },
  { key: 'armR',    cat: 'arm',     label: '右腕',  sub: '攻撃' },
  { key: 'legs',    cat: 'legs',    label: '脚部',  sub: '機動' },
];

const PARTS = {
  // 頭部A：回路ユニット（プログラム・センサー）
  headCpu: [
    { id: 'cpu_s', name: 'HC-S ロビン', grid: 6, clock: 8, sensor: 45, weight: 4, hp: 40,
      desc: '小型の回路ユニット。6×6の回路盤、処理速度は控えめ。' },
    { id: 'cpu_m', name: 'HC-M オウル', grid: 8, clock: 12, sensor: 60, weight: 5, hp: 50,
      desc: '標準的な回路ユニット。8×8の回路盤と広めのセンサー。' },
    { id: 'cpu_x', name: 'HC-X ファルコン', grid: 10, clock: 20, sensor: 75, weight: 7, hp: 45,
      desc: '高性能回路ユニット。10×10の回路盤、高速処理、遠距離センサー。' },
  ],
  // 頭部B：出力レギュレーター（腕/脚への出力配分）
  headReg: [
    { id: 'reg_b', name: 'OR-1 ベーシック', min: 0.3, max: 0.7, eff: 1.0, weight: 3, hp: 30,
      desc: '基本型。配分は腕30〜70%の範囲でのみ調整可能。' },
    { id: 'reg_p', name: 'OR-3 プレシジョン', min: 0.15, max: 0.85, eff: 1.05, weight: 4, hp: 30,
      desc: '精密制御型。配分範囲が広く、出力効率も少し高い。' },
    { id: 'reg_o', name: 'OR-X オーバードライブ', min: 0.0, max: 1.0, eff: 1.15, weight: 6, hp: 25,
      desc: 'リミッター解除型。0〜100%の極端な配分が可能で、出力効率も高い。' },
  ],
  // 胴体（防御・ジェネレーター）
  torso: [
    { id: 't_light', name: 'TL-1 軽量フレーム', hp: 320, def: 4, power: 105, weight: 20,
      desc: '軽量な骨組み胴体。装甲は薄いが脚への負担が小さい。' },
    { id: 't_std', name: 'TS-3 汎用ボディ', hp: 500, def: 8, power: 120, weight: 32,
      desc: 'バランスの取れた標準胴体。' },
    { id: 't_heavy', name: 'TH-9 重装甲ボディ', hp: 820, def: 16, power: 110, weight: 55,
      desc: '厚い装甲板で覆われた重胴体。積載量の多い脚が必要。' },
    { id: 't_gen', name: 'TG-5 ジェネレーター搭載', hp: 420, def: 6, power: 160, weight: 38,
      desc: '大型ジェネレーターを内蔵。総出力が非常に高い。' },
  ],
  // 腕（攻撃）
  arm: [
    { id: 'gatling', name: 'GA-10 ガトリング', type: 'gun', dmg: 5, rate: 10, range: 32, speed: 75, spread: 0.07,
      mag: 80, reload: 2.5, weight: 14, hp: 60, desc: '高速連射の機関砲。群れの掃討向き。' },
    { id: 'cannon', name: 'HC-3 ヘビーキャノン', type: 'shell', dmg: 48, rate: 0.8, range: 48, speed: 45, spread: 0.01,
      splash: 3.5, mag: 6, reload: 3.2, weight: 22, hp: 80, desc: '榴弾砲。着弾地点で爆発し範囲ダメージ。' },
    { id: 'missile', name: 'MP-4 ミサイルポッド', type: 'missile', dmg: 20, rate: 2.5, range: 60, speed: 28, spread: 0.6,
      splash: 4.5, fuse: 1.2, turn: 3.5, mag: 12, reload: 4.5, weight: 18, hp: 50,
      desc: '誘導ミサイル。敵の群れを狙って飛び、近接信管で起爆して爆風で周囲をまとめて攻撃する。' },
    { id: 'flamer', name: 'FL-2 フレイムスロワー', type: 'flame', dmg: 4, rate: 16, range: 13, speed: 20, spread: 0.22,
      mag: 120, reload: 3, weight: 16, hp: 60, desc: '火炎放射。貫通する炎で密集した敵を焼き払う。' },
    { id: 'blade', name: 'BL-7 ヒートブレード', type: 'melee', dmg: 60, rate: 1.5, range: 4.2, arc: 1.8,
      mag: 0, reload: 0, weight: 11, hp: 75, desc: '近接用の赤熱刃。前方の扇状範囲を薙ぎ払う。' },
    { id: 'none', name: '(未装着)', type: 'none', dmg: 0, rate: 0, range: 0, mag: 0, reload: 0, weight: 0, hp: 0,
      desc: 'ジョイントのみ。武装なしで軽量化。' },
  ],
  // 脚部（機動）
  legs: [
    { id: 'biped', name: 'LG-2 標準二脚', speed: 9, turn: 3.6, accel: 10, strafe: 0.6, cap: 120,
      hp: 120, weight: 30, desc: '扱いやすい二脚。速度・積載ともに標準。' },
    { id: 'rjoint', name: 'RJ-5 逆関節', speed: 12, turn: 4.4, accel: 12, strafe: 0.5, cap: 95,
      hp: 90, weight: 24, desc: '跳ねるように走る逆関節脚。高速だが積載は少なめ。' },
    { id: 'tank', name: 'TR-8 キャタピラ', speed: 6.5, turn: 2.0, accel: 8, strafe: 0, cap: 190,
      hp: 200, weight: 45, defBonus: 5, desc: '無限軌道。鈍足で横移動不可だが、重積載と追加防御。' },
    { id: 'hover', name: 'HV-1 ホバー', speed: 15, turn: 3.0, accel: 2.5, strafe: 0.9, cap: 85,
      hp: 80, weight: 22, desc: '浮上走行。最速だが慣性で滑る。' },
    { id: 'spider', name: 'SP-6 多脚', speed: 7.5, turn: 4.0, accel: 10, strafe: 1.0, cap: 150,
      hp: 160, weight: 38, desc: '六本脚。全方向に同じ速さで動ける安定した脚。' },
  ],
};

const ENEMY_DEFS = {
  scarab:  { name: 'サンドスカラベ',   r: 0.6, hp: 22,  speed: 7.5, dmg: 3,  cd: 1.0, reach: 0.4 },
  spitter: { name: 'アシッドスピッター', r: 0.9, hp: 40,  speed: 4.2, dmg: 7,  cd: 2.8, range: 28 },
  troll:   { name: 'ロックトロール',   r: 1.8, hp: 200, speed: 3.2, dmg: 22, cd: 2.2, reach: 0.8 },
  // boss: true のものはボス（行動は battle.js / boss-spider.js の BOSS_KINDS）。phase2Name = HP半分以下の形態名
  boss:    { name: '砂礫王グラヴォルム', r: 4.5, hp: 2500, speed: 4.5, dmg: 15, cd: 1.0,
             boss: true, phase2Name: '赤熱形態', barColors: ['#e08a3a', '#ff4a2a'] },
  spider:  { name: '蒼晶蜘蛛ノクタラクネ', r: 4, hp: 2300, speed: 6, dmg: 16, cd: 1.0,
             boss: true, phase2Name: '晶化暴走', barColors: ['#6aa8d8', '#4ae0ff'] },
};

// ---------------------------------------------------------------------
//  鉱石（エネミーがドロップ。ガレージでパーツ強化に使う）
// ---------------------------------------------------------------------
const ORES = [
  { id: 'iron',    name: '鉄鉱石', color: '#c3c8cf', desc: 'あらゆる強化の基本素材。どのエネミーも落とす。' },
  { id: 'crystal', name: '酸晶石', color: '#a6e04a', desc: 'スピッターの酸腺が結晶化したもの。弾頭と回路に使う。' },
  { id: 'core',    name: '岩核',   color: '#ff9a3a', desc: 'トロールの体内で圧縮された鉱核。装甲材になる。' },
];
const ORE_DROPS = {
  scarab:  { iron: 1 },
  spitter: { iron: 1, crystal: 1 },
  troll:   { iron: 3, core: 1 },
  boss:    { iron: 30, crystal: 15, core: 12 },
  spider:  { iron: 24, crystal: 26, core: 8 },
};
const ORE_MAGNET_R = 7;   // この距離まで近づくと鉱石が機体に吸い寄せられる(m)

function emptyOre() {
  const o = {};
  for (const k of ORES) o[k.id] = 0;
  return o;
}

// 鉱石の数を並べた HTML（cost を渡すと、足りない分を赤く表示）
function oreHTML(ore, have) {
  return ORES.filter(k => ore[k.id]).map(k => {
    const short = have && have[k.id] < ore[k.id];
    return `<span class="ore${short ? ' short' : ''}"><i style="background:${k.color}"></i>${k.name} ${ore[k.id]}</span>`;
  }).join('') || '<span class="ore none">なし</span>';
}

// ---------------------------------------------------------------------
//  パーツ強化（強化レベルはパーツごと。最大 UPGRADE_MAX）
//  cost(L)：レベル L に上げるのに必要な鉱石 / apply(p, lv)：パーツ性能の写しを書き換える
// ---------------------------------------------------------------------
const UPGRADE_MAX = 5;
const UPGRADES = {
  arm: {
    label: '攻撃力', where: '腕パーツ', per: '1段階ごとに 威力 +12%',
    cost: L => ({ iron: 8 * L, crystal: 2 * L }),
    apply(p, lv) { p.dmg *= 1 + 0.12 * lv; },
    stat: p => ['威力', p.dmg, ''],
  },
  torso: {
    label: '防御力', where: '胴体', per: '1段階ごとに 防御 +2（被ダメージ軽減）',
    cost: L => ({ iron: 8 * L, core: 2 * L }),
    apply(p, lv) { p.def += 2 * lv; },
    stat: p => ['防御', p.def, ''],
  },
  legs: {
    label: '機動性', where: '脚部', per: '1段階ごとに 速度・旋回・加速 +6%',
    cost: L => ({ iron: 12 * L }),
    apply(p, lv) { const k = 1 + 0.06 * lv; p.speed *= k; p.turn *= k; p.accel *= k; },
    stat: p => ['速度', p.speed, 'm/s'],
  },
  headCpu: {
    label: '実行速度', where: '頭部A（回路ユニット）', per: '1段階ごとに 回路の処理速度 +20%',
    cost: L => ({ crystal: 3 * L, core: L }),
    apply(p, lv) { p.clock *= 1 + 0.2 * lv; },
    stat: p => ['処理', p.clock, 'Hz'],
  },
};

// 同時にフィールドにいる一般エネミーの上限（残りは増援として順次出現）
const MAX_ACTIVE_ENEMIES = 30;

// 荒野フィールドの地区構成（横に並ぶ3地区）
const DISTRICT_W = 130;
const DISTRICT_H = 150;
const DISTRICTS = [
  { name: '第1地区', sub: '赤錆の平原', tint: 'rgba(0,0,0,0)',          troll: 7, spitter: 4 },
  { name: '第2地区', sub: '骨の渓谷',   tint: 'rgba(80,65,60,0.20)',    troll: 6, spitter: 3 },
  { name: '第3地区', sub: '灼砂の窪地', tint: 'rgba(160,60,20,0.16)',   troll: 5, spitter: 3 },
];

// 出撃できるフィールド。shape で形が決まる（field.js）
//   strip … 横に並ぶ長方形の地区（dw × h）
//   disc  … 円形。中心の円が第1地区で、外側の輪へ広がる（radii = 各地区の外周の半径）
const FIELDS = [
  {
    id: 'wasteland', name: '荒野 第7区画', shape: 'strip', dw: DISTRICT_W, h: DISTRICT_H,
    desc: '見通しの良い荒野。横に並ぶ地区を順に制圧していく。ボス戦は全地区が戦場になる。',
    districts: DISTRICTS,
    boss: 'boss', bossWarn: '大型の生体反応が地中を接近中！',
    rocksPer: 10, rockR: [2, 6], decorN: 900, decor: ['pebble', 'pebble', 'pebble', 'bush', 'bush', 'crack', 'bone'],
  },
  {
    id: 'cave', name: '円形洞窟「奈落の大空洞」', shape: 'disc', radii: [45, 80, 110], dark: true,
    boss: 'spider', bossWarn: '天井の暗闇から巨大な生体反応が降りてくる！',
    desc: '巨大な円形の地下空洞。中心に降下し、地区を掃討するたびに外側の輪へ戦場が広がる。全地区を掃討すると空洞全体でボス戦になる。',
    districts: [
      { name: '第1地区', sub: '崩落の底',     tint: 'rgba(0,0,0,0)',          troll: 8, spitter: 4 },
      { name: '第2地区', sub: '蒼晶の坑道',   tint: 'rgba(40,110,170,0.12)', troll: 6, spitter: 3 },
      { name: '第3地区', sub: '骨喰いの外縁', tint: 'rgba(120,40,30,0.14)',  troll: 5, spitter: 3 },
    ],
    rocksPer: 6, rockR: [2, 4.5], decorN: 500, decor: ['pebble', 'pebble', 'crack', 'bone', 'crystal', 'crystal', 'stalag', 'stalag'],
  },
];

function fieldById(id) {
  return FIELDS.find(f => f.id === id) || FIELDS[0];
}

// 敵の構成（数と地区から決定的に決める。奥の地区ほど大型・射撃型が増える）
function enemyComposition(n, D) {
  const list = [];
  for (let i = 0; i < n; i++) {
    if (i % D.troll === D.troll - 1) list.push('troll');
    else if (i % D.spitter === D.spitter - 1) list.push('spitter');
    else list.push('scarab');
  }
  return list;
}

// ---------------------------------------------------------------------
//  回路タイル
//  kind: start / cmd(出口1つ) / cond(YES・NOの出口2つ)
// ---------------------------------------------------------------------
const TILE_GROUPS = [
  { id: 'move', name: '移動' },
  { id: 'atk',  name: '攻撃' },
  { id: 'sys',  name: '制御' },
  { id: 'cond', name: '判定' },
];

const TILE_DEFS = {
  start:     { kind: 'start', group: 'start', name: 'START（実行開始位置）', short: 'START', icon: '▶' },
  move_f:    { kind: 'cmd', group: 'move', name: '前進', short: '前進', icon: '⇧' },
  move_b:    { kind: 'cmd', group: 'move', name: '後退', short: '後退', icon: '⇩' },
  strafe_l:  { kind: 'cmd', group: 'move', name: '左へ平行移動', short: '左移動', icon: '⇦' },
  strafe_r:  { kind: 'cmd', group: 'move', name: '右へ平行移動', short: '右移動', icon: '⇨' },
  turn_l:    { kind: 'cmd', group: 'move', name: '左旋回', short: '左旋回', icon: '↺' },
  turn_r:    { kind: 'cmd', group: 'move', name: '右旋回', short: '右旋回', icon: '↻' },
  face:      { kind: 'cmd', group: 'move', name: '最寄りの敵へ向く', short: '敵へ向く', icon: '◎' },
  fire_l:    { kind: 'cmd', group: 'atk', name: '左腕で攻撃', short: '左腕攻撃', icon: 'L' },
  fire_r:    { kind: 'cmd', group: 'atk', name: '右腕で攻撃', short: '右腕攻撃', icon: 'R' },
  fire_both: { kind: 'cmd', group: 'atk', name: '両腕で攻撃', short: '両腕攻撃', icon: 'LR' },
  power:     { kind: 'cmd', group: 'sys', name: '出力配分を変更（腕への割合）', short: '出力', icon: '⚡',
               params: [0, 20, 35, 50, 65, 80, 100], unit: '%', dp: 3 },
  wait:      { kind: 'cmd', group: 'sys', name: '待機', short: '待機', icon: '…' },
  c_near:    { kind: 'cond', group: 'cond', name: '敵が○m以内にいるか', short: '敵≦', icon: '◇',
               params: [5, 10, 20, 30, 45, 60], unit: 'm', dp: 3 },
  c_front:   { kind: 'cond', group: 'cond', name: '前方±○°に敵がいるか', short: '前方敵', icon: '◇',
               params: [10, 20, 45, 90], unit: '°', dp: 1 },
  c_left:    { kind: 'cond', group: 'cond', name: '最寄りの敵は左側か', short: '敵は左', icon: '◇' },
  c_count:   { kind: 'cond', group: 'cond', name: 'センサー内の敵が○体以上か', short: '敵数≧', icon: '◇',
               params: [1, 3, 5, 10, 20], unit: '体', dp: 2 },
  c_hp:      { kind: 'cond', group: 'cond', name: 'HP残量が○%以下か', short: 'HP≦', icon: '◇',
               params: [25, 50, 75], unit: '%', dp: 1 },
  c_ready_l: { kind: 'cond', group: 'cond', name: '左腕が攻撃可能か（リロード中でない）', short: '左腕OK', icon: '◇' },
  c_ready_r: { kind: 'cond', group: 'cond', name: '右腕が攻撃可能か（リロード中でない）', short: '右腕OK', icon: '◇' },
  c_proj:    { kind: 'cond', group: 'cond', name: '敵弾が○m以内に接近しているか', short: '敵弾≦', icon: '◇',
               params: [4, 8, 12], unit: 'm', dp: 1 },
  c_boss:    { kind: 'cond', group: 'cond', name: 'ボスが出現しているか', short: 'ボス?', icon: '◇' },
  c_rand:    { kind: 'cond', group: 'cond', name: 'ランダム（○%の確率でYES）', short: '確率', icon: '◇',
               params: [25, 50, 75], unit: '%', dp: 1 },
};

const GROUP_COLORS = {
  start: '#2f8f4e', move: '#2f6f96', atk: '#a63e30', sys: '#6f55a0', cond: '#a8861c',
};

function makeTile(t) {
  const def = TILE_DEFS[t];
  return { t, d: 2, n: 1, p: def.params ? (def.dp || 0) : 0 };
}

function tileParamText(tile) {
  const def = TILE_DEFS[tile.t];
  if (!def.params) return '';
  return def.params[tile.p] + def.unit;
}

// 初期プログラム（6×6に収まる）
function defaultProgram() {
  const c = new Array(MAX_GRID * MAX_GRID).fill(null);
  const put = (x, y, t, d, n = 1, p = 0) => { c[y * MAX_GRID + x] = { t, d, n, p }; };
  put(0, 0, 'start', 2);
  put(0, 1, 'c_front', 1, 2, 1);  // 前方±20°に敵？ NO→敵へ向く
  put(1, 1, 'c_near', 1, 2, 3);   //   30m以内？ YES→攻撃 / NO→前進
  put(2, 1, 'fire_both', 1);      //   両腕攻撃（引き金を引いたまま次へ）
  put(3, 1, 'c_near', 2, 1, 0);   //   5m以内まで迫られた？ YES→後退
  put(3, 2, 'move_b', 1);
  put(1, 2, 'move_f', 1);
  put(0, 2, 'face', 2);           // 敵へ向く
  return c;
}

function defaultSave() {
  return {
    build: { headCpu: 'cpu_m', headReg: 'reg_b', torso: 't_std', armL: 'gatling', armR: 'cannon', legs: 'biped', armRatio: 0.5 },
    program: defaultProgram(),
    enemyCount: 20,
    field: 'wasteland',   // 出撃するフィールド（FIELDS の id）
    ore: emptyOre(),   // 所持している鉱石
    upgrades: {},      // パーツ id → 強化レベル
  };
}
