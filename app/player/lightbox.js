// 點圖片放大:投影片上的圖常被版面裁切或縮小,點一下看完整的原圖。
// 再點一下、按 Esc 或返回鍵就關閉;手機可以用兩指縮放細看。

import { escapeHTML as esc } from '../core/markdown.js';
import { t } from '../core/i18n.js';

/** 可以放大的圖片:投影片內容裡有載入成功的圖(不含 logo 與線上影片的縮圖)。 */
export function zoomableImage(target) {
  const img = target?.closest?.('img');
  if (!img || img.classList.contains('logo') || img.closest('.poster, .foot')) return null;
  return img.currentSrc || img.src ? img : null;
}

/** 打開放大檢視;回傳關閉函式。onClose 在關閉後呼叫。 */
export function openLightbox(host, img, { onClose } = {}) {
  const caption = img.closest('figure')?.querySelector('figcaption')?.textContent || img.alt || '';
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', t('lightbox.label'));
  box.innerHTML = `<img alt="${esc(img.alt || '')}">${caption ? `<p class="lightbox-cap">${esc(caption)}</p>` : ''}<p class="lightbox-hint">${esc(t('lightbox.hint'))}</p>`;
  box.querySelector('img').src = img.currentSrc || img.src;
  host.append(box);
  // 從原本的位置放大出來
  const from = img.getBoundingClientRect(), big = box.querySelector('img');
  requestAnimationFrame(() => {
    const to = big.getBoundingClientRect();
    if (to.width && from.width) {
      big.animate([
        { transform: `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width})` },
        { transform: 'none' },
      ], { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  });
  const close = () => { box.remove(); onClose?.(); };
  box.addEventListener('click', e => { e.stopPropagation(); close(); });
  return close;
}
