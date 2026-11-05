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
  { key: 'headCpu', cat: 'headCpu', label: T('slot.headCpu.label' /* 頭部A */), sub: T('slot.headCpu.sub' /* 回路ユニット */) },
  { key: 'headReg', cat: 'headReg', label: T('slot.headReg.label' /* 頭部B */), sub: T('slot.headReg.sub' /* 出力レギュレーター */) },
  { key: 'torso',   cat: 'torso',   label: T('slot.torso.label' /* 胴体 */),  sub: T('slot.torso.sub' /* 防御 */) },
  { key: 'armL',    cat: 'arm',     label: T('slot.armL.label' /* 左腕 */),  sub: T('slot.armL.sub' /* 攻撃 */) },
  { key: 'armR',    cat: 'arm',     label: T('slot.armR.label' /* 右腕 */),  sub: T('slot.armR.sub' /* 攻撃 */) },
  { key: 'legs',    cat: 'legs',    label: T('slot.legs.label' /* 脚部 */),  sub: T('slot.legs.sub' /* 機動 */) },
];

const PARTS = {
  // 頭部A：回路ユニット（プログラム・センサー）
  headCpu: [
    { id: 'cpu_s', name: T('part.cpu_s.name' /* HC-S ロビン */), grid: 6, clock: 8, sensor: 45, weight: 4, hp: 40,
      desc: T('part.cpu_s.desc' /* 小型の回路ユニット。6×6の回路盤、処理速度は控えめ。 */) },
    { id: 'cpu_m', name: T('part.cpu_m.name' /* HC-M オウル */), grid: 8, clock: 12, sensor: 60, weight: 5, hp: 50,
      desc: T('part.cpu_m.desc' /* 標準的な回路ユニット。8×8の回路盤と広めのセンサー。 */) },
    { id: 'cpu_x', name: T('part.cpu_x.name' /* HC-X ファルコン */), grid: 10, clock: 20, sensor: 75, weight: 7, hp: 45,
      desc: T('part.cpu_x.desc' /* 高性能回路ユニット。10×10の回路盤、高速処理、遠距離セン… */) },
  ],
  // 頭部B：出力レギュレーター（腕/脚への出力配分）
  headReg: [
    { id: 'reg_b', name: T('part.reg_b.name' /* OR-1 ベーシック */), min: 0.3, max: 0.7, eff: 1.0, weight: 3, hp: 30,
      desc: T('part.reg_b.desc' /* 基本型。配分は腕30〜70%の範囲でのみ調整可能。 */) },
    { id: 'reg_p', name: T('part.reg_p.name' /* OR-3 プレシジョン */), min: 0.15, max: 0.85, eff: 1.05, weight: 4, hp: 30,
      desc: T('part.reg_p.desc' /* 精密制御型。配分範囲が広く、出力効率も少し高い。 */) },
    { id: 'reg_o', name: T('part.reg_o.name' /* OR-X オーバードライブ */), min: 0.0, max: 1.0, eff: 1.15, weight: 6, hp: 25,
      desc: T('part.reg_o.desc' /* リミッター解除型。0〜100%の極端な配分が可能で、出力効率… */) },
  ],
  // 胴体（防御・ジェネレーター）
  torso: [
    { id: 't_light', name: T('part.t_light.name' /* TL-1 軽量フレーム */), hp: 320, def: 4, power: 105, weight: 20,
      desc: T('part.t_light.desc' /* 軽量な骨組み胴体。装甲は薄いが脚への負担が小さい。 */) },
    { id: 't_std', name: T('part.t_std.name' /* TS-3 汎用ボディ */), hp: 500, def: 8, power: 120, weight: 32,
      desc: T('part.t_std.desc' /* バランスの取れた標準胴体。 */) },
    { id: 't_heavy', name: T('part.t_heavy.name' /* TH-9 重装甲ボディ */), hp: 820, def: 16, power: 110, weight: 55,
      desc: T('part.t_heavy.desc' /* 厚い装甲板で覆われた重胴体。積載量の多い脚が必要。 */) },
    { id: 't_gen', name: T('part.t_gen.name' /* TG-5 ジェネレーター搭載 */), hp: 420, def: 6, power: 160, weight: 38,
      desc: T('part.t_gen.desc' /* 大型ジェネレーターを内蔵。総出力が非常に高い。 */) },
  ],
  // 腕（攻撃）
  arm: [
    { id: 'gatling', name: T('part.gatling.name' /* GA-10 ガトリング */), type: 'gun', dmg: 5, rate: 10, range: 32, speed: 75, spread: 0.07,
      mag: 80, reload: 2.5, weight: 14, hp: 60, desc: T('part.gatling.desc' /* 高速連射の機関砲。群れの掃討向き。 */) },
    { id: 'cannon', name: T('part.cannon.name' /* HC-3 ヘビーキャノン */), type: 'shell', dmg: 48, rate: 0.8, range: 48, speed: 45, spread: 0.01,
      splash: 3.5, mag: 6, reload: 3.2, weight: 22, hp: 80, desc: T('part.cannon.desc' /* 榴弾砲。着弾地点で爆発し範囲ダメージ。 */) },
    { id: 'missile', name: T('part.missile.name' /* MP-4 ミサイルポッド */), type: 'missile', dmg: 20, rate: 2.5, range: 60, speed: 28, spread: 0.6,
      splash: 4.5, fuse: 1.2, turn: 3.5, mag: 12, reload: 4.5, weight: 18, hp: 50,
      desc: T('part.missile.desc' /* 誘導ミサイル。敵の群れを狙って飛び、近接信管で起爆して爆風で… */) },
    { id: 'flamer', name: T('part.flamer.name' /* FL-2 フレイムスロワー */), type: 'flame', dmg: 4, rate: 16, range: 13, speed: 20, spread: 0.22,
      mag: 120, reload: 3, weight: 16, hp: 60, desc: T('part.flamer.desc' /* 火炎放射。貫通する炎で密集した敵を焼き払う。 */) },
    { id: 'blade', name: T('part.blade.name' /* BL-7 ヒートブレード */), type: 'melee', dmg: 60, rate: 1.5, range: 4.2, arc: 1.8,
      mag: 0, reload: 0, weight: 11, hp: 75, desc: T('part.blade.desc' /* 近接用の赤熱刃。前方の扇状範囲を薙ぎ払う。 */) },
    { id: 'none', name: T('part.none.name' /* (未装着) */), type: 'none', dmg: 0, rate: 0, range: 0, mag: 0, reload: 0, weight: 0, hp: 0,
      desc: T('part.none.desc' /* ジョイントのみ。武装なしで軽量化。 */) },
  ],
  // 脚部（機動）
  legs: [
    { id: 'biped', name: T('part.biped.name' /* LG-2 標準二脚 */), speed: 9, turn: 3.6, accel: 10, strafe: 0.6, cap: 120,
      hp: 120, weight: 30, desc: T('part.biped.desc' /* 扱いやすい二脚。速度・積載ともに標準。 */) },
    { id: 'rjoint', name: T('part.rjoint.name' /* RJ-5 逆関節 */), speed: 12, turn: 4.4, accel: 12, strafe: 0.5, cap: 95,
      hp: 90, weight: 24, desc: T('part.rjoint.desc' /* 跳ねるように走る逆関節脚。高速だが積載は少なめ。 */) },
    { id: 'tank', name: T('part.tank.name' /* TR-8 キャタピラ */), speed: 6.5, turn: 2.0, accel: 8, strafe: 0, cap: 190,
      hp: 200, weight: 45, defBonus: 5, desc: T('part.tank.desc' /* 無限軌道。鈍足で横移動不可だが、重積載と追加防御。 */) },
    { id: 'hover', name: T('part.hover.name' /* HV-1 ホバー */), speed: 15, turn: 3.0, accel: 2.5, strafe: 0.9, cap: 85,
      hp: 80, weight: 22, desc: T('part.hover.desc' /* 浮上走行。最速だが慣性で滑る。 */) },
    { id: 'spider', name: T('part.spider.name' /* SP-6 多脚 */), speed: 7.5, turn: 4.0, accel: 10, strafe: 1.0, cap: 150,
      hp: 160, weight: 38, desc: T('part.spider.desc' /* 六本脚。全方向に同じ速さで動ける安定した脚。 */) },
  ],
};

