'use strict';
// =====================================================================
//  3D 表示（試作）：戦闘画面を 3D で描く
//   ・ゲームの計算（battle.js の simulate）は 2D のまま。ここは描き方だけを受け持つ
//     （View3D.on のあいだ、battle.js は drawWorld の代わりに View3D.render を呼ぶ）
//   ・視点は自機の背後：後ろ上から、進む向きを奥にして見る。カメラは機体の向きに遅れてついていく
//     （北を上にした見下ろしは 2D 表示で見る）
//   ・地面 … 2D の地面の絵（battle.js の drawFloor など）を、カメラに映る範囲（カメラの向きに合わせて回した範囲）だけ
//            毎フレーム描いて地面に貼る
//   ・岩・洞窟の壁・荒野の外の崖 … 立体で作る。光が当たり、影を落とす。自機を隠す岩は半透明にする
//   ・機体・エネミー … 2D の絵（真上から見た絵）を1枚の画像（アトラス）にまとめて描き、地面と平行な板に貼る
//            （少し浮かせて置く。ジャンプ・蜘蛛の跳躍は板ごと持ち上げる）。HP バーは画面に重ねて描く（drawOverlay）
//   ・弾・爆発 … 機体の板より少し上の、地面と平行な透明な板に描く
//   ・HUD・画面の色（洞窟の暗さなど）は今までどおり 2D のキャンバス（#battle）に描き、3D の上に重ねる
//   ・設定は localStorage（VIEW_KEY：'2d' / '3d'）。戦闘中の一時停止メニュー（#pause-menu）で切り替える
//     2D の向き（TURN2D_KEY：'north' 北が上 / 'behind' 背後。画面ごと回す。描くのは battle.js の drawWorld）の設定もここで持つ
//   ・Three.js（js/lib/three.min.js・r128）は 3D を選んだときだけ読み込む。読めない環境では 2D のまま
// =====================================================================

const VIEW_KEY = 'iron_wasteland_view';
const TURN2D_KEY = 'iron_wasteland_2d_turn';

