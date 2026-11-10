// 把 render.js 輸出的媒體佔位(data-media / data-embed / data-bg)換成真正的網址。
// 只在需要時呼叫:縮圖只處理目前章節附近,放大時才建立 iframe 與播放影片。

import { isURL } from '../core/names.js';
import { escapeHTML } from '../core/markdown.js';
import { t } from '../core/i18n.js';

export async function hydrate(root, source, { full = false } = {}) {
  const jobs = [];
  for (const el of root.querySelectorAll('[data-media]:not([data-ready])')) {
    el.dataset.ready = '1';
    const path = el.dataset.media;
    jobs.push((isURL(path) ? Promise.resolve(path) : source.mediaURL(path)).then(url => {
      if (el.tagName === 'IMG') {
        el.decoding = 'async';
        if (el.parentElement?.classList.contains('marked')) el.addEventListener('load', () => placeMarks(el));
        el.src = url;
        el.onerror = () => missing(el, path);
      }
      else { el.preload = full ? 'auto' : 'metadata'; el.src = url; }
    }, () => missing(el, path)));
  }
  for (const el of root.querySelectorAll('img[data-thumb]:not([data-ready])')) {
    el.dataset.ready = '1';
    el.onerror = () => el.remove(); // 縮圖載入失敗(例如離線)就直接移除,露出預設底色
    el.src = el.dataset.thumb;
  }
  const slides = root.matches?.('.slide[data-bg]') ? [root] : [...root.querySelectorAll('.slide[data-bg]:not([data-ready])')];
  for (const s of slides) {
    s.dataset.ready = '1';
    const p = s.dataset.bg;
    jobs.push((isURL(p) ? Promise.resolve(p) : source.mediaURL(p)).then(url => {
      // 遮罩:auto = 主題底色淡化(預設);dark / light = 深色或淺色遮罩(字會自動反白或變深);none = 不加
      const tint = { dark: 'rgba(14, 16, 20, .6)', light: 'rgba(255, 253, 248, .8)', none: '' }[s.dataset.overlay] ?? 'color-mix(in srgb, var(--slide-bg) 78%, transparent)';
      s.style.background = `${tint ? `linear-gradient(${tint}, ${tint}), ` : ''}url("${url}") center / cover`;
    }, () => {}));
  }
  if (full) {
    for (const fig of root.querySelectorAll('[data-embed]')) {
      if (fig.querySelector('iframe')) continue;
      const f = document.createElement('iframe');
      f.src = fig.dataset.embed;
      f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      // 嵌入的播放器不能把整頁導走、不能下載;播放、全螢幕、在新分頁開啟仍可用。
      // 互動網頁另外允許表單與對話框。和本網站同網域的網頁不給 allow-same-origin,
      // 否則它可以拿掉自己的限制、讀取本網站記住的資料夾。
      const sameSite = new URL(f.src, location.href).origin === location.origin;
      const flags = ['allow-scripts', 'allow-presentation', 'allow-popups', 'allow-popups-to-escape-sandbox'];
      if (!sameSite) flags.push('allow-same-origin');
      if (fig.dataset.interactive) flags.push('allow-forms', 'allow-modals');
      f.setAttribute('sandbox', flags.filter(x => f.sandbox?.supports?.(x) ?? true).join(' ')); // Safari 不認得 allow-presentation
      fig.querySelector('.poster')?.remove();
      fig.prepend(f);
    }
    for (const fig of root.querySelectorAll('[data-page]')) {
      if (fig.querySelector('iframe')) continue;
      jobs.push(mountPage(fig, source));
    }
    for (const b of root.querySelectorAll('[data-open-page]')) b.onclick = e => { e.stopPropagation(); openPageTab(b.dataset.openPage, source); };
  }
  await Promise.all(jobs);
}

// ---------- 簡報資料夾裡的 HTML 檔 ----------
// 倉庫(網站上的書庫):直接載入檔案,同資料夾的 CSS / JS 也讀得到。
// 本機資料夾:檔案只能變成瀏覽器內的暫時網址,本網站的安全規則會跟著套用,裡面的程式會被擋下。
// 所以改用 embed.html 這個沒有安全規則的中繼頁:它收到 HTML 內容後,放進一個隔離的框框執行。
// 兩種情況都不給 allow-same-origin:網頁碰不到本網站的資料。
const PAGE_FLAGS = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox';
const HOST = 'embed.html';

