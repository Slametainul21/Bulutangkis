// engine.test.js — Pengujian unit & property test untuk engine.js (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTING_TABLE,
  createGame,
  rallyWon,
  chooseSet,
  startNextGame,
  getServingInfo,
  createHistory,
  pushHistory,
  undoHistory,
  redoHistory,
} from './engine.js';

test('T1: Tunggal dasar (A servis dari kanan 0-0, urutan pemenang reli: A, A, B, B)', () => {
  let state = createGame({
    matchType: 'MS',
    mode: 'singles',
    target: 15,
    serving: 'A',
    pemain: { A: ['Andi'], B: ['Budi'] },
  });

  let info = getServingInfo(state);
  assert.equal(info.servingSide, 'A');
  assert.equal(info.court, 'kanan');

  state = rallyWon(state, 'A');
  assert.deepEqual(state.skor, { A: 1, B: 0 });
  info = getServingInfo(state);
  assert.equal(info.servingSide, 'A');
  assert.equal(info.court, 'kiri');

  state = rallyWon(state, 'A');
  assert.deepEqual(state.skor, { A: 2, B: 0 });
  info = getServingInfo(state);
  assert.equal(info.servingSide, 'A');
  assert.equal(info.court, 'kanan');

  state = rallyWon(state, 'B');
  assert.deepEqual(state.skor, { A: 2, B: 0 });
  info = getServingInfo(state);
  assert.equal(info.servingSide, 'B');
  assert.equal(info.court, 'kanan');

  state = rallyWon(state, 'B');
  assert.deepEqual(state.skor, { A: 2, B: 1 });
  info = getServingInfo(state);
  assert.equal(info.servingSide, 'B');
  assert.equal(info.court, 'kiri');
});

test('T2: Ganda alur lengkap (A1,A2 vs B1,B2; urutan pemenang reli: A, B, A, A, A)', () => {
  let state = createGame({
    matchType: 'MD',
    mode: 'doubles',
    target: 15,
    serving: 'A',
    pemain: { A: ['A1', 'A2'], B: ['B1', 'B2'] },
    posisi: { A: [0, 1], B: [0, 1] },
  });

  let info = getServingInfo(state);
  assert.equal(info.serverName, 'A1');
  assert.equal(info.court, 'kanan');
  assert.equal(info.receiverName, 'B1');

  // (1) A menang: A1-B0; A bertukar sisi (kanan=A2, kiri=A1); A1 servis dari KIRI ke B2
  state = rallyWon(state, 'A');
  assert.deepEqual(state.skor, { A: 1, B: 0 });
  assert.deepEqual(state.posisi.A, [1, 0]);
  info = getServingInfo(state);
  assert.equal(info.servingSide, 'A');
  assert.equal(info.serverName, 'A1');
  assert.equal(info.court, 'kiri');
  assert.equal(info.receiverName, 'B2');

  // (2) B menang: giliran pertama hanya satu -> service over ke B1 dari KANAN, penerima A2
  state = rallyWon(state, 'B');
  assert.deepEqual(state.skor, { A: 1, B: 0 });
  assert.equal(state.firstTurn, false);
  info = getServingInfo(state);
  assert.equal(info.servingSide, 'B');
  assert.equal(info.serverNo, 1);
  assert.equal(info.serverName, 'B1');
  assert.equal(info.court, 'kanan');
  assert.equal(info.receiverName, 'A2');

  // (3) A menang: second service -> B2 dari KIRI, penerima A1
  state = rallyWon(state, 'A');
  assert.deepEqual(state.skor, { A: 1, B: 0 });
  info = getServingInfo(state);
  assert.equal(info.servingSide, 'B');
  assert.equal(info.serverNo, 2);
  assert.equal(info.serverName, 'B2');
  assert.equal(info.court, 'kiri');
  assert.equal(info.receiverName, 'A1');

  // (4) A menang: service over -> A2 dari KANAN, penerima B1
  state = rallyWon(state, 'A');
  assert.deepEqual(state.skor, { A: 1, B: 0 });
  info = getServingInfo(state);
  assert.equal(info.servingSide, 'A');
  assert.equal(info.serverNo, 1);
  assert.equal(info.serverName, 'A2');
  assert.equal(info.court, 'kanan');
  assert.equal(info.receiverName, 'B1');

  // (5) A menang: A2-B0; A bertukar sisi (kanan=A1, kiri=A2); A2 servis dari KIRI ke B2
  state = rallyWon(state, 'A');
  assert.deepEqual(state.skor, { A: 2, B: 0 });
  assert.deepEqual(state.posisi.A, [0, 1]);
  info = getServingInfo(state);
  assert.equal(info.servingSide, 'A');
  assert.equal(info.serverName, 'A2');
  assert.equal(info.court, 'kiri');
  assert.equal(info.receiverName, 'B2');
});