const ENEMY_DEFS = {
  scarab:  { name: T('enemy.scarab.name' /* サンドスカラベ */),   r: 0.6, hp: 22,  speed: 7.5, dmg: 3,  cd: 1.0, reach: 0.4 },
  spitter: { name: T('enemy.spitter.name' /* アシッドスピッター */), r: 0.9, hp: 40,  speed: 4.2, dmg: 7,  cd: 2.8, range: 28 },
  troll:   { name: T('enemy.troll.name' /* ロックトロール */),   r: 1.8, hp: 200, speed: 3.2, dmg: 22, cd: 2.2, reach: 0.8 },
  // boss: true のものはボス（行動は battle.js / boss-spider.js の BOSS_KINDS）。phase2Name = HP半分以下の形態名
  boss:    { name: T('enemy.boss.name' /* 砂礫王グラヴォルム */), r: 4.5, hp: 2500, speed: 4.5, dmg: 15, cd: 1.0,
             boss: true, phase2Name: T('enemy.boss.phase2Name' /* 赤熱形態 */), barColors: ['#e08a3a', '#ff4a2a'] },
  spider:  { name: T('enemy.spider.name' /* 蒼晶蜘蛛ノクタラクネ */), r: 4, hp: 2300, speed: 6, dmg: 16, cd: 1.0,
             boss: true, phase2Name: T('enemy.spider.phase2Name' /* 晶化暴走 */), barColors: ['#6aa8d8', '#4ae0ff'] },
};

