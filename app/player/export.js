// 匯出成單一 HTML 檔:播放器程式、樣式、簡報資料與圖片全部塞進一個檔案,
// 雙擊就能離線播放(file://)。不需要打包工具:
//   - 程式:逐一讀取 app/ 底下的模組原始碼,把相對 import 改成「@m/路徑」,
//     再用 import map 指到 data: 網址。模組彼此獨立,不會有變數名稱衝突。
//   - 樣式:讀取頁面上的樣式表,直接內嵌。
//   - 媒體:圖片一律內嵌成 data: 網址;影片與音訊預設不放(檔案會很大),可勾選加入。
//   - 線上影片(YouTube 等)保持外部連結,需要網路才能看。

import { escapeHTML as esc } from '../core/markdown.js';
import { isURL } from '../core/names.js';
import { flatten } from '../core/library.js';
import { renderSlide } from './render.js';
import { t, getLang } from '../core/i18n.js';

const ENTRY = 'standalone.js';
const IMPORT_RE = /^(\s*(?:import|export)\b[^;'"]*?)(['"])(\.{1,2}\/[^'"]+)\2/gm;

/** 把一段 import 規格改寫成 import map 的鍵(相對於 app/)。 */
function moduleKey(spec, fromURL, appBase) {
  const abs = new URL(spec, fromURL).href;
  if (!abs.startsWith(appBase)) throw new Error('module outside app/: ' + spec);
  return '@m/' + abs.slice(appBase.length);
}

/** 從入口開始讀取所有模組,回傳 { 鍵: 原始碼 }。 */
export async function collectModules(appBase, entry = ENTRY) {
  const out = {};
  const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    const key = '@m/' + rel;
    if (key in out) continue;
    const url = appBase + rel;
    const res = await fetch(url);
    if (!res.ok) throw new Error('cannot read ' + rel);
    const src = await res.text();
    out[key] = src.replace(IMPORT_RE, (m, head, q, spec) => {
      const k = moduleKey(spec, url, appBase);
      queue.push(k.slice(3));
      return head + q + k + q;
    });
  }
  return out;
}

/** 讀取頁面上的樣式表(同網站的),合併成一段 CSS。 */
export async function collectCSS(doc = document) {
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')];
  const parts = await Promise.all(links.map(l => fetch(l.href).then(r => (r.ok ? r.text() : ''))));
  return parts.join('\n');
}

/** 找出簡報用到的本機媒體:[{ path, kind: 'image' | 'video' | 'audio' }]。 */
export function collectMediaPaths(deck) {
  const slides = flatten(deck);
  const box = document.createElement('template');
  box.innerHTML = slides.map((s, gi) => renderSlide(s, { deck, mode: 'full', globalIndex: gi, total: slides.length })).join('');
  const found = new Map();
  for (const el of box.content.querySelectorAll('[data-media]')) {
    const tag = el.tagName.toLowerCase();
    found.set(el.dataset.media, tag === 'video' ? 'video' : tag === 'audio' ? 'audio' : 'image');
  }
  for (const el of box.content.querySelectorAll('[data-bg]')) found.set(el.dataset.bg, 'image');
  return [...found].filter(([p]) => !isURL(p)).map(([path, kind]) => ({ path, kind }));
}

/** 讀取媒體檔(Blob)。讀不到的略過,播放時會顯示「找不到媒體」。 */
async function readMedia(items, source) {
  await Promise.all(items.map(async it => {
    try {
      const res = await fetch(await source.mediaURL(it.path));
      it.blob = res.ok ? await res.blob() : null;
    } catch { it.blob = null; }
  }));
  return items;
}

const toDataURL = blob => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => fail(r.error);
  r.readAsDataURL(blob);
});