test('T3: Penerima tidak pernah mencetak poin (tunggal dan ganda)', () => {
  let s1 = createGame({ matchType: 'MS', serving: 'A' });
  s1 = rallyWon(s1, 'B');
  assert.deepEqual(s1.skor, { A: 0, B: 0 });
  s1 = rallyWon(s1, 'A');
  assert.deepEqual(s1.skor, { A: 0, B: 0 });

  let s2 = createGame({ matchType: 'MD', serving: 'A' });
  s2 = rallyWon(s2, 'B');
  assert.deepEqual(s2.skor, { A: 0, B: 0 });
  s2 = rallyWon(s2, 'A');
  assert.deepEqual(s2.skor, { A: 0, B: 0 });
  s2 = rallyWon(s2, 'A');
  assert.deepEqual(s2.skor, { A: 0, B: 0 });
});

test('T4: Setting 15 poin (13-13 SET 5 vs Lanjut, 14-14 SET 3 vs Lanjut)', () => {
  const base13 = {
    ...createGame({ matchType: 'MD', serving: 'B' }),
    skor: { A: 13, B: 12 },
    serving: 'B',
    firstTurn: false,
  };

  const tied13 = rallyWon(base13, 'B');
  assert.deepEqual(tied13.skor, { A: 13, B: 13 });
  assert.ok(tied13.pendingSetChoice);
  assert.equal(tied13.pendingSetChoice.side, 'A');
  assert.equal(tied13.pendingSetChoice.extra, 5);

  let set5State = chooseSet(tied13, 'A', 'set');
  assert.deepEqual(set5State.skor, { A: 0, B: 0 });
  assert.deepEqual(set5State.preSetScore, { A: 13, B: 13 });
  assert.equal(set5State.pendingSetChoice, null);
  assert.equal(set5State.setPhase.extra, 5);

  for (let i = 0; i < 5; i++) {
    set5State = rallyWon(set5State, 'B');
  }
  assert.equal(set5State.gameWinner, 'B');

  let cont13 = chooseSet(tied13, 'A', 'continue');
  assert.equal(cont13.pendingSetChoice, null);
  assert.equal(cont13.setPhase, null);
  cont13 = rallyWon(cont13, 'B');
  assert.deepEqual(cont13.skor, { A: 13, B: 14 });
  cont13 = rallyWon(cont13, 'A');
  cont13 = rallyWon(cont13, 'A');
  const tied14 = rallyWon(cont13, 'A');
  assert.deepEqual(tied14.skor, { A: 14, B: 14 });
  assert.ok(tied14.pendingSetChoice);
  assert.equal(tied14.pendingSetChoice.side, 'B');
  assert.equal(tied14.pendingSetChoice.extra, 3);

  let cont14 = chooseSet(tied14, 'B', 'continue');
  cont14 = rallyWon(cont14, 'A');
  assert.deepEqual(cont14.skor, { A: 15, B: 14 });
  assert.equal(cont14.gameWinner, 'A');
});

