// 離線快取:只快取「網站本身」(遊戲機),不快取你的簡報內容。
//
// 部署時 scripts/build-catalog.mjs 會產生 shell-manifest.js(檔案清單 + 內容雜湊)。
// 雜湊變了 → 瀏覽器安裝新版 service worker → 一次預先下載整套新檔案 → 刪除舊快取。
// 本機開發沒有 shell-manifest.js 時,退回「先用快取、背景更新」。

let SHELL = null;
try { importScripts('shell-manifest.js'); SHELL = self.SHELL; } catch { /* 本機開發 */ }

const PREFIX = 'leafpile-shell';
const CACHE = SHELL ? `${PREFIX}-${SHELL.version}` : `${PREFIX}-dev`;
const OFFLINE = 'offline.html';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    if (SHELL) {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.files.map(f => new Request(f, { cache: 'reload' })));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isShell = url => url.pathname.endsWith('/') || /\.(html|js|css|svg|ico|webmanifest)$/.test(url.pathname);

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/content/') || url.pathname.endsWith('/catalog.json')) return; // 簡報內容一律走網路
  if (e.request.mode === 'navigate') return e.respondWith(page(e.request));
  if (!isShell(url)) return;
  e.respondWith(asset(e.request));
});

/** 頁面:先試網路(拿到最新版),沒網路用快取,再不行顯示離線說明頁。 */
async function page(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && !SHELL) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./')) || (await cache.match(OFFLINE)) || offlineResponse();
  }
}

/** 程式與樣式:有預先快取就直接用;本機開發時背景更新。 */
async function asset(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached && SHELL) return cached;
  const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
  if (cached) { fresh.catch(() => {}); return cached; }
  return fresh.catch(() => new Response('', { status: 504, statusText: 'Offline' }));
}

function offlineResponse() {
  return new Response('<!DOCTYPE html><meta charset="utf-8"><title>Offline</title><p style="font:16px system-ui;padding:40px">Offline. / 目前沒有網路。</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
