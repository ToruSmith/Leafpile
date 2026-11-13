// 資料來源:把「倉庫裡的檔案」與「使用者電腦裡的資料夾」包成同一個介面。
//
// 介面(core/library.js 只認這四個):
//   label                 顯示名稱
//   list(path)            → [{ name, kind: 'file'|'dir' }]
//   readText(path)        → string
//   mediaURL(path)        → 可放進 <img>/<video> 的網址
//   releaseMedia()        釋放 mediaURL 產生的暫存網址(離開簡報時呼叫)
//   readBytes(path)       → Uint8Array(書庫包匯出、匯入時讀圖片與 PDF)
//
// 本機來源讀到的清單都會快取:同一個資料夾只列一次,減少隨身碟讀取。

const enc = p => p.split('/').map(encodeURIComponent).join('/');
import { t } from '../core/i18n.js';

/** 倉庫模式:讀 GitHub Pages 上的 content/,目錄清單來自建置時產生的 catalog.json。 */
export class HttpSource {
  constructor(base, catalog) {
    this.kind = 'repo';
    this.base = base.replace(/\/?$/, '/');
    this.tree = catalog.tree;
    this.label = catalog.title || t('source.repoLabel');
  }
  static async open(base = 'content/', catalogURL = 'catalog.json') {
    const res = await fetch(catalogURL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(t('source.noCatalog'));
    return new HttpSource(base, await res.json());
  }
  async list(path) {
    const entries = this.tree[path];
    if (!entries) throw new Error('not found: ' + path);
    return entries;
  }
  async readText(path) {
    const i = path.lastIndexOf('/');
    const dir = this.tree[i < 0 ? '' : path.slice(0, i)];
    if (!dir || !dir.some(e => e.name === path.slice(i + 1))) throw new Error('not found: ' + path); // 不存在就不發請求
    const res = await fetch(this.base + enc(path));
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.text();
  }
  async readBytes(path) {
    const res = await fetch(this.base + enc(path));
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async mediaURL(path) { return this.base + enc(path); }
  releaseMedia() {}
}

/** 本機模式(Chrome / Edge):FileSystemDirectoryHandle,可以記住並在下次重新連線。 */
export class HandleSource {
  constructor(handle, id = null) {
    this.kind = 'handle';
    this.handle = handle;
    this.id = id;
    this.label = handle.name;
    this.dirCache = new Map([['', handle]]);
    this.listCache = new Map();
    this.urls = new Map();
  }
  async dir(path) {
    if (this.dirCache.has(path)) return this.dirCache.get(path);
    const i = path.lastIndexOf('/');
    const parent = await this.dir(i < 0 ? '' : path.slice(0, i));
    const h = await parent.getDirectoryHandle(path.slice(i + 1));
    this.dirCache.set(path, h);
    return h;
  }
  async list(path) {
    if (this.listCache.has(path)) return this.listCache.get(path);
    const d = await this.dir(path);
    const out = [];
    for await (const [name, h] of d.entries()) {
      out.push({ name, kind: h.kind === 'directory' ? 'dir' : 'file' });
      if (h.kind === 'directory') this.dirCache.set(path ? `${path}/${name}` : name, h);
    }
    this.listCache.set(path, out);
    return out;
  }
  async file(path) {
    const i = path.lastIndexOf('/');
    const d = await this.dir(i < 0 ? '' : path.slice(0, i));
    return (await d.getFileHandle(path.slice(i + 1))).getFile();
  }
  async readText(path) { return (await this.file(path)).text(); }
  async readBytes(path) { return new Uint8Array(await (await this.file(path)).arrayBuffer()); }
  async mediaURL(path) {
    if (!this.urls.has(path)) this.urls.set(path, this.file(path).then(f => URL.createObjectURL(f)));
    return this.urls.get(path);
  }
  releaseMedia() {
    for (const p of this.urls.values()) p.then(u => URL.revokeObjectURL(u), () => {});
    this.urls.clear();
  }
  /** 重新整理:清掉快取,下次會重新讀資料夾。 */
  refresh() { this.listCache.clear(); this.dirCache = new Map([['', this.handle]]); }

  // ---------------- 寫入(編輯模式) ----------------
  // 安全規則:
  //   1. 一定要使用者授權才寫得了(瀏覽器會跳出詢問)。
  //   2. 只寫 .md 與 .yml,而且只在這個書庫資料夾裡面。
  //   3. 寫之前先比對「打開時的檔案狀態」,別的程式改過就停下來問使用者。
  //   4. 刪除一律改成搬到 _封存/,不真的刪檔。
  get canWrite() { return true; }

  /**
   * 要求寫入權限;使用者沒答應就回傳 false。
   * Chrome 只在「使用者剛按下按鈕」的當下才肯跳出詢問(選完檔案之後、自動儲存的計時器裡都不算),
   * 否則直接拒絕。這時先用 HandleSource.askPermission(由 main.js 設定的小對話框)請使用者按一下「允許」,
   * 那一下就是真正的點擊,再向瀏覽器要權限。同時有好幾個寫入時只問一次。
   */
  async ensureWritable() {
    const q = await this.handle.queryPermission?.({ mode: 'readwrite' });
    if (q === 'granted' || !this.handle.requestPermission) return q === 'granted' || q === undefined;
    this.asking ||= (async () => {
      try {
        if (globalThis.navigator?.userActivation && !navigator.userActivation.isActive && HandleSource.askPermission) {
          if (!(await HandleSource.askPermission())) return false;
        }
        return (await this.handle.requestPermission({ mode: 'readwrite' })) === 'granted';
      } catch { return false; /* 沒有使用者操作時瀏覽器會丟出錯誤:當成沒答應 */ } finally { this.asking = null; }
    })();
    return this.asking;
  }

  /** 檔案目前的狀態(修改時間與大小),用來判斷有沒有被別的程式改過。 */
  async stat(path) {
    try { const f = await this.file(path); return `${f.lastModified}:${f.size}`; } catch { return null; }
  }

  /**
   * 寫入文字檔。expect = 打開時的 stat();不符就丟出 'stale'(檔案被別的程式改過)。
   * 新建檔案時傳 expect: null,表示「必須還不存在」,已經有同名檔就丟出 'stale',不覆蓋。
   * 瀏覽器會先寫暫存檔,關閉時才取代原檔,所以寫到一半中斷不會弄壞原檔。
   */
  async writeText(path, text, { expect = undefined, mkdir = false } = {}) {
    checkPath(path);
    if (!(await this.ensureWritable())) throw new Error('denied');
    if (expect !== undefined && (await this.stat(path)) !== expect) throw new Error('stale');
    const i = path.lastIndexOf('/');
    let d;
    if (mkdir) {
      // 新增簡報骨架、講後筆記時:沿路建立還不存在的資料夾
      d = this.handle;
      for (const part of (i < 0 ? '' : path.slice(0, i)).split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create: true });
      this.refresh();
    } else d = await this.dir(i < 0 ? '' : path.slice(0, i));
    const h = await d.getFileHandle(path.slice(i + 1), { create: true });
    const w = await h.createWritable();
    try {
      await w.write(text);
    } finally {
      await w.close();
    }
    this.listCache.delete(i < 0 ? '' : path.slice(0, i));
    return this.stat(path);
  }

  /**
   * 寫入圖片、PDF、HTML(書庫包匯入用)。規則與 writeText 相同:只在書庫裡、expect 不符就停下來;
   * 另外只收這幾種副檔名、有大小上限。新檔案請傳 expect: null(已經有同名檔就不覆蓋)。
   */
  async writeFile(path, data, { expect = undefined } = {}) {
    checkPath(path, true);
    if (!BINARY_EXT.test(path)) throw new Error('bad type');
    const size = data.size ?? data.length;
    if (size > (/\.html?$/i.test(path) ? HTML_LIMIT : FILE_LIMIT)) throw new Error('too large');
    if (!(await this.ensureWritable())) throw new Error('denied');
    if (expect !== undefined && (await this.stat(path)) !== expect) throw new Error('stale');
    const i = path.lastIndexOf('/');
    let d = this.handle;
    for (const part of (i < 0 ? '' : path.slice(0, i)).split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create: true });
    const w = await (await d.getFileHandle(path.slice(i + 1), { create: true })).createWritable();
    try { await w.write(data); } finally { await w.close(); }
    this.refresh();
    return this.stat(path);
  }