// ---------------------------------------------------------------------
//  鉱石（エネミーがドロップ。ガレージでパーツ強化に使う）
// ---------------------------------------------------------------------
// short = 戦闘画面の HUD に並べる短い名前
const ORES = [
  { id: 'iron',    name: T('ore.iron.name' /* 鉄鉱石 */), short: T('ore.iron.short' /* 鉄鉱石 */), color: '#c3c8cf', desc: T('ore.iron.desc' /* あらゆる強化の基本素材。どのエネミーも落とす。 */) },
  { id: 'crystal', name: T('ore.crystal.name' /* 酸晶石 */), short: T('ore.crystal.short' /* 酸晶石 */), color: '#a6e04a', desc: T('ore.crystal.desc' /* スピッターの酸腺が結晶化したもの。弾頭と回路に使う。 */) },
  { id: 'core',    name: T('ore.core.name' /* 岩核 */),   short: T('ore.core.short' /* 岩核 */), color: '#ff9a3a', desc: T('ore.core.desc' /* トロールの体内で圧縮された鉱核。装甲材になる。 */) },
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

// 鉱石の数を並べた HTML（cost を渡すと、足りない分を赤く表示。abbr = 短い名前で並べる）
function oreHTML(ore, have, abbr) {
  return ORES.filter(k => ore[k.id]).map(k => {
    const short = have && have[k.id] < ore[k.id];
    return `<span class="ore${short ? ' short' : ''}"><i style="background:${k.color}"></i>${abbr ? k.short : k.name} ${ore[k.id]}</span>`;
  }).join('') || T('C012' /* なし */);
}

// ---------------------------------------------------------------------
//  パーツ強化（強化レベルはパーツごと。最大 UPGRADE_MAX）
//  cost(L)：レベル L に上げるのに必要な鉱石（以前の5倍） / apply(p, lv)：パーツ性能の写しを書き換える
// ---------------------------------------------------------------------
const UPGRADE_MAX = 10;
const UPGRADE_SHOT_LV = 6;   // 攻撃系：このレベルから弾数+1（1発の威力はいったん下がり、Lv10で未強化の1.5倍）
const UPGRADE_JUMP_LV = 6;   // 機動系：このレベルからジャンプが使える

// 腕の強化：1発あたりの威力の倍率と同時発射数
function armUpgradeMult(lv) {
  if (lv < UPGRADE_SHOT_LV) return 1 + 0.12 * lv;                  // Lv5 = ×1.6
  return 0.9 + 0.6 * (lv - UPGRADE_SHOT_LV) / (UPGRADE_MAX - UPGRADE_SHOT_LV);   // Lv6 = ×0.9 → Lv10 = ×1.5
}

// 脚の強化で使えるジャンプの性能（dist = 跳躍距離 m / cd = 再使用までの待ち 秒 / dur = 滞空時間 秒）
function jumpPerf(lv) {
  if (lv < UPGRADE_JUMP_LV) return null;
  const j = lv - UPGRADE_JUMP_LV;
  return { dist: 8 + j, cd: 5 - 0.5 * j, dur: 0.55 + 0.02 * j };
}

const UPGRADES = {
  arm: {
    label: T('upgrade.arm.label' /* 攻撃力 */), where: T('upgrade.arm.where' /* 腕パーツ */),
    per: T('upgrade.arm.per' /* Lv1〜5：威力 +12%/段 Lv{lv}〜：弾数+1（2… */, { lv: UPGRADE_SHOT_LV }),
    cost: L => ({ iron: 40 * L, crystal: 10 * L }),
    apply(p, lv) {
      p.dmg *= armUpgradeMult(lv);
      if (lv >= UPGRADE_SHOT_LV) p.shots = 2;
    },
    stat: p => [T('upgrade.arm.stat' /* 威力 */), p.dmg, p.shots > 1 ? T('upgrade.arm.shots' /* ×{shots}発 */, { shots: p.shots }) : ''],
    note: (p, lv) => lv + 1 === UPGRADE_SHOT_LV ? T('upgrade.arm.next' /* 次の強化で弾数+1 */) : '',
  },
  torso: {
    label: T('upgrade.torso.label' /* 防御力 */), where: T('upgrade.torso.where' /* 胴体 */), per: T('upgrade.torso.per' /* 1段階ごとに 防御 +2（被ダメージ軽減） */),
    cost: L => ({ iron: 40 * L, core: 10 * L }),
    apply(p, lv) { p.def += 2 * lv; },
    stat: p => [T('upgrade.torso.stat' /* 防御 */), p.def, ''],
  },
  legs: {
    label: T('upgrade.legs.label' /* 機動性 */), where: T('upgrade.legs.where' /* 脚部 */),
    per: T('upgrade.legs.per' /* 1段階ごとに 速度・旋回・加速 +6% Lv{lv}〜：ジャ… */, { lv: UPGRADE_JUMP_LV }),
    cost: L => ({ iron: 60 * L }),
    apply(p, lv) {
      const k = 1 + 0.06 * lv; p.speed *= k; p.turn *= k; p.accel *= k;
      p.jump = jumpPerf(lv);
    },
    stat: p => [T('upgrade.legs.stat' /* 速度 */), p.speed, 'm/s'],
    note: (p, lv) => {
      if (lv + 1 === UPGRADE_JUMP_LV) return T('upgrade.legs.next' /* 次の強化でジャンプ解放 */);
      const a = jumpPerf(lv), b = jumpPerf(lv + 1);
      if (!a) return '';
      const t = j => T('upgrade.legs.jumpSpec' /* {dist}m / 待ち{cd}s */, { dist: j.dist, cd: fmtNum(j.cd) });
      return `${T('upgrade.legs.jump' /* ジャンプ */)} ${t(a)}${b && lv < UPGRADE_MAX ? ` → ${t(b)}` : ''}`;
    },
  },
  headCpu: {
    label: T('upgrade.headCpu.label' /* 実行速度 */), where: T('upgrade.headCpu.where' /* 頭部A（回路ユニット） */), per: T('upgrade.headCpu.per' /* 1段階ごとに 回路の処理速度 +20% */),
    cost: L => ({ crystal: 15 * L, core: 5 * L }),
    apply(p, lv) { p.clock *= 1 + 0.2 * lv; },
    stat: p => [T('upgrade.headCpu.stat' /* 処理 */), p.clock, 'Hz'],
  },
};

// ---------------------------------------------------------------------
//  レアエネミー（一般エネミーがまれに「輝晶個体」として出現し、倒すとブースターを落とす）
//  ブースター＝特定のパーツ専用の性能強化モジュール。パーツに1つ差し込め、いつでも付け替えられる
// ---------------------------------------------------------------------
const RARE = {
  chance: 0.01,      // 一般エネミー1体がレアになる確率（大地の脈動中は surgeMul 倍）
  surgeMul: 2,
  hp: 4, speed: 1.2, dmg: 1.3,   // 元の種類に対する倍率
  ore: 3,            // 鉱石ドロップの倍率
  prefix: T('rare.prefix' /* 輝晶 */),    // 表示名の頭に付ける（例：輝晶サンドスカラベ / Glimmering Sand Scarab）
};

// ブースターの効果アップ（+1〜+10）。値が低いほど出やすい
const BONUS_MIN = 1, BONUS_MAX = 10;
// 第1層での +0〜+10 それぞれの出やすさ（合計100 = %。+0 は出ない）。+5以上は合わせて14%
const BONUS_WEIGHTS = [0, 30, 25, 18, 13, 5, 3.5, 2.5, 1.5, 1, 0.5];
// 下の層ほど高い値が出やすい：第 f 層では +10 の出やすさが第1層の f 倍（第8層で 0.5% → 4%）
// +N の出やすさを e^(k × (N-1)) 倍して全体を高い側へ傾け、k は層ごとに +10 がちょうど f 倍になる値を求める
// （第8層で +5以上 14% → 約40%、+8以上 3% → 約16%）
function bonusWeights(k) {
  const w = BONUS_WEIGHTS.map((x, b) => x * Math.exp(k * (b - 1)));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / sum);
}
const BONUS_FLOOR_W = [];   // 層 → 出やすさ（初めて使うときに求める）
function bonusFloorWeights(floor) {
  const f = clamp(floor | 0, 1, FLOORS);
  if (!BONUS_FLOOR_W[f]) {
    const want = bonusWeights(0)[BONUS_MAX] * f;
    let lo = 0, hi = 2;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (bonusWeights(mid)[BONUS_MAX] < want) lo = mid; else hi = mid;
    }
    BONUS_FLOOR_W[f] = bonusWeights(lo);
  }
  return BONUS_FLOOR_W[f];
}
function rollBonus(floor) {
  const w = bonusFloorWeights(floor);
  let r = Math.random();
  for (let b = 0; b < w.length; b++) {
    r -= w[b];
    if (r < 0) return b;
  }
  return BONUS_MIN;
}

