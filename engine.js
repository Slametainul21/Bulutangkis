// engine.js — Logika murni penghitung skor bulutangkis (Service-Over / Side-Out System)
// Tidak ada dependensi DOM. Semua fungsi bersifat pure dan state bersifat immutable.

/**
 * Tabel konfigurasi setting default berdasarkan target poin game.
 * VERIFIKASI dengan aturan panitia untuk turnamen lokal masing-masing.
 */
export const DEFAULT_SETTING_TABLE = {
  15: { 13: 5, 14: 3 },
  11: { 9: 3, 10: 2 }, // VERIFIKASI dengan aturan panitia
};

/**
 * Tabel konfigurasi batas poin "Tukar sisi lapangan" pada game penentuan (mis. game ke-3).
 * VERIFIKASI dengan aturan panitia.
 */
export const DEFAULT_CHANGE_ENDS_TABLE = {
  15: 8, // VERIFIKASI dengan aturan panitia
  11: 6, // VERIFIKASI dengan aturan panitia
};

export const MATCH_TYPES = {
  MS: { id: 'MS', mode: 'singles', target: 15 },
  MD: { id: 'MD', mode: 'doubles', target: 15 },
  WS: { id: 'WS', mode: 'singles', target: 11 },
  WD: { id: 'WD', mode: 'doubles', target: 15 },
  XD: { id: 'XD', mode: 'doubles', target: 15 },
  CUSTOM: { id: 'CUSTOM', mode: 'doubles', target: 15 },
};

export function otherSide(side) {
  return side === 'A' ? 'B' : 'A';
}

function cloneSettingTable(table) {
  const out = {};
  for (const [targetKey, rules] of Object.entries(table || {})) {
    out[targetKey] = { ...rules };
  }
  return out;
}

function cloneChangeEndsTable(table) {
  return { ...(table || {}) };
}

/**
 * Membuat state awal pertandingan baru.
 * @param {Object} config
 * @returns {Object} state immutable
 */
export function createGame(config = {}) {
  const matchType = config.matchType || 'MD';
  const preset = MATCH_TYPES[matchType] || MATCH_TYPES.MD;
  const mode = config.mode || preset.mode;
  const target = Number(config.target ?? preset.target) || 15;
  const bestOf = Number(config.bestOf ?? 3) || 3;
  const tabelSetting = cloneSettingTable(config.tabelSetting || DEFAULT_SETTING_TABLE);
  const tabelTukarSisi = cloneChangeEndsTable(config.tabelTukarSisi || DEFAULT_CHANGE_ENDS_TABLE);

  const defaultPlayersA = mode === 'singles' ? [config.pemain?.A?.[0] || 'Pemain A'] : [
    config.pemain?.A?.[0] || 'Pemain A1',
    config.pemain?.A?.[1] || 'Pemain A2',
  ];
  const defaultPlayersB = mode === 'singles' ? [config.pemain?.B?.[0] || 'Pemain B'] : [
    config.pemain?.B?.[0] || 'Pemain B1',
    config.pemain?.B?.[1] || 'Pemain B2',
  ];

  const pemain = {
    A: [...defaultPlayersA],
    B: [...defaultPlayersB],
  };

  const posA = mode === 'singles'
    ? [0, null]
    : (Array.isArray(config.posisi?.A) ? [...config.posisi.A] : [0, 1]);
  const posB = mode === 'singles'
    ? [0, null]
    : (Array.isArray(config.posisi?.B) ? [...config.posisi.B] : [0, 1]);

  const serving = config.serving === 'B' ? 'B' : 'A';
  const serverIdx = mode === 'singles' ? 0 : (serving === 'A' ? posA[0] : posB[0]);

  return {
    matchType,
    mode,
    target,
    bestOf,
    tabelSetting,
    tabelTukarSisi,
    pemain,
    skor: { A: 0, B: 0 },
    serving,
    serverIdx,
    serverNo: 1,
    firstTurn: true,
    posisi: {
      A: posA,
      B: posB,
    },
    setPhase: null,
    preSetScore: null,
    pendingSetChoice: null,
    declinedSettingAt: {},
    games: [],
    gameNumber: 1,
    gameWins: { A: 0, B: 0 },
    gameWinner: null,
    matchWinner: null,
    changeEndsPending: false,
    changeEndsTriggered: false,
    riwayat: [],
    lastEvent: {
      type: 'GAME_START',
      serving,
      messageKey: 'gameStart',
    },
  };
}