  /**
   * 改名／搬移一個檔案:先把(可能改過的)內容寫到新位置、讀回來確認一致,才移除舊檔。
   * 這是 Leafpile 唯一會移除檔案的地方,而且內容一定已經在新位置。
   *   expect:舊檔打開時的狀態,不一致(被別的程式改過)就停下來。
   *   新位置已經有檔案就拒絕('exists'),不覆蓋。
   */
  async move(from, to, text, { expect } = {}) {
    checkPath(from); checkPath(to);
    if (!(await this.ensureWritable())) throw new Error('denied');
    if (expect !== undefined && (await this.stat(from)) !== expect) throw new Error('stale');
    const sameFile = from.toLowerCase() === to.toLowerCase(); // 只改大小寫:不分大小寫的檔案系統上是同一個檔
    if (!sameFile && (await this.stat(to)) != null) throw new Error('exists');
    if (sameFile) { await this.writeText(from, text); return from; }
    await this.writeText(to, text, { mkdir: true });
    if ((await this.readText(to)) !== text) throw new Error('verify');
    const i = from.lastIndexOf('/');
    await (await this.dir(i < 0 ? '' : from.slice(0, i))).removeEntry(from.slice(i + 1));
    this.refresh();
    return to;
  }

  /**
   * 畫布的素材(圖片、HTML、PDF):只能寫進 boards/media/,只收這幾種副檔名,有大小上限。
   * 檔名由呼叫端用內容雜湊決定,所以同名 = 同內容:已經存在就直接沿用,不覆蓋。
   */
  async writeMedia(path, blob) {
    if (!/^boards\/media\/[^/]+\.(png|jpe?g|webp|gif|svg|avif|html?|pdf)$/i.test(path) || path.includes('..')) throw new Error('bad path');
    const limit = /\.html?$/i.test(path) ? 500 * 1024 : 5 * 1024 * 1024;
    if (blob.size > limit) throw new Error('too large');
    if (!(await this.ensureWritable())) throw new Error('denied');
    let d = this.handle;
    for (const part of ['boards', 'media']) d = await d.getDirectoryHandle(part, { create: true });
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (!(await exists(d, name))) {
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      try { await w.write(blob); } finally { await w.close(); }
    }
    this.listCache.delete('boards/media'); this.listCache.delete('boards');
    return path;
  }