// ボーナスの等級（色分け）
const BONUS_TIERS = [
  { min: 10, name: T('tier.10.name' /* 極 */), color: '#ffd84a' },
  { min: 8,  name: T('tier.8.name' /* 秀 */), color: '#e07aff' },
  { min: 5,  name: T('tier.5.name' /* 優 */), color: '#5ab0ff' },
  { min: 3,  name: T('tier.3.name' /* 良 */), color: '#7dff9a' },
  { min: 0,  name: T('tier.0.name' /* 並 */), color: '#c8c0b0' },
];
function bonusTier(b) {
  return BONUS_TIERS.find(t => b >= t.min);
}

// ブースター +N が上げる性能と、その効き方（係数 × N%）
const BONUS_STATS = {
  headCpu: { clock: 1, sensor: 0.5, hp: 1 },
  headReg: { eff: 0.3, hp: 1 },
  torso:   { hp: 1, def: 1, power: 0.3 },
  arm:     { dmg: 1, hp: 1 },
  legs:    { speed: 0.5, turn: 0.5, accel: 0.5, cap: 0.5, hp: 1 },
};
const BONUS_STAT_NAMES = {
  clock: T('stat.clock' /* 処理 */), sensor: T('stat.sensor' /* センサー */), eff: T('stat.eff' /* 出力効率 */), hp: T('stat.hp' /* 耐久 */), def: T('stat.def' /* 防御 */), power: T('stat.power' /* 出力 */),
  dmg: T('stat.dmg' /* 威力 */), speed: T('stat.speed' /* 速度 */), turn: T('stat.turn' /* 旋回 */), accel: T('stat.accel' /* 加速 */), cap: T('stat.cap' /* 積載 */),
};
// 「威力 +20% / 耐久 +20%」のような説明文
function bonusDesc(cat, b) {
  return Object.entries(BONUS_STATS[cat]).map(([k, f]) => `${BONUS_STAT_NAMES[k]} +${fmtPct(b * f)}%`).join(' / ');
}
function fmtPct(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }

