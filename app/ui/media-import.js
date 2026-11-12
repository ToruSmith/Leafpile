// 畫布素材匯入:圖片縮到最長邊 1600 px 並轉成 WebP(GIF、SVG 保持原樣);HTML 與 PDF 原樣保存。
// 檔名是內容雜湊,所以同一張圖放兩次只會存一份。

const MAX_SIDE = 1600;
const RASTER = /^image\/(png|jpe?g|webp|avif|bmp)$/i;

async function hash(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf).slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise(res => c.toBlob(res, 'image/webp', 0.85));
  // 不支援 WebP 編碼的瀏覽器會給 PNG:照實際格式命名
  return { blob: out, ext: out.type === 'image/webp' ? 'webp' : 'png', width: w, height: h };
}

/**
 * @param {File} file
 * @returns {Promise<{ kind: 'image'|'html'|'pdf', path: string, blob: Blob, name: string, width?: number, height?: number }>}
 */
export async function prepareMedia(file) {
  const name = file.name || 'pasted';
  const lower = name.toLowerCase();
  let kind, blob = file, ext, width, height;
  if (RASTER.test(file.type)) ({ blob, ext, width, height } = await shrink(file)), kind = 'image';
  else if (file.type === 'image/gif' || lower.endsWith('.gif')) { kind = 'image'; ext = 'gif'; }
  else if (file.type === 'image/svg+xml' || lower.endsWith('.svg')) { kind = 'image'; ext = 'svg'; }
  else if (file.type === 'text/html' || /\.html?$/.test(lower)) { kind = 'html'; ext = 'html'; }
  else if (file.type === 'application/pdf' || lower.endsWith('.pdf')) { kind = 'pdf'; ext = 'pdf'; }
  else throw new Error('type');
  if (kind === 'image' && !width) {
    try { const b = await createImageBitmap(blob); width = b.width; height = b.height; b.close?.(); } catch { /* SVG 有時量不到 */ }
  }
  return { kind, blob, name, width, height, path: `boards/media/${await hash(blob)}.${ext}` };
}
