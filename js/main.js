'use strict';
// =====================================================================
//  エントリーポイント：画面遷移とセーブ
// =====================================================================

const Game = {
  save: null,

  init() {
    this.save = this.load();
    Sound.init();
    Garage.init();
    this.toGarage();
  },

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.build && Array.isArray(s.program) && s.program.length === MAX_GRID * MAX_GRID) {
        const d = defaultSave();
        return {
          build: Object.assign(d.build, s.build), program: s.program, enemyCount: s.enemyCount || d.enemyCount,
          ore: Object.assign(d.ore, s.ore), upgrades: Object.assign(d.upgrades, s.upgrades),
        };
      }
    } catch (e) { /* 壊れたセーブは無視 */ }
    return defaultSave();
  },

  persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* 保存不可の環境 */ }
  },

  // 戦闘で持ち帰った鉱石を所持数に加える
  addOre(gain) {
    for (const k of ORES) this.save.ore[k.id] += gain[k.id] || 0;
    this.persist();
  },

  show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  },

  toGarage() {
    this.show('garage');
    Sound.playBgm('garage');
    Garage.onShow();
  },

  sortie() {
    Garage.onHide();
    this.show('battle');
    Sound.play('sortie');
    Battle.start(this.save);
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