// ブースターを分解して得られる鉱石（+値が高いほど多い。+10 で3倍）
const SALVAGE = {
  headCpu: { crystal: 3, core: 1 },
  headReg: { iron: 3, crystal: 2, core: 1 },
  torso:   { iron: 6, core: 2 },
  arm:     { iron: 6, crystal: 2 },
  legs:    { iron: 9 },
};
function salvageOre(item) {
  const k = 1 + 2 * item.bonus / BONUS_MAX, o = emptyOre();
  for (const [id, n] of Object.entries(SALVAGE[item.cat])) o[id] = Math.round(n * k);
  return o;
}

// ドロップするブースターの対象パーツ（未装着は除く）
function randomDropPart(floor) {
  const all = [];
  for (const cat of Object.keys(PARTS)) for (const p of PARTS[cat]) if (p.type !== 'none') all.push({ cat, id: p.id });
  const p = all[(Math.random() * all.length) | 0];
  return { cat: p.cat, id: p.id, bonus: rollBonus(floor) };
}

// 同時にフィールドにいる一般エネミーの上限（残りは増援として順次出現）
const MAX_ACTIVE_ENEMIES = 30;

// 荒野フィールドの地区構成（横に並ぶ3地区）
const DISTRICT_W = 130;
const DISTRICT_H = 150;
const DISTRICTS = [
  { name: T('district.wasteland.1.name' /* 第1地区 */), sub: T('district.wasteland.1.sub' /* 赤錆の平原 */), tint: 'rgba(0,0,0,0)',          troll: 7, spitter: 4 },
  { name: T('district.wasteland.2.name' /* 第2地区 */), sub: T('district.wasteland.2.sub' /* 骨の渓谷 */),   tint: 'rgba(80,65,60,0.20)',    troll: 6, spitter: 3 },
  { name: T('district.wasteland.3.name' /* 第3地区 */), sub: T('district.wasteland.3.sub' /* 灼砂の窪地 */), tint: 'rgba(160,60,20,0.16)',   troll: 5, spitter: 3 },
];

