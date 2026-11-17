// app.js — Lapisan UI & PWA untuk Penghitung Skor Bulutangkis (Service-Over)
import {
  DEFAULT_SETTING_TABLE,
  MATCH_TYPES,
  createGame,
  rallyWon,
  chooseSet,
  startNextGame,
  dismissChangeEnds,
  endMatchEarly,
  getServingInfo,
  createHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo,
  otherSide,
} from './engine.js';

import {
  loadSettings,
  saveSettings,
  loadActiveMatch,
  saveActiveMatch,
  clearActiveMatch,
  loadMatchHistory,
  saveMatchRecord,
  deleteMatchRecord,
  exportHistoryJson,
  importHistoryJson,
} from './storage.js';

// Semua teks tampilan dalam satu objek agar mudah diterjemahkan
const TEXTS = {
  id: {
    appTitle: 'Skor Bulutangkis',
    gameLabel: (n, bestOf) => `Game ${n} / ${bestOf}`,
    gameWins: (a, b) => `Game: ${a} - ${b}`,
    servingLine: (sName, court, rName, mode, sNo) =>
      `Servis: ${sName}${mode === 'doubles' ? ` (#${sNo})` : ''} dari ${court.toUpperCase()} → Penerima: ${rName}`,
    rallyBtn: (name) => `${name} menang reli`,
    events: {
      gameStart: 'Pertandingan dimulai',
      point: (name) => `Poin untuk ${name}`,
      serviceOver: (name) => `Service over! Hak servis pindah ke ${name}`,
      secondService: (name) => `Second service — ${name} melayani`,
      setChosen: (extra) => `Set ${extra} dipilih (skor mulai 0-0)`,
      setDeclined: 'Tidak set — permainan lanjut',
      gameWin: (name) => `${name} memenangkan game ini!`,
      matchWin: (name) => `${name} memenangkan pertandingan!`,
      nextGame: (n) => `Game ${n} dimulai`,
      matchEnded: 'Pertandingan diakhiri',
    },
    setDialogTitle: 'Pilihan Setting',
    setDialogDesc: (sideName, tieScore, extra) =>
      `Kedudukan seri ${tieScore}-${tieScore}. Pihak ${sideName} lebih dulu mencapai ${tieScore} dan berhak memilih:`,
    setBtn: (extra) => `Set ${extra}`,
    continueBtn: 'Lanjut',
    emptyHistory: 'Belum ada riwayat pertandingan tersimpan.',
    shareTitle: 'Hasil Pertandingan Bulutangkis (Service-Over)',
    copiedToast: 'Hasil pertandingan disalin ke clipboard.',
    confirmResetGame: 'Reset skor game saat ini ke 0-0?',
    confirmEndMatch: 'Akhiri pertandingan sekarang dan simpan ke riwayat?',
  },
};

const T = TEXTS.id;

let settings = loadSettings();
let historyStack = null;
let flipDisplaySides = false;
let matchSavedToHistory = false;
let wakeLockSentinel = null;
let deferredInstallPrompt = null;
let waitingWorker = null;
let audioCtx = null;

let setupPos = {
  A: [0, 1],
  B: [0, 1],
};

const views = {
  setup: document.getElementById('view-setup'),
  board: document.getElementById('view-board'),
  history: document.getElementById('view-history'),
  settings: document.getElementById('view-settings'),
};

const navButtons = document.querySelectorAll('.nav-btn');

function getSideDisplayName(state, side) {
  if (state.mode === 'singles') return state.pemain[side][0];
  return `${state.pemain[side][0]} / ${state.pemain[side][1]}`;
}

function playBeep(freq = 660, durationMs = 70) {
  if (!settings.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch {
    // Abaikan jika browser memblokir audio
  }
}

function triggerVibrate(ms = 35) {
  if (settings.vibrate && navigator.vibrate) {
    navigator.vibrate(ms);
  }
}

async function syncWakeLock(activeView) {
  if (!('wakeLock' in navigator)) return;
  const shouldLock = settings.wakeLock && activeView === 'board';
  if (shouldLock && !wakeLockSentinel) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch {
      // Abaikan jika gagal
    }
  } else if (!shouldLock && wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    } catch {
      wakeLockSentinel = null;
    }
  }
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.theme);
}