const View3D = {
  TILT: 35,         // カメラの角度（水平から・度）
  FOV: 40,          // カメラの縦の画角（度）
  UNIT_H: 0.5,      // 機体・エネミーの板の高さ（m）
  AIR_H: 0.6,       // 弾の層の高さ（機体の板より上）
  JUMP_H: 3.2,      // ジャンプの最高点の高さ（m）
  LIFT_M: 4,        // エネミーの絵の高さ（ENEMY_ART の lift）1 あたりの高さ（m）
  CLIFF: 7,         // 荒野の外の低い土地の深さ（m）

  want: (() => { try { return localStorage.getItem(VIEW_KEY) === '3d'; } catch (e) { return false; } })(),
  turn2d: (() => { try { return localStorage.getItem(TURN2D_KEY) === 'behind'; } catch (e) { return false; } })(),   // 2D を背後の向きで描く
  on: false,       // いま 3D で描いているか
  ready: false,    // WebGL の準備ができたか
  failed: false,   // 3D を始められなかった（2D のまま）
  loading: null,   // three.min.js の読み込み（Promise）
  B: null,         // 戦闘画面（Battle）
  world: null,     // 立体を作ったワールド（変わったら作り直す）
  yaw: null,           // カメラの向いている方角（ワールドの角度）。null = 次の描画で機体の向きに合わせる
  tx: 0, ty: 0,        // カメラの注視点（m）

  // ------------------------------------------------------------ 設定
  // 起動時に一度だけ呼ぶ（main.js の Game.init）。一時停止メニューの 2D / 3D と 2D の向きのボタンをつなぐ
  initUI() {
    document.querySelectorAll('#pause-menu button[data-view]').forEach(b => {
      b.onclick = () => {
        b.blur();   // 押したボタンにフォーカスが残ると、Space キー（再開）でもう一度押されてしまう
        if ((b.dataset.view === '3d') !== this.want) this.toggle();
      };
    });
    document.querySelectorAll('#pause-menu button[data-turn]').forEach(b => {
      b.onclick = () => {
        b.blur();
        Battle.setTurn2d(b.dataset.turn === 'behind');
      };
    });
    this.syncUI();
    if (this.want) this.load();   // 出撃までに読み込んでおく
  },

  syncUI() {
    document.querySelectorAll('#pause-menu button[data-view]').forEach(b => b.classList.toggle('sel', (b.dataset.view === '3d') === this.want));
    document.querySelectorAll('#pause-menu button[data-turn]').forEach(b => {
      b.classList.toggle('sel', (b.dataset.turn === 'behind') === this.turn2d);
      b.disabled = this.want;   // 2D の向きは 2D のときだけ（3D は常に背後からの視点）
    });
  },

  setWant(v) {
    this.want = v;
    try { localStorage.setItem(VIEW_KEY, v ? '3d' : '2d'); } catch (e) { /* 保存不可の環境 */ }
    this.syncUI();
  },

  setTurn2d(v) {
    this.turn2d = v;
    try { localStorage.setItem(TURN2D_KEY, v ? 'behind' : 'north'); } catch (e) { /* 保存不可の環境 */ }
    this.syncUI();
  },

  load() {
    if (window.THREE) return Promise.resolve(true);
    if (!this.loading) {
      this.loading = new Promise(res => {
        const s = document.createElement('script');
        s.src = 'js/lib/three.min.js';
        s.onload = () => res(!!window.THREE);
        s.onerror = () => res(false);
        document.head.appendChild(s);
      });
    }
    return this.loading;
  },

  // ------------------------------------------------------------ 戦闘画面とのつなぎ
  attach(B) {
    this.B = B;
    this.on = false;
    this.hide();
    if (!this.want) return;
    if (window.THREE) { this.enable(); return; }
    this.load().then(ok => {
      if (this.B !== B || !B.running || !this.want) return;
      if (ok) this.enable();
      else this.fail();
    });
  },

  detach() {
    this.B = null;
    this.on = false;
    this.hide();
    this.clearWorld();
  },

  // 2D / 3D の切り替え（一時停止メニューから）
  toggle() {
    const B = this.B;
    if (!B) return;
    Sound.play('ui');
    this.setWant(!this.want);
    if (!this.want) {
      this.on = false;
      this.hide();
      addLog(B.world, T('B117' /* 表示切替：2D */), '#ffd24a');
      return;
    }
    this.turnOn(B, () => addLog(B.world, T('B118' /* 表示切替：3D（試作） */), '#ffd24a'));
  },

  turnOn(B, done) {
    this.load().then(ok => {
      if (this.B !== B || !this.want) return;
      if (!ok) { this.fail(); return; }
      if (this.enable()) done();
    });
  },

  enable() {
    if (!this.ready && (this.failed || !this.setup())) { this.fail(); return false; }
    this.on = true;
    this.yaw = null;   // カメラは最初から機体の後ろに置く
    this.cv.style.display = 'block';
    this.resize();
    return true;
  },

  fail() {
    this.failed = true;
    this.on = false;
    this.hide();
    if (this.B) addLog(this.B.world, T('B119' /* 3D 表示を始められませんでした。2D で表示します */), '#ff8a6a');
  },

  hide() {
    if (this.cv) this.cv.style.display = 'none';
  },

  // 小さい画面・タッチの端末は、描く画像の細かさを抑える
  lowSpec() {
    const B = this.B;
    return !B || B.touchUI || Math.min(B.VW, B.VH) < 600;
  },

  // ------------------------------------------------------------ 準備（最初に 3D にしたときに一度だけ）
  setup() {
    try {
      const b2 = document.getElementById('battle');
      const cv = document.createElement('canvas');
      cv.id = 'battle3d';
      b2.parentNode.insertBefore(cv, b2);
      this.cv = cv;
      const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      this.r = r;

      const scene = this.scene = new THREE.Scene();
      this.cam = new THREE.PerspectiveCamera(this.FOV, 1, 1, 2000);
      this.fog = new THREE.Fog(0x000000, 100, 200);
      scene.fog = this.fog;

      // 光：空と地面の照り返し（全体の明るさ）＋ 太陽（左上から。影を落とす）＋ 洞窟で機体が照らすライト
      this.hemi = new THREE.HemisphereLight(0xfff4e0, 0x6a4a30, 0.6);
      this.sun = new THREE.DirectionalLight(0xfff0d8, 0.6);
      this.sun.castShadow = true;
      this.sun.shadow.bias = -0.0006;
      this.lamp = new THREE.PointLight(0xcfe6ff, 0, 42, 1.3);
      scene.add(this.hemi, this.sun, this.sun.target, this.lamp);

      this.ground = this.makeLayer(false);
      this.air = this.makeLayer(true);

      // 機体・エネミーの絵を並べる画像（アトラス）と、それを貼る板
      const ac = document.createElement('canvas');
      this.atlas = { cv: ac, g: ac.getContext('2d'), tex: null };
      this.atlas.g.liftByCaller = true;   // 蜘蛛の跳躍などの高さは絵に描かず、板を持ち上げて表す（enemy-art.js）
      this.cardMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      this.cards = [];
      this.ready = true;
      return true;
    } catch (e) {
      console.error('3D 表示の準備に失敗しました', e);
      if (this.cv) { this.cv.remove(); this.cv = null; }
      return false;
    }
  },

  // 地面（air = false）と弾の層（air = true）：2D の絵を描くキャンバスと、それを貼る水平な板
  // 地面は絵の無い所（荒野の外など）を描かずに抜く（下の崖・低い土地が見える）
  makeLayer(air) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 4;
    const mat = air
      ? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
      : new THREE.MeshPhongMaterial({ specular: 0x000000, shininess: 0, depthWrite: false, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = !air;
    mesh.renderOrder = air ? 3 : -1;   // 地面は崖の次、弾の層は板（機体）より後に描く
    this.scene.add(mesh);
    const L = { cv, g: cv.getContext('2d'), mesh, tex: null, ppm: 1 };
    this.setTex(L, mat);
    return L;
  },

  // キャンバスの大きさを変えたら貼る画像も作り直す
  setTex(L, mat) {
    if (L.tex) L.tex.dispose();
    L.tex = new THREE.CanvasTexture(L.cv);
    L.tex.minFilter = THREE.LinearFilter;
    L.tex.generateMipmaps = false;
    mat.map = L.tex;
    mat.needsUpdate = true;
  },

  sizeCanvas(L, w, h, mat) {
    if (L.cv.width === w && L.cv.height === h) return;
    L.cv.width = w;
    L.cv.height = h;
    this.setTex(L, mat);
  },

  resize() {
    if (!this.ready || !this.B) return;
    const B = this.B;
    this.r.setPixelRatio(Math.min(B.dpr, this.lowSpec() ? 1.5 : 2));
    this.r.setSize(B.VW, B.VH);
    this.cam.aspect = B.VW / B.VH;
    this.cam.updateProjectionMatrix();
    const low = this.lowSpec();
    const ms = low ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.sizeCanvas(this.atlas, low ? 1024 : 2048, 1024, this.cardMat);
    this.geomKey = '';
  },

  // ------------------------------------------------------------ カメラと映る範囲
  // 2D の zoom（1m あたりのピクセル数）と同じ大きさに見える距離にカメラを置き、
  // 画面の四隅から地面へ伸ばした線の届く範囲を求める。範囲はカメラの向きを基準にした座標
  // （x = 右、z = 手前。注視点からの相対位置）で、カメラの向きが変わっても同じ形になる
  viewGeom(tiltDeg) {
    const B = this.B;
    const key = `${B.zoom},${B.VW},${B.VH},${B.dpr},${tiltDeg}`;
    if (key === this.geomKey) return this.vg;
    this.geomKey = key;
    const tilt = tiltDeg * Math.PI / 180;
    const D = B.VH / (2 * B.zoom * Math.tan(this.FOV * Math.PI / 360));
    const off = new THREE.Vector3(0, D * Math.sin(tilt), D * Math.cos(tilt));
    this.cam.position.copy(off);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, far = 0;
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const d = new THREE.Vector3(nx, ny, 0.5).unproject(this.cam).sub(off).normalize();
      const t = d.y < -0.05 ? Math.min(off.y / -d.y, D * 4) : D * 4;
      const x = off.x + d.x * t, z = off.z + d.z * t;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      far = Math.max(far, t);
    }
    // 少し広めに描いておく（揺れ・カメラの移動・遠くの霞の向こう）
    const px = (x1 - x0) * 0.08 + 4, pz = (z1 - z0) * 0.08 + 4;
    x0 -= px; x1 += px; z0 -= pz * 1.5; z1 += pz;
    const bw = x1 - x0, bh = z1 - z0;
    // 地面の画像の細かさ（1m あたりのピクセル数）。画面の細かさ以上にはしない。全体のピクセル数に上限
    const budget = this.lowSpec() ? 1.4e6 : 3.6e6;
    const maxT = Math.min(this.r.capabilities.maxTextureSize, 4096);
    const ppm = Math.min(B.zoom * B.dpr, Math.sqrt(budget / (bw * bh)), maxT / bw, maxT / bh);
    this.ground.ppm = ppm;
    this.air.ppm = ppm * 0.75;
    this.sizeCanvas(this.ground, Math.ceil(bw * ppm), Math.ceil(bh * ppm), this.ground.mesh.material);
    this.sizeCanvas(this.air, Math.ceil(bw * ppm * 0.75), Math.ceil(bh * ppm * 0.75), this.air.mesh.material);
    // 遠くは霞ませて背景の色に溶かす
    this.fog.near = D * 1.15;
    this.fog.far = far * 1.12;
    // 影を描く範囲
    const S = Math.max(bw, bh) * 0.62, sc = this.sun.shadow.camera;
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S;
    sc.near = 1; sc.far = 500;
    sc.updateProjectionMatrix();
    this.shadowS = S;
    this.vg = { D, x0, x1, z0, z1 };
    return this.vg;
  },

  // カメラの向き：機体の向きに遅れてついていく（battle.js の chaseYaw。2D の背後の向きと同じ動き）
  updateYaw(w, B, dt) {
    this.yaw = chaseYaw(this.yaw, w.player, B.manual, dt);
  },

  // ------------------------------------------------------------ 描画（毎フレーム）
  render(w, B) {
    if (this.world !== w) this.buildWorld(w);
    const now = performance.now(), dt = Math.min(0.1, (now - (this.lastT || now)) / 1000);
    this.lastT = now;
    const P = w.player;

    const tilt = this.TILT * Math.PI / 180;
    const vg = this.viewGeom(this.TILT);
    this.updateYaw(w, B, dt);

    const fx = Math.cos(this.yaw), fy = Math.sin(this.yaw);   // カメラの前（奥）の向き
    const rx = -fy, ry = fx;                                  // 右の向き
    // 注視点は機体の少し前（進む先を広く見せる）
    const lead = vg.D * 0.16;
    let tx = P.x + fx * lead, ty = P.y + fy * lead;
    const sh = w.shake > 0 ? w.shake * 6 / B.zoom : 0;
    if (sh) { tx += rand(-1, 1) * sh; ty += rand(-1, 1) * sh; }
    this.tx = tx; this.ty = ty;
    const hd = vg.D * Math.cos(tilt);
    this.cam.position.set(tx - fx * hd, vg.D * Math.sin(tilt), ty - fy * hd);
    this.cam.lookAt(tx, 0, ty);
    this.cam.updateMatrixWorld();

    // 地面の画像に描く範囲（カメラの向きを基準にした長方形）。画素の境目に合わせ、カメラが動いても地面の模様がちらつかないようにする
    const gp = this.ground.ppm;
    const tR = tx * rx + ty * ry, tB = -(tx * fx + ty * fy);   // 注視点の「右」「手前」方向の位置
    const F = { fx, fy, rx, ry, X0: Math.floor((tR + vg.x0) * gp) / gp, Z0: Math.floor((tB + vg.z0) * gp) / gp };
    // 2D の描画に渡す範囲：その長方形を囲むワールドの範囲
    const Wm = this.ground.cv.width / gp, Hm = this.ground.cv.height / gp;
    const cs = [[F.X0, F.Z0], [F.X0 + Wm, F.Z0], [F.X0, F.Z0 + Hm], [F.X0 + Wm, F.Z0 + Hm]].map(([cx, cz]) => [cx * rx - cz * fx, cx * ry - cz * fy]);
    const R = {
      x0: Math.min(...cs.map(c => c[0])), x1: Math.max(...cs.map(c => c[0])),
      y0: Math.min(...cs.map(c => c[1])), y1: Math.max(...cs.map(c => c[1])),
    };
    this.drawGround(w, F, R);
    this.drawAir(w, F, R);
    this.drawCards(w, B, R);
    this.fadeRocks(w, dt);

    // 太陽は注視点の左上奥から。影の画素の境目に合わせて動かし、影の縁がちらつかないようにする
    const texel = this.shadowS * 2 / this.sun.shadow.mapSize.x;
    const sx = Math.round(tx / texel) * texel, sy = Math.round(ty / texel) * texel;
    this.sun.position.set(sx - 45, 80, sy - 55);
    this.sun.target.position.set(sx, 0, sy);
    this.sun.target.updateMatrixWorld();
    if (w.field.dark) this.lamp.position.set(P.x + Math.cos(P.a) * 3, 7, P.y + Math.sin(P.a) * 3);
    this.r.render(this.scene, this.cam);
  },

  // 層のキャンバスに、ワールドの座標（m）で描けるようにする（カメラの向きに合わせて回す）
  layerTransform(L, F) {
    const q = L.ppm;
    L.g.setTransform(q * F.rx, -q * F.fx, q * F.ry, -q * F.fy, -q * F.X0, -q * F.Z0);
  },

  // 層の板を、キャンバスに描いた範囲の所に置く
  placeLayer(L, F, h) {
    const W = L.cv.width / L.ppm, H = L.cv.height / L.ppm;
    const cx = F.X0 + W / 2, cz = F.Z0 + H / 2;
    L.mesh.position.set(cx * F.rx - cz * F.fx, h, cx * F.ry - cz * F.fy);
    L.mesh.scale.set(W, H, 1);
    L.mesh.rotation.y = Math.atan2(-F.fx, -F.fy);
  },

  // 地面の層：2D と同じ地面の絵 ＋ 鉱石など ＋ 機体・エネミーの影
  drawGround(w, F, R) {
    const L = this.ground, g = L.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, L.cv.width, L.cv.height);
    this.layerTransform(L, F);
    const inView = (x, y, m = 0) => x > R.x0 - m && x < R.x1 + m && y > R.y0 - m && y < R.y1 + m;
    drawFloor(g, w, R, inView);
    drawFloorItems(g, w, inView);

    // 影と足元の光（板に立てた絵には影を描かず、ここで地面に落とす）
    const sk = w.surge.k, sb = sk > 0 ? surgeBreath(w) : 0;
    for (const e of w.enemies) {
      if (e.robot) { this.mechShadow(g, w, e); continue; }
      if (e.buried || !inView(e.x, e.y, 20)) continue;
      if (sk > 0.05) drawSurgeAura(g, e, sk, sb);
      if (e.rare) drawRareAura(g, e, w.time, false);
      this.enemyShadow(g, e);
    }
    this.mechShadow(g, w, w.player);
    w.geo.drawSealed(g, w);
    L.tex.needsUpdate = true;
    this.placeLayer(L, F, 0);
  },

  mechShadow(g, w, P) {
    if (P.dead) return;
    const lift = P.air > 0 ? Math.sin(Math.PI * (1 - P.air / P.airMax)) : 0;
    g.fillStyle = `rgba(0,0,0,${0.3 - 0.12 * lift})`;
    g.beginPath();
    g.ellipse(P.x + 0.35 + 1.2 * lift, P.y + 0.45 + 1.5 * lift, 1.5 * (1 - 0.2 * lift), 1.35 * (1 - 0.2 * lift), 0, 0, Math.PI * 2);
    g.fill();
    if (w.vs) {   // 対戦：足元に色の輪（自機は青、相手は赤）
      g.strokeStyle = P.rival ? 'rgba(255,90,70,0.8)' : 'rgba(90,180,255,0.8)';
      g.lineWidth = 0.18;
      circle(g, P.x, P.y, 2.1);
      g.stroke();
    }
  },

  enemyShadow(g, e) {
    const one = (x, y, rx, ry, a) => {
      g.fillStyle = `rgba(18,12,8,${a})`;
      g.beginPath();
      g.ellipse(x + rx * 0.2, y + ry * 0.3, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    };
    if (e.segs) e.segs.forEach((s, i) => one(s.x, s.y, (3.2 - i * 0.28) * 1.2, (3.2 - i * 0.28) * 1.0, 0.25));
    const h = this.liftOf(e);   // 高く跳んでいるほど影は小さく薄い
    one(e.x, e.y, e.r * 1.15 * (1 - 0.25 * h), e.r * 0.95 * (1 - 0.25 * h), 0.32 * (1 - 0.35 * h));
  },

  // 弾の層：弾・爆発など（地面から AIR_H の高さに浮かせる）
  drawAir(w, F, R) {
    const L = this.air, g = L.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, L.cv.width, L.cv.height);
    this.layerTransform(L, F);
    const inView = (x, y, m = 0) => x > R.x0 - m && x < R.x1 + m && y > R.y0 - m && y < R.y1 + m;
    drawShotsFx(g, w, inView);
    L.tex.needsUpdate = true;
    this.placeLayer(L, F, this.AIR_H);
  },

  // エネミーの高さ（ENEMY_ART の lift。0 = 接地）
  liftOf(e) {
    const art = enemyArtOf(e.type);
    return art.lift ? art.lift(e) : 0;
  },

  // 板に描く絵の半分の大きさ（m）。体節のあるボスは尾まで入る大きさにする
  cardSize(e) {
    if (e.segs && e.segs.length) {
      let d = 0;
      for (const s of e.segs) d = Math.max(d, Math.hypot(s.x - e.x, s.y - e.y));
      return Math.max(e.r * 2, d + 4.2);
    }
    if (e.def.boss) return e.r * 2.6;
    return Math.max(e.r * 1.8, e.r + 1.1);
  },

  // 機体・エネミー：2D の絵をアトラスに並べて描き、地面と平行な板に貼る
  drawCards(w, B, R) {
    const items = [];
    const inR = (x, y, s) => x > R.x0 - s && x < R.x1 + s && y > R.y0 - s && y < R.y1 + s;
    const mech = (P, xray) => {
      if (P.dead) return;
      const lift = P.air > 0 ? Math.sin(Math.PI * (1 - P.air / P.airMax)) : 0;
      items.push({
        x: P.x, y: P.y, h: this.UNIT_H + lift * this.JUMP_H, s: 2.4,
        draw: g => {
          g.translate(P.x, P.y);
          g.rotate(P.a);
          drawRobot(g, P.st.parts, {
            time: w.time, walk: P.walk, hit: P.hit, xray, noShadow: true,
            armL: { recoil: P.arms.L.recoil, flash: P.arms.L.flash },
            armR: { recoil: P.arms.R.recoil, flash: P.arms.R.flash },
          });
        },
      });
    };
    for (const e of w.enemies) {
      if (e.robot) { mech(e, false); continue; }
      if (e.buried) continue;   // 地中のボスは地面の盛り上がり（予兆）だけ
      const s = this.cardSize(e);
      if (!inR(e.x, e.y, s)) continue;
      const art = enemyArtOf(e.type);
      items.push({
        x: e.x, y: e.y, h: this.UNIT_H + this.liftOf(e) * this.LIFT_M, s,
        // battle.js の drawEnemy と同じ描き方。HP バーは板に描かず、画面に重ねて描く（drawOverlay）
        draw: g => {
          g.save();
          g.translate(e.x, e.y);
          if (art.rotate !== false) { g.rotate(e.a); g.translate(e.lunge * 0.3, 0); }
          art.draw(g, e);
          g.restore();
          if (e.rare) drawRareAura(g, e, w.time, true);
        },
      });
    }
    mech(w.player, B.xray);

    // 並べ方：大きいものから棚に詰める。入りきらなければ細かさを下げてやり直す
    const A = this.atlas, AW = A.cv.width, AH = A.cv.height;
    items.sort((a, b) => b.s - a.s);
    let area = 0;
    for (const it of items) area += 4 * it.s * it.s;
    let ppm = Math.min(B.zoom * B.dpr * 1.1, 64, Math.sqrt(AW * AH * 0.6 / Math.max(area, 1)));
    for (let tries = 0; tries < 8; tries++) {
      let x = 0, y = 0, rowH = 0, ok = true;
      for (const it of items) {
        const pp = Math.min(ppm, (Math.min(AW, AH) - 2) / (2 * it.s));
        const cs = Math.ceil(2 * it.s * pp) + 2;
        if (x + cs > AW) { x = 0; y += rowH; rowH = 0; }
        if (y + cs > AH) { ok = false; break; }
        it.cell = { x, y, cs, pp };
        x += cs;
        rowH = Math.max(rowH, cs);
      }
      if (ok) break;
      ppm *= 0.8;
    }

    const g = A.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, AW, AH);
    // 板に立てた絵には影を描かない（影は地面の層に描いた）
    const gs = window.groundShadow;
    window.groundShadow = () => {};
    try {
      for (const it of items) {
        const c = it.cell;
        if (!c) continue;
        g.save();
        g.beginPath();
        g.rect(c.x, c.y, c.cs, c.cs);
        g.clip();
        g.setTransform(c.pp, 0, 0, c.pp, c.x + c.cs / 2 - it.x * c.pp, c.y + c.cs / 2 - it.y * c.pp);
        it.draw(g);
        g.restore();
      }
    } finally {
      window.groundShadow = gs;
    }
    A.tex.needsUpdate = true;

    // 板を置く（絵は北が上のワールドの向きのまま描いたので、板も回さずに寝かせるだけ）
    let n = 0;
    for (const it of items) {
      const c = it.cell;
      if (!c) continue;
      const m = this.card(n++);
      const u0 = (c.x + 1) / AW, u1 = (c.x + c.cs - 1) / AW;
      const vt = 1 - (c.y + 1) / AH, vb = 1 - (c.y + c.cs - 1) / AH;
      const uv = m.geometry.attributes.uv;
      uv.setXY(0, u0, vt); uv.setXY(1, u1, vt); uv.setXY(2, u0, vb); uv.setXY(3, u1, vb);
      uv.needsUpdate = true;
      const size = (c.cs - 2) / c.pp;
      m.position.set(it.x, it.h, it.y);
      m.scale.set(size, size, 1);
      m.visible = true;
    }
    for (let i = n; i < this.cards.length; i++) this.cards[i].visible = false;
  },

  card(i) {
    if (!this.cards[i]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.cardMat);
      m.rotation.x = -Math.PI / 2;   // 地面と平行に寝かせる（板の上 = 北）
      m.renderOrder = 1;
      this.scene.add(m);
      this.cards[i] = m;
    }
    return this.cards[i];
  },

  // 自機とカメラの間にあって自機を隠す岩は半透明にする
  fadeRocks(w, dt) {
    const P = w.player, cp = this.cam.position;
    const vx = cp.x - P.x, vy = cp.z - P.y, L2 = vx * vx + vy * vy || 1;
    const k = Math.min(1, dt * 8);
    for (const m of this.rocks) {
      const u = m.userData;
      const t = ((u.x - P.x) * vx + (u.y - P.y) * vy) / L2;
      let goal = 1;
      if (t > 0 && t < 1 && !P.dead) {
        const d = Math.hypot(P.x + vx * t - u.x, P.y + vy * t - u.y);
        const sight = 0.3 + t * (cp.y - 0.3);   // その位置での視線の高さ（カメラから機体の足元への線）
        if (d < u.r + 1.4 && u.H > sight) goal = 0.28;
      }
      u.op += (goal - u.op) * k;
      if (Math.abs(goal - u.op) < 0.01) u.op = goal;
      m.material.opacity = u.op;
      m.material.depthWrite = u.op > 0.99;   // 半透明の間は奥の機体を隠さない
    }
  },

  // ------------------------------------------------------------ 画面に重ねて描くもの（battle.js が HUD の前に呼ぶ）
  // エネミーの HP バー：板の奥側の縁の少し上に、画面に対して水平に描く（カメラの向きによらず読める）。
  // 大きさはその場所の 1m あたりのピクセル数に合わせる（遠いほど小さい）
  drawOverlay(ctx, w) {
    const B = this.B, fx = Math.cos(this.yaw), fy = Math.sin(this.yaw);
    drawEnemyBars(ctx, w, e => {
      const h = this.UNIT_H + this.liftOf(e) * this.LIFT_M;
      const p = this.screenPos(e.x, e.y, h);
      if (p.x < -60 || p.x > B.VW + 60 || p.y < -60 || p.y > B.VH + 60) return null;
      const q = this.screenPos(e.x - fy, e.y + fx, h);   // 右へ 1m の点
      const top = this.screenPos(e.x + fx * e.r, e.y + fy * e.r, h);   // 板の奥側の縁
      return { x: p.x, top: Math.min(top.y, p.y), k: Math.hypot(q.x - p.x, q.y - p.y) };
    });
  },

  // ------------------------------------------------------------ 画面とワールドの位置の変換
  // ワールドの位置（地面から h の高さ）が画面のどこに映るか
  screenPos(x, y, h = this.UNIT_H) {
    const p = new THREE.Vector3(x, h, y).project(this.cam);
    return { x: (p.x + 1) / 2 * this.B.VW, y: (1 - p.y) / 2 * this.B.VH };
  },

  // 画面の位置の先にある地点（機体の板の高さ UNIT_H の面との交点）
  screenToWorld(mx, my) {
    const B = this.B;
    const o = this.cam.position;
    const d = new THREE.Vector3(mx / B.VW * 2 - 1, 1 - my / B.VH * 2, 0.5).unproject(this.cam).sub(o).normalize();
    const t = d.y < -0.02 ? (o.y - this.UNIT_H) / -d.y : 500;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  },

  // ------------------------------------------------------------ 立体（岩・洞窟の壁・荒野の外の崖）と光
  buildWorld(w) {
    this.clearWorld();
    this.world = w;
    const grp = this.grp = new THREE.Group();
    this.scene.add(grp);
    this.rocks = w.rocks.map(k => this.rockMesh(k));
    for (const m of this.rocks) grp.add(m);
    if (w.discEdge) grp.add(this.wallMesh(w));
    if (w.field.shape === 'strip') for (const m of this.cliffMeshes(w)) grp.add(m);

    const dark = !!w.field.dark;
    const bg = dark ? 0x141216 : 0x3b2a1c;
    this.scene.background = new THREE.Color(bg);
    this.fog.color.setHex(bg);
    if (dark) {
      this.hemi.color.setHex(0xc8d0ff); this.hemi.groundColor.setHex(0x2a2430); this.hemi.intensity = 0.62;
      this.sun.color.setHex(0xa0b4ff); this.sun.intensity = 0.22;
      this.lamp.intensity = 0.9;
    } else {
      this.hemi.color.setHex(0xfff4e0); this.hemi.groundColor.setHex(0x6a4a30); this.hemi.intensity = 0.6;
      this.sun.color.setHex(0xfff0d8); this.sun.intensity = 0.62;
      this.lamp.intensity = 0;
    }
  },

  clearWorld() {
    if (this.grp) {
      this.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.scene.remove(this.grp);
      this.grp = null;
    }
    this.rocks = [];
    this.world = null;
  },

  // 位置から決まる乱数（同じ岩はいつも同じ形）
  seeded(seed) {
    let s = (Math.abs(Math.floor(seed * 9301 + 49297)) % 233280) || 1;
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  },

  // 三角形を1枚加える。法線が want の向きになるよう頂点の順をそろえる
  tri(pos, col, a, b, c, want, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) [b, c] = [c, b];
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
  },

  mesh(pos, col, opt = {}) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();   // 頂点を共有しないので面ごとの法線になる（角ばった岩）
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true }, opt)));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  },

  // 岩：2D の輪郭（k.pts）を底にして、上へ行くほど細くなる角ばった塊。洞窟は背の高い石筍
  rockMesh(k) {
    const rnd = this.seeded(k.x * 73.1 + k.y * 19.7);
    const pal = (k.cave ? [0x45414c, 0x5b5664, 0x75707f] : [0x6b5440, 0x86694f, 0x9c7d5e]).map(c => new THREE.Color(c));
    const H = k.r * (k.cave ? 1.1 + 0.5 * rnd() : 0.55 + 0.3 * rnd());
    const rings = [[1, 0], [0.9, 0.34], [0.66, 0.7], [0.34, 0.93]];   // [太さ, 高さの割合]
    const lean = [-0.12 * k.r, -0.14 * k.r];   // 2D の絵と同じく頂が左上へ寄る
    const V = rings.map(([s, hh], ri) => k.pts.map(([x, y]) => {
      const j = ri ? 1 + (rnd() - 0.5) * 0.18 : 1;
      return [x * s * j + lean[0] * hh, H * hh * (ri ? 1 + (rnd() - 0.5) * 0.12 : 1), y * s * j + lean[1] * hh];
    }));
    const top = [lean[0], H, lean[1]];
    const pos = [], col = [], n = k.pts.length;
    const shade = (c, f) => c.clone().multiplyScalar(f);
    for (let ri = 0; ri < rings.length - 1; ri++) {
      for (let i = 0; i < n; i++) {
        const a = V[ri][i], b = V[ri][(i + 1) % n], c = V[ri + 1][(i + 1) % n], d = V[ri + 1][i];
        const cx = (a[0] + c[0]) / 2, cy = (a[1] + c[1]) / 2, cz = (a[2] + c[2]) / 2;
        const want = [cx - lean[0] * cy / H, cy - H * 0.3, cz - lean[1] * cy / H];
        const color = shade(pal[Math.min(2, ri)], 0.9 + rnd() * 0.2);
        this.tri(pos, col, a, b, c, want, color);
        this.tri(pos, col, a, c, d, want, color);
      }
    }
    const last = V[rings.length - 1];
    for (let i = 0; i < n; i++) {
      this.tri(pos, col, last[i], last[(i + 1) % n], top, [0, 1, 0], shade(pal[2], 0.95 + rnd() * 0.15));
    }
    // 自機を隠すときに半透明にできるよう、はじめから透明の扱いにしておく（不透明度 1）
    const m = this.mesh(pos, col, { transparent: true });
    m.position.set(k.x, 0, k.y);
    m.userData = { x: k.x, y: k.y, r: k.r, H, op: 1 };
    return m;
  },

  // 洞窟（円形のフィールド）の外周の岩壁：縁（w.discEdge）から外へ立ち上がる、でこぼこの壁
  wallMesh(w) {
    const E = w.discEdge, c = w.FW / 2, step = 4, n = Math.floor(E.length / step);
    const rnd = this.seeded(c * 7.3);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = E[i * step];
      const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
      const ux = dx / d, uy = dy / d, h = 2.6 + rnd() * 1.6;
      pts.push({
        b: [x, 0, y],
        t: [x + ux * (0.7 + rnd() * 0.5), h, y + uy * (0.7 + rnd() * 0.5)],
        o: [c + ux * (d + DISC_PAD + 6), h * (0.9 + rnd() * 0.3), c + uy * (d + DISC_PAD + 6)],
        in: [-ux, 0.25, -uy],
      });
    }
    const pos = [], col = [];
    const base = new THREE.Color(0x3a3540), topc = new THREE.Color(0x2a2630);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const f = 0.85 + rnd() * 0.3;
      const cw = base.clone().multiplyScalar(f), ct = topc.clone().multiplyScalar(f);
      this.tri(pos, col, p.b, q.b, q.t, p.in, cw);
      this.tri(pos, col, p.b, q.t, p.t, p.in, cw);
      this.tri(pos, col, p.t, q.t, q.o, [0, 1, 0], ct);
      this.tri(pos, col, p.t, q.o, p.o, [0, 1, 0], ct);
    }
    const m = this.mesh(pos, col);
    m.castShadow = false;
    return m;
  },

  // 荒野（長方形のフィールド）の外：縁から崖で下がった低い土地。
  // 壁を立てると手前の端にいる敵が隠れるので、下がる形にする（地面の層の絵の無い所から見える）
  cliffMeshes(w) {
    const rnd = this.seeded(w.FW * 3.1 + w.H);
    const D = this.CLIFF, W = w.FW, H = w.H;
    // 縁を一周する点（左上から時計回り）と外向きの向き
    const pts = [];
    const side = (x0, y0, x1, y1, ox, oy) => {
      const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / 4));
      for (let i = 0; i < n; i++) pts.push({ x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n, ox, oy });
    };
    side(0, 0, W, 0, 0, -1);
    side(W, 0, W, H, 1, 0);
    side(W, H, 0, H, 0, 1);
    side(0, H, 0, 0, -1, 0);
    const pos = [], col = [];
    const face = new THREE.Color(0x5a4330), n = pts.length;
    const P = pts.map(p => {
      const out = 1.5 + rnd() * 2.5;   // 崖の下は縁より外へ出る（斜面）
      return { top: [p.x, 0.02, p.y], bot: [p.x + p.ox * out, -D, p.y + p.oy * out], o: [p.ox, 0.3, p.oy] };
    });
    for (let i = 0; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n];
      const c = face.clone().multiplyScalar(0.8 + rnd() * 0.35);
      const want = [p.o[0] + q.o[0], 0.4, p.o[2] + q.o[2]];
      this.tri(pos, col, p.top, q.top, q.bot, want, c);
      this.tri(pos, col, p.top, q.bot, p.bot, want, c);
    }
    const cliff = this.mesh(pos, col);
    cliff.renderOrder = -2;
    // 低い土地（広い板）
    const low = new THREE.Mesh(new THREE.PlaneGeometry(W + 800, H + 800), new THREE.MeshLambertMaterial({ color: 0x4a3622 }));
    low.rotation.x = -Math.PI / 2;
    low.position.set(W / 2, -D, H / 2);
    low.receiveShadow = true;
    low.renderOrder = -2;
    return [cliff, low];
  },
};