test('T5: Game 11 poin (9-9 -> SET 3, 10-10 -> SET 2) dan tabel setting bisa diubah', () => {
  const base9 = {
    ...createGame({ matchType: 'WS', serving: 'A' }),
    skor: { A: 8, B: 9 },
    serving: 'A',
  };
  const tied9 = rallyWon(base9, 'A');
  assert.equal(tied9.pendingSetChoice.side, 'B');
  assert.equal(tied9.pendingSetChoice.extra, 3);

  const set3 = chooseSet(tied9, 'B', 'set');
  assert.equal(set3.setPhase.extra, 3);
  assert.deepEqual(set3.skor, { A: 0, B: 0 });

  let cont9 = chooseSet(tied9, 'B', 'continue');
  cont9 = rallyWon(cont9, 'A');
  cont9 = rallyWon(cont9, 'B');
  const tied10 = rallyWon(cont9, 'B');
  assert.equal(tied10.pendingSetChoice.side, 'A');
  assert.equal(tied10.pendingSetChoice.extra, 2);

  const customTable = {
    ...DEFAULT_SETTING_TABLE,
    11: { 9: 4, 10: 5 },
  };
  const baseCustom = {
    ...createGame({ matchType: 'WS', serving: 'A', tabelSetting: customTable }),
    skor: { A: 8, B: 9 },
    serving: 'A',
  };
  const tiedCustom = rallyWon(baseCustom, 'A');
  assert.equal(tiedCustom.pendingSetChoice.extra, 4);
});

test('T6: Undo/redo 10 reli acak kembali persis ke state awal dan akhir', () => {
  let hist = createHistory(createGame({ matchType: 'MD', serving: 'A' }));
  const initialState = hist.present;

  const sequence = ['A', 'B', 'A', 'B', 'B', 'A', 'A', 'B', 'A', 'B'];
  for (const w of sequence) {
    const next = rallyWon(hist.present, w);
    hist = pushHistory(hist, next);
  }
  const finalState = hist.present;

  for (let i = 0; i < 10; i++) {
    hist = undoHistory(hist);
  }
  assert.deepEqual(hist.present, initialState);

  for (let i = 0; i < 10; i++) {
    hist = redoHistory(hist);
  }
  assert.deepEqual(hist.present, finalState);
});

test('T7: Ganda game berikutnya — pemenang game 1 servis dulu dan firstTurn bernilai true', () => {
  let state = {
    ...createGame({ matchType: 'MD', serving: 'A' }),
    skor: { A: 14, B: 5 },
    serving: 'A',
  };
  state = rallyWon(state, 'A');
  assert.equal(state.gameWinner, 'A');
  assert.equal(state.games.length, 1);

  const g2 = startNextGame(state, { serverRightIdx: 1, receiverRightIdx: 0 });
  assert.equal(g2.gameNumber, 2);
  assert.equal(g2.serving, 'A');
  assert.equal(g2.firstTurn, true);
  assert.equal(g2.serverNo, 1);
  assert.deepEqual(g2.skor, { A: 0, B: 0 });
  assert.deepEqual(g2.posisi.A, [1, 0]);
  assert.deepEqual(g2.posisi.B, [0, 1]);

  const afterLoss = rallyWon(g2, 'B');
  assert.equal(afterLoss.serving, 'B');
  assert.equal(afterLoss.firstTurn, false);
  assert.equal(afterLoss.serverNo, 1);
});

test('Property test: 1000 reli acak — poin tidak pernah turun dan hanya penyerve yang skornya bertambah', () => {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  let state = createGame({ matchType: 'MD', bestOf: 3, target: 15 });
  for (let i = 0; i < 1000; i++) {
    if (state.matchWinner) {
      state = createGame({ matchType: rand() < 0.5 ? 'MS' : 'MD', bestOf: 3 });
    } else if (state.gameWinner) {
      state = startNextGame(state);
    } else if (state.pendingSetChoice) {
      const choice = rand() < 0.5 ? 'set' : 'continue';
      state = chooseSet(state, state.pendingSetChoice.side, choice);
      continue;
    }

    const prevSkor = { ...state.skor };
    const prevServing = state.serving;
    const winner = rand() < 0.5 ? 'A' : 'B';
    const next = rallyWon(state, winner);

    if (!next.setPhase || state.setPhase) {
      assert.ok(next.skor.A >= prevSkor.A, 'Skor A tidak boleh turun');
      assert.ok(next.skor.B >= prevSkor.B, 'Skor B tidak boleh turun');
    }

    if (winner !== prevServing) {
      assert.deepEqual(next.skor, prevSkor, 'Penerima tidak boleh menambah poin');
    } else {
      assert.equal(next.skor[prevServing], prevSkor[prevServing] + 1, 'Penyerve menang reli harus +1');
      const other = prevServing === 'A' ? 'B' : 'A';
      assert.equal(next.skor[other], prevSkor[other], 'Pihak lain tidak boleh berubah skornya');
    }

    state = next;
  }
});