function switchView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle('hidden', key !== name);
  }
  navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === name);
  });
  syncWakeLock(name);
  if (name === 'history') renderHistory();
  if (name === 'setup') renderSetupResume();
}

function renderSetupResume() {
  const saved = loadActiveMatch();
  const card = document.getElementById('resume-card');
  if (saved && saved.history && saved.history.present && !saved.history.present.matchWinner) {
    const st = saved.history.present;
    document.getElementById('resume-desc').textContent =
      `${getSideDisplayName(st, 'A')} (${st.skor.A}) vs ${getSideDisplayName(st, 'B')} (${st.skor.B}) — Game ${st.gameNumber}`;
    card.classList.remove('hidden');
  } else {
    card.classList.add('hidden');
  }
}

function updateSetupTypeFields() {
  const type = document.getElementById('match-type').value;
  const customBox = document.getElementById('custom-options');
  customBox.classList.toggle('hidden', type !== 'CUSTOM');

  const isSingles = type === 'CUSTOM'
    ? document.getElementById('custom-mode').value === 'singles'
    : MATCH_TYPES[type].mode === 'singles';

  document.querySelectorAll('.doubles-only').forEach((el) => {
    el.classList.toggle('hidden', isSingles);
  });
}

function formatEventText(state) {
  const ev = state.lastEvent;
  if (!ev) return '';
  switch (ev.messageKey) {
    case 'gameStart': return T.events.gameStart;
    case 'point': return T.events.point(getSideDisplayName(state, ev.side));
    case 'serviceOver': return T.events.serviceOver(getSideDisplayName(state, ev.side));
    case 'secondService': return T.events.secondService(getSideDisplayName(state, ev.side));
    case 'setChosen': return T.events.setChosen(ev.extra);
    case 'setDeclined': return T.events.setDeclined;
    case 'gameWin': return T.events.gameWin(getSideDisplayName(state, ev.side));
    case 'matchWin': return T.events.matchWin(getSideDisplayName(state, ev.side));
    case 'nextGame': return T.events.nextGame(ev.gameNumber);
    case 'matchEnded': return T.events.matchEnded;
    default: return '';
  }
}

function renderScorePanel(el, state, side, info) {
  const isServing = state.serving === side && !state.gameWinner && !state.matchWinner;
  el.className = `score-panel${isServing ? ' is-serving' : ''}`;

  const teamName = getSideDisplayName(state, side);
  const serveBadge = isServing
    ? `<span class="serve-pill">🏸 ${state.mode === 'doubles' ? `Servis #${info.serverNo}` : 'Servis'}</span>`
    : '';

  const disabledAttr = (state.pendingSetChoice || state.gameWinner || state.matchWinner) ? 'disabled' : '';

  el.innerHTML = `
    <div class="panel-header">
      <span class="team-name">${escapeHtml(teamName)}</span>
      ${serveBadge}
    </div>
    <div class="giant-score">${state.skor[side]}</div>
    <button class="btn btn-primary btn-rally" data-rally="${side}" type="button" ${disabledAttr}>
      ${escapeHtml(T.rallyBtn(teamName))}
    </button>
  `;
}