  /** 搬到同一個簡報資料夾下的 _封存/(不真的刪檔)。回傳新位置。 */
  async archive(path, archiveDir) {
    checkPath(path, true);
    const binary = !TEXT_EXT.test(path);
    const text = binary ? await this.readBytes(path) : await this.readText(path); // 圖片等二進位檔照位元組搬
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (!(await this.ensureWritable())) throw new Error('denied');
    const parts = archiveDir.split('/').filter(Boolean);
    let d = this.handle;
    for (const part of parts) d = await d.getDirectoryHandle(part, { create: true });
    let target = name;
    for (let n = 2; await exists(d, target); n++) target = name.replace(/(\.[^.]*)?$/, `-${n}$&`); // 同名就加編號
    const w = await (await d.getFileHandle(target, { create: true })).createWritable();
    try { await w.write(text); } finally { await w.close(); }
    // 和 move() 一樣:讀回來確認封存的副本完整,才移除原檔
    const back = await (await d.getFileHandle(target)).getFile();
    if (binary ? !sameBytes(new Uint8Array(await back.arrayBuffer()), text) : (await back.text()) !== text) throw new Error('verify');
    const i = path.lastIndexOf('/');
    await (await this.dir(i < 0 ? '' : path.slice(0, i))).removeEntry(name);
    this.refresh();
    return `${archiveDir}/${target}`;
  }

