'use strict';
// =====================================================================
//  エネミーデザイン（見た目）
//  ・性能の数値は data.js の ENEMY_DEFS、見た目はこのファイル、と分けている
//  ・キーは ENEMY_DEFS の種類名に対応（未登録の種類は仮の図形で表示される）
//
//  座標系：単位はメートル、原点はエネミーの中心
//  rotate が false でなければ、+X がエネミーの向き（突進の踏み込み e.lunge*0.3 も適用済み）
//  draw(ctx, e) の e：エネミーの状態
//    e.r 半径 / e.anim 経過秒 / e.lunge 攻撃の踏み込み(1→0) / e.flash 被弾の白飛び時間
//    ボスのみ：e.a 向き / e.state 行動 / e.st 行動の残り時間（e.st0 行動の長さ） / e.phase2 HP半分以下の形態 /
//              砂礫王：e.buried 地中に潜行中 / e.segs 尾の体節（ワールド座標）
//              蒼晶蜘蛛：e.airborne 跳躍中 / e.walk 歩いた距離（脚の動き）
//
//  その他の見た目の設定：
//    hpBar       … 損傷時に頭上へHPバーを出すか
//    gibColor    … 撃破時に飛び散る破片の色
//    scorchColor … 撃破跡の地面の染みの色
//    mapColor / mapSize … ミニマップ上の点の色と大きさ(px)
// =====================================================================

// 被弾時の白飛び
function enemyFlash(ctx, e, alpha) {
  if (e.flash <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  circle(ctx, 0, 0, e.r * 1.05);
  ctx.fill();
  ctx.restore();
}

// 発光のにじみ：半透明の円を加算で3枚重ね、中心ほど明るくする。shadowBlur（ぼかしの計算が重い）の代わりに、数の多い雑魚と弾で使う。
// 光らせる形を描く直前に呼ぶ（ぼかしと同じく、形の下にまわりの光が広がる）
function glowDot(ctx, x, y, r, color, alpha = 0.35) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = color;
  ctx.globalAlpha *= alpha / 3;
  circle(ctx, x, y, r); ctx.fill();
  circle(ctx, x, y, r * 0.7); ctx.fill();
  circle(ctx, x, y, r * 0.45); ctx.fill();
  ctx.restore();
}

