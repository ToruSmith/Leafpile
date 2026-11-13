// 讀寫 zip(書庫包)。零依賴:壓縮用瀏覽器與 Node 18+ 都內建的 CompressionStream('deflate-raw')。
// 只支援書庫包用得到的部分:不壓縮(stored)與 deflate,UTF-8 檔名,不支援加密、分割、zip64。
//
// 安全:讀取時擋掉跳出資料夾的路徑(../、絕對路徑、反斜線)、限制單檔與總大小(防解壓縮炸彈),
// 略過 macOS 的 __MACOSX/ 與 . 開頭的隱藏檔。

export const ZIP_LIMITS = { files: 5000, fileBytes: 25 * 1024 * 1024, totalBytes: 200 * 1024 * 1024 };

const enc = new TextEncoder();
const dec = new TextDecoder();

let CRC_TABLE = null;
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const deflate = bytes => pipe(bytes, new CompressionStream('deflate-raw'));
const inflate = bytes => pipe(bytes, new DecompressionStream('deflate-raw'));
const canCompress = () => typeof CompressionStream === 'function';

/** 路徑安全嗎:相對路徑、用 / 分隔、沒有 ..、不是隱藏檔或 macOS 的附屬檔。 */
export function safeZipPath(name) {
  const p = String(name || '');
  if (!p || p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p) || p.includes('\0')) return null;
  const parts = p.split('/');
  if (parts.some(x => x === '..' || x === '.')) return null;
  if (parts[0] === '__MACOSX' || parts.some(x => x.startsWith('.'))) return null;
  return parts.filter(Boolean).join('/');
}

/**
 * 寫出 zip。
 * @param {{ path: string, data: Uint8Array|string }[]} entries
 * @param {{ date?: Date }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function writeZip(entries, { date = new Date() } = {}) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.path);
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const crc = crc32(raw);
    let body = raw, method = 0;
    if (canCompress() && raw.length > 64) {
      const z = await deflate(raw);
      if (z.length < raw.length) { body = z; method = 8; }
    }
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); // bit 11:UTF-8 檔名
    head.setUint16(8, method, true); head.setUint16(10, time, true); head.setUint16(12, day, true);
    head.setUint32(14, crc, true); head.setUint32(18, body.length, true); head.setUint32(22, raw.length, true);
    head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
    locals.push(new Uint8Array(head.buffer), name, body);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, method, true); cen.setUint16(12, time, true); cen.setUint16(14, day, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, body.length, true); cen.setUint32(24, raw.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    centrals.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cenSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

/**
 * 讀 zip,回傳檔案清單(資料夾項目與不安全的路徑會略過,略過的另外列出)。
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {Promise<{ files: { path: string, data: Uint8Array }[], skipped: { path: string, reason: string }[] }>}
 */
export async function readZip(input, limits = ZIP_LIMITS) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip:not a zip');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count > limits.files) throw new Error('zip:too many files');
  const files = [], skipped = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('zip:broken');
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true), usize = view.getUint32(p + 24, true);
    const nlen = view.getUint16(p + 28, true), xlen = view.getUint16(p + 30, true), clen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue; // 資料夾
    const path = safeZipPath(name);
    if (!path) { if (!/(^|\/)(__MACOSX|\.)/.test(name)) skipped.push({ path: name, reason: 'path' }); continue; }
    if (flags & 1) { skipped.push({ path, reason: 'encrypted' }); continue; }
    if (method !== 0 && method !== 8) { skipped.push({ path, reason: 'method' }); continue; }
    if (usize > limits.fileBytes) { skipped.push({ path, reason: 'size' }); continue; }
    if ((total += usize) > limits.totalBytes) throw new Error('zip:too large');
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('zip:broken');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + csize);
    const data = method === 8 ? await inflate(body) : body.slice();
    if (data.length !== usize) throw new Error('zip:broken');
    files.push({ path, data });
  }
  return { files, skipped };
}
