// 智慧貼上:接在一個 <textarea> 上。從網頁、Word、Google 文件、Notion、Claude 對話複製的內容,
// 剪貼簿裡有 HTML 版本;貼上時轉成 Markdown(規則在 core/html-md.js)。
// 轉換後右下角提示「已轉成 Markdown」,旁邊有「改貼純文字」;Ctrl+Shift+V(⌘⇧V)一律貼純文字。
// 剪貼簿沒有 HTML、或轉不出結構(程式編輯器複製的上色文字、本來就是 Markdown 的文字)時,不干預。
// 筆記編輯器與畫布的側邊面板共用。

import { pasteMarkdown } from '../core/html-md.js';
import { t } from '../core/i18n.js';
import { toast } from './dialog.js';

/** 在游標處插入文字(取代選取範圍),盡量保留瀏覽器的「復原」。 */
function insertAt(ta, s) {
  ta.focus();
  const ok = (() => { try { return document.execCommand('insertText', false, s); } catch { return false; } })();
  if (ok) return;
  ta.setRangeText(s, ta.selectionStart, ta.selectionEnd, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * @param {HTMLTextAreaElement} ta
 * @returns {() => void} 取消接上
 */
export function attachPaste(ta) {
  let plain = false;
  const onKey = e => { plain = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v'; };
  const onPaste = e => {
    const wantPlain = plain;
    plain = false;
    const cd = e.clipboardData;
    if (wantPlain || e.defaultPrevented || !cd || cd.files?.length || ta.readOnly) return;
    const html = cd.getData('text/html');
    if (!html) return;
    const text = cd.getData('text/plain');
    const md = pasteMarkdown(html, text);
    if (md == null) return;
    e.preventDefault();
    const start = ta.selectionStart;
    insertAt(ta, md);
    toast(t('paste.converted'), {
      ms: 8000,
      actions: [{
        label: t('paste.plain'),
        run: () => {
          // 內容在這之後被改過就不動它
          if (ta.value.slice(start, start + md.length) !== md) return;
          ta.focus();
          ta.setSelectionRange(start, start + md.length);
          insertAt(ta, text);
        },
      }],
    });
  };
  ta.addEventListener('keydown', onKey);
  ta.addEventListener('paste', onPaste);
  return () => { ta.removeEventListener('keydown', onKey); ta.removeEventListener('paste', onPaste); };
}