  /**
   * 監看簡報資料夾:每隔一段時間比對 .md 與設定檔的修改時間(只讀檔案資訊,不讀內容),
   * 以及子資料夾的增減;有變化就呼叫 onChange。分頁不在前景時暫停。回傳停止監看的函式。
   */
  watch(dirPaths, onChange, interval = 1500) {
    let last = null, timer = null, stopped = false;
    const snapshot = async () => {
      const parts = [];
      for (const p of dirPaths) {
        let d;
        try { d = await this.dir(p); } catch { parts.push(`${p}:gone`); continue; }
        for await (const [name, h] of d.entries()) {
          if (h.kind === 'directory') parts.push(`${p}/${name}/`);
          else if (/\.(md|ya?ml)$/i.test(name)) { const f = await h.getFile(); parts.push(`${p}/${name}:${f.lastModified}:${f.size}`); }
        }
      }
      return parts.sort().join('|');
    };
    const tick = async () => {
      if (stopped) return;
      if (typeof document === 'undefined' || !document.hidden) {
        try {
          const s = await snapshot();
          if (last !== null && s !== last) await onChange();
          last = s;
        } catch { /* 隨身碟拔掉等情況:下次再試 */ }
      }
      if (!stopped) timer = setTimeout(tick, interval);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }
}

/** 只允許寫入書庫資料夾裡的 .md / .yml,路徑不能跳出去。 */
const TEXT_EXT = /\.(md|ya?ml|canvas)$/i; // 筆記、設定、畫布
const BINARY_EXT = /\.(png|jpe?g|webp|gif|svg|avif|pdf|html?)$/i; // 圖片、PDF、HTML(只有 writeFile、archive 收)
const FILE_LIMIT = 10 * 1024 * 1024, HTML_LIMIT = 1024 * 1024;

/** 路徑檢查:只能在書庫裡;預設只收文字檔,binary = true 時也收圖片、PDF、HTML。 */
function checkPath(path, binary = false) {
  if (!/^[^/][^\0]*$/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('bad path');
  if (!TEXT_EXT.test(path) && !(binary && BINARY_EXT.test(path))) throw new Error('bad type');
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

/** 本機模式(所有瀏覽器):<input webkitdirectory> 或拖放取得的檔案清單。只讀到檔名,內容等需要時才讀。 */
export class FileListSource {
  constructor(files, label) {
    this.kind = 'files';
    this.files = new Map();
    this.dirs = new Map([['', new Map()]]);
    this.urls = new Map();
    let root = label;
    for (const { file, path } of files) {
      const parts = path.split('/').filter(Boolean);
      if (!root) root = parts[0];
      if (parts[0] === root && parts.length > 1) parts.shift(); // 去掉最外層的資料夾名稱
      this.files.set(parts.join('/'), file);
      for (let i = 0; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        if (!this.dirs.has(dir)) this.dirs.set(dir, new Map());
        this.dirs.get(dir).set(parts[i], i === parts.length - 1 ? 'file' : 'dir');
      }
    }
    this.label = root || t('source.localLabel');
  }
  static fromInput(fileList) {
    return new FileListSource([...fileList].map(f => ({ file: f, path: f.webkitRelativePath || f.name })));
  }
  async list(path) {
    const d = this.dirs.get(path);
    if (!d) throw new Error('not found: ' + path);
    return [...d].map(([name, kind]) => ({ name, kind }));
  }
  async readText(path) {
    const f = this.files.get(path);
    if (!f) throw new Error('not found: ' + path);
    return f.text();
  }
  async readBytes(path) {
    const f = this.files.get(path);
    if (!f) throw new Error('not found: ' + path);
    return new Uint8Array(await f.arrayBuffer());
  }
  async mediaURL(path) {
    if (!this.urls.has(path)) {
      const f = this.files.get(path);
      if (!f) throw new Error('not found: ' + path);
      this.urls.set(path, URL.createObjectURL(f));
    }
    return this.urls.get(path);
  }
  releaseMedia() { for (const u of this.urls.values()) URL.revokeObjectURL(u); this.urls.clear(); }
}

/** 拖放:Chrome/Edge 優先拿到可記住的 handle;其他瀏覽器逐層走訪(只讀檔名)。 */
export async function sourceFromDrop(dataTransfer) {
  const item = [...dataTransfer.items].find(i => i.kind === 'file');
  if (!item) return null;
  if (item.getAsFileSystemHandle) {
    const h = await item.getAsFileSystemHandle();
    if (h && h.kind === 'directory') return new HandleSource(h);
  }
  const entry = item.webkitGetAsEntry?.();
  if (!entry || !entry.isDirectory) return null;
  const files = [];
  const readAll = reader => new Promise((res, rej) => {
    const out = [];
    const step = () => reader.readEntries(batch => batch.length ? (out.push(...batch), step()) : res(out), rej);
    step();
  });
  const walk = async (dir, prefix) => {
    for (const e of await readAll(dir.createReader())) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (e.isDirectory) await walk(e, `${prefix}/${e.name}`);
      else files.push({ file: await new Promise((res, rej) => e.file(res, rej)), path: `${prefix}/${e.name}` });
    }
  };
  await walk(entry, entry.name);
  return new FileListSource(files, entry.name);
}

export const canPickDirectory = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;
