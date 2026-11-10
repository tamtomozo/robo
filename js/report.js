'use strict';
// =====================================================================
//  戦闘レポート（頭部ユニットが記録した戦闘データ）
// =====================================================================

const Report = {
  show(w) {
    Game.show('report');
    Sound.playBgm('garage');
    const s = w.stats, P = w.player;
    const title = {
      win: T('R001' /* 任務完了 — {floor} 制圧・ボス撃破 */, { floor: floorName(w.floor) }),
      lose: T('R002' /* 機体大破 — 任務失敗 */), retreat: T('R003' /* 撤退 — 任務中断 */),
      return: T('R004' /* 基地へ帰還 — {n}地区 掃討完了 */, { n: s.cleared }),
      timeout: T('R055' /* 活動限界 — ボス未撃破のまま機体を回収 */),
    }[w.result];
    const cls = { win: 'win', lose: 'lose', retreat: 'retreat', return: 'return', timeout: 'timeout' }[w.result];
    const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const acc = (side) => s.shots[side] ? Math.round(s.hits[side] / s.shots[side] * 100) + '%' : '—';
    const armName = (side) => partLabel(P.arms[side].def);
    const killsN = s.kills.scarab + s.kills.spitter + s.kills.troll;
    const DS = w.field.districts;
    const ore = finishOre(w);
    const lostAny = ORES.some(k => ore.lost[k.id]);

    // 頭部ユニットの所見
    const notes = [];
    const prog = w.program, grid = P.st.grid;
    let unused = 0;
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
      const i = y * MAX_GRID + x;
      if (prog[i] && P.vm.counts[i] === 0) unused++;
    }
    if (unused) notes.push(T('R005' /* 一度も実行されなかったタイルが {n} 個あります。矢印のつ… */, { n: unused }));
    for (const side of ['L', 'R']) {
      const a = P.arms[side];
      if (a.def.type === 'none') continue;
      const L = side === 'L';
      if (s.shots[side] === 0) notes.push(L ? T('R049' /* 左腕は一度も攻撃していません。攻撃タイルの配置を確認してくだ… */) : T('R050' /* 右腕は一度も攻撃していません。攻撃タイルの配置を確認してくだ… */));
      else if (s.hits[side] / s.shots[side] < 0.3 && a.def.type !== 'missile') {
        notes.push(L ? T('R051' /* 左腕の命中率が低め（{acc}）。「前方に敵」の角度を狭める… */, { acc: acc(side) }) : T('R052' /* 右腕の命中率が低め（{acc}）。「前方に敵」の角度を狭める… */, { acc: acc(side) }));
      }
    }
    if (w.result === 'lose' && s.dmgTaken > 0) notes.push(T('R006' /* 被弾が多く撃破されました。胴体の防御強化、「HP残量」「敵弾… */));
    if (P.st.over) notes.push(T('R007' /* 過積載状態で出撃しています。脚部の積載量を見直してください。 */));
    if (w.result === 'return') {
      const pct = Math.round(P.hp / P.maxHp * 100);
      notes.push(s.res.length < DS.length ? T('R053' /* 機体HP {pct}% で帰還しました。次は{name}以降… */, { pct, name: DS[s.res.length].name })
        : T('R054' /* 機体HP {pct}% で帰還しました。ボス戦に挑むには、さ… */, { pct }));
    }
    if (w.unlocked) notes.push(T('R008' /* {name}の{floor}が解放されました。次の出撃は{f… */, { name: w.field.name, floor: floorName(w.unlocked), hp: fmtMul(floorMul(w.unlocked).hp), dmg: fmtMul(floorMul(w.unlocked).dmg) }));
    else if (w.result === 'win' && w.floor >= FLOORS) notes.push(T('R009' /* {name}の最深部 {floor}を制圧しました。 */, { name: w.field.name, floor: floorName(FLOORS) }));
    if (w.templeOpened) notes.unshift(`<b class="temple-open">${T('R083' /* 荒野と洞窟の最深部を制圧した。地の底への道が開く……出撃タブ… */, { name: FIELDS.find(f => f.duel).name })}</b>`);
    if (w.result === 'timeout') notes.push(T('R056' /* 活動限界（{min}分）に達しました。地区を早く掃討するほど… */, { min: ACT_LIMIT / 60 }));
    const timeN = s.res.filter(r => r === 'time').length;
    if (timeN) notes.push(T('R057' /* {n}地区は活動時間の区切りまでに掃討しきれませんでした。火… */, { n: timeN }));
    if (w.result === 'win' && w.act < ACT_LIMIT - ACT_SEG) notes.push(T('R010' /* 迅速な任務遂行です。敵数を増やして挑戦してみましょう。 */));
    if (lostAny) notes.push(T('R011' /* 機体大破により、回収した鉱石の半分を失いました。 */));
    if (ore.field) notes.push(T('R012' /* フィールドに残した鉱石 {n}個は回収できませんでした（地区… */, { n: ore.field }));
    if (s.rareKills) notes.push(T('R013' /* レア個体を {n}体 撃破しました。落としたブースターはガレ… */, { n: s.rareKills }));
    else if (s.rareSeen) notes.push(T('R014' /* レア個体を検知しましたが、撃破できませんでした。 */));
    if (ore.lostParts.length) notes.push(T('R015' /* 機体大破により、回収したブースター {n}個を失いました。 */, { n: ore.lostParts.length }));
    if (ore.fieldParts) notes.push(T('R016' /* フィールドに残したブースター {n}個は回収できませんでした… */, { n: ore.fieldParts }));
    if (ORES.some(k => ore.gain[k.id])) notes.push(T('R017' /* 持ち帰った鉱石は、ガレージの「強化」タブでパーツの強化に使え… */));
    if (!notes.length) notes.push(T('R018' /* 特記事項なし。良好な戦闘データです。 */));

    document.getElementById('report').innerHTML = `
      <div class="rep-head ${cls}"><h1>${title}</h1><p>${w.field.name} ${floorName(w.floor)} / ${T('R019' /* 掃討 {n} / {count} 地区 / 活動時間 {ti… */, { n: s.cleared, count: DS.length, time: mmss(Math.min(w.act, ACT_LIMIT)), total: s.total })}</p>
        <div class="rep-districts">${DS.map((D, i) => {
          const st = s.res[i] === 'clear' ? 'done' : s.res[i] === 'time' ? 'time' : i === w.district && !w.full ? 'fail' : 'none';
          return `<span class="${st}">${districtLabel(D)}${{ done: ' ✔', time: ' ⏱', fail: ' ✖', none: '' }[st]}</span>`;
        }).join('<em>›</em>')}<em>›</em><span class="${s.kills.boss ? 'done' : s.bossAt != null ? 'fail' : 'none'}">BOSS${s.kills.boss ? ' ✔' : s.bossAt != null ? ' ✖' : ''}</span></div></div>
      <div class="rep-body">
        <div class="rep-col">
          <h3>${T('R020' /* 撃破記録 */)}</h3>
          <table class="rep">
            <tr><th>${ENEMY_DEFS.scarab.name}</th><td>${s.kills.scarab}</td></tr>
            <tr><th>${ENEMY_DEFS.spitter.name}</th><td>${s.kills.spitter}</td></tr>
            <tr><th>${ENEMY_DEFS.troll.name}</th><td>${s.kills.troll}</td></tr>
            <tr><th>${ENEMY_DEFS[w.field.boss].name}</th><td>${s.kills.boss ? T('R021' /* 撃破 */) : (s.bossAt != null ? T('R022' /* 未撃破 */) : T('R023' /* 未出現 */))}</td></tr>
            <tr class="sum"><th>${T('R024' /* 合計（一般） */)}</th><td>${killsN} / ${s.total}</td></tr>
          </table>
          <h3>${T('R025' /* 回収鉱石 */)}</h3>
          <table class="rep">
            <tr><th></th><td>${T('R026' /* 回収 */)}</td>${lostAny ? `<td>${T('R027' /* 大破で喪失 */)}</td>` : ''}<td>${T('R028' /* 持ち帰り */)}</td><td>${T('R029' /* 所持数 */)}</td></tr>
            ${ORES.map(k => `<tr><th><i class="ore-dot" style="background:${k.color}"></i>${k.name}</th><td>${ore.collected[k.id]}</td>${lostAny ? `<td class="lost">−${ore.lost[k.id]}</td>` : ''}<td class="gain">+${ore.gain[k.id]}</td><td>${Game.save.ore[k.id]}</td></tr>`).join('')}
          </table>
          ${ore.parts.length || ore.lostParts.length ? `<h3>${T('R030' /* 回収ブースター */)} <small>${T('R031' /* レア個体 {n} / {rareSeen}体 撃破 */, { n: s.rareKills, rareSeen: s.rareSeen })}</small></h3>
          <div class="rep-parts">${ore.parts.map(p => partTagHTML(p)).join('')}${ore.lostParts.map(p => partTagHTML(p).replace('class="ptag"', 'class="ptag lost"')).join('')}</div>` : ''}
          <h3>${T('R032' /* 戦闘データ */)}</h3>
          <table class="rep">
            <tr><th>${T('R033' /* 与ダメージ */)}</th><td>${Math.round(s.dmgDealt)}</td></tr>
            <tr><th>${T('R034' /* 被ダメージ */)}</th><td>${Math.round(s.dmgTaken)}</td></tr>
            <tr><th>${T('R035' /* 残りHP */)}</th><td>${Math.ceil(P.hp)} / ${P.maxHp}</td></tr>
            <tr><th>${T('R036' /* 移動距離 */)}</th><td>${Math.round(s.distance)} m</td></tr>
            <tr><th>${T('R037' /* 回路 実行ステップ数 */)}</th><td>${P.vm.steps}</td></tr>
          </table>
          <h3>${T('R038' /* 武装別 */)}</h3>
          <table class="rep">
            <tr><th></th><td>${T('R039' /* 攻撃回数 */)}</td><td>${T('R040' /* 命中率 */)}</td><td>${T('R041' /* 与ダメージ */)}</td></tr>
            <tr><th>${T('R042' /* 左腕 */)} ${armName('L')}</th><td>${s.shots.L}</td><td>${acc('L')}</td><td>${Math.round(s.dmgBy.L)}</td></tr>
            <tr><th>${T('R043' /* 右腕 */)} ${armName('R')}</th><td>${s.shots.R}</td><td>${acc('R')}</td><td>${Math.round(s.dmgBy.R)}</td></tr>
          </table>
        </div>
        <div class="rep-col">
          <h3>${T('R044' /* 回路 実行ヒートマップ */)}</h3>
          <canvas id="rep-heat" width="320" height="320"></canvas>
          <p class="muted">${T('R045' /* 明るいほど多く実行されたタイル */)}</p>
          <h3>${T('R046' /* 頭部ユニット所見 */)}</h3>
          <ul class="notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="rep-btns">
        <button id="rep-garage">${T('R047' /* ガレージへ戻る */)}</button>
        <button id="rep-retry" class="primary">${T('R048' /* 同じ条件で再出撃 */)}</button>
      </div>`;
    const cv = document.getElementById('rep-heat');
    const ctx = cv.getContext('2d');
    const cs = Math.floor(300 / grid);
    drawCircuit(ctx, prog, grid, 10, 10, cs, { counts: P.vm.counts });
    document.getElementById('rep-garage').onclick = () => Game.toGarage();
    document.getElementById('rep-retry').onclick = () => Game.sortie();
  },

  // 対戦の結果（versus.js）。自機と相手を並べて見せる
  showVersus(w) {
    Game.show('report');
    Sound.playBgm('garage');
    const P = w.player, R = w.rival, foe = w.opp.name, A = w.abyss;   // A = 地底エリア（abyss.js）
    const title = w.vsReason === 'surrender' ? (A ? T('R073' /* 撤退 — {name} との戦いを中断 */, { name: foe }) : T('R063' /* 降参 — {name} との対戦を中断 */, { name: foe }))
      : w.result === 'draw' ? T('R062' /* 引き分け — {name} と互角 */, { name: foe })
      : w.vsReason === 'time' ? (w.result === 'win' ? T('R060' /* 判定勝ち — {name} より多くHPが残った */, { name: foe }) : T('R061' /* 判定負け — {name} のほうがHPが多く残った */, { name: foe }))
      : w.result === 'win' ? T('R058' /* 勝利 — {name} を撃破 */, { name: foe }) : T('R059' /* 敗北 — {name} に撃破された */, { name: foe });
    const cls = { win: 'win', lose: 'lose', draw: 'retreat' }[w.result];
    const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const sides = [
      { M: P, s: w.stats, name: w.meName, head: T('R066' /* 自機 */) },
      { M: R, s: w.rv.stats, name: foe, head: A ? T('R075' /* 地底のマシン */) : T('R067' /* 相手 */) },
    ];
    const acc = (s, k) => s.shots[k] ? Math.round(s.hits[k] / s.shots[k] * 100) + '%' : '—';
    const row = (label, f) => `<tr><th>${label}</th>${sides.map(o => `<td>${f(o)}</td>`).join('')}</tr>`;

    // 自機の回路への所見
    const notes = [];
    const grid = P.st.grid, prog = P.vm.prog;
    let unused = 0;
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
      const i = y * MAX_GRID + x;
      if (prog[i] && P.vm.counts[i] === 0) unused++;
    }
    if (unused) notes.push(T('R005' /* 一度も実行されなかったタイルが {n} 個あります。矢印のつ… */, { n: unused }));
    for (const side of ['L', 'R']) {
      const a = P.arms[side], s = w.stats;
      if (a.def.type === 'none') continue;
      const L = side === 'L';
      if (s.shots[side] === 0) notes.push(L ? T('R049' /* 左腕は一度も攻撃していません。攻撃タイルの配置を確認してくだ… */) : T('R050' /* 右腕は一度も攻撃していません。攻撃タイルの配置を確認してくだ… */));
      else if (s.hits[side] / s.shots[side] < 0.3 && a.def.type !== 'missile') {
        notes.push(L ? T('R051' /* 左腕の命中率が低め（{acc}）。「前方に敵」の角度を狭める… */, { acc: acc(s, side) }) : T('R052' /* 右腕の命中率が低め（{acc}）。「前方に敵」の角度を狭める… */, { acc: acc(s, side) }));
      }
    }
    const time = mmss(clamp(w.vsT, 0, w.cfg.time));
    if (w.vsT > 0 && w.stats.lost > Math.min(w.vsT, w.cfg.time) * 0.3) notes.push(T('R070' /* 相手をセンサーで捉えられない時間が長めでした（{t}秒）。セ… */, { t: Math.round(w.stats.lost) }));
    if (P.st.over) notes.push(T('R007' /* 過積載状態で出撃しています。脚部の積載量を見直してください。 */));
    if (A) {
      const M = A.mech;
      if (w.result === 'win' && A.floor >= ABYSS.floors) notes.push(T('R078' /* {field}の最深部を制圧しました。{name} とともに… */, { field: w.field.name, name: M.name }));
      // 次の出撃先（同じレベルの次の層 / 最深部ならひとつ上のレベルの第1層）
      if (w.next) {
        const N = abyssMech(w.next.floor), floor = floorName(w.next.floor), level = T('C029' /* レベル{n} */, { n: w.next.lv });
        notes.push(w.next.floor > A.floor ? T('R084' /* {floor}「{sub}」の{level}が解放されました… */, { floor, sub: N.sub, name: N.name, level })
          : T('R085' /* {level}が解放されました。{floor}「{sub}」… */, { floor, sub: N.sub, name: N.name, level }));
      }
      if (w.result !== 'win') notes.push(T('R079' /* 脈動中の{name}は回路の処理速度が×{k}になり、回避や… */, { name: M.name, k: ABYSS.surge }));
    } else if (w.rec) notes.push(T('R068' /* {name} との戦績：{w}勝 {l}敗 {d}分 */, { name: escHTML(foe), w: w.rec.w, l: w.rec.l, d: w.rec.d }));
    else notes.push(T('R071' /* 練習相手との対戦は戦績に残りません。 */));
    // 地底エリアで勝って持ち帰ったもの
    const rw = w.reward;
    const loot = rw ? `<h3>${T('R076' /* 持ち帰り */)}</h3>
          <p class="ore-line">${oreHTML(rw.ore)}</p>
          <div class="rep-parts">${partTagHTML(rw.part)}</div>` : '';

    document.getElementById('report').innerHTML = `
      <div class="rep-head ${cls}"><h1>${escHTML(title)}</h1>
        <p>${A ? T('R074' /* {field} {floor}「{sub}」 {level}… */, { field: w.field.name, floor: floorName(A.floor), sub: A.mech.sub, level: T('C029' /* レベル{n} */, { n: A.lv }), time })
          : T('R064' /* {field} / 対戦時間 {time}{rule} */, { field: w.field.name, time, rule: w.flat ? T('R065' /* （強化・ブースター無効） */) : '' })}</p></div>
      <div class="rep-body">
        <div class="rep-col">
          <h3>${A ? T('R032' /* 戦闘データ */) : T('R072' /* 対戦データ */)}</h3>
          <table class="rep vs-rep">
            <tr><th></th>${sides.map(o => `<td class="${o.M.rival ? 'foe' : 'me'}">${o.head}<br><b>${escHTML(o.name)}</b></td>`).join('')}</tr>
            ${row(T('R035' /* 残りHP */), o => `${Math.ceil(o.M.hp)} / ${o.M.maxHp}（${Math.round(o.M.hp / o.M.maxHp * 100)}%）`)}
            ${row(T('R033' /* 与ダメージ */), o => Math.round(o.s.dmgDealt))}
            ${row(`${T('R042' /* 左腕 */)} / ${T('R040' /* 命中率 */)}`, o => `${partLabel(o.M.arms.L.def)}<br>${acc(o.s, 'L')}`)}
            ${row(`${T('R043' /* 右腕 */)} / ${T('R040' /* 命中率 */)}`, o => `${partLabel(o.M.arms.R.def)}<br>${acc(o.s, 'R')}`)}
            ${row(T('R036' /* 移動距離 */), o => `${Math.round(o.s.distance)} m`)}
            ${row(T('R037' /* 回路 実行ステップ数 */), o => o.M.vm.steps)}
          </table>
          ${loot}
          <h3>${T('R046' /* 頭部ユニット所見 */)}</h3>
          <ul class="notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>
        </div>
        <div class="rep-col">
          <h3>${T('R044' /* 回路 実行ヒートマップ */)}</h3>
          <div class="vs-heat">${sides.map((o, i) => `<div><canvas id="rep-heat${i}" width="230" height="230"></canvas><p class="muted">${o.head}：${escHTML(o.name)}</p></div>`).join('')}</div>
          <p class="muted">${T('R045' /* 明るいほど多く実行されたタイル */)}</p>
        </div>
      </div>
      <div class="rep-btns">
        <button id="rep-garage">${T('R047' /* ガレージへ戻る */)}</button>
        <button id="rep-retry" class="primary">${A && w.next ? (w.next.floor > A.floor ? T('R080' /* 次の層へ出撃 */) : T('R082' /* 次のレベルへ出撃 */)) : T('R069' /* 再戦 */)}</button>
      </div>`;
    sides.forEach((o, i) => {
      const g = o.M.st.grid, cs = Math.floor(210 / g);
      drawCircuit(document.getElementById('rep-heat' + i).getContext('2d'), o.M.vm.prog, g, 10, 10, cs, { counts: o.M.vm.counts });
    });
    document.getElementById('rep-garage').onclick = () => Game.toGarage();
    // 地底エリアは出撃（次の層・レベルが解放されていれば、そこが次の出撃先になっている）
    document.getElementById('rep-retry').onclick = () => (A ? Game.sortie() : Game.versus());
  },
};
