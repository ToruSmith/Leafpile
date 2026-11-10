// 用 IndexedDB 記住「最近開啟的本機書庫」(只有 Chrome / Edge 的資料夾 handle 能記住)。
// 存的是資料夾的存取權杖,不是檔案內容;下次開啟時,瀏覽器會再詢問一次讀取權限。

const DB = 'leafpile', STORE = 'libraries', VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function listRecent() {
  try {
    const all = await tx('readonly', s => s.getAll());
    return (all || []).sort((a, b) => b.lastOpened - a.lastOpened);
  } catch { return []; }
}

export async function remember(handle) {
  const recent = await listRecent();
  for (const r of recent) {
    try { if (await r.handle.isSameEntry(handle)) { await tx('readwrite', s => s.put({ ...r, name: handle.name, lastOpened: Date.now() })); return r.id; } } catch { /* 舊紀錄失效 */ }
  }
  const id = Math.random().toString(36).slice(2, 8);
  await tx('readwrite', s => s.put({ id, name: handle.name, handle, lastOpened: Date.now() }));
  return id;
}

export async function getRecent(id) {
  try { return await tx('readonly', s => s.get(id)); } catch { return null; }
}

export async function forget(id) {
  await tx('readwrite', s => s.delete(id));
}

/** 確認讀取權限;沒有權限時必須在使用者點擊後呼叫 request = true。 */
export async function ensurePermission(handle, request = false) {
  const opts = { mode: 'read' };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission?.(opts)) === 'granted';
}