/** 等中繼頁準備好,再把 HTML 送過去。 */
function sendPage(win, html, title) {
  const onMsg = e => {
    if (e.source !== win || e.origin !== location.origin || e.data?.type !== 'mdslide-embed-ready') return;
    window.removeEventListener('message', onMsg);
    win.postMessage({ type: 'mdslide-embed', html, title }, location.origin);
  };
  window.addEventListener('message', onMsg);
  setTimeout(() => window.removeEventListener('message', onMsg), 20000);
}

async function readPage(path, source) {
  if (!source.readText) throw new Error('no readText');
  return source.readText(path);
}

async function mountPage(fig, source) {
  const path = fig.dataset.page;
  const f = document.createElement('iframe');
  f.allow = 'fullscreen';
  f.allowFullscreen = true;
  f.title = path.split('/').pop();
  try {
    if (source.kind === 'repo') {
      f.setAttribute('sandbox', PAGE_FLAGS.split(' ').filter(x => f.sandbox?.supports?.(x) ?? true).join(' '));
      const url = await source.mediaURL(path);
      fig.prepend(f); // 先放進畫面再設定網址:有些瀏覽器不會載入還沒放進畫面的框框
      fig.querySelector('.poster')?.remove();
      f.src = url;
      return;
    }
    {
      const html = await readPage(path, source);
      fig.prepend(f);
      fig.querySelector('.poster')?.remove();
      f.src = HOST;
      sendPage(f.contentWindow, html, f.title);
    }
  } catch {
    f.remove();
    missing(fig.querySelector('.poster') || fig, path);
  }
}

/** 在新分頁開啟(本機資料夾也能用)。 */
async function openPageTab(path, source) {
  if (source.kind === 'repo') return window.open(await source.mediaURL(path), '_blank', 'noopener');
  const html = await readPage(path, source).catch(() => null);
  if (html == null) return;
  const win = window.open(HOST, '_blank');
  if (win) sendPage(win, html, path.split('/').pop());
}

function missing(el, path) {
  const fig = el.closest('figure');
  const box = document.createElement('div');
  box.className = 'missing';
  const lang = el.closest('[lang]')?.getAttribute('lang'); // 依簡報語言,不是介面語言
  box.innerHTML = `${escapeHTML(t('slide.missingMedia', null, lang))}<br><small>${escapeHTML(path)}</small>`;
  if (fig) { el.remove(); fig.append(box); } else el.replaceWith(box);
}

export function playMedia(root, { sound = false } = {}) {
  for (const v of root.querySelectorAll('video, audio')) {
    if (sound) { v.muted = false; v.controls = true; v.currentTime = 0; }
    v.play()?.catch(() => { v.muted = true; v.play()?.catch(() => {}); });
  }
}

export function stopMedia(root) {
  for (const v of root.querySelectorAll('video, audio')) v.pause();
  for (const f of root.querySelectorAll('iframe')) f.src = 'about:blank';
}

/**
 * 截圖標註:圖片以 contain 顯示時,算出圖片在框裡的實際位置,讓標註層剛好蓋在圖片上。
 * 投影片固定 1280×720(外面再整體縮放),所以用 offset 尺寸計算即可,不必跟著視窗大小重算。
 */
export function placeMarks(img) {
  const layer = img.parentElement?.querySelector('.marks');
  if (!layer || !img.naturalWidth) return;
  const fw = img.offsetWidth, fh = img.offsetHeight;
  if (!fw || !fh) { requestAnimationFrame(() => placeMarks(img)); return; } // 還沒排版(例如在隱藏的元素裡)
  const k = Math.min(fw / img.naturalWidth, fh / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  Object.assign(layer.style, { left: `${img.offsetLeft + (fw - w) / 2}px`, top: `${img.offsetTop + (fh - h) / 2}px`, width: `${w}px`, height: `${h}px` });
  layer.classList.add('on');
}