function renderMiniCourt(state, info) {
  const container = document.getElementById('mini-court');
  const leftSide = flipDisplaySides ? 'B' : 'A';
  const rightSide = flipDisplaySides ? 'A' : 'B';

  const getBoxPlayers = (side) => {
    if (state.mode === 'singles') {
      const serverCourt = info.court;
      return {
        kanan: serverCourt === 'kanan' ? state.pemain[side][0] : '—',
        kiri: serverCourt === 'kiri' ? state.pemain[side][0] : '—',
      };
    }
    return {
      kanan: state.pemain[side][state.posisi[side][0]],
      kiri: state.pemain[side][state.posisi[side][1]],
    };
  };

  const lp = getBoxPlayers(leftSide);
  const rp = getBoxPlayers(rightSide);

  const boxHtml = (side, courtPos, playerName) => {
    const isServer = state.serving === side && info.court === courtPos && !state.gameWinner;
    const isReceiver = info.receiverSide === side && info.court === courtPos && !state.gameWinner;
    const cls = `court-box${isServer ? ' is-server' : ''}${isReceiver ? ' is-receiver' : ''}`;
    const icon = isServer ? '🏸 ' : (isReceiver ? '🎯 ' : '');
    return `
      <div class="${cls}">
        <span>${icon}${escapeHtml(playerName)}</span>
        <span class="court-pos-tag">${side} · ${courtPos.toUpperCase()}</span>
      </div>
    `;
  };

  container.innerHTML = `
    <div class="court-half">
      ${boxHtml(leftSide, 'kiri', lp.kiri)}
      ${boxHtml(leftSide, 'kanan', lp.kanan)}
    </div>
    <div class="court-net" aria-hidden="true"></div>
    <div class="court-half">
      ${boxHtml(rightSide, 'kanan', rp.kanan)}
      ${boxHtml(rightSide, 'kiri', rp.kiri)}
    </div>
  `;
}

function renderBoard() {
  if (!historyStack) return;
  const state = historyStack.present;
  const info = getServingInfo(state);

  document.getElementById('board-game-label').textContent = T.gameLabel(state.gameNumber, state.bestOf);
  document.getElementById('board-game-wins').textContent = T.gameWins(state.gameWins.A, state.gameWins.B);

  const setBadge = document.getElementById('board-set-badge');
  if (state.setPhase) {
    setBadge.textContent = `SET ${state.setPhase.extra} (dari ${state.preSetScore.A}-${state.preSetScore.B})`;
    setBadge.classList.remove('hidden');
  } else {
    setBadge.classList.add('hidden');
  }

  document.getElementById('status-serving').textContent = T.servingLine(
    info.serverName,
    info.court,
    info.receiverName,
    state.mode,
    info.serverNo
  );
  document.getElementById('status-event').textContent = formatEventText(state);

  const changeBanner = document.getElementById('change-ends-banner');
  changeBanner.classList.toggle('hidden', !state.changeEndsPending);

  const leftSide = flipDisplaySides ? 'B' : 'A';
  const rightSide = flipDisplaySides ? 'A' : 'B';
  renderScorePanel(document.getElementById('panel-left'), state, leftSide, info);
  renderScorePanel(document.getElementById('panel-right'), state, rightSide, info);
  renderMiniCourt(state, info);

  document.getElementById('btn-undo').disabled = !canUndo(historyStack);
  document.getElementById('btn-redo').disabled = !canRedo(historyStack);

  saveActiveMatch(historyStack);
  checkModals(state);
}

