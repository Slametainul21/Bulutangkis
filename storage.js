// storage.js — Penyimpanan lokal (localStorage) untuk pertandingan aktif, riwayat, dan pengaturan

import { DEFAULT_SETTING_TABLE, DEFAULT_CHANGE_ENDS_TABLE } from './engine.js';

const KEYS = {
  ACTIVE: 'skor_bulutangkis_active_v1',
  HISTORY: 'skor_bulutangkis_history_v1',
  SETTINGS: 'skor_bulutangkis_settings_v1',
};

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  vibrate: true,
  sound: false,
  wakeLock: true,
  bestOf: 3,
  lang: 'id',
  tabelSetting: DEFAULT_SETTING_TABLE,
  tabelTukarSisi: DEFAULT_CHANGE_ENDS_TABLE,
};

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function loadSettings() {
  const saved = safeParse(localStorage.getItem(KEYS.SETTINGS), {});
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    tabelSetting: saved.tabelSetting || DEFAULT_SETTING_TABLE,
    tabelTukarSisi: saved.tabelTukarSisi || DEFAULT_CHANGE_ENDS_TABLE,
  };
}

export function saveSettings(settings) {
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
}

export function loadActiveMatch() {
  return safeParse(localStorage.getItem(KEYS.ACTIVE), null);
}

export function saveActiveMatch(historyStack) {
  if (!historyStack || !historyStack.present) return;
  const payload = {
    savedAt: new Date().toISOString(),
    history: historyStack,
  };
  localStorage.setItem(KEYS.ACTIVE, JSON.stringify(payload));
}

export function clearActiveMatch() {
  localStorage.removeItem(KEYS.ACTIVE);
}

export function loadMatchHistory() {
  const list = safeParse(localStorage.getItem(KEYS.HISTORY), []);
  return Array.isArray(list) ? list : [];
}

export function saveMatchRecord(state) {
  const list = loadMatchHistory();
  const games = [...state.games];
  if (!state.gameWinner && (state.skor.A > 0 || state.skor.B > 0)) {
    games.push({
      gameNumber: state.gameNumber,
      skor: { ...state.skor },
      preSetScore: state.preSetScore ? { ...state.preSetScore } : null,
      setPhase: state.setPhase ? { ...state.setPhase } : null,
      winner: state.skor.A === state.skor.B ? null : (state.skor.A > state.skor.B ? 'A' : 'B'),
      incomplete: true,
    });
  }

  const record = {
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    tanggal: new Date().toISOString(),
    matchType: state.matchType,
    mode: state.mode,
    target: state.target,
    bestOf: state.bestOf,
    pemain: state.pemain,
    games,
    gameWins: state.gameWins,
    matchWinner: state.matchWinner,
  };

  const updated = [record, ...list];
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(updated));
  return record;
}

export function deleteMatchRecord(id) {
  const list = loadMatchHistory().filter((item) => item.id !== id);
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(list));
  return list;
}

export function exportHistoryJson() {
  return JSON.stringify(loadMatchHistory(), null, 2);
}

export function importHistoryJson(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    throw new Error('Format JSON riwayat harus berupa array.');
  }
  const existing = loadMatchHistory();
  const existingIds = new Set(existing.map((m) => m.id));
  const merged = [...existing];
  let added = 0;

  for (const item of parsed) {
    if (item && typeof item === 'object' && item.pemain && Array.isArray(item.games)) {
      const id = item.id && !existingIds.has(item.id)
        ? item.id
        : `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      merged.push({ ...item, id });
      existingIds.add(id);
      added += 1;
    }
  }

  merged.sort((a, b) => new Date(b.tanggal || 0) - new Date(a.tanggal || 0));
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(merged));
  return { total: merged.length, added };
}