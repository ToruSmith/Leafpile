// Google Drive 書庫(實驗):書庫就是使用者 Drive 裡的一個資料夾,介面與 HandleSource 相同。
//
// 權限只用 drive.file:Leafpile 只看得到「自己建立的檔案」,使用者 Drive 裡其他東西完全碰不到。
// 所以一次列出「看得到的全部檔案」就等於整個書庫,用 parents 自己組出路徑,不必一層一層問。
//
// 這個檔案不碰 DOM、不載入 Google 的腳本:連線(fetch)與通行證(auth)都由呼叫端傳進來,
// 所以可以在 Node 裡用模擬的 Drive 測試(tests/drive.test.mjs)。
//
//   auth.token()   → 目前的通行證(可能已過期)
//   auth.renew()   → 重新取得通行證(可能要使用者按一下);拿不到就丟出 'denied'
//
// 安全規則與 HandleSource 相同:只寫 .md/.yml/.canvas(與 writeFile 收的幾種)、寫之前比對狀態、
// 刪除一律是搬到 _archive/。Drive 的搬移只是改「上層資料夾」,一個動作完成,不必複製再比對。

import { checkPath, BINARY_EXT, FILE_LIMIT, HTML_LIMIT } from './sources.js';
import { trashablePath, treePath, archivePath } from '../core/trash.js';