function checkModals(state) {
  const dlgSet = document.getElementById('dialog-set');
  const dlgNext = document.getElementById('dialog-next-game');
  const dlgEnd = document.getElementById('dialog-match-end');

  if (state.pendingSetChoice) {
    const { side, tieScore, extra } = state.pendingSetChoice;
    document.getElementById('set-dialog-title').textContent = T.setDialogTitle;
    document.getElementById('set-dialog-desc').textContent = T.setDialogDesc(
      getSideDisplayName(state, side),
      tieScore,
      extra
    );
    document.getElementById('btn-choose-set').textContent = T.setBtn(extra);
    document.getElementById('btn-choose-continue').textContent = T.continueBtn;
    if (!dlgSet.open) dlgSet.showModal();
  } else if (dlgSet.open) {
    dlgSet.close();
  }

  if (state.matchWinner) {
    if (dlgNext.open) dlgNext.close();
    if (!matchSavedToHistory) {
      saveMatchRecord(state);
      clearActiveMatch();
      matchSavedToHistory = true;
    }
    const winName = state.matchWinner === 'DRAW' ? 'Seri' : getSideDisplayName(state, state.matchWinner);
    document.getElementById('match-end-title').textContent =
      state.matchWinner === 'DRAW' ? 'Pertandingan Berakhir Seri' : `Pemenang: ${winName}`;
    document.getElementById('match-end-desc').textContent =
      `Skor Game: ${state.gameWins.A} - ${state.gameWins.B}`;
    document.getElementById('match-end-games').innerHTML = formatGamesHtml(state.games);
    if (!dlgEnd.open) dlgEnd.showModal();
  } else {
    if (dlgEnd.open) dlgEnd.close();

    if (state.gameWinner) {
      const winnerSide = state.gameWinner;
      const loserSide = otherSide(winnerSide);
      document.getElementById('next-game-title').textContent = `Game ${state.gameNumber} Dimenangkan ${getSideDisplayName(state, winnerSide)}`;
      document.getElementById('next-game-desc').textContent =
        `${getSideDisplayName(state, winnerSide)} melayani lebih dulu di Game ${state.gameNumber + 1}.`;

      const doublesPick = document.getElementById('next-game-doubles-pick');
      if (state.mode === 'doubles') {
        doublesPick.classList.remove('hidden');
        const selS = document.getElementById('next-server-right');
        const selR = document.getElementById('next-receiver-right');
        selS.innerHTML = state.pemain[winnerSide]
          .map((n, i) => `<option value="${i}">${escapeHtml(n)}</option>`)
          .join('');
        selR.innerHTML = state.pemain[loserSide]
          .map((n, i) => `<option value="${i}">${escapeHtml(n)}</option>`)
          .join('');
      } else {
        doublesPick.classList.add('hidden');
      }
      if (!dlgNext.open) dlgNext.showModal();
    } else if (dlgNext.open) {
      dlgNext.close();
    }
  }
}

function formatGamesHtml(games) {
  if (!games || games.length === 0) return '<p class="hint-text">Belum ada game selesai.</p>';
  return games.map((g) => {
    const pre = g.preSetScore ? ` (sebelum set: ${g.preSetScore.A}-${g.preSetScore.B}, Set ${g.setPhase.extra})` : '';
    return `<div>Game ${g.gameNumber}: <strong>${g.skor.A} - ${g.skor.B}</strong>${pre}</div>`;
  }).join('');
}

function buildShareText(record) {
  const nameA = record.mode === 'singles' ? record.pemain.A[0] : `${record.pemain.A[0]}/${record.pemain.A[1]}`;
  const nameB = record.mode === 'singles' ? record.pemain.B[0] : `${record.pemain.B[0]}/${record.pemain.B[1]}`;
  const winnerName = record.matchWinner === 'A' ? nameA : (record.matchWinner === 'B' ? nameB : 'Seri');
  const lines = [
    T.shareTitle,
    `${nameA} vs ${nameB}`,
    `Pemenang: ${winnerName} (${record.gameWins.A}-${record.gameWins.B})`,
    ...record.games.map((g) => {
      const pre = g.preSetScore ? ` [sebelum set ${g.preSetScore.A}-${g.preSetScore.B}, Set ${g.setPhase.extra}]` : '';
      return `- Game ${g.gameNumber}: ${g.skor.A}-${g.skor.B}${pre}`;
    }),
  ];
  return lines.join('\n');
}

async function shareMatch(record) {
  const text = buildShareText(record);
  if (navigator.share) {
    try {
      await navigator.share({ title: T.shareTitle, text });
      return;
    } catch {
      // Fallback ke clipboard
    }
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    alert(T.copiedToast);
  } else {
    prompt('Salin hasil:', text);
  }
}

