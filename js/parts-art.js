'use strict';
// =====================================================================
//  パーツデザイン（見た目）
//  ・性能の数値は data.js の PARTS、見た目はこのファイル、と分けている
//  ・キーは PARTS のカテゴリと id に対応（未登録の id は仮の図形で表示される）
//
//  座標系：単位はメートル、+X が機体の正面、+Y が機体の右
//  原点（draw が呼ばれる位置）はカテゴリごとに次の関節：
//    legs    … 機体中心（腰関節は JOINTS.hip を参照）
//    torso   … 機体中心（胴体の中心関節）
//    headCpu … 頭部Aソケット（JOINTS.headA）
//    headReg … 頭部Bソケット（JOINTS.headB）
//    arm     … 肩関節（JOINTS.shoulder）。s.side は 左腕 -1 / 右腕 +1
//
//  draw(ctx, s) の s：{ t: 経過秒, walk: 歩いた距離(m), side: 腕の左右 }
//  arm.muzzle … 肩関節から砲口までの前方距離(m)。弾の発射位置と発射炎に使う
//  外形線：outline(ctx) で直前のパスを太い線（PART_OUTLINE, robot.js）で縁取る。重量感を出すため外形は必ず縁取る
//  描画前の既定値：torso・arm は線色・太さとも外形線（ctx.stroke() だけで縁取れる）、legs は線太さ0.2
//  反動・発射炎・被弾の白飛びなどの共通演出は robot.js 側で描く
// =====================================================================

// 頭部A：回路ユニット共通のドーム形状
function cpuDome(ctx, color) {
  ctx.fillStyle = '#d6d2c6';
  circle(ctx, 0, 0, 0.34); ctx.fill(); outline(ctx);
  ctx.strokeStyle = color; ctx.lineWidth = 0.12;
  ctx.beginPath(); ctx.arc(0, 0, 0.24, -0.9, 0.9); ctx.stroke();
  ctx.fillStyle = color;
  circle(ctx, 0.22, 0, 0.05); ctx.fill();
}

// 頭部B：レギュレーター共通の筐体（アンテナ類の下地）
function regHousing(ctx) {
  ctx.fillStyle = '#6e6b63';
  rr(ctx, -0.22, -0.26, 0.4, 0.52, 0.08); ctx.fill(); outline(ctx);
  ctx.strokeStyle = '#2d2d2a'; ctx.lineWidth = 0.07;
}

