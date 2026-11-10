// 快閃播放:把一篇筆記暫時拆成投影片,交給原本的播放器。不產生任何檔案(docs/INTEROP.md 第 2 節)。
//
// 拆張規則:
//   有單獨一行的 --- → 依它拆
//   否則依 ## 拆;第一個 # 只當標題(自動標題頁),## 之前的文字是第一張
// 版型一律 auto,筆記裡寫的投影片設定(<!-- layout: … -->)照樣有效;front matter 只讀 title、date。

import { parseSlideFile } from '../core/slide.js';
import { detectDeckLang } from '../core/i18n.js';
import { PALETTE } from '../core/library.js';

const FENCE = /^\s*(```+|~~~+)/;

/** 把筆記內文切成投影片段落(還是 Markdown)。 */
export function splitNoteForSlides(body) {
  const lines = String(body).replace(/\r\n?/g, '\n').split('\n');
  let fence = null;
  const isRule = [], isH2 = [];
  lines.forEach((l, i) => {
    const f = l.match(FENCE);
    if (f) fence = fence ? (l.trim().startsWith(fence) ? null : fence) : f[1];
    isRule[i] = !fence && /^---\s*$/.test(l);
    isH2[i] = !fence && /^##\s+/.test(l);
  });
  // 第一個 # 標題拿掉(自動標題頁會顯示)
  const h1 = lines.findIndex((l, i) => !isRule[i] && /^#\s+/.test(l));
  const keep = (_, i) => i !== h1;
  const out = [[]];
  if (isRule.some(Boolean)) {
    lines.forEach((l, i) => { if (!keep(l, i)) return; if (isRule[i]) out.push([]); else out.at(-1).push(l); });
  } else {
    lines.forEach((l, i) => { if (!keep(l, i)) return; if (isH2[i] && out.at(-1).some(x => x.trim())) out.push([]); out.at(-1).push(l); });
  }
  return out.map(seg => seg.join('\n').trim()).filter(Boolean);
}

/**
 * 筆記 → 播放器要的 deck 物件(和 core/library.js 的 loadDeck 同樣的形狀)。
 * @param note core/note.js 的 parseNote 結果
 * @param {{ rel: string, theme?: string, color?: string, topicTitle?: string }} ctx rel = 在筆記渠道裡的路徑
 */
export function noteToDeck(note, { rel, theme = '', color = '', topicTitle = '' }) {
  const dir = rel.split('/').slice(0, -1).join('/');
  const slides = [];
  const issues = [];
  for (const seg of splitNoteForSlides(note.body)) {
    // 每段當成一個獨立的投影片檔解析:--- 已經切過了,段落裡不會再有
    // 筆記的 ## 是小標題;投影片的標題是 #(Mdslide 的 ## 是「大數字」版型,不能直接沿用)
    const r = parseSlideFile(seg.replace(/^##\s+/, '# '), { path: rel });
    issues.push(...r.issues);
    slides.push(...r.slides.filter(s => !s.meta.hidden));
  }
  slides.forEach((s, i) => { s.index = i; });
  slides.unshift({ file: rel, index: -1, meta: {}, layout: 'title', body: '', notes: '', media: [], title: note.title, auto: true });
  const accent = color || PALETTE[0];
  return {
    id: rel, topicId: '', folder: '', path: dir, hasConfig: true,
    title: note.title, subtitle: '', author: '', date: note.date || '', event: '', tags: note.tags || [],
    theme, accent, coverImage: '', brand: null,
    lang: detectDeckLang(note.lang, note.title, note.body.slice(0, 400)),
    config: { kicker: topicTitle },
    sections: [{ id: '_flash', folder: '', path: dir, title: '', subtitle: '', color: accent, slides }],
    stage: 'pile', transition: 'shuffle', size: '', issues,
    flash: true,
  };
}