function renderHistory() {
  const list = loadMatchHistory();
  const container = document.getElementById('history-list');
  if (list.length === 0) {
    container.innerHTML = `<p class="hint-text">${T.emptyHistory}</p>`;
    return;
  }

  container.innerHTML = list.map((m) => {
    const nameA = m.mode === 'singles' ? m.pemain.A[0] : `${m.pemain.A[0]} / ${m.pemain.A[1]}`;
    const nameB = m.mode === 'singles' ? m.pemain.B[0] : `${m.pemain.B[0]} / ${m.pemain.B[1]}`;
    const tgl = new Date(m.tanggal).toLocaleString('id-ID');
    const win = m.matchWinner === 'A' ? nameA : (m.matchWinner === 'B' ? nameB : 'Seri');

    return `
      <article class="history-item">
        <div class="row-between">
          <strong>${escapeHtml(nameA)} vs ${escapeHtml(nameB)}</strong>
          <span class="hint-text">${escapeHtml(tgl)}</span>
        </div>
        <div>Pemenang: <strong>${escapeHtml(win)}</strong> (Game ${m.gameWins.A} - ${m.gameWins.B})</div>
        <div class="summary-games">${formatGamesHtml(m.games)}</div>
        <div class="inline-group">
          <button class="btn btn-sm btn-secondary" data-share-id="${m.id}" type="button">Bagikan hasil</button>
          <button class="btn btn-sm btn-danger" data-delete-id="${m.id}" type="button">Hapus</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderSettings() {
  document.getElementById('set-theme').value = settings.theme;
  document.getElementById('set-vibrate').checked = settings.vibrate;
  document.getElementById('set-sound').checked = settings.sound;
  document.getElementById('set-wakelock').checked = settings.wakeLock;
  document.getElementById('set-default-bestof').value = String(settings.bestOf);
  document.getElementById('set-table-json').value = JSON.stringify(settings.tabelSetting, null, 2);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.nav;
    if (target === 'board' && !historyStack) {
      alert('Mulai pertandingan baru terlebih dahulu.');
      switchView('setup');
      return;
    }
    switchView(target);
  });
});

document.getElementById('match-type').addEventListener('change', updateSetupTypeFields);
document.getElementById('custom-mode').addEventListener('change', updateSetupTypeFields);
document.getElementById('best-of').value = String(settings.bestOf);

document.getElementById('btn-swap-a-pos').addEventListener('click', () => {
  const a1 = document.getElementById('name-a1');
  const a2 = document.getElementById('name-a2');
  [a1.value, a2.value] = [a2.value, a1.value];
});

document.getElementById('btn-swap-b-pos').addEventListener('click', () => {
  const b1 = document.getElementById('name-b1');
  const b2 = document.getElementById('name-b2');
  [b1.value, b2.value] = [b2.value, b1.value];
});

document.getElementById('btn-coin-toss').addEventListener('click', () => {
  const pick = Math.random() < 0.5 ? 'A' : 'B';
  document.querySelector(`input[name="first-serve"][value="${pick}"]`).checked = true;
  document.getElementById('toss-result').textContent = `Hasil undian acak: Pihak ${pick} servis pertama.`;
});

document.getElementById('setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const matchType = document.getElementById('match-type').value;
  const isCustom = matchType === 'CUSTOM';
  const mode = isCustom ? document.getElementById('custom-mode').value : MATCH_TYPES[matchType].mode;
  const target = isCustom
    ? Number(document.getElementById('custom-target').value) || 15
    : MATCH_TYPES[matchType].target;
  const bestOf = Number(document.getElementById('best-of').value) || 3;
  const serving = document.querySelector('input[name="first-serve"]:checked').value;

  const a1 = document.getElementById('name-a1').value.trim() || 'Pemain A1';
  const a2 = document.getElementById('name-a2').value.trim() || 'Pemain A2';
  const b1 = document.getElementById('name-b1').value.trim() || 'Pemain B1';
  const b2 = document.getElementById('name-b2').value.trim() || 'Pemain B2';

  const initialState = createGame({
    matchType,
    mode,
    target,
    bestOf,
    serving,
    tabelSetting: settings.tabelSetting,
    tabelTukarSisi: settings.tabelTukarSisi,
    pemain: mode === 'singles' ? { A: [a1], B: [b1] } : { A: [a1, a2], B: [b1, b2] },
    posisi: mode === 'singles' ? { A: [0, null], B: [0, null] } : setupPos,
  });

  historyStack = createHistory(initialState);
  matchSavedToHistory = false;
  switchView('board');
  renderBoard();
});

document.getElementById('btn-resume').addEventListener('click', () => {
  const saved = loadActiveMatch();
  if (saved && saved.history) {
    historyStack = saved.history;
    matchSavedToHistory = Boolean(historyStack.present.matchWinner);
    switchView('board');
    renderBoard();
  }
});

document.getElementById('scoreboard-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rally]');
  if (!btn || !historyStack) return;
  const side = btn.dataset.rally;
  const next = rallyWon(historyStack.present, side);
  if (next !== historyStack.present) {
    historyStack = pushHistory(historyStack, next);
    triggerVibrate(35);
    playBeep(next.lastEvent?.type === 'POINT' ? 740 : 480, 65);
    renderBoard();
  }
});

document.getElementById('btn-undo').addEventListener('click', () => {
  if (!historyStack) return;
  historyStack = undoHistory(historyStack);
  renderBoard();
});

document.getElementById('btn-redo').addEventListener('click', () => {
  if (!historyStack) return;
  historyStack = redoHistory(historyStack);
  renderBoard();
});

document.getElementById('btn-flip-sides').addEventListener('click', () => {
  flipDisplaySides = !flipDisplaySides;
  renderBoard();
});

document.getElementById('btn-dismiss-change-ends').addEventListener('click', () => {
  if (!historyStack) return;
  historyStack = pushHistory(historyStack, dismissChangeEnds(historyStack.present));
  renderBoard();
});

document.getElementById('btn-reset-game').addEventListener('click', () => {
  if (!historyStack || !confirm(T.confirmResetGame)) return;
  const cur = historyStack.present;
  const reset = createGame({
    matchType: cur.matchType,
    mode: cur.mode,
    target: cur.target,
    bestOf: cur.bestOf,
    serving: cur.serving,
    tabelSetting: cur.tabelSetting,
    tabelTukarSisi: cur.tabelTukarSisi,
    pemain: cur.pemain,
  });
  historyStack = pushHistory(historyStack, {
    ...reset,
    games: cur.games,
    gameNumber: cur.gameNumber,
    gameWins: cur.gameWins,
  });
  renderBoard();
});

document.getElementById('btn-end-match').addEventListener('click', () => {
  if (!historyStack || !confirm(T.confirmEndMatch)) return;
  const ended = endMatchEarly(historyStack.present);
  historyStack = pushHistory(historyStack, ended);
  renderBoard();
});

document.getElementById('btn-choose-set').addEventListener('click', () => {
  if (!historyStack || !historyStack.present.pendingSetChoice) return;
  const side = historyStack.present.pendingSetChoice.side;
  historyStack = pushHistory(historyStack, chooseSet(historyStack.present, side, 'set'));
  playBeep(880, 90);
  renderBoard();
});

document.getElementById('btn-choose-continue').addEventListener('click', () => {
  if (!historyStack || !historyStack.present.pendingSetChoice) return;
  const side = historyStack.present.pendingSetChoice.side;
  historyStack = pushHistory(historyStack, chooseSet(historyStack.present, side, 'continue'));
  renderBoard();
});

document.getElementById('btn-start-next-game').addEventListener('click', () => {
  if (!historyStack) return;
  const cur = historyStack.present;
  const opts = cur.mode === 'doubles'
    ? {
        serverRightIdx: Number(document.getElementById('next-server-right').value),
        receiverRightIdx: Number(document.getElementById('next-receiver-right').value),
      }
    : {};
  historyStack = pushHistory(historyStack, startNextGame(cur, opts));
  renderBoard();
});

document.getElementById('btn-share-result').addEventListener('click', () => {
  if (!historyStack) return;
  shareMatch(historyStack.present);
});

document.getElementById('btn-finish-close').addEventListener('click', () => {
  document.getElementById('dialog-match-end').close();
  historyStack = null;
  switchView('history');
});

document.getElementById('history-list').addEventListener('click', (e) => {
  const shareId = e.target.dataset.shareId;
  const delId = e.target.dataset.deleteId;
  if (shareId) {
    const rec = loadMatchHistory().find((m) => m.id === shareId);
    if (rec) shareMatch(rec);
  } else if (delId) {
    deleteMatchRecord(delId);
    renderHistory();
  }
});

document.getElementById('btn-export-json').addEventListener('click', () => {
  const blob = new Blob([exportHistoryJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `riwayat-bulutangkis-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('input-import-json').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const res = importHistoryJson(text);
    alert(`Berhasil mengimpor ${res.added} pertandingan.`);
    renderHistory();
  } catch (err) {
    alert(`Gagal impor JSON: ${err.message}`);
  }
  e.target.value = '';
});

