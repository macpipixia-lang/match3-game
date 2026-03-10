// Game configuration (non-module) so it can be loaded before main.js without a bundler.
// This is step 1 of engineering refactor: move all tunables out of main.js.

window.MATCH3_CONFIG = {
  // Board
  boardSize: 8,
  gemTypes: [0, 1, 2, 3, 4, 5],

  // Timing
  timing: {
    clearDelayMs: 260,
    dropDelayMs: 170,
    wrappedPulseDelayMs: 120,
    targetHighlightDelayMs: 120,
    comboWaveDelayMs: 90,
  },

  // Scoring / thresholds
  scoring: {
    scorePerGem: 10,
  },
  thresholds: {
    bigClearShake: 8,
    targetHighlight: 8,
  },

  // Persistence keys
  storageKeys: {
    audioEnabled: "match3.audioEnabled",
    debugEnabled: "match3.debugEnabled",
    levelIndex: "match3.levelIndex",
    bestScore: "match3.bestScore",
  },

  // Audio
  sfxSources: {
    clear: "assets/sfx/clear.mp3",
    swap: "assets/sfx/swap.mp3",
    invalid: "assets/sfx/invalid.mp3",
    combo: "assets/sfx/combo.mp3",
  },

  // Levels
  levels: [
    { targetScore: 900, moveLimit: 16 },
    { targetScore: 1300, moveLimit: 18 },
    { targetScore: 1750, moveLimit: 20 },
  ],
};