/**
 * Mengembalikan informasi servis dan penerima saat ini.
 * @param {Object} state
 * @returns {{servingSide: 'A'|'B', serverIdx: number, serverName: string, serverNo: 1|2, court: 'kanan'|'kiri', receiverSide: 'A'|'B', receiverIdx: number, receiverName: string}}
 */
export function getServingInfo(state) {
  const servingSide = state.serving;
  const receiverSide = otherSide(servingSide);

  if (state.mode === 'singles') {
    const serverScore = state.skor[servingSide];
    const court = serverScore % 2 === 0 ? 'kanan' : 'kiri';
    return {
      servingSide,
      serverIdx: 0,
      serverName: state.pemain[servingSide][0],
      serverNo: 1,
      court,
      receiverSide,
      receiverIdx: 0,
      receiverName: state.pemain[receiverSide][0],
    };
  }

  const posServing = state.posisi[servingSide];
  const court = state.serverIdx === posServing[0] ? 'kanan' : 'kiri';
  const courtSlot = court === 'kanan' ? 0 : 1;
  const receiverIdx = state.posisi[receiverSide][courtSlot];

  return {
    servingSide,
    serverIdx: state.serverIdx,
    serverName: state.pemain[servingSide][state.serverIdx],
    serverNo: state.serverNo,
    court,
    receiverSide,
    receiverIdx,
    receiverName: state.pemain[receiverSide][receiverIdx],
  };
}

function getEffectiveTarget(state) {
  return state.setPhase ? state.setPhase.extra : state.target;
}

function getChangeEndsThreshold(state) {
  if (Object.prototype.hasOwnProperty.call(state.tabelTukarSisi, state.target)) {
    return state.tabelTukarSisi[state.target];
  }
  return Math.floor(state.target / 2) + 1;
}

function checkGameWin(skor, effectiveTarget) {
  if (skor.A >= effectiveTarget) return 'A';
  if (skor.B >= effectiveTarget) return 'B';
  return null;
}

function recordCompletedGame(state, winner) {
  const gameRecord = {
    gameNumber: state.gameNumber,
    skor: { ...state.skor },
    preSetScore: state.preSetScore ? { ...state.preSetScore } : null,
    setPhase: state.setPhase ? { ...state.setPhase } : null,
    winner,
  };
  const games = [...state.games, gameRecord];
  const gameWins = {
    ...state.gameWins,
    [winner]: state.gameWins[winner] + 1,
  };
  const winsNeeded = Math.ceil(state.bestOf / 2);
  const matchWinner = gameWins[winner] >= winsNeeded ? winner : null;
  return { games, gameWins, matchWinner };
}

/**
 * Memproses hasil satu reli yang dimenangkan oleh `sideWinner` ('A' atau 'B').
 * @param {Object} state
 * @param {'A'|'B'} sideWinner
 * @returns {Object} state baru
 */