// 線で描くフレーム（脚の骨など）：外形線の太さぶん太い暗色の線を下に敷いて縁取る
function strut(ctx, color, width) {
  ctx.save();
  ctx.strokeStyle = PART_OUTLINE.color;
  ctx.lineWidth = width + PART_OUTLINE.width * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function regLamp(ctx) {
  ctx.fillStyle = '#ffd56a';
  circle(ctx, 0, 0, 0.06); ctx.fill();
}

const PART_ART = {
  // ------------------------------------------------------------ 頭部A
  headCpu: {
    cpu_s: { draw(ctx) { cpuDome(ctx, '#6fa8dc'); } },
    cpu_m: { draw(ctx) { cpuDome(ctx, '#7cc48f'); } },
    cpu_x: { draw(ctx) { cpuDome(ctx, '#e6a85c'); } },
  },

  // ------------------------------------------------------------ 頭部B
  headReg: {
    reg_b: {
      draw(ctx) {
        regHousing(ctx);
        ctx.beginPath(); ctx.moveTo(-0.15, -0.2); ctx.lineTo(-0.55, -0.35); ctx.stroke();
        regLamp(ctx);
      },
    },
    reg_p: {
      draw(ctx) {
        regHousing(ctx);
        ctx.beginPath();
        ctx.moveTo(-0.15, -0.2); ctx.lineTo(-0.6, -0.4);
        ctx.moveTo(-0.15, 0.2); ctx.lineTo(-0.6, 0.4);
        ctx.stroke();
        regLamp(ctx);
      },
    },
    reg_o: {
      draw(ctx, s) {
        regHousing(ctx);
        ctx.fillStyle = `rgba(255,90,40,${0.6 + 0.4 * Math.sin(s.t * 9)})`;
        ctx.fillRect(-0.18, -0.2, 0.12, 0.4);
        ctx.beginPath(); ctx.moveTo(-0.2, -0.25); ctx.lineTo(-0.6, -0.45); ctx.lineTo(-0.3, -0.1); ctx.closePath();
        ctx.fillStyle = '#6e6b63'; ctx.fill(); outline(ctx);
        regLamp(ctx);
      },
    },
  },

  // ------------------------------------------------------------ 胴体
  torso: {
    t_light: {
      draw(ctx) {
        ctx.fillStyle = '#c9c6bb';
        ctx.beginPath();
        ctx.moveTo(0.55, 0); ctx.lineTo(0.3, -0.6); ctx.lineTo(-0.5, -0.55);
        ctx.lineTo(-0.65, 0); ctx.lineTo(-0.5, 0.55); ctx.lineTo(0.3, 0.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#d98b2b';
        ctx.fillRect(-0.45, -0.08, 0.7, 0.16);
      },
    },
    t_std: {
      draw(ctx) {
        ctx.fillStyle = '#b5b0a2';
        rr(ctx, -0.65, -0.68, 1.25, 1.36, 0.22); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#9c978a';
        rr(ctx, -0.5, -0.5, 0.5, 1.0, 0.1); ctx.fill();
        ctx.fillStyle = '#d98b2b';
        ctx.fillRect(0.25, -0.62, 0.12, 1.24);
      },
    },
    t_heavy: {
      draw(ctx) {
        ctx.fillStyle = '#8c877a';
        rr(ctx, -0.78, -0.82, 1.5, 1.64, 0.15); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#a19c8e';
        ctx.lineWidth = PART_OUTLINE.detail;
        rr(ctx, -0.6, -0.7, 1.15, 0.55, 0.08); ctx.fill(); ctx.stroke();
        rr(ctx, -0.6, 0.15, 1.15, 0.55, 0.08); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#5d5a52';
        for (const [x, y] of [[-0.5, -0.6], [0.45, -0.6], [-0.5, 0.6], [0.45, 0.6]]) { circle(ctx, x, y, 0.05); ctx.fill(); }
      },
    },
    t_gen: {
      draw(ctx, s) {
        ctx.fillStyle = '#a5adb5';
        rr(ctx, -0.72, -0.72, 1.32, 1.44, 0.28); ctx.fill(); ctx.stroke();
        const pulse = 0.6 + 0.4 * Math.sin(s.t * 4);
        const g = ctx.createRadialGradient(-0.25, 0, 0.02, -0.25, 0, 0.42);
        g.addColorStop(0, `rgba(200,255,255,${pulse})`);
        g.addColorStop(0.5, `rgba(60,200,255,${0.7 * pulse})`);
        g.addColorStop(1, 'rgba(60,200,255,0)');
        ctx.fillStyle = '#3a4650';
        ctx.lineWidth = PART_OUTLINE.detail;
        circle(ctx, -0.25, 0, 0.32); ctx.fill(); ctx.stroke();
        ctx.fillStyle = g;
        circle(ctx, -0.25, 0, 0.42); ctx.fill();
      },
    },
  },

  // ------------------------------------------------------------ 腕（原点＝肩関節）
  arm: {
    gatling: {
      muzzle: 1.55,
      draw(ctx, s) {
        ctx.fillStyle = '#a0926a';
        rr(ctx, -0.2, -0.27, 1.0, 0.54, 0.1); ctx.fill(); ctx.stroke();
        const spin = (s.t * 30) % 1;
        ctx.beginPath();
        for (const o of [-0.13, 0, 0.13]) { ctx.moveTo(0.8, o * Math.cos(spin)); ctx.lineTo(1.52, o * Math.cos(spin)); }
        ctx.lineWidth = 0.09 + PART_OUTLINE.width * 2; ctx.stroke();
        ctx.strokeStyle = '#3b3b38'; ctx.lineWidth = 0.09; ctx.stroke();
        ctx.fillStyle = '#3b3b38';
        ctx.fillRect(1.05, -0.2, 0.08, 0.4);
      },
    },
    cannon: {
      muzzle: 1.9,
      draw(ctx) {
        ctx.fillStyle = '#7f8a6e';
        rr(ctx, -0.35, -0.32, 0.95, 0.64, 0.12); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#4a4f44';
        ctx.beginPath(); ctx.rect(0.55, -0.13, 1.25, 0.26); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2f322c';
        ctx.beginPath(); ctx.rect(1.72, -0.18, 0.2, 0.36); ctx.fill(); ctx.stroke();
      },
    },
    missile: {
      muzzle: 0.7,
      draw(ctx) {
        ctx.fillStyle = '#8a7d70';
        rr(ctx, -0.45, -0.42, 1.15, 0.84, 0.1); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2b2a28';
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { circle(ctx, -0.05 + i * 0.27, -0.17 + j * 0.34, 0.1); ctx.fill(); }
        ctx.fillStyle = '#c94a3a';
        ctx.fillRect(0.6, -0.42, 0.1, 0.84);
      },
    },
    flamer: {
      muzzle: 1.25,
      draw(ctx, s) {
        ctx.fillStyle = '#c2702f';
        circle(ctx, -0.25, 0, 0.3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#6c6a63';
        rr(ctx, -0.05, -0.18, 1.0, 0.36, 0.08); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3a3936';
        ctx.beginPath(); ctx.rect(0.92, -0.12, 0.33, 0.24); ctx.fill(); ctx.stroke();
        ctx.fillStyle = `rgba(80,160,255,${0.6 + 0.4 * Math.sin(s.t * 25)})`;
        circle(ctx, 1.28, 0, 0.06); ctx.fill();
      },
    },
    blade: {
      muzzle: 2.1,
      draw(ctx, s) {
        ctx.fillStyle = '#6f6c66';
        rr(ctx, -0.15, -0.22, 0.65, 0.44, 0.1); ctx.fill(); ctx.stroke();
        const g = ctx.createLinearGradient(0.4, 0, 2.1, 0);
        g.addColorStop(0, '#d0d0d0');
        g.addColorStop(0.4, '#ff9a3c');
        g.addColorStop(1, '#ff4a1c');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0.4, -0.15); ctx.lineTo(2.1, -0.03 * s.side); ctx.lineTo(0.4, 0.15);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      },
    },
  },

  // ------------------------------------------------------------ 脚部（原点＝機体中心）
  legs: {
    biped: {
      color: '#8d8a80',
      draw(ctx, s) {
        const ph = s.walk * 1.6, H = JOINTS.hip;
        for (const k of [-1, 1]) {
          const off = Math.sin(ph + (k > 0 ? Math.PI : 0)) * 0.5;
          ctx.beginPath(); ctx.moveTo(H.x, k * H.y); ctx.lineTo(off, k * 0.6);
          strut(ctx, '#3e4246', 0.2);
          ctx.fillStyle = this.color;
          rr(ctx, off - 0.42, k * 0.6 - 0.2, 0.84, 0.4, 0.12); ctx.fill(); outline(ctx);
          ctx.fillStyle = '#5a5850';
          ctx.fillRect(off + 0.2, k * 0.6 - 0.2, 0.12, 0.4);
        }
      },
    },
    rjoint: {
      color: '#9a8466',
      draw(ctx, s) {
        const ph = s.walk * 1.6, H = JOINTS.hip;
        for (const k of [-1, 1]) {
          const off = Math.sin(ph * 1.2 + (k > 0 ? Math.PI : 0)) * 0.6;
          const kx = -1.0 + off * 0.3;
          ctx.beginPath(); ctx.moveTo(H.x, k * H.y); ctx.lineTo(kx, k * 0.7); ctx.lineTo(off + 0.1, k * 0.6);
          strut(ctx, '#3e4246', 0.2);
          ctx.fillStyle = '#6a5a44';
          circle(ctx, kx, k * 0.7, 0.18); ctx.fill(); outline(ctx);
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.moveTo(off + 0.7, k * 0.6);
          ctx.lineTo(off - 0.1, k * 0.6 - 0.25);
          ctx.lineTo(off - 0.1, k * 0.6 + 0.25);
          ctx.closePath(); ctx.fill(); outline(ctx);
        }
      },
    },
    tank: {
      color: '#5f6258',
      draw(ctx, s) {
        for (const k of [-1, 1]) {
          const y0 = k > 0 ? 0.5 : -1.05;
          ctx.fillStyle = '#2f312d';
          rr(ctx, -1.25, y0, 2.35, 0.55, 0.2); ctx.fill(); outline(ctx);
          ctx.strokeStyle = '#555a50';
          ctx.lineWidth = 0.07;
          const sp = 0.28;
          const shift = ((s.walk % sp) + sp) % sp;
          ctx.beginPath();
          for (let x = -1.15 + shift; x < 1.05; x += sp) { ctx.moveTo(x, y0 + 0.05); ctx.lineTo(x, y0 + 0.5); }
          ctx.stroke();
          ctx.fillStyle = this.color;
          rr(ctx, -0.9, y0 + 0.12, 1.6, 0.31, 0.1); ctx.fill();
        }
      },
    },
    hover: {
      color: '#6c8aa0',
      draw(ctx, s) {
        const fl = 0.6 + 0.4 * Math.sin(s.t * 40);
        ctx.fillStyle = `rgba(120,200,255,${0.35 * fl})`;
        for (const k of [-1, 1]) { circle(ctx, -1.35, k * 0.55, 0.35 + 0.1 * fl); ctx.fill(); }
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.ellipse(-0.2, 0, 1.3, 1.2, 0, 0, Math.PI * 2); ctx.fill(); outline(ctx);
        ctx.strokeStyle = '#3d5566'; ctx.lineWidth = 0.1;
        ctx.beginPath(); ctx.ellipse(-0.2, 0, 1.05, 0.95, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#9fe0ff';
        for (const k of [-1, 1]) { circle(ctx, -1.35, k * 0.55, 0.13); ctx.fill(); }
      },
    },
    spider: {
      color: '#7d7466',
      draw(ctx, s) {
        const ph = s.walk * 1.6;
        const angs = [-0.7, -1.57, -2.4];
        for (const k of [-1, 1]) {
          angs.forEach((a, i) => {
            const sw = Math.sin(ph * 1.4 + i * 2.1 + (k > 0 ? Math.PI : 0)) * 0.25;
            const ang = (k > 0 ? Math.abs(a) : -Math.abs(a)) + sw;
            const kx = Math.cos(ang) * 1.0 - 0.15, ky = Math.sin(ang) * 1.0;
            const fx = Math.cos(ang) * 1.6 - 0.15, fy = Math.sin(ang) * 1.6;
            ctx.beginPath(); ctx.moveTo(-0.15, 0); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy);
            strut(ctx, '#3e4246', 0.16);
            ctx.fillStyle = this.color;
            circle(ctx, kx, ky, 0.17); ctx.fill(); outline(ctx);
            ctx.fillStyle = '#4a463e';
            circle(ctx, fx, fy, 0.12); ctx.fill(); outline(ctx);
          });
        }
        ctx.fillStyle = this.color;
        circle(ctx, -0.15, 0, 0.7); ctx.fill(); outline(ctx);
      },
    },
  },
};
