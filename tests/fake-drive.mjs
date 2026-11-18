// 模擬的 Google Drive:只實作 Leafpile 用到的 REST 呼叫(列清單、讀、建立、上傳、改上層資料夾、公開／取消公開)。
// Node 測試(tests/drive.test.mjs)與瀏覽器冒煙測試共用。
// 規則和真的 Drive 一樣:有通行證才看得到檔案;只有 API key 時,只讀得到設成公開的檔案。

const FOLDER = 'application/vnd.google-apps.folder';
// 文字檔存成字串(測試方便比對),二進位檔(圖片)存成位元組
const decode = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return bytes; } };

export class FakeDrive {
  constructor() { this.files = new Map(); this.n = 0; this.token = 'tok-1'; this.calls = []; this.at = Date.parse('2026-11-18T00:00:00Z'); }
  add(f) { const id = `id${String(++this.n).padStart(10, '0')}`; this.files.set(id, { id, parents: ['root'], shared: false, content: '', ...f, modifiedTime: new Date(this.at += 1000).toISOString() }); return id; }
  meta(f) { const { content, shared, ...m } = f; return { ...m, size: f.mimeType === FOLDER ? undefined : String(typeof f.content === 'string' ? new TextEncoder().encode(f.content).length : f.content.length) }; }
  json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } }); }
  fetch = async (href, init = {}) => {
    const url = new URL(href), method = init.method || 'GET';
    const authed = init.headers?.Authorization === `Bearer ${this.token}`;
    const key = url.searchParams.get('key') === 'KEY';
    this.calls.push(`${method} ${url.pathname}`);
    if (!authed && !key) return this.json({}, 401);
    const m = url.pathname.match(/^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?(\/permissions(?:\/([^/]+))?)?$/);
    if (!m) return this.json({}, 400);
    const [, upload, id, perm, permId] = m;
    const f = id ? this.files.get(id) : null;
    if (id && !f) return this.json({}, 404);
    if (f && !authed && !(f.shared && method === 'GET')) return this.json({}, 404); // 沒公開:別人看不到
    if (perm) {
      if (method === 'POST') { f.shared = true; return this.json({ id: 'anyoneWithLink' }); }
      if (method === 'DELETE' && permId === 'anyoneWithLink') { f.shared = false; return new Response(null, { status: 204 }); }
    }
    if (method === 'GET' && !id) {
      if (!authed) return this.json({}, 403);
      const q = url.searchParams.get('q');
      let list = [...this.files.values()].filter(x => !x.trashed);
      const name = q.match(/name = '([^']+)'/)?.[1];
      if (name) list = list.filter(x => x.name === name && x.mimeType === FOLDER && x.parents.includes('root'));
      return this.json({ files: list.map(x => this.meta(x)) });
    }
    if (method === 'GET') return url.searchParams.get('alt') === 'media' ? new Response(f.content) : this.json(this.meta(f));
    if (method === 'POST' && !upload) { const b = JSON.parse(init.body); return this.json(this.meta(this.files.get(this.add({ name: b.name, mimeType: b.mimeType, parents: b.parents })))); }
    if (method === 'POST' && upload) {
      // multipart/related:照位元組切開(圖片不能當文字解析)
      const bytes = new Uint8Array(await init.body.arrayBuffer());
      const boundary = new TextEncoder().encode('--' + init.headers['Content-Type'].split('boundary=')[1]);
      const find = (from) => { outer: for (let i = from; i <= bytes.length - boundary.length; i++) { for (let j = 0; j < boundary.length; j++) if (bytes[i + j] !== boundary[j]) continue outer; return i; } return -1; };
      const cuts = []; for (let i = find(0); i >= 0; i = find(i + boundary.length)) cuts.push(i);
      const part = k => { const seg = bytes.slice(cuts[k] + boundary.length, cuts[k + 1]); let h = 0; while (!(seg[h] === 13 && seg[h + 1] === 10 && seg[h + 2] === 13 && seg[h + 3] === 10)) h++; return seg.slice(h + 4, seg.length - 2); };
      const b = JSON.parse(new TextDecoder().decode(part(0)));
      return this.json(this.meta(this.files.get(this.add({ name: b.name, mimeType: b.mimeType, parents: b.parents, content: decode(part(1)) }))));
    }
    if (method === 'PATCH' && upload) { f.content = decode(new Uint8Array(await init.body.arrayBuffer())); f.modifiedTime = new Date(this.at += 1000).toISOString(); return this.json(this.meta(f)); }
    if (method === 'PATCH') {
      const add = url.searchParams.get('addParents'), rm = url.searchParams.get('removeParents');
      if (add) f.parents = [...f.parents.filter(p => !(rm || '').split(',').includes(p)), add];
      const b = init.body ? JSON.parse(init.body) : {};
      if (b.name) f.name = b.name;
      return this.json(this.meta(f));
    }
    return this.json({}, 400);
  };
}
