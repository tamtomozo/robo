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
      win: '任務完了 — 全地区制圧・ボス撃破', lose: '機体大破 — 任務失敗', retreat: '撤退 — 任務中断',
      return: `基地へ帰還 — ${s.cleared}地区 掃討完了`,
    }[w.result];
    const cls = { win: 'win', lose: 'lose', retreat: 'retreat', return: 'return' }[w.result];
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
    if (unused) notes.push(`一度も実行されなかったタイルが ${unused} 個あります。矢印のつながりを確認してください。`);
    for (const side of ['L', 'R']) {
      const a = P.arms[side];
      if (a.def.type === 'none') continue;
      if (s.shots[side] === 0) notes.push(`${side === 'L' ? '左' : '右'}腕は一度も攻撃していません。攻撃タイルの配置を確認してください。`);
      else if (s.hits[side] / s.shots[side] < 0.3 && a.def.type !== 'missile') notes.push(`${side === 'L' ? '左' : '右'}腕の命中率が低め（${acc(side)}）。「前方に敵」の角度を狭める・距離判定を加えると改善します。`);
    }
    if (w.result === 'lose' && s.dmgTaken > 0) notes.push('被弾が多く撃破されました。胴体の防御強化、「HP残量」「敵弾接近」判定での回避行動が有効です。');
    if (P.st.over) notes.push('過積載状態で出撃しています。脚部の積載量を見直してください。');
    if (w.result === 'return') {
      const pct = Math.round(P.hp / P.maxHp * 100);
      notes.push(`機体HP ${pct}% で帰還しました。${s.cleared < DS.length ? `次は${DS[s.cleared].name}以降が待っています。` : 'ボス戦に挑むには、さらに損傷を抑える必要があります。'}`);
    }
    if (w.result === 'win' && w.time < 420) notes.push('迅速な任務遂行です。敵数を増やして挑戦してみましょう。');
    if (lostAny) notes.push('機体大破により、回収した鉱石の半分を失いました。');
    if (ore.field) notes.push(`フィールドに残した鉱石 ${ore.field}個は回収できませんでした（地区を掃討すると回収ドローンが残りを回収します）。`);
    if (s.rareKills) notes.push(`レア個体を ${s.rareKills}体 撃破しました。落としたブースターはガレージの「ブースター」タブで確認・分解でき、「組立」タブで対象パーツに差し込めます。`);
    else if (s.rareSeen) notes.push('レア個体を検知しましたが、撃破できませんでした。');
    if (ore.lostParts.length) notes.push(`機体大破により、回収したブースター ${ore.lostParts.length}個を失いました。`);
    if (ore.fieldParts) notes.push(`フィールドに残したブースター ${ore.fieldParts}個は回収できませんでした。`);
    if (ORES.some(k => ore.gain[k.id])) notes.push('持ち帰った鉱石は、ガレージの「強化」タブでパーツの強化に使えます。');
    if (!notes.length) notes.push('特記事項なし。良好な戦闘データです。');

    document.getElementById('report').innerHTML = `
      <div class="rep-head ${cls}"><h1>${title}</h1><p>${w.field.name} / 掃討 ${s.cleared} / ${DS.length} 地区 / 戦闘時間 ${mmss(w.time)} / 交戦した敵 ${s.total}体</p>
        <div class="rep-districts">${DS.map((D, i) => {
          const st = i < s.cleared ? 'done' : i === w.district && w.result !== 'return' ? 'fail' : 'none';
          return `<span class="${st}">${D.name}「${D.sub}」${st === 'done' ? ' ✔' : st === 'fail' ? ' ✖' : ''}</span>`;
        }).join('<em>›</em>')}<em>›</em><span class="${s.kills.boss ? 'done' : s.bossAt != null ? 'fail' : 'none'}">BOSS${s.kills.boss ? ' ✔' : s.bossAt != null ? ' ✖' : ''}</span></div></div>
      <div class="rep-body">
        <div class="rep-col">
          <h3>撃破記録</h3>
          <table class="rep">
            <tr><th>${ENEMY_DEFS.scarab.name}</th><td>${s.kills.scarab}</td></tr>
            <tr><th>${ENEMY_DEFS.spitter.name}</th><td>${s.kills.spitter}</td></tr>
            <tr><th>${ENEMY_DEFS.troll.name}</th><td>${s.kills.troll}</td></tr>
            <tr><th>${ENEMY_DEFS[w.field.boss].name}</th><td>${s.kills.boss ? '撃破' : (s.bossAt != null ? '未撃破' : '未出現')}</td></tr>
            <tr class="sum"><th>合計（一般）</th><td>${killsN} / ${s.total}</td></tr>
          </table>
          <h3>回収鉱石</h3>
          <table class="rep">
            <tr><th></th><td>回収</td>${lostAny ? '<td>大破で喪失</td>' : ''}<td>持ち帰り</td><td>所持数</td></tr>
            ${ORES.map(k => `<tr><th><i class="ore-dot" style="background:${k.color}"></i>${k.name}</th><td>${ore.collected[k.id]}</td>${lostAny ? `<td class="lost">−${ore.lost[k.id]}</td>` : ''}<td class="gain">+${ore.gain[k.id]}</td><td>${Game.save.ore[k.id]}</td></tr>`).join('')}
          </table>
          ${ore.parts.length || ore.lostParts.length ? `<h3>回収ブースター <small>レア個体 ${s.rareKills} / ${s.rareSeen}体 撃破</small></h3>
          <div class="rep-parts">${ore.parts.map(p => partTagHTML(p)).join('')}${ore.lostParts.map(p => partTagHTML(p).replace('class="ptag"', 'class="ptag lost"')).join('')}</div>` : ''}
          <h3>戦闘データ</h3>
          <table class="rep">
            <tr><th>与ダメージ</th><td>${Math.round(s.dmgDealt)}</td></tr>
            <tr><th>被ダメージ</th><td>${Math.round(s.dmgTaken)}</td></tr>
            <tr><th>残りHP</th><td>${Math.ceil(P.hp)} / ${P.maxHp}</td></tr>
            <tr><th>移動距離</th><td>${Math.round(s.distance)} m</td></tr>
            <tr><th>回路 実行ステップ数</th><td>${P.vm.steps}</td></tr>
          </table>
          <h3>武装別</h3>
          <table class="rep">
            <tr><th></th><td>攻撃回数</td><td>命中率</td><td>与ダメージ</td></tr>
            <tr><th>左腕 ${armName('L')}</th><td>${s.shots.L}</td><td>${acc('L')}</td><td>${Math.round(s.dmgBy.L)}</td></tr>
            <tr><th>右腕 ${armName('R')}</th><td>${s.shots.R}</td><td>${acc('R')}</td><td>${Math.round(s.dmgBy.R)}</td></tr>
          </table>
        </div>
        <div class="rep-col">
          <h3>回路 実行ヒートマップ</h3>
          <canvas id="rep-heat" width="320" height="320"></canvas>
          <p class="muted">明るいほど多く実行されたタイル</p>
          <h3>頭部ユニット所見</h3>
          <ul class="notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="rep-btns">
        <button id="rep-garage">ガレージへ戻る</button>
        <button id="rep-retry" class="primary">同じ条件で再出撃</button>
      </div>`;
    const cv = document.getElementById('rep-heat');
    const ctx = cv.getContext('2d');
    const cs = Math.floor(300 / grid);
    drawCircuit(ctx, prog, grid, 10, 10, cs, { counts: P.vm.counts });
    document.getElementById('rep-garage').onclick = () => Game.toGarage();
    document.getElementById('rep-retry').onclick = () => Game.sortie();
  },
};