export function rallyWon(state, sideWinner) {
  if (sideWinner !== 'A' && sideWinner !== 'B') {
    throw new Error(`Invalid sideWinner: ${sideWinner}`);
  }
  if (state.matchWinner || state.gameWinner || state.pendingSetChoice) {
    return state;
  }

  const isServerWin = sideWinner === state.serving;

  if (isServerWin) {
    const newSkor = {
      ...state.skor,
      [state.serving]: state.skor[state.serving] + 1,
    };

    const newPosisi = state.mode === 'doubles'
      ? {
          ...state.posisi,
          [state.serving]: [state.posisi[state.serving][1], state.posisi[state.serving][0]],
        }
      : {
          A: [...state.posisi.A],
          B: [...state.posisi.B],
        };

    const effectiveTarget = getEffectiveTarget(state);
    const winner = checkGameWin(newSkor, effectiveTarget);

    let pendingSetChoice = null;
    if (!winner && !state.setPhase) {
      const targetTable = state.tabelSetting?.[state.target];
      if (targetTable && newSkor.A === newSkor.B) {
        const tieScore = newSkor.A;
        if (Object.prototype.hasOwnProperty.call(targetTable, tieScore) && !state.declinedSettingAt[tieScore]) {
          const extra = targetTable[tieScore];
          const eligibleSide = otherSide(state.serving);
          pendingSetChoice = {
            side: eligibleSide,
            tieScore,
            extra,
            options: ['set', 'continue'],
          };
        }
      }
    }

    let changeEndsPending = state.changeEndsPending;
    let changeEndsTriggered = state.changeEndsTriggered;
    const isDecidingGame = state.bestOf > 1 && state.gameNumber === state.bestOf;
    if (!winner && !state.setPhase && isDecidingGame && !changeEndsTriggered) {
      const threshold = getChangeEndsThreshold(state);
      if (Math.max(newSkor.A, newSkor.B) >= threshold) {
        changeEndsPending = true;
        changeEndsTriggered = true;
      }
    }

    const event = {
      type: 'POINT',
      side: state.serving,
      skor: { ...newSkor },
    };

    const baseNext = {
      ...state,
      skor: newSkor,
      posisi: newPosisi,
      pendingSetChoice,
      changeEndsPending,
      changeEndsTriggered,
      riwayat: [...state.riwayat, event],
      lastEvent: {
        type: 'POINT',
        side: state.serving,
        messageKey: 'point',
      },
    };

    if (winner) {
      const { games, gameWins, matchWinner } = recordCompletedGame(baseNext, winner);
      return {
        ...baseNext,
        games,
        gameWins,
        gameWinner: winner,
        matchWinner,
        lastEvent: {
          type: matchWinner ? 'MATCH_WIN' : 'GAME_WIN',
          side: winner,
          messageKey: matchWinner ? 'matchWin' : 'gameWin',
        },
      };
    }

    return baseNext;
  }

  // Penerima menang reli -> TIDAK ada poin
  if (state.mode === 'singles') {
    const nextServing = otherSide(state.serving);
    const event = {
      type: 'SERVICE_OVER',
      from: state.serving,
      to: nextServing,
      skor: { ...state.skor },
    };
    return {
      ...state,
      serving: nextServing,
      serverIdx: 0,
      serverNo: 1,
      riwayat: [...state.riwayat, event],
      lastEvent: {
        type: 'SERVICE_OVER',
        side: nextServing,
        messageKey: 'serviceOver',
      },
    };
  }

  // Ganda: penerima menang reli
  if (state.firstTurn || state.serverNo === 2) {
    const nextServing = otherSide(state.serving);
    const nextServerIdx = state.posisi[nextServing][0];
    const event = {
      type: 'SERVICE_OVER',
      from: state.serving,
      to: nextServing,
      skor: { ...state.skor },
    };
    return {
      ...state,
      serving: nextServing,
      serverIdx: nextServerIdx,
      serverNo: 1,
      firstTurn: false,
      riwayat: [...state.riwayat, event],
      lastEvent: {
        type: 'SERVICE_OVER',
        side: nextServing,
        messageKey: 'serviceOver',
      },
    };
  }

  // serverNo === 1 dan !firstTurn -> Second Service
  const posServing = state.posisi[state.serving];
  const partnerIdx = state.serverIdx === posServing[0] ? posServing[1] : posServing[0];
  const event = {
    type: 'SECOND_SERVICE',
    side: state.serving,
    serverIdx: partnerIdx,
    skor: { ...state.skor },
  };
  return {
    ...state,
    serverIdx: partnerIdx,
    serverNo: 2,
    riwayat: [...state.riwayat, event],
    lastEvent: {
      type: 'SECOND_SERVICE',
      side: state.serving,
      messageKey: 'secondService',
    },
  };
}

/**
 * Memproses pilihan setting ('set' atau 'continue') saat kedudukan seri sesuai tabel setting.
 */