export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,parents,modifiedTime,size,trashed';
const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const MIME = { md: 'text/markdown', yml: 'text/yaml', yaml: 'text/yaml', canvas: 'application/json', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', pdf: 'application/pdf', html: 'text/html', htm: 'text/html' };
export const mimeOf = name => MIME[(name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()] || 'application/octet-stream';

/** 同時最多跑 n 個(預設 4):比一個一個快好幾倍,又不會快到被 Google 限速。結果照原本順序。 */
export async function pool(items, fn, n = 4) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** Google 要我們「等一下再試」的回應:429、5xx,以及原因是限速的 403(其他 403 是沒有權限,不重試)。 */
async function isRateLimited(res) {
  if (res.status === 429 || res.status >= 500) return true;
  if (res.status !== 403) return false;
  try { return /rate ?limit/i.test(JSON.stringify((await res.clone().json())?.error || '')); } catch { return false; }
}

/**
 * 呼叫 Drive API。所有讀寫(存檔、匯入、分享)都經過這裡:
 *   - 401:通行證過期,重新取得一次再試;
 *   - 被限速(429、限速的 403、5xx):照 Google 建議等 1、2、4、8、16 秒(加一點隨機)再試,最多 5 次;
 *   - 其他錯誤轉成 Leafpile 認得的訊息('missing'、'denied'、'not shared')。
 * sleep 可以換掉,測試時不必真的等。
 */
export function driveClient({ fetch = globalThis.fetch.bind(globalThis), auth = null, apiKey = '', sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 5 } = {}) {
  async function call(url, init = {}, renew = true, attempt = 0) {
    const headers = { ...(init.headers || {}) };
    let href = url;
    if (auth) headers.Authorization = `Bearer ${await auth.token()}`;
    else if (apiKey) href += (href.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(apiKey);
    const res = await fetch(href, { ...init, headers });
    if (res.status === 401 && auth && renew) { await auth.renew(); return call(url, init, false, attempt); }
    if (attempt < retries && await isRateLimited(res)) {
      await sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 500));
      return call(url, init, renew, attempt + 1);
    }
    if (res.status === 404) throw new Error('missing');
    if (res.status === 401 || res.status === 403) throw new Error(auth ? 'denied' : 'not shared');
    if (!res.ok) throw new Error(`drive ${res.status}`);
    return res;
  }
  return {
    call,
    json: async (url, init) => (await call(url, init)).json(),
    /** 列出符合條件的所有檔案(自動翻頁)。 */
    async listAll(query) {
      const out = [];
      let page = '';
      do {
        const r = await (await call(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(`nextPageToken,files(${FIELDS})`)}&pageSize=1000&spaces=drive${page ? '&pageToken=' + encodeURIComponent(page) : ''}`)).json();
        out.push(...(r.files || []));
        page = r.nextPageToken || '';
      } while (page);
      return out;
    },
    meta: id => call(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`).then(r => r.json()),
    media: id => call(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`),
  };
}

/** 找到(或建立)使用者 Drive 根目錄下名為 name 的書庫資料夾,回傳它的 id。 */
export async function findOrCreateRoot(client, name = 'Leafpile') {
  const found = await client.listAll(`name = ${q(name)} and mimeType = '${FOLDER}' and 'root' in parents and trashed = false`);
  if (found.length) return found.sort((a, b) => a.modifiedTime < b.modifiedTime ? 1 : -1)[0].id;
  const r = await client.json(`${DRIVE_API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: ['root'] }) });
  return r.id;
}

export class DriveSource {
  /** rootId:書庫資料夾的 id。client:driveClient({ auth })。 */
  constructor(rootId, client, label = 'Google Drive') {
    this.rootId = rootId;
    this.client = client;
    this.label = label;
    this.kind = 'drive';
    this.urls = new Map();
    this.index = null; // Promise<{ byPath: Map<path, file>, children: Map<folderId, file[]> }>
  }

  get canWrite() { return true; }
  async ensureWritable() { return true; } // 登入時已經同意;通行證過期由 client 處理

  refresh() { this.index = null; }

  /** 一次列出看得到的所有檔案,組成「路徑 → 檔案」。同一個資料夾有同名檔時取最新的那個。 */
  load() {
    this.index ||= this.client.listAll('trashed = false').then(files => this.build(files)).catch(e => { this.index = null; throw e; });
    return this.index;
  }

  /** 檔案清單的指紋:任何檔案新增、刪除、搬移、修改都會改變它。 */
  static signature(files) {
    return files.filter(f => !f.trashed).map(f => `${f.id}:${f.modifiedTime}:${(f.parents || []).join(',')}:${f.name}`).sort().join('|');
  }

  /**
   * 向 Drive 確認書庫有沒有被別處(另一台裝置)改過。有的話換成新的清單並回傳 true。
   * 比對的是「Drive 給的原始清單」:自己寫檔時 remember() 會同步更新,所以自己的修改不算變化。
   * 只花一次「列清單」的請求;用在切回分頁時。
   */
  async changed() {
    if (!this.index) return false; // 還沒打開過:下次打開本來就會讀新的
    await this.index;
    const files = await this.client.listAll('trashed = false');
    if (DriveSource.signature(files) === DriveSource.signature([...this.raw.values()])) return false;
    this.index = Promise.resolve(this.build(files));
    return true;
  }

  build(all) {
    {
      const files = all.filter(f => !f.trashed);
      this.raw = new Map(files.map(f => [f.id, f])); // Drive 給的原始清單(changed() 比對用)
      const children = new Map();
      for (const f of files) for (const p of f.parents || []) {
        if (!children.has(p)) children.set(p, []);
        children.get(p).push(f);
      }
      const byPath = new Map([['', { id: this.rootId, name: '', mimeType: FOLDER }]]);
      const walk = (id, prefix, depth) => {
        if (depth > 32) return; // 防止資料夾互相包含造成無限迴圈
        const kids = (children.get(id) || []).slice().sort((a, b) => a.modifiedTime < b.modifiedTime ? 1 : -1);
        for (const f of kids) {
          const path = prefix ? `${prefix}/${f.name}` : f.name;
          if (byPath.has(path)) continue;
          byPath.set(path, f);
          if (f.mimeType === FOLDER) walk(f.id, path, depth + 1);
        }
      };
      walk(this.rootId, '', 0);
      return { byPath, children };
    }
  }

  /** 登入的是哪個 Google 帳號(名稱與信箱)。用 Drive 自己的 about,不必多要權限;拿不到就回傳 null。 */
  async whoami() {
    try { const r = await this.client.json(`${DRIVE_API}/about?fields=${encodeURIComponent('user(displayName,emailAddress)')}`); return r.user || null; }
    catch { return null; }
  }

  async fileOf(path) { return (await this.load()).byPath.get(path) || null; }
  async need(path) { const f = await this.fileOf(path); if (!f) throw new Error('missing'); return f; }

  async list(path) {
    const dir = await this.need(path);
    if (dir.mimeType !== FOLDER) throw new Error('not a folder');
    const { byPath } = await this.load();
    const prefix = path ? path + '/' : '';
    const out = [];
    for (const [p, f] of byPath) if (p.startsWith(prefix) && p !== path && !p.slice(prefix.length).includes('/')) out.push({ name: f.name, kind: f.mimeType === FOLDER ? 'dir' : 'file' });
    return out;
  }

  async readText(path) { return (await this.client.media((await this.need(path)).id)).text(); }
  async readBytes(path) { return new Uint8Array(await (await this.client.media((await this.need(path)).id)).arrayBuffer()); }
  async mediaURL(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const blob = await (await this.client.media((await this.need(path)).id)).blob();
    const url = URL.createObjectURL(blob);
    this.urls.set(path, url);
    return url;
  }
  releaseMedia() { for (const u of this.urls.values()) URL.revokeObjectURL(u); this.urls.clear(); }

  async stat(path) {
    const f = await this.fileOf(path);
    return f && f.mimeType !== FOLDER ? `${f.modifiedTime}:${f.size ?? ''}` : null;
  }

  // ---------------- 寫入 ----------------
  /** 記下 Drive 回傳的新狀態(不必整個重新列一次)。 */
  async remember(path, f) {
    const idx = await this.load();
    this.raw?.set(f.id, f);
    idx.byPath.set(path, f);
    for (const p of f.parents || []) {
      const list = idx.children.get(p) || [];
      idx.children.set(p, [f, ...list.filter(x => x.id !== f.id)]);
    }
  }
  async forget(path) {
    const idx = await this.load();
    for (const p of [...idx.byPath.keys()]) if (p === path || p.startsWith(path + '/')) idx.byPath.delete(p);
  }

  /** 沿路建立還不存在的資料夾,回傳最後一層的 id。 */
  async folder(path) {
    if (!path) return this.rootId;
    const f = await this.fileOf(path);
    if (f) { if (f.mimeType !== FOLDER) throw new Error('not a folder'); return f.id; }
    const i = path.lastIndexOf('/');
    const parent = await this.folder(i < 0 ? '' : path.slice(0, i));
    const made = await this.client.json(`${DRIVE_API}/files?fields=${encodeURIComponent(FIELDS)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: path.slice(i + 1), mimeType: FOLDER, parents: [parent] }),
    });
    await this.remember(path, made);
    return made.id;
  }

  /** 寫入一個檔案(新建或覆寫)。data:字串、Blob 或 Uint8Array。 */
  async put(path, data, { expect = undefined, mkdir = true } = {}) {
    if (expect !== undefined) {
      // 清單是打開書庫時列的,別的裝置(手機)可能已經改過:一律向 Drive 問這個檔案現在的狀態再比對
      const f = await this.fileOf(path);
      if (f) {
        try { await this.remember(path, await this.client.meta(f.id)); }
        catch (e) { if (e.message !== 'missing') throw e; await this.forget(path); }
      }
      if ((await this.stat(path)) !== expect) throw new Error('stale');
    }
    const i = path.lastIndexOf('/');
    const dir = i < 0 ? '' : path.slice(0, i), name = path.slice(i + 1);
    if (!mkdir && !(await this.fileOf(dir))) throw new Error('missing');
    const type = mimeOf(name);
    const body = typeof data === 'string' ? new Blob([data], { type }) : data instanceof Blob ? data : new Blob([data], { type });
    const old = await this.fileOf(path);
    let f;
    if (old) {
      f = await this.client.json(`${DRIVE_UPLOAD}/files/${encodeURIComponent(old.id)}?uploadType=media&fields=${encodeURIComponent(FIELDS)}`, { method: 'PATCH', headers: { 'Content-Type': type }, body });
    } else {
      const parent = await this.folder(dir);
      const boundary = 'leafpile' + Math.random().toString(36).slice(2);
      const multipart = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent], mimeType: type })}\r\n`,
        `--${boundary}\r\nContent-Type: ${type}\r\n\r\n`, body, `\r\n--${boundary}--`,
      ]);
      f = await this.client.json(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent(FIELDS)}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
    }
    await this.remember(path, f);
    return this.stat(path);
  }

  async writeText(path, text, { expect = undefined, mkdir = false } = {}) {
    checkPath(path);
    return this.put(path, text, { expect, mkdir: true }); // Drive 上建資料夾沒有副作用,一律沿路建立
  }

  async writeFile(path, data, { expect = undefined } = {}) {
    checkPath(path, true);
    if (!BINARY_EXT.test(path)) throw new Error('bad type');
    const size = data.size ?? data.length;
    if (size > (/\.html?$/i.test(path) ? HTML_LIMIT : FILE_LIMIT)) throw new Error('too large');
    return this.put(path, data, { expect });
  }

  async writeMedia(path, blob) {
    if (!/^boards\/media\/[^/]+\.(png|jpe?g|webp|gif|svg|avif|html?|pdf)$/i.test(path) || path.includes('..')) throw new Error('bad path');
    if (blob.size > (/\.html?$/i.test(path) ? 500 * 1024 : 5 * 1024 * 1024)) throw new Error('too large');
    if (!(await this.fileOf(path))) await this.put(path, blob); // 檔名是內容雜湊:同名 = 同內容,不覆蓋
    return path;
  }

  /** 把 from 搬到 to(改上層資料夾與名稱,一個動作)。 */
  async relocate(from, to) {
    const f = await this.need(from);
    const i = to.lastIndexOf('/');
    const parent = await this.folder(i < 0 ? '' : to.slice(0, i));
    const old = (f.parents || []).join(',');
    const moved = await this.client.json(`${DRIVE_API}/files/${encodeURIComponent(f.id)}?addParents=${encodeURIComponent(parent)}${old ? '&removeParents=' + encodeURIComponent(old) : ''}&fields=${encodeURIComponent(FIELDS)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: to.slice(i + 1) }),
    });
    // 資料夾底下的路徑全部跟著換前綴
    const idx = await this.load();
    for (const [p, x] of [...idx.byPath]) if (p.startsWith(from + '/')) { idx.byPath.delete(p); idx.byPath.set(to + p.slice(from.length), x); }
    idx.byPath.delete(from);
    await this.remember(to, moved);
    return to;
  }

  async move(from, to, text, { expect } = {}) {
    checkPath(from); checkPath(to);
    if (expect !== undefined && (await this.stat(from)) !== expect) throw new Error('stale');
    const sameFile = from.toLowerCase() === to.toLowerCase();
    if (!sameFile && (await this.fileOf(to))) throw new Error('exists');
    await this.put(from, text);
    if (from !== to) await this.relocate(from, to);
    return to;
  }

  async archive(path, archiveDir) {
    checkPath(path, true);
    const name = path.slice(path.lastIndexOf('/') + 1);
    let target = name;
    for (let n = 2; await this.fileOf(`${archiveDir}/${target}`); n++) target = name.replace(/(\.[^.]*)?$/, `-${n}$&`);
    await this.relocate(path, `${archiveDir}/${target}`);
    return `${archiveDir}/${target}`;
  }

  async entryOf(path) {
    const f = await this.fileOf(path);
    return f ? { kind: f.mimeType === FOLDER ? 'dir' : 'file', id: f.id, name: f.name } : null;
  }
  async kindOf(path) { return (await this.entryOf(path))?.kind ?? null; }

  async moveTree(from, to) {
    if (!treePath(from) || !treePath(to)) throw new Error('bad path');
    if (!(await this.fileOf(from))) throw new Error('missing');
    if (await this.fileOf(to)) throw new Error('exists');
    return this.relocate(from, to);
  }

  async archiveTree(path) {
    if (!trashablePath(path)) throw new Error('bad path');
    const src = await this.entryOf(path);
    if (!src) throw new Error('missing');
    let to = archivePath(path, 1, src.kind === 'dir');
    for (let n = 2; await this.fileOf(to); n++) to = archivePath(path, n, src.kind === 'dir');
    return this.moveTree(path, to);
  }

  // ---------------- 分享 ----------------
  /**
   * 把這些路徑設成「知道連結的人都能看」。回傳 { 路徑: 檔案 id }。
   * skip:已經公開的檔案 id(上次分享過、或別的分享正在用),不必再設一次 —— 重新分享時通常只剩幾個請求。
   */
  async publish(paths, { skip = new Set() } = {}) {
    const files = await Promise.all(paths.map(p => this.need(p)));
    await pool(files.filter(f => !skip.has(f.id)), f => this.client.call(`${DRIVE_API}/files/${encodeURIComponent(f.id)}/permissions?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    }));
    return Object.fromEntries(paths.map((p, i) => [p, files[i].id]));
  }

  /** 取消「知道連結的人都能看」。檔案已經不在、或本來就沒公開,都不算錯。 */
  async unpublish(ids) {
    await pool([...new Set(ids)], async id => {
      try { await this.client.call(`${DRIVE_API}/files/${encodeURIComponent(id)}/permissions/anyoneWithLink`, { method: 'DELETE' }); }
      catch (e) { if (e.message !== 'missing') throw e; }
    });
  }
}

