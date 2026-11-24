import { ColonyBrain, MODEL_KEYS, STAT_KEYS } from './engine.js';

const STORAGE_KEY = 'ant-wars.picnic.v1';
export function loadNotebook(storage) {
  let data = {};
  try { data = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}') || {}; } catch {}
  if (data.version !== 1) data = {};
  const record = ['moss','ember','draw'].map((_, i) => {
    const n = data.record?.[i];
    return Number.isSafeInteger(n) && n >= 0 && n < 1e7 ? n : 0;
  });
  return { moss: new ColonyBrain(data.moss), ember: new ColonyBrain(data.ember), record, sound: data.sound === true };
}

export function saveNotebook(storage, book) {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, moss: book.moss.save(), ember: book.ember.save(), record: book.record, sound: book.sound }));
    return true;
  } catch { return false; }
}

// A challenge contains numeric policy data only. Indexing a fixed schema keeps links small.
export function encodeChallenge(brain) {
  const history = brain.save();
  const entries = MODEL_KEYS.flatMap((key, index) => {
    const entry = history.table[key];
    return entry ? [[index, entry[0], Math.round(entry[1] * 1000)]] : [];
  });
  const payload = [1, entries, STAT_KEYS.map(key => history.stats[key])];
  return btoa(JSON.stringify(payload)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
}

export function decodeChallenge(encoded) {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const payload = JSON.parse(atob(encoded.replaceAll('-','+').replaceAll('_','/')));
    if (!Array.isArray(payload) || payload.length !== 3 || payload[0] !== 1) return null;
    const [, entries, values] = payload;
    if (!Array.isArray(entries) || entries.length > MODEL_KEYS.length || !Array.isArray(values) || values.length !== STAT_KEYS.length) return null;
    const table = {}, stats = {};
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 3) return null;
      const [key, n, value] = entry;
      if (!Number.isInteger(key) || !MODEL_KEYS[key] || table[MODEL_KEYS[key]] || !Number.isInteger(n) || n < 1 || n > 1e7 ||
        !Number.isInteger(value) || Math.abs(value) > 2000) return null;
      table[MODEL_KEYS[key]] = [n, value / 1000];
    }
    for (let i=0;i<values.length;i++) {
      if (!Number.isSafeInteger(values[i]) || values[i]<0 || values[i]>1e8) return null;
      stats[STAT_KEYS[i]]=values[i];
    }
    return new ColonyBrain({ version:1, table, stats }, true);
  } catch { return null; }
}