export function chooseSet(state, side, choice) {
  if (!state.pendingSetChoice) {
    return state;
  }
  if (side !== state.pendingSetChoice.side) {
    throw new Error(`Side ${side} is not eligible to choose set (expected ${state.pendingSetChoice.side})`);
  }

  const isSet = choice === 'set' || choice === true || choice === state.pendingSetChoice.extra;
  const { tieScore, extra } = state.pendingSetChoice;

  if (isSet) {
    const event = {
      type: 'SET_CHOSEN',
      side,
      tieScore,
      extra,
    };
    return {
      ...state,
      preSetScore: { ...state.skor },
      skor: { A: 0, B: 0 },
      setPhase: {
        extra,
        tieScore,
        chosenBy: side,
      },
      pendingSetChoice: null,
      riwayat: [...state.riwayat, event],
      lastEvent: {
        type: 'SET_CHOSEN',
        side,
        extra,
        messageKey: 'setChosen',
      },
    };
  }

  const event = {
    type: 'SET_DECLINED',
    side,
    tieScore,
  };
  return {
    ...state,
    pendingSetChoice: null,
    declinedSettingAt: {
      ...state.declinedSettingAt,
      [tieScore]: true,
    },
    riwayat: [...state.riwayat, event],
    lastEvent: {
      type: 'SET_DECLINED',
      side,
      messageKey: 'setDeclined',
    },
  };
}

/**
 * Memulai game berikutnya setelah `gameWinner` ditetapkan.
 */
export function startNextGame(state, options = {}) {
  if (!state.gameWinner || state.matchWinner) {
    return state;
  }

  const nextServing = state.gameWinner;
  const nextReceiving = otherSide(nextServing);

  let nextPosisi;
  let nextServerIdx = 0;

  if (state.mode === 'doubles') {
    const sRight = options.serverRightIdx === 1 ? 1 : 0;
    const rRight = options.receiverRightIdx === 1 ? 1 : 0;
    nextPosisi = {
      [nextServing]: [sRight, sRight === 0 ? 1 : 0],
      [nextReceiving]: [rRight, rRight === 0 ? 1 : 0],
    };
    nextServerIdx = sRight;
  } else {
    nextPosisi = {
      A: [0, null],
      B: [0, null],
    };
  }

  const nextGameNumber = state.gameNumber + 1;
  const event = {
    type: 'NEXT_GAME',
    gameNumber: nextGameNumber,
    serving: nextServing,
  };

  return {
    ...state,
    skor: { A: 0, B: 0 },
    serving: nextServing,
    serverIdx: nextServerIdx,
    serverNo: 1,
    firstTurn: true,
    posisi: nextPosisi,
    setPhase: null,
    preSetScore: null,
    pendingSetChoice: null,
    declinedSettingAt: {},
    gameNumber: nextGameNumber,
    gameWinner: null,
    changeEndsPending: false,
    changeEndsTriggered: false,
    riwayat: [...state.riwayat, event],
    lastEvent: {
      type: 'NEXT_GAME',
      serving: nextServing,
      gameNumber: nextGameNumber,
      messageKey: 'nextGame',
    },
  };
}

export function dismissChangeEnds(state) {
  if (!state.changeEndsPending) return state;
  return {
    ...state,
    changeEndsPending: false,
  };
}

export function endMatchEarly(state) {
  if (state.matchWinner) return state;
  let winner = null;
  if (state.gameWins.A > state.gameWins.B) winner = 'A';
  else if (state.gameWins.B > state.gameWins.A) winner = 'B';
  else if (state.skor.A > state.skor.B) winner = 'A';
  else if (state.skor.B > state.skor.A) winner = 'B';

  return {
    ...state,
    matchWinner: winner || 'DRAW',
    lastEvent: {
      type: 'MATCH_ENDED',
      side: winner,
      messageKey: 'matchEnded',
    },
  };
}

// === Helper Undo / Redo (Immutable History Stack) ===

export function createHistory(initialState) {
  return {
    past: [],
    present: initialState,
    future: [],
  };
}

export function pushHistory(history, nextState) {
  if (nextState === history.present) return history;
  return {
    past: [...history.past, history.present],
    present: nextState,
    future: [],
  };
}

export function undoHistory(history) {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const newPast = history.past.slice(0, -1);
  return {
    past: newPast,
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistory(history) {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  const newFuture = history.future.slice(1);
  return {
    past: [...history.past, history.present],
    present: next,
    future: newFuture,
  };
}

export function canUndo(history) {
  return history.past.length > 0;
}

export function canRedo(history) {
  return history.future.length > 0;
}