/** JSON 放進 <script> 時,避免 </script> 提早結束。 */
const safeJSON = v => JSON.stringify(v).replace(/[<\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/** 組出完整的 HTML 字串。 */
export function buildHTML({ deck, theme, modules, css, media, lang }) {
  const imports = {};
  for (const [k, src] of Object.entries(modules)) imports[k] = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(src);
  const data = { deck, theme, media };
  return `<!DOCTYPE html>
<html lang="${esc(lang)}" data-theme="${esc(theme || 'paper')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Leafpile">
<title>${esc(deck.title)}</title>
<style>
${css.replace(/<\/style/gi, '<\\/style')}
</style>
<script type="importmap">${safeJSON({ imports })}</script>
<script type="application/json" id="mdslide-data">${safeJSON(data)}</script>
</head>
<body>
<div id="app"></div>
<script type="module">import '@m/${ENTRY}';</script>
</body>
</html>
`;
}

/** 檔案大小的顯示文字。 */
export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/** 匯出整份簡報。includeVideo = 是否內嵌影片與音訊。 */
export async function exportDeck({ deck, source, theme, includeVideo = false, items = null }) {
  const appBase = new URL('app/', document.baseURI).href;
  items ||= await readMedia(collectMediaPaths(deck), source);
  const [modules, css] = await Promise.all([collectModules(appBase), collectCSS()]);
  const media = {};
  for (const it of items) {
    if (!it.blob || (it.kind !== 'image' && !includeVideo)) continue;
    media[it.path] = await toDataURL(it.blob);
  }
  const html = buildHTML({ deck, theme, modules, css, media, lang: getLang() });
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

const fileName = title => (String(title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || 'slides') + '.html';

/** 匯出對話框:顯示預估大小與「包含影片」選項。player = 目前的播放器。 */
export async function openExportDialog(player) {
  const { deck, source } = player;
  const panel = document.createElement('div');
  panel.className = 'help-panel export-panel on';
  panel.innerHTML = `<div class="help-card"><h2>${esc(t('export.title'))}</h2><p class="export-text">${esc(t('export.text'))}</p><p class="export-status">${esc(t('export.measuring'))}</p><div class="export-actions"><button class="btn ghost" data-x="cancel">${esc(t('export.cancel'))}</button> <button class="btn primary" data-x="go" disabled>${esc(t('export.go'))}</button></div></div>`;
  player.el.player.append(panel);
  const $ = s => panel.querySelector(s);
  const close = () => panel.remove();
  panel.addEventListener('click', e => { if (e.target === panel || e.target.closest('[data-x="cancel"]')) close(); });
  panel.addEventListener('keydown', e => e.stopPropagation());

  const items = await readMedia(collectMediaPaths(deck), source);
  const size = kind => items.filter(it => it.blob && kind(it.kind)).reduce((n, it) => n + it.blob.size, 0);
  const base = 450 * 1024; // 程式與樣式大約的大小
  const images = size(k => k === 'image') * 4 / 3; // base64 會大約 1/3
  const videos = size(k => k !== 'image') * 4 / 3;
  const videoCount = items.filter(it => it.blob && it.kind !== 'image').length;
  const status = $('.export-status');
  const show = () => {
    const withVideo = $('.export-video input')?.checked;
    status.textContent = t('export.size', { size: formatSize(base + images + (withVideo ? videos : 0)) });
  };
  if (videoCount) {
    status.insertAdjacentHTML('beforebegin', `<label class="export-video"><input type="checkbox"> ${esc(t('export.videos', { n: videoCount, size: formatSize(videos) }))}</label>`);
    $('.export-video input').addEventListener('change', show);
  }
  show();
  const go = $('[data-x="go"]');
  go.disabled = false;
  go.addEventListener('click', async () => {
    go.disabled = true;
    status.textContent = t('export.working');
    try {
      const blob = await exportDeck({ deck, source, theme: document.documentElement.dataset.theme, includeVideo: !!$('.export-video input')?.checked, items });
      download(blob, fileName(deck.title));
      close();
      player.toast(t('export.done', { size: formatSize(blob.size) }));
    } catch (e) {
      status.textContent = t('export.failed');
      go.disabled = false;
      console.error(e);
    }
  });
}