// 接地影（地面に落とす柔らかい陰影）
function groundShadow(ctx, cx, cy, rx, ry, alpha = 0.32) {
  ctx.save();
  ctx.fillStyle = `rgba(18, 12, 8, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const ENEMY_ART = {
  // ------------------------------------------------------------ サンドスカラベ
  // 荒野を高速疾走する凶悪な機械キチン甲虫
  scarab: {
    hpBar: false,
    gibColor: '#7a502e',
    scorchColor: 'rgba(50,30,18,0.4)',
    mapColor: '#ff6250', mapSize: 2,
    draw(ctx, e) {
      const t = e.anim;

      // 接地影
      groundShadow(ctx, -0.05, 0.08, 0.72, 0.52, 0.32);

      // 3対の鋭利な多関節昆虫レッグ（走る高速アニメーション）
      ctx.strokeStyle = '#22160d';
      ctx.lineWidth = 0.07;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = -1; i <= 1; i++) {
        const sw = Math.sin(t * 24 + i * 2.3);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          const bx = i * 0.22, by = s * 0.25;
          const kx = i * 0.26 + sw * 0.12, ky = s * (0.52 + Math.abs(sw) * 0.06);
          const tx = i * 0.28 + sw * 0.18 - 0.05, ty = s * 0.78;
          ctx.moveTo(bx, by);
          ctx.lineTo(kx, ky);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }
      }

      // 腹部ベース
      ctx.fillStyle = '#2d1b0f';
      ctx.beginPath();
      ctx.ellipse(-0.1, 0, 0.6, 0.44, 0, 0, Math.PI * 2);
      ctx.fill();

      // 後部甲殻プレート（重厚なキチン装甲）
      ctx.fillStyle = '#54361e';
      ctx.beginPath();
      ctx.moveTo(-0.62, 0);
      ctx.lineTo(-0.48, -0.42);
      ctx.quadraticCurveTo(-0.18, -0.45, -0.05, -0.4);
      ctx.lineTo(-0.05, 0.4);
      ctx.quadraticCurveTo(-0.18, 0.45, -0.48, 0.42);
      ctx.closePath();
      ctx.fill();

      // 中央甲殻プレート（左右分割＆中央スリット）
      ctx.fillStyle = '#6b4526';
      ctx.beginPath();
      ctx.moveTo(-0.1, -0.38);
      ctx.lineTo(0.24, -0.34);
      ctx.lineTo(0.24, -0.04);
      ctx.lineTo(-0.1, -0.04);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-0.1, 0.38);
      ctx.lineTo(0.24, 0.34);
      ctx.lineTo(0.24, 0.04);
      ctx.lineTo(-0.1, 0.04);
      ctx.closePath();
      ctx.fill();

      // 甲殻エッジのハイライト
      ctx.strokeStyle = '#8c5d33';
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(-0.55, -0.25); ctx.lineTo(-0.05, -0.38); ctx.lineTo(0.24, -0.34);
      ctx.moveTo(-0.55, 0.25); ctx.lineTo(-0.05, 0.38); ctx.lineTo(0.24, 0.34);
      ctx.stroke();

      // 前胸部
      ctx.fillStyle = '#3e2413';
      ctx.beginPath();
      ctx.ellipse(0.26, 0, 0.16, 0.32, 0, 0, Math.PI * 2);
      ctx.fill();

      // 頭部
      ctx.fillStyle = '#26160b';
      ctx.beginPath();
      ctx.ellipse(0.44, 0, 0.16, 0.22, 0, 0, Math.PI * 2);
      ctx.fill();

      // 大顎（ノコギリ状の凶悪シザース）
      const mandOpen = 0.18 + Math.sin(t * 12) * 0.08 + (e.lunge > 0 ? 0.25 : 0);
      ctx.fillStyle = '#1c1007';
      ctx.strokeStyle = '#85562e';
      ctx.lineWidth = 0.03;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(0.52, s * 0.12);
        ctx.rotate(s * mandOpen);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0.22, s * 0.05);
        ctx.lineTo(0.35, -s * 0.06);
        ctx.lineTo(0.24, -s * 0.08);
        ctx.lineTo(0.18, -s * 0.03);
        ctx.lineTo(0.12, -s * 0.06);
        ctx.lineTo(0, -s * 0.04);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // 複眼LEDセンサー（真紅の発光グロー）
      for (const s of [-1, 1]) glowDot(ctx, 0.46, s * 0.12, 0.15, '#ff3311', 0.5);
      ctx.save();
      ctx.fillStyle = '#ff2818';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0.42, s * 0.08);
        ctx.lineTo(0.5, s * 0.13);
        ctx.lineTo(0.44, s * 0.16);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#ffaa33';
      circle(ctx, 0.49, 0, 0.03); ctx.fill();
      ctx.restore();

      enemyFlash(ctx, e, 0.65);
    },
  },

  // ------------------------------------------------------------ アシッドスピッター
  // 蛍光酸タンクを背負ったバイオメカ・プレデター
  spitter: {
    hpBar: true,
    gibColor: '#8edb2b',
    scorchColor: 'rgba(90,140,20,0.4)',
    mapColor: '#88ff33', mapSize: 3,
    draw(ctx, e) {
      const t = e.anim;

      // 接地影
      groundShadow(ctx, -0.05, 0.08, 1.05, 0.85, 0.35);

      // 3対の長大な多関節スパイクレッグ
      ctx.strokeStyle = '#1e280c';
      ctx.lineWidth = 0.09;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [ax, s, phase] of [
        [0.35, -1, 0], [0.35, 1, Math.PI],
        [-0.1, -1, 1.8], [-0.1, 1, 1.8 + Math.PI],
        [-0.45, -1, 3.2], [-0.45, 1, 3.2 + Math.PI],
      ]) {
        const sw = Math.sin(t * 8 + phase);
        const kx = ax + sw * 0.12 + 0.1;
        const ky = s * (0.75 + Math.abs(sw) * 0.1);
        const tx = ax + sw * 0.18 + 0.2;
        const ty = s * 1.25;
        ctx.beginPath();
        ctx.moveTo(ax, s * 0.35);
        ctx.lineTo(kx, ky);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        // 先端の鋭利な鉤爪
        ctx.strokeStyle = '#4e691b';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.strokeStyle = '#1e280c';
        ctx.lineWidth = 0.09;
      }

      // 胴体キチン外骨格
      ctx.fillStyle = '#263311';
      ctx.beginPath();
      ctx.moveTo(0.5, 0);
      ctx.lineTo(0.3, -0.5);
      ctx.lineTo(-0.35, -0.55);
      ctx.lineTo(-0.6, 0);
      ctx.lineTo(-0.35, 0.55);
      ctx.lineTo(0.3, 0.5);
      ctx.closePath();
      ctx.fill();

      // 腹部のアシッドタンク（背負った強酸の嚢）
      const pulse = 1 + 0.08 * Math.sin(t * 5);
      const tankR = 0.48 * pulse;

      // タンク保持リブ（外骨格の爪がタンクを固定）
      ctx.strokeStyle = '#182208';
      ctx.lineWidth = 0.08;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-0.15, s * 0.45);
        ctx.quadraticCurveTo(-0.4, s * 0.55, -0.55, s * 0.2);
        ctx.stroke();
      }

      // タンク本体（妖しく発光する液体グラデーション）
      ctx.save();
      const grad = ctx.createRadialGradient(-0.38, -0.08, 0.08, -0.35, 0, tankR);
      grad.addColorStop(0, '#f2ff99');
      grad.addColorStop(0.35, '#a4f527');
      grad.addColorStop(0.75, 'rgba(80, 180, 20, 0.85)');
      grad.addColorStop(1, 'rgba(30, 80, 10, 0.95)');
      glowDot(ctx, -0.35, 0, tankR + 0.22, '#99ff11', 0.35);
      ctx.fillStyle = grad;
      circle(ctx, -0.35, 0, tankR);
      ctx.fill();

      // タンク内の気泡
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const b1 = Math.sin(t * 6) * 0.06;
      const b2 = Math.cos(t * 7) * 0.05;
      circle(ctx, -0.42 + b1, -0.15 + b2, 0.07); ctx.fill();
      circle(ctx, -0.28 - b2, 0.12 - b1, 0.05); ctx.fill();
      circle(ctx, -0.48, 0.08, 0.04); ctx.fill();
      ctx.restore();

      // 前部甲殻プレート
      ctx.fillStyle = '#3d5218';
      ctx.beginPath();
      ctx.moveTo(0.1, -0.35);
      ctx.lineTo(0.45, -0.25);
      ctx.lineTo(0.45, 0.25);
      ctx.lineTo(0.1, 0.35);
      ctx.closePath();
      ctx.fill();

      // 射撃バイオノズル（酸の噴射砲門）
      ctx.fillStyle = '#1c260b';
      ctx.beginPath();
      ctx.moveTo(0.35, -0.18);
      ctx.lineTo(0.72 + e.lunge * 0.15, -0.1);
      ctx.lineTo(0.78 + e.lunge * 0.2, 0);
      ctx.lineTo(0.72 + e.lunge * 0.15, 0.1);
      ctx.lineTo(0.35, 0.18);
      ctx.closePath();
      ctx.fill();

      // ノズル先端のチャージ光
      glowDot(ctx, 0.72 + e.lunge * 0.18, 0, 0.22 + e.lunge * 0.1, '#aaff00', 0.45);
      ctx.save();
      ctx.fillStyle = '#d5ff4f';
      circle(ctx, 0.72 + e.lunge * 0.18, 0, 0.09 + e.lunge * 0.08);
      ctx.fill();
      ctx.restore();

      // 多眼センサー
      ctx.fillStyle = '#ffcc00';
      for (const [ex, ey] of [[0.45, -0.2], [0.45, 0.2], [0.52, -0.12], [0.52, 0.12]]) {
        circle(ctx, ex, ey, 0.04); ctx.fill();
      }

      enemyFlash(ctx, e, 0.65);
    },
  },

  // ------------------------------------------------------------ ロックトロール
  // 灼熱の炉心を抱える超重量級の巨石ゴーレム
  troll: {
    hpBar: true,
    gibColor: '#8a7d6b',
    scorchColor: 'rgba(50,35,22,0.45)',
    mapColor: '#ff9430', mapSize: 4,
    draw(ctx, e) {
      const t = e.anim;

      // 巨大な接地影
      groundShadow(ctx, 0.1, 0.15, 2.3, 2.0, 0.4);

      const sw = Math.sin(t * 2.8) * 0.3;
      const lungeFwd = e.lunge * 1.1;

      // 巨大な岩石ナックル（両腕）
      for (const [sSign] of [[-1], [1]]) {
        ctx.save();
        const armX = 0.5 + (sSign > 0 ? -sw : sw) + lungeFwd;
        const armY = sSign * 1.6;
        ctx.translate(armX, armY);

        // 腕の影
        groundShadow(ctx, 0, 0.1, 0.8, 0.65, 0.25);

        // ナックル岩塊（角ばった多角形）
        ctx.fillStyle = '#47433c';
        ctx.beginPath();
        ctx.moveTo(-0.5, -0.4 * sSign);
        ctx.lineTo(0.4, -0.55 * sSign);
        ctx.lineTo(0.75, -0.1 * sSign);
        ctx.lineTo(0.6, 0.5 * sSign);
        ctx.lineTo(-0.3, 0.6 * sSign);
        ctx.closePath();
        ctx.fill();

        // ナックル表面のハイライト面
        ctx.fillStyle = '#6e685e';
        ctx.beginPath();
        ctx.moveTo(-0.3, -0.2 * sSign);
        ctx.lineTo(0.35, -0.35 * sSign);
        ctx.lineTo(0.5, 0);
        ctx.lineTo(-0.1, 0.3 * sSign);
        ctx.closePath();
        ctx.fill();

        // 先端の鉱石スパイク
        ctx.fillStyle = '#2b2925';
        ctx.beginPath();
        ctx.moveTo(0.6, -0.2 * sSign);
        ctx.lineTo(0.9, -0.05 * sSign);
        ctx.lineTo(0.55, 0.2 * sSign);
        ctx.closePath();
        ctx.fill();

        // 腕のひび割れ溶岩光
        const glowA = 0.6 + 0.4 * Math.sin(t * 4 + sSign);
        ctx.strokeStyle = `rgba(255, 120, 30, ${glowA})`;
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.moveTo(-0.2, 0); ctx.lineTo(0.2, -0.1 * sSign); ctx.lineTo(0.45, 0.1 * sSign);
        ctx.stroke();

        ctx.restore();
      }

      // 胴体：無骨な多角形岩塊（多重レイヤー）
      // 下層ダークベース
      ctx.fillStyle = '#332f2a';
      ctx.beginPath();
      ctx.moveTo(1.7, 0);
      ctx.lineTo(1.2, -1.3);
      ctx.lineTo(-0.2, -1.8);
      ctx.lineTo(-1.6, -1.1);
      ctx.lineTo(-1.8, 0.3);
      ctx.lineTo(-0.9, 1.6);
      ctx.lineTo(0.8, 1.7);
      ctx.lineTo(1.5, 1.1);
      ctx.closePath();
      ctx.fill();

      // メイン岩盤プレート（荒削りな幾何学的ファセット）
      ctx.fillStyle = '#544f46';
      ctx.beginPath();
      ctx.moveTo(1.4, -0.2);
      ctx.lineTo(1.0, -1.1);
      ctx.lineTo(-0.1, -1.4);
      ctx.lineTo(-1.3, -0.8);
      ctx.lineTo(-1.4, 0.2);
      ctx.lineTo(-0.7, 1.3);
      ctx.lineTo(0.6, 1.4);
      ctx.lineTo(1.3, 0.8);
      ctx.closePath();
      ctx.fill();

      // 上層ハイライト岩塊面
      ctx.fillStyle = '#736c60';
      for (const poly of [
        [[0.2, -0.8], [0.8, -0.6], [0.5, -0.1], [-0.1, -0.3]],
        [[-0.8, -0.6], [-0.3, -0.4], [-0.5, 0.2], [-1.1, 0.0]],
        [[-0.6, 0.4], [0.1, 0.3], [-0.1, 1.0], [-0.8, 0.9]],
        [[0.4, 0.1], [1.1, 0.3], [0.8, 0.9], [0.2, 0.8]],
      ]) {
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
        ctx.closePath();
        ctx.fill();
      }

      // 風化した古代の苔
      ctx.fillStyle = 'rgba(95, 120, 50, 0.75)';
      ctx.beginPath();
      ctx.ellipse(-0.7, -0.6, 0.38, 0.25, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-0.3, 0.9, 0.32, 0.2, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // 体内マグマコア＆クラック（ひび割れから漏れ出す高熱エネルギー）
      const magmaPulse = 0.65 + 0.35 * Math.sin(t * 3.2);
      ctx.save();
      // ひび割れ：太く薄い線（光のにじみ）を下に敷いてから細い線を描く（shadowBlur の代わり）
      const crack = () => {
        ctx.beginPath();
        ctx.moveTo(0.9, 0);
        ctx.lineTo(0.3, -0.35);
        ctx.lineTo(-0.2, -0.05);
        ctx.lineTo(-0.8, -0.2);
        ctx.moveTo(0.3, -0.35);
        ctx.lineTo(0.1, 0.4);
        ctx.lineTo(-0.4, 0.55);
        ctx.stroke();
      };
      ctx.strokeStyle = `rgba(255, 102, 17, ${0.3 * magmaPulse})`;
      ctx.lineWidth = 0.32;
      crack();
      ctx.strokeStyle = `rgba(255, 110, 20, ${magmaPulse})`;
      ctx.lineWidth = 0.09;
      crack();

      // コア中心の熱源
      glowDot(ctx, 0.3, -0.1, 0.32, '#ff6611', 0.45 * magmaPulse);
      glowDot(ctx, -0.1, 0.2, 0.26, '#ff6611', 0.45 * magmaPulse);
      ctx.fillStyle = `rgba(255, 230, 100, ${magmaPulse * 0.9})`;
      circle(ctx, 0.3, -0.1, 0.14); ctx.fill();
      circle(ctx, -0.1, 0.2, 0.1); ctx.fill();
      ctx.restore();

      // 頭部岩庇（バイザー状の突起）
      ctx.fillStyle = '#292622';
      ctx.beginPath();
      ctx.moveTo(0.9, -0.6);
      ctx.lineTo(1.5, -0.45);
      ctx.lineTo(1.6, 0.45);
      ctx.lineTo(0.9, 0.6);
      ctx.closePath();
      ctx.fill();

      // ギラリと光るデュアルアイ（琥珀色の眼光）
      for (const s of [-1, 1]) glowDot(ctx, 1.38, s * 0.33, 0.2, '#ff8800', 0.4);
      ctx.save();
      ctx.fillStyle = '#ffaa11';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(1.25, s * 0.25);
        ctx.lineTo(1.48, s * 0.32);
        ctx.lineTo(1.42, s * 0.42);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      enemyFlash(ctx, e, 0.65);
    },
  },

  // ------------------------------------------------------------ ボス：砂礫王グラヴォルム
  // 荒野を統べる超巨大ムカデ型古代兵器
  // 尾の体節がワールド座標で動くため、回転は draw の中で行う
  boss: {
    rotate: false,
    hpBar: false,
    gibColor: '#8a522f',
    scorchColor: 'rgba(70,40,20,0.5)',
    mapColor: '#ff2814', mapSize: 6,
    draw(ctx, e) {
      if (e.buried) return;   // 地中にいる間は地表の盛り上がりだけを描く（battle.js）
      const t = e.anim;
      const p = bossWind(e);  // 現在の行動の進み具合（予備モーションの大きさ）
      const emerge = e.state === 'emerge' ? p : e.state === 'dive' ? 1 - p : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0.15, emerge);

      // 尾の体節（各節に左右の鋭角スパイクと装甲プレート、赤熱スリット）
      for (let i = e.segs.length - 1; i >= 0; i--) {
        const sx = e.segs[i].x - e.x, sy = e.segs[i].y - e.y;
        const r = 3.2 - i * 0.28;
        const nextX = i > 0 ? (e.segs[i - 1].x - e.x) : 0;
        const nextY = i > 0 ? (e.segs[i - 1].y - e.y) : 0;
        const segAngle = Math.atan2(nextY - sy, nextX - sx);

        // 各節の影
        groundShadow(ctx, sx, sy + 0.2, r * 1.3, r * 1.1, 0.25);

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(segAngle);

        // 左右に突き出す外骨格スパイク（甲殻の返しトゲ）
        ctx.fillStyle = i % 2 === 0 ? '#382012' : '#452817';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(r * 0.3, s * r * 0.6);
          ctx.lineTo(-r * 0.2, s * (r * 1.45 + 0.2));
          ctx.lineTo(-r * 0.7, s * r * 0.7);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#633d22';
          ctx.lineWidth = 0.15;
          ctx.stroke();
        }

        // 体節メイン装甲プレート
        ctx.fillStyle = i % 2 === 0 ? '#54321d' : '#693e24';
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.95, r * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();

        // 甲殻のセンターリッジ
        ctx.fillStyle = '#7a4b2c';
        ctx.beginPath();
        ctx.ellipse(-r * 0.1, 0, r * 0.6, r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();

        // 装甲ライン＆フェーズ2発光
        if (e.phase2) {
          ctx.save();
          const pulse = 0.7 + 0.3 * Math.sin(t * 8 + i * 1.2);
          ctx.strokeStyle = `rgba(255, 90, 20, ${pulse})`;
          ctx.shadowColor = '#ff5500';
          ctx.shadowBlur = 12;
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.65, -0.9, 0.9);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(-r * 0.5, 0); ctx.lineTo(r * 0.5, 0);
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.strokeStyle = '#2b170c';
          ctx.lineWidth = 0.2;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.65, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }

      // 頭部へ移行（ボスの向き e.a で回転）
      ctx.rotate(e.a);

      // 予備モーション：突進前は頭を引いて震え、弾の放出前は甲殻を膨らませ、叩きつけ前は伸び上がる
      const jit = Math.sin(t * 70) * 0.12;
      const inhale = e.state === 'ring_wind' || e.state === 'spiral_wind';
      if (e.state === 'charge_wind') ctx.translate(-1.4 * p, jit * p);
      else if (inhale) { ctx.translate(jit * p * 0.5, 0); ctx.scale(1 + 0.14 * p, 1 + 0.14 * p); }
      else if (e.state === 'slam_wind') ctx.scale(1 + 0.22 * p, 1 + 0.22 * p);
      else if (e.state === 'rage') ctx.translate(jit, jit * 0.7);

      // 頭部直下の接地影
      groundShadow(ctx, 0, 0.3, 4.2, 3.4, 0.4);

      // 3対の巨大多関節脚（重装甲レッグ）
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const sw = Math.sin(t * 6 + i * 2.1) * 0.55;
        for (const s of [-1, 1]) {
          const rootX = -1.2 + i * 1.6;
          const rootY = s * 2.6;
          const kneeX = -1.8 + i * 1.6 + sw * s;
          const kneeY = s * 4.6;
          const tipX = -2.2 + i * 1.7 + sw * s * 1.3;
          const tipY = s * 6.6;

          // 基部〜膝
          ctx.strokeStyle = '#2d180c';
          ctx.lineWidth = 0.65;
          ctx.beginPath();
          ctx.moveTo(rootX, rootY);
          ctx.lineTo(kneeX, kneeY);
          ctx.stroke();

          // 膝〜爪先
          ctx.strokeStyle = e.phase2 ? '#a83c16' : '#472714';
          ctx.lineWidth = 0.45;
          ctx.beginPath();
          ctx.moveTo(kneeX, kneeY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // 先端の返し爪
          ctx.strokeStyle = '#1a0d06';
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          ctx.moveTo(kneeX, kneeY);
          ctx.lineTo(kneeX + 0.4, kneeY + s * 0.6);
          ctx.stroke();
        }
      }

      // 凶悪な二重クラッシャー大顎
      const open = 0.32 + 0.22 * Math.sin(t * 3.2) + (e.state === 'charge' ? 0.35 : 0) +
        (e.state === 'charge_wind' ? 0.5 * p : e.state === 'rage' ? 0.45 : inhale ? 0.3 * p : 0);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(3.5, s * 1.5);
        ctx.rotate(s * open);

        // 外側大顎（メインブレード）
        ctx.fillStyle = e.phase2 ? '#3d160a' : '#211208';
        ctx.strokeStyle = e.phase2 ? '#ff6622' : '#69381b';
        ctx.lineWidth = 0.15;
        ctx.beginPath();
        ctx.moveTo(-0.2, -0.6 * s);
        ctx.quadraticCurveTo(2.8, -0.2 * s, 3.6, s * 1.4);
        ctx.lineTo(3.2, s * 1.5);
        ctx.quadraticCurveTo(2.0, s * 0.4, 0, s * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 内側のノコギリ牙列
        ctx.fillStyle = e.phase2 ? '#ff9944' : '#d49b6a';
        for (const [fx, fy, len] of [[1.0, 0.1, 0.45], [1.7, 0.3, 0.55], [2.4, 0.6, 0.65]]) {
          ctx.beginPath();
          ctx.moveTo(fx, s * fy);
          ctx.lineTo(fx + 0.2, s * (fy + len));
          ctx.lineTo(fx + 0.35, s * fy);
          ctx.closePath();
          ctx.fill();
        }

        // 内側副顎
        ctx.fillStyle = '#180d06';
        ctx.beginPath();
        ctx.moveTo(0.2, 0);
        ctx.lineTo(1.4, s * 0.5);
        ctx.lineTo(0.3, s * 0.7);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }

      // 頭部重層甲殻（王冠を思わせる迫力のヘルメットアーマー）
      // 下部フレーム
      ctx.fillStyle = '#3a1f10';
      ctx.beginPath();
      ctx.ellipse(0, 0, e.r * 0.98, e.r * 0.88, 0, 0, Math.PI * 2);
      ctx.fill();

      // メインヘッドシェル
      ctx.fillStyle = '#6b3f23';
      ctx.beginPath();
      ctx.moveTo(2.6, 0);
      ctx.lineTo(1.8, -2.8);
      ctx.lineTo(-1.2, -3.4);
      ctx.lineTo(-3.4, -2.2);
      ctx.lineTo(-3.6, 0);
      ctx.lineTo(-3.4, 2.2);
      ctx.lineTo(-1.2, 3.4);
      ctx.lineTo(1.8, 2.8);
      ctx.closePath();
      ctx.fill();

      // 中央キール（隆起した背骨装甲）
      ctx.fillStyle = '#85502e';
      ctx.beginPath();
      ctx.moveTo(2.8, 0);
      ctx.lineTo(1.2, -1.2);
      ctx.lineTo(-2.8, -1.0);
      ctx.lineTo(-3.2, 0);
      ctx.lineTo(-2.8, 1.0);
      ctx.lineTo(1.2, 1.2);
      ctx.closePath();
      ctx.fill();

      // 側頭部の角状ホーンブレード
      ctx.fillStyle = '#26140a';
      ctx.strokeStyle = '#784523';
      ctx.lineWidth = 0.15;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0.5, s * 2.4);
        ctx.lineTo(2.4, s * 3.2);
        ctx.lineTo(1.2, s * 1.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // 装甲スリット・発熱ライン
      if (e.phase2) {
        ctx.save();
        const p2Pulse = 0.65 + 0.35 * Math.sin(t * 9);
        ctx.strokeStyle = `rgba(255, 100, 20, ${p2Pulse})`;
        ctx.shadowColor = '#ff4400';
        ctx.shadowBlur = 16;
        ctx.lineWidth = 0.28;
        ctx.beginPath();
        ctx.moveTo(-3.0, 0); ctx.lineTo(2.4, 0);
        ctx.moveTo(-1.8, -2.4); ctx.quadraticCurveTo(0, -1.0, 1.8, -2.2);
        ctx.moveTo(-1.8, 2.4); ctx.quadraticCurveTo(0, 1.0, 1.8, 2.2);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = '#381e0f';
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.moveTo(-3.0, 0); ctx.lineTo(2.2, 0);
        ctx.moveTo(-1.8, -2.2); ctx.quadraticCurveTo(0, -1.0, 1.8, -2.0);
        ctx.moveTo(-1.8, 2.2); ctx.quadraticCurveTo(0, 1.0, 1.8, 2.0);
        ctx.stroke();
      }

      // 弾の放出前：甲殻の内側から光が漏れる
      if (inhale) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, e.r * 1.1);
        g.addColorStop(0, `rgba(255,170,60,${0.6 * p})`);
        g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g;
        circle(ctx, 0, 0, e.r * 1.1);
        ctx.fill();
        ctx.restore();
      }

      // 巨大な多眼センサー（王の眼光）。突進の直前は白く明滅する
      const eyeColor = e.state === 'charge_wind' && Math.sin(t * 40) > 0 ? '#fff4d0' : e.phase2 ? '#ff2200' : '#ffc020';
      const eyeGlow = e.phase2 ? '#ff1100' : '#ff9900';
      ctx.save();
      ctx.fillStyle = eyeColor;
      ctx.shadowColor = eyeGlow;
      ctx.shadowBlur = e.phase2 ? 20 : 14;

      // 主眼（大型）
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(2.8, s * 1.25, 0.42, 0.28, s * 0.3, 0, Math.PI * 2);
        ctx.fill();

        // 副眼列（小型3連センサー）
        for (const [ox, oy, orad] of [
          [2.3, s * 1.7, 0.22],
          [1.8, s * 2.0, 0.18],
          [1.3, s * 2.2, 0.15],
        ]) {
          circle(ctx, ox, oy, orad); ctx.fill();
        }
      }
      ctx.restore();

      enemyFlash(ctx, e, 0.45);
      ctx.restore();
    },
  },

  // ------------------------------------------------------------ ボス：蒼晶蜘蛛ノクタラクネ（洞窟）
  // 背に青い結晶を生やした巨大蜘蛛。天井から糸で降り、跳躍して襲いかかる
  // 跳躍中・降下中は宙に浮くので、影は地面に残したまま体を上にずらして大きく描く
  spider: {
    rotate: false,
    hpBar: false,
    gibColor: '#8fd8ff',
    scorchColor: 'rgba(60,110,160,0.45)',
    mapColor: '#4ad8ff', mapSize: 6,
    // 高さ（0 = 接地）：跳躍は放物線、出現は天井から降りてくる。1 あたり 4m
    lift(e) {
      const p = bossWind(e);
      return e.state === 'leap' ? Math.sin(Math.PI * p) : e.state === 'emerge' ? (1 - p) * 2.2 : 0;
    },
    // ctx.liftByCaller（3D 表示 view3d.js）のときは、高さを絵の中で表さない（呼び出し側が板ごと持ち上げる）
    draw(ctx, e) {
      const t = e.anim, p = bossWind(e), st = e.state, p2 = e.phase2;
      const h = this.lift(e), hs = ctx.liftByCaller ? 0 : h;   // hs = 絵の中で表す高さ
      const crouch = st === 'leap_wind' ? p : 0;                                          // しゃがみ込み
      const rear = st === 'fan_wind' || st === 'sweep_wind' || st === 'web_wind' ? p : st === 'rage' ? 0.6 : 0;  // 立ち上がり
      const glow = st === 'fan_wind' ? p : st === 'rage' ? 0.7 + 0.3 * Math.sin(t * 30) : st === 'fan' ? 0.8 : 0;
      const jit = st === 'rage' || st === 'rain_wind' ? Math.sin(t * 70) * 0.12 : 0;
      const crys = p2 ? '#9ff0ff' : '#6cc6ff';

      ctx.save();
      if (st === 'emerge') ctx.globalAlpha = Math.min(1, 0.2 + p);

      // 接地影（高いほど小さく薄い）
      groundShadow(ctx, 0, 0.4, 5.6 * (1 - 0.25 * h), 4.6 * (1 - 0.25 * h), 0.36 * (1 - 0.35 * h));
      // 出現：天井から垂れる糸
      if (st === 'emerge' && !ctx.liftByCaller) {
        ctx.strokeStyle = 'rgba(230,240,255,0.6)';
        ctx.lineWidth = 0.08;
        ctx.beginPath(); ctx.moveTo(0, -h * 4); ctx.lineTo(0, -60); ctx.stroke();
      }

      ctx.translate(jit, -hs * 4 + jit * 0.5);
      const sc = 1 + 0.3 * hs - 0.06 * crouch;
      ctx.scale(sc, sc);
      ctx.rotate(e.a);
      ctx.translate(-0.9 * rear, 0);   // 立ち上がると体が後ろへ下がる

      // 脚（左右4本ずつ）。歩くと交互に動き、しゃがむと縮む
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const walk = e.walk || 0;
      const base = [0.75, 0.25, -0.25, -0.7];   // 横向きからの角度（前脚ほど前へ）
      for (let i = 0; i < 4; i++) {
        for (const s of [-1, 1]) {
          let sw = Math.sin(walk * 1.3 + i * 1.7 + (s > 0 ? Math.PI : 0)) * 0.22;
          if (st === 'leap') sw = 0;
          let ang = base[i] + sw;
          let len = 1 - 0.25 * crouch + 0.1 * h;
          // 前脚：立ち上がると前へ高く振り上げる
          if (i === 0 && rear > 0) { ang += 0.6 * rear; len += 0.35 * rear; }
          const rx = 0.9 - i * 0.55, ry = s * 1.1;
          const ka = s * (Math.PI / 2) - s * ang;         // 膝への向き
          const kx = rx + Math.cos(ka) * 3.0 * len, ky = ry + Math.sin(ka) * 3.0 * len;
          const ta = ka - s * (0.55 + 0.3 * crouch);       // 爪先は外側へ折れ曲がる
          const tx = kx + Math.cos(ta) * 3.2 * len, ty = ky + Math.sin(ta) * 3.2 * len;
          ctx.strokeStyle = '#141220';
          ctx.lineWidth = 0.55;
          ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(kx, ky); ctx.lineTo(tx, ty); ctx.stroke();
          ctx.strokeStyle = p2 ? '#3d5a78' : '#2e2b44';
          ctx.lineWidth = 0.32;
          ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(kx, ky); ctx.lineTo(tx, ty); ctx.stroke();
          // 膝の結晶の棘
          ctx.fillStyle = crys;
          ctx.beginPath();
          ctx.moveTo(kx - 0.18, ky); ctx.lineTo(kx + Math.cos(ka - s * 1.2) * 0.7, ky + Math.sin(ka - s * 1.2) * 0.7); ctx.lineTo(kx + 0.18, ky);
          ctx.closePath(); ctx.fill();
        }
      }

      // 腹部（後ろの大きな楕円）と背の結晶群
      ctx.fillStyle = '#1b1828';
      ctx.beginPath(); ctx.ellipse(-3.1, 0, 3.0, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#272338';
      ctx.beginPath(); ctx.ellipse(-3.0, 0, 2.4, 1.8, 0, 0, Math.PI * 2); ctx.fill();
      // 腹部の模様
      ctx.strokeStyle = 'rgba(110,190,255,0.25)';
      ctx.lineWidth = 0.12;
      for (const k of [-1.0, 0, 1.0]) {
        ctx.beginPath(); ctx.ellipse(-3.0 + k * 0.9, 0, 0.35, 1.2 - Math.abs(k) * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
      }
      // 結晶（発光は扇射の予備動作・暴走で強まる）
      ctx.save();
      ctx.shadowColor = crys;
      ctx.shadowBlur = 6 + 18 * glow + (p2 ? 8 : 0);
      const spikes = [[-2.2, -0.9, 1.6, -2.3], [-3.0, 0.2, 1.9, 2.9], [-3.9, -0.5, 1.4, -2.7], [-2.6, 0.9, 1.3, 2.1], [-4.4, 0.6, 1.1, 2.6], [-3.4, -1.2, 1.2, -1.9]];
      for (const [x, y, l, a] of spikes) {
        const L = l * (1 + 0.25 * glow);
        ctx.fillStyle = glow > 0.05 ? `rgba(${170 + 85 * glow},${230 + 25 * glow},255,0.95)` : crys;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a + 1.57) * 0.3, y + Math.sin(a + 1.57) * 0.3);
        ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
        ctx.lineTo(x + Math.cos(a - 1.57) * 0.3, y + Math.sin(a - 1.57) * 0.3);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // 頭胸部
      ctx.fillStyle = '#161322';
      ctx.beginPath(); ctx.ellipse(0.5, 0, 2.0, 1.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2c283f';
      ctx.beginPath(); ctx.ellipse(0.35, 0, 1.5, 1.2, 0, 0, Math.PI * 2); ctx.fill();
      if (p2) {
        // 晶化暴走：頭胸部にも結晶の筋が走る
        ctx.save();
        ctx.strokeStyle = `rgba(150,240,255,${0.6 + 0.4 * Math.sin(t * 9)})`;
        ctx.shadowColor = '#7ae8ff';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 0.18;
        ctx.beginPath();
        ctx.moveTo(-1.2, 0); ctx.lineTo(1.6, 0);
        ctx.moveTo(-0.6, -1.1); ctx.lineTo(0.8, -0.5);
        ctx.moveTo(-0.6, 1.1); ctx.lineTo(0.8, 0.5);
        ctx.stroke();
        ctx.restore();
      }

      // 鋏角（牙）。糸玉や薙ぎ払いの前に開く
      const open = 0.2 + 0.5 * rear + 0.08 * Math.sin(t * 4);
      ctx.fillStyle = '#0f0d18';
      ctx.strokeStyle = crys;
      ctx.lineWidth = 0.08;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(2.3, s * 0.45);
        ctx.rotate(s * open);
        ctx.beginPath();
        ctx.moveTo(0, -0.25 * s); ctx.quadraticCurveTo(1.2, -0.1 * s, 1.3, 0.55 * s); ctx.lineTo(0.9, 0.35 * s); ctx.quadraticCurveTo(0.6, 0.15 * s, 0, 0.25 * s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      // 8つの眼
      ctx.save();
      ctx.fillStyle = p2 ? '#d6fbff' : '#7fe0ff';
      ctx.shadowColor = p2 ? '#9ff6ff' : '#3ab8ff';
      ctx.shadowBlur = p2 ? 14 : 8;
      for (const [x, y, r] of [[1.9, -0.35, 0.22], [1.9, 0.35, 0.22], [1.6, -0.75, 0.16], [1.6, 0.75, 0.16], [1.35, -0.3, 0.12], [1.35, 0.3, 0.12], [1.1, -0.95, 0.1], [1.1, 0.95, 0.1]]) {
        circle(ctx, x, y, r); ctx.fill();
      }
      ctx.restore();

      enemyFlash(ctx, e, 0.4);
      ctx.restore();
    },
  },
};

// ---------------------------------------------------------------------
//  エネミーの弾（原点＝弾の中心）。hitColor は命中時の飛沫の色
// ---------------------------------------------------------------------
const ENEMY_SHOT_ART = {
  // ------------------------------------------------------------ アシッド弾
  acid: {
    hitColor: '#9aff2a',
    draw(ctx, s) {
      const angle = (s.vx !== undefined && s.vy !== undefined) ? Math.atan2(s.vy, s.vx) : 0;
      ctx.save();
      ctx.rotate(angle);

      // 外側グロー
      ctx.fillStyle = 'rgba(120, 255, 30, 0.25)';
      circle(ctx, 0, 0, s.r * 2.2); ctx.fill();

      // 尾を引く涙滴型（スライム飛沫）
      ctx.fillStyle = 'rgba(160, 255, 50, 0.6)';
      ctx.beginPath();
      ctx.moveTo(s.r * 1.2, 0);
      ctx.quadraticCurveTo(0, -s.r * 1.0, -s.r * 1.8, 0);
      ctx.quadraticCurveTo(0, s.r * 1.0, s.r * 1.2, 0);
      ctx.closePath();
      ctx.fill();

      // 高輝度コア
      glowDot(ctx, s.r * 0.2, 0, s.r * 1.05, '#99ff00', 0.35);
      ctx.save();
      ctx.fillStyle = '#f0ff99';
      circle(ctx, s.r * 0.2, 0, s.r * 0.7);
      ctx.fill();
      ctx.restore();

      ctx.restore();
    },
  },

  // ------------------------------------------------------------ 岩弾
  rock: {
    hitColor: '#ff9430',
    draw(ctx, s) {
      // 飛翔に伴う自転
      const rot = ((s.x || 0) * 2.5 + (s.y || 0) * 2.5);
      ctx.save();
      ctx.rotate(rot);

      // 大気摩擦の衝撃波・熱気グロー
      ctx.fillStyle = 'rgba(255, 110, 30, 0.3)';
      circle(ctx, 0, 0, s.r * 1.8); ctx.fill();

      // ゴツゴツした角ばった多角形隕石
      ctx.fillStyle = '#42372d';
      ctx.beginPath();
      ctx.moveTo(s.r * 1.1, 0);
      ctx.lineTo(s.r * 0.6, s.r * 0.9);
      ctx.lineTo(-s.r * 0.5, s.r * 1.1);
      ctx.lineTo(-s.r * 1.0, s.r * 0.2);
      ctx.lineTo(-s.r * 0.7, -s.r * 0.8);
      ctx.lineTo(s.r * 0.4, -s.r * 1.0);
      ctx.closePath();
      ctx.fill();

      // 表面の岩肌ファセット
      ctx.fillStyle = '#6b5a4a';
      ctx.beginPath();
      ctx.moveTo(s.r * 0.4, -s.r * 0.5);
      ctx.lineTo(s.r * 0.7, 0.1);
      ctx.lineTo(0, s.r * 0.5);
      ctx.lineTo(-s.r * 0.4, -s.r * 0.2);
      ctx.closePath();
      ctx.fill();

      // 赤熱した摩擦エッジ
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 85, 0, 0.35)';   // 光のにじみ（shadowBlur の代わりに太く薄い線を下に敷く）
      ctx.lineWidth = s.r * 0.5;
      ctx.stroke();
      ctx.strokeStyle = '#ff9430';
      ctx.lineWidth = s.r * 0.18;
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    },
  },

  // ------------------------------------------------------------ 晶弾（蒼晶蜘蛛）
  shard: {
    hitColor: '#9fe4ff',
    draw(ctx, s) {
      ctx.save();
      ctx.rotate(Math.atan2(s.vy, s.vx));
      ctx.fillStyle = 'rgba(110,200,255,0.3)';
      ctx.beginPath(); ctx.ellipse(-s.r * 0.6, 0, s.r * 2.4, s.r * 1.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9fe4ff';
      ctx.strokeStyle = '#e8faff';
      ctx.lineWidth = s.r * 0.15;
      ctx.beginPath();
      ctx.moveTo(s.r * 1.6, 0); ctx.lineTo(0, -s.r * 0.55); ctx.lineTo(-s.r * 1.3, 0); ctx.lineTo(0, s.r * 0.55);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    },
  },

  // ------------------------------------------------------------ 糸玉（蒼晶蜘蛛）。着弾点に蜘蛛の巣が張られる
  web: {
    hitColor: '#eef2ff',
    draw(ctx, s) {
      ctx.save();
      ctx.rotate(Math.atan2(s.vy, s.vx));
      ctx.strokeStyle = 'rgba(235,240,255,0.5)';
      ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-s.r * 4, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(240,244,255,0.9)';
      circle(ctx, 0, 0, s.r); ctx.fill();
      ctx.strokeStyle = 'rgba(180,190,220,0.8)';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * s.r * 1.4, Math.sin(a) * s.r * 1.4);
      }
      ctx.stroke();
      ctx.restore();
    },
  },
};