// 出撃できるフィールド。shape で形が決まる（field.js）
//   strip … 横に並ぶ長方形の地区（dw × h）
//   disc  … 円形。中心の円が第1地区で、外側の輪へ広がる（radii = 各地区の外周の半径）
const FIELDS = [
  {
    id: 'wasteland', name: T('field.wasteland.name' /* 荒野 第7区画 */), shape: 'strip', dw: DISTRICT_W, h: DISTRICT_H,
    desc: T('field.wasteland.desc' /* 見通しの良い荒野。横に並ぶ地区を順に制圧していく。ボス戦は全… */),
    districts: DISTRICTS,
    boss: 'boss', bossWarn: T('field.wasteland.bossWarn' /* 大型の生体反応が地中を接近中！ */),
    rocksPer: 10, rockR: [2, 6], decorN: 900, decor: ['pebble', 'pebble', 'pebble', 'bush', 'bush', 'crack', 'bone'],
  },
  {
    id: 'cave', name: T('field.cave.name' /* 円形洞窟「奈落の大空洞」 */), shape: 'disc', radii: [45, 80, 110], dark: true,
    boss: 'spider', bossWarn: T('field.cave.bossWarn' /* 天井の暗闇から巨大な生体反応が降りてくる！ */),
    desc: T('field.cave.desc' /* 巨大な円形の地下空洞。中心に降下し、地区を掃討するたびに外側… */),
    districts: [
      { name: T('district.cave.1.name' /* 第1地区 */), sub: T('district.cave.1.sub' /* 崩落の底 */),     tint: 'rgba(0,0,0,0)',          troll: 8, spitter: 4 },
      { name: T('district.cave.2.name' /* 第2地区 */), sub: T('district.cave.2.sub' /* 蒼晶の坑道 */),   tint: 'rgba(40,110,170,0.12)', troll: 6, spitter: 3 },
      { name: T('district.cave.3.name' /* 第3地区 */), sub: T('district.cave.3.sub' /* 骨喰いの外縁 */), tint: 'rgba(120,40,30,0.14)',  troll: 5, spitter: 3 },
    ],
    rocksPer: 6, rockR: [2, 4.5], decorN: 500, decor: ['pebble', 'pebble', 'crack', 'bone', 'crystal', 'crystal', 'stalag', 'stalag'],
  },
];

function fieldById(id) {
  return FIELDS.find(f => f.id === id) || FIELDS[0];
}