document.getElementById('set-theme').addEventListener('change', (e) => {
  settings.theme = e.target.value;
  saveSettings(settings);
  applyTheme();
});

document.getElementById('set-vibrate').addEventListener('change', (e) => {
  settings.vibrate = e.target.checked;
  saveSettings(settings);
});

document.getElementById('set-sound').addEventListener('change', (e) => {
  settings.sound = e.target.checked;
  saveSettings(settings);
});

document.getElementById('set-wakelock').addEventListener('change', (e) => {
  settings.wakeLock = e.target.checked;
  saveSettings(settings);
  const boardVisible = !views.board.classList.contains('hidden');
  syncWakeLock(boardVisible ? 'board' : 'other');
});

document.getElementById('set-default-bestof').addEventListener('change', (e) => {
  settings.bestOf = Number(e.target.value) || 3;
  saveSettings(settings);
});

document.getElementById('btn-save-table').addEventListener('click', () => {
  try {
    const parsed = JSON.parse(document.getElementById('set-table-json').value);
    settings.tabelSetting = parsed;
    saveSettings(settings);
    alert('Tabel setting disimpan.');
  } catch (err) {
    alert(`Format JSON tidak valid: ${err.message}`);
  }
});

document.getElementById('btn-reset-table').addEventListener('click', () => {
  settings.tabelSetting = DEFAULT_SETTING_TABLE;
  saveSettings(settings);
  renderSettings();
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('install-banner').classList.remove('hidden');
});