/**
 * 別人分享給你的內容(免登入):用 API key 讀公開的檔案。
 * files = { 路徑: 檔案 id },來自分享清單;另外可以放幾個「虛擬檔」(直接給文字)。
 * 只能讀,沒有任何寫入的方法。
 */
/**
 * 讀一個公開的檔案。剛分享時 Google 那邊可能還沒生效(幾秒到幾十秒),讀不到就等一下再試幾次。
 * waits:每次重試前等多久(毫秒)。
 */
export async function readShared(client, id, { waits = [1500, 3000, 6000], sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let i = 0; ; i++) {
    try { return await client.media(id); }
    catch (e) {
      const retryable = ['missing', 'not shared'].includes(e.message) || e instanceof TypeError;
      if (!retryable || i >= waits.length) throw e;
      await sleep(waits[i]);
    }
  }
}

export class SharedSource {
  constructor(files, client, { label = '', virtual = {}, waits } = {}) {
    this.waits = waits;
    this.files = files;
    this.virtual = virtual;
    this.client = client;
    this.label = label;
    this.kind = 'shared';
    this.urls = new Map();
  }
  get canWrite() { return false; }
  all() { return [...Object.keys(this.files), ...Object.keys(this.virtual)]; }
  async list(path) {
    const prefix = path ? path + '/' : '';
    const seen = new Map();
    for (const p of this.all()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length), i = rest.indexOf('/');
      if (rest) seen.set(i < 0 ? rest : rest.slice(0, i), i < 0 ? 'file' : 'dir');
    }
    if (path && !seen.size) throw new Error('missing');
    return [...seen].map(([name, kind]) => ({ name, kind }));
  }
  id(path) { const id = this.files[path]; if (!id) throw new Error('missing'); return id; }
  async readText(path) {
    if (path in this.virtual) return this.virtual[path];
    return (await this.get(path)).text();
  }
  get(path) { return readShared(this.client, this.id(path), this.waits ? { waits: this.waits } : {}); }
  async readBytes(path) { return new Uint8Array(await (await this.get(path)).arrayBuffer()); }
  async mediaURL(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const url = URL.createObjectURL(await (await this.get(path)).blob());
    this.urls.set(path, url);
    return url;
  }
  releaseMedia() { for (const u of this.urls.values()) URL.revokeObjectURL(u); this.urls.clear(); }
  async kindOf(path) { return path in this.files || path in this.virtual ? 'file' : (await this.list(path).then(() => 'dir', () => null)); }
}