// 階層：どのフィールドも第1〜第 FLOORS 層（各層は同じ3地区＋ボス）。
// 下の層ほどエネミー（ボス含む）の耐久・攻撃力が上がり、落とす鉱石も増える。ボスを倒すと次の層が解放される
const FLOORS = 8;
const FLOOR_STEP = { hp: 0.3, dmg: 0.15, ore: 0.15 };   // 1層下がるごとの増加（第8層で 耐久×3.1 / 攻撃×2.05 / 鉱石×2.05）
function floorMul(f) {
  const k = clamp(f | 0, 1, FLOORS) - 1;
  return { hp: 1 + FLOOR_STEP.hp * k, dmg: 1 + FLOOR_STEP.dmg * k, ore: 1 + FLOOR_STEP.ore * k };
}
function floorName(f) { return T('C013' /* 第{f}層 */, { f }); }
// 地区の表示名（第1地区「赤錆の平原」 / District 1 "Rust Plains"）
function districtLabel(D) { return T('C014' /* {name}「{sub}」 */, { name: D.name, sub: D.sub }); }
function fmtMul(v) { return '×' + String(+v.toFixed(2)); }   // 倍率の表示（×1.45 など）
function emptyFloors(v) {
  const o = {};
  for (const f of FIELDS) o[f.id] = v;
  return o;
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
//  mini = 戦闘画面の小さな回路図に出す判定タイルの略称（3文字まで）
// ---------------------------------------------------------------------
const TILE_GROUPS = [
  { id: 'move', name: T('tilegroup.move.name' /* 移動 */) },
  { id: 'atk',  name: T('tilegroup.atk.name' /* 攻撃 */) },
  { id: 'sys',  name: T('tilegroup.sys.name' /* 制御 */) },
  { id: 'cond', name: T('tilegroup.cond.name' /* 判定 */) },
];

const TILE_DEFS = {
  start:     { kind: 'start', group: 'start', name: T('tile.start.name' /* START（実行開始位置） */), short: 'START', icon: '▶' },
  move_f:    { kind: 'cmd', group: 'move', name: T('tile.move_f.name' /* 前進 */), short: T('tile.move_f.short' /* 前進 */), icon: '⇧' },
  move_b:    { kind: 'cmd', group: 'move', name: T('tile.move_b.name' /* 後退 */), short: T('tile.move_b.short' /* 後退 */), icon: '⇩' },
  strafe_l:  { kind: 'cmd', group: 'move', name: T('tile.strafe_l.name' /* 左へ平行移動 */), short: T('tile.strafe_l.short' /* 左移動 */), icon: '⇦' },
  strafe_r:  { kind: 'cmd', group: 'move', name: T('tile.strafe_r.name' /* 右へ平行移動 */), short: T('tile.strafe_r.short' /* 右移動 */), icon: '⇨' },
  turn_l:    { kind: 'cmd', group: 'move', name: T('tile.turn_l.name' /* 左旋回 */), short: T('tile.turn_l.short' /* 左旋回 */), icon: '↺' },
  turn_r:    { kind: 'cmd', group: 'move', name: T('tile.turn_r.name' /* 右旋回 */), short: T('tile.turn_r.short' /* 右旋回 */), icon: '↻' },
  face:      { kind: 'cmd', group: 'move', name: T('tile.face.name' /* 最寄りの敵へ向く */), short: T('tile.face.short' /* 敵へ向く */), icon: '◎' },
  jump:      { kind: 'cmd', group: 'move', name: T('tile.jump.name' /* ジャンプ（脚部 強化Lv{lv}以上。跳躍中は無敵） */, { lv: UPGRADE_JUMP_LV }), short: T('tile.jump.short' /* ジャンプ */), icon: '⤴',
               params: [T('tile.jump.param.0' /* 前 */), T('tile.jump.param.1' /* 後 */), T('tile.jump.param.2' /* 左 */), T('tile.jump.param.3' /* 右 */), T('tile.jump.param.4' /* 敵から離脱 */)], unit: '', dp: 1 },
  fire_l:    { kind: 'cmd', group: 'atk', name: T('tile.fire_l.name' /* 左腕で攻撃 */), short: T('tile.fire_l.short' /* 左腕攻撃 */), icon: 'L' },
  fire_r:    { kind: 'cmd', group: 'atk', name: T('tile.fire_r.name' /* 右腕で攻撃 */), short: T('tile.fire_r.short' /* 右腕攻撃 */), icon: 'R' },
  fire_both: { kind: 'cmd', group: 'atk', name: T('tile.fire_both.name' /* 両腕で攻撃 */), short: T('tile.fire_both.short' /* 両腕攻撃 */), icon: 'LR' },
  power:     { kind: 'cmd', group: 'sys', name: T('tile.power.name' /* 出力配分を変更（腕への割合） */), short: T('tile.power.short' /* 出力 */), icon: '⚡',
               params: [0, 20, 35, 50, 65, 80, 100], unit: '%', dp: 3 },
  wait:      { kind: 'cmd', group: 'sys', name: T('tile.wait.name' /* 待機 */), short: T('tile.wait.short' /* 待機 */), icon: '…' },
  c_near:    { kind: 'cond', group: 'cond', name: T('tile.c_near.name' /* 敵が○m以内にいるか */), short: T('tile.c_near.short' /* 敵≦ */), mini: T('tile.c_near.mini' /* 敵≦ */), icon: '◇',
               params: [5, 10, 20, 30, 45, 60], unit: 'm', dp: 3 },
  c_front:   { kind: 'cond', group: 'cond', name: T('tile.c_front.name' /* 前方±○°に敵がいるか */), short: T('tile.c_front.short' /* 前方敵 */), mini: T('tile.c_front.mini' /* 前方敵 */), icon: '◇',
               params: [10, 20, 45, 90], unit: '°', dp: 1 },
  c_left:    { kind: 'cond', group: 'cond', name: T('tile.c_left.name' /* 最寄りの敵は左側か */), short: T('tile.c_left.short' /* 敵は左 */), mini: T('tile.c_left.mini' /* 敵は左 */), icon: '◇' },
  c_count:   { kind: 'cond', group: 'cond', name: T('tile.c_count.name' /* センサー内の敵が○体以上か */), short: T('tile.c_count.short' /* 敵数≧ */), mini: T('tile.c_count.mini' /* 敵数≧ */), icon: '◇',
               params: [1, 3, 5, 10, 20], unit: T('tile.c_count.unit' /* 体 */), dp: 2 },
  c_hp:      { kind: 'cond', group: 'cond', name: T('tile.c_hp.name' /* HP残量が○%以下か */), short: 'HP≦', mini: T('tile.c_hp.mini' /* HP≦ */), icon: '◇',
               params: [25, 50, 75], unit: '%', dp: 1 },
  c_ready_l: { kind: 'cond', group: 'cond', name: T('tile.c_ready_l.name' /* 左腕が攻撃可能か（リロード中でない） */), short: T('tile.c_ready_l.short' /* 左腕OK */), mini: T('tile.c_ready_l.mini' /* 左腕O */), icon: '◇' },
  c_ready_r: { kind: 'cond', group: 'cond', name: T('tile.c_ready_r.name' /* 右腕が攻撃可能か（リロード中でない） */), short: T('tile.c_ready_r.short' /* 右腕OK */), mini: T('tile.c_ready_r.mini' /* 右腕O */), icon: '◇' },
  c_proj:    { kind: 'cond', group: 'cond', name: T('tile.c_proj.name' /* 敵弾が○m以内に接近しているか */), short: T('tile.c_proj.short' /* 敵弾≦ */), mini: T('tile.c_proj.mini' /* 敵弾≦ */), icon: '◇',
               params: [4, 8, 12], unit: 'm', dp: 1 },
  c_jump:    { kind: 'cond', group: 'cond', name: T('tile.c_jump.name' /* ジャンプ可能か（脚部 強化Lv6以上・再使用待ちでない） */), short: T('tile.c_jump.short' /* 跳躍OK */), mini: T('tile.c_jump.mini' /* 跳躍O */), icon: '◇' },
  c_boss:    { kind: 'cond', group: 'cond', name: T('tile.c_boss.name' /* ボスが出現しているか */), short: T('tile.c_boss.short' /* ボス? */), mini: T('tile.c_boss.mini' /* ボス? */), icon: '◇' },
  c_rand:    { kind: 'cond', group: 'cond', name: T('tile.c_rand.name' /* ランダム（○%の確率でYES） */), short: T('tile.c_rand.short' /* 確率 */), mini: T('tile.c_rand.mini' /* 確率 */), icon: '◇',
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

const PROG_SLOTS = 3;   // 保存しておける回路の数

function defaultSave() {
  const s = {
    // gear = スロット → 差し込んだブースター { uid, id(対象パーツ), bonus }（無いスロットは無し）
    build: { headCpu: 'cpu_m', headReg: 'reg_b', torso: 't_std', armL: 'gatling', armR: 'cannon', legs: 'biped', armRatio: 0.5, gear: {} },
    program: null,     // 出撃に使う回路（programs[progSlot] と同じもの。下で入れる）
    programs: [defaultProgram(), defaultProgram(), defaultProgram()],   // 保存しておける回路（PROG_SLOTS 個）
    progSlot: 0,       // 選んでいる回路の番号
    enemyCount: 20,
    field: 'wasteland',   // 出撃するフィールド（FIELDS の id）
    floor: emptyFloors(1),     // フィールド id → 出撃する層
    reached: emptyFloors(1),   // フィールド id → 解放済みの一番深い層
    ore: emptyOre(),   // 所持している鉱石
    upgrades: {},      // パーツ id → 強化レベル
    stock: [],         // レアエネミーが落としたブースター { uid, cat, id(対象パーツ), bonus, got }（同じものを何個でも持てる）
    nextUid: 1,
  };
  s.program = s.programs[0];
  return s;
}