async function promptInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.getElementById('install-banner').classList.add('hidden');
  } else {
    alert('Buka Menu Chrome (⋮) di pojok kanan atas → pilih "Instal aplikasi" atau "Tambahkan ke layar utama".');
  }
}

document.getElementById('btn-install-app').addEventListener('click', promptInstall);
document.getElementById('btn-settings-install').addEventListener('click', promptInstall);
document.getElementById('btn-dismiss-install').addEventListener('click', () => {
  document.getElementById('install-banner').classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      if (reg.waiting) {
        waitingWorker = reg.waiting;
        document.getElementById('update-banner').classList.remove('hidden');
      }
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = newWorker;
            document.getElementById('update-banner').classList.remove('hidden');
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    } catch {
      // Abaikan jika SW gagal registrasi
    }
  });
}

document.getElementById('btn-reload-sw').addEventListener('click', () => {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  } else {
    window.location.reload();
  }
});

applyTheme();
renderSettings();
updateSetupTypeFields();

const params = new URLSearchParams(window.location.search);
const initialView = params.get('view');
if (initialView === 'history') {
  switchView('history');
} else {
  const saved = loadActiveMatch();
  if (saved && saved.history && saved.history.present && !saved.history.present.matchWinner && initialView !== 'setup') {
    historyStack = saved.history;
    switchView('board');
    renderBoard();
  } else {
    switchView('setup');
  }
}