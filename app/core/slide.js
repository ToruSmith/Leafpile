// 把一個 MD 檔解析成一張或多張投影片的資料(還不是 HTML)。

import { parseYaml, YamlError } from './yaml.js';
import { classifyMedia } from './media.js';
import { safeColor } from './color.js';
import { readSlideStyle } from './style.js';
import { t } from './i18n.js';

/** 所有支援的版型。新增版型時,記得同步更新 製作專案指南.md 與 app/player/render.js。 */
export const LAYOUTS = ['auto', 'text', 'center', 'split', 'split-left', 'full', 'quote', 'number', 'stats', 'timeline', 'columns', 'agenda', 'chart', 'flow', 'gallery', 'grid', 'title', 'section', 'end'];

const MEDIA_LINE = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)\s*$/;
const NOTE_LINE = /^\s*(?:note|notes|備註|講者備註)\s*[:：]\s*(.*)$/i; // i18n-ok:語法關鍵字,不是介面文字
const META_LINE = /^\s*<!--\s*([\w-]+)\s*:\s*(.*?)\s*-->\s*$/;

/**
 * @param {string} text 檔案內容
 * @param {{ path: string }} info
 * @returns {{ slides: object[], issues: {path:string, message:string}[] }}
 */
export function parseSlideFile(text, { path }) {
  const issues = [];
  let src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let fileMeta = {};

  // 檔案開頭的 front matter
  const fm = src.match(/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/);
  if (fm) {
    try { fileMeta = parseYaml(fm[1]) || {}; }
    catch (e) { issues.push({ path, message: t('issue.frontMatter', { detail: e instanceof YamlError ? e.message : t('issue.frontMatterParse') }) }); }
    src = src.slice(fm[0].length);
  }

  const segments = splitSegments(src);
  const slides = [];
  segments.forEach((seg, index) => {
    if (!seg.trim() && segments.length > 1) return;
    slides.push(parseSegment(seg, { path, index, fileMeta, issues }));
  });
  if (!slides.length) slides.push(parseSegment('', { path, index: 0, fileMeta, issues }));
  return { slides, issues };
}

/** 依單獨一行的 `---` 切開(程式碼區塊裡的不算)。 */
function splitSegments(src) {
  const out = [[]];
  let fence = null;
  for (const line of src.split('\n')) {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && /^---\s*$/.test(line)) { out.push([]); continue; }
    out.at(-1).push(line);
  }
  return out.map(l => l.join('\n'));
}

function parseSegment(seg, { path, index, fileMeta, issues }) {
  const meta = { ...fileMeta };
  let lines = seg.split('\n');

  // 段落開頭的 <!-- key: value --> 設定(只影響這一張)
  while (lines.length && (lines[0].trim() === '' || META_LINE.test(lines[0]))) {
    const m = lines[0].match(META_LINE);
    if (m && m[1].toLowerCase() === 'mark') { // 標註可以有很多行
      const mk = parseMark(m[2]);
      if (mk) (meta.marks ||= []).push(mk);
      else issues.push({ path, message: t('issue.mark', { value: m[2] }) });
    } else if (m) meta[m[1]] = coerce(m[2]);
    lines.shift();
  }

  // 講者備註
  let notes = '';
  const n = lines.findIndex(l => NOTE_LINE.test(l));
  if (n >= 0) {
    const first = lines[n].match(NOTE_LINE)[1];
    notes = [first, ...lines.slice(n + 1)].join('\n').trim();
    lines = lines.slice(0, n);
  }

  // 單獨一行的圖片 / 影片 = 這張投影片的主要媒體
  const media = [];
  let fence = false;
  const bodyLines = [];
  // 分欄與多區塊:圖片留在原來的區塊裡顯示(其他版型則抽出來當主要媒體)
  const inline = ['columns', 'grid'].includes(String(meta.layout || '').toLowerCase());
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && l.match(MEDIA_LINE);
    if (m) media.push({ alt: m[1], caption: m[3] || m[1], ...classifyMedia(m[2]) });
    if (!m || inline) bodyLines.push(l);
  }
  const body = bodyLines.join('\n').replace(/^\n+|\n+$/g, '');

  if (meta.color != null && !safeColor(meta.color)) {
    issues.push({ path, message: t('issue.slideColor', { value: meta.color }) });
    delete meta.color;
  }

  const style = readSlideStyle(meta, { path, issues, t });

  let layout = String(meta.layout || 'auto').toLowerCase();
  if (!LAYOUTS.includes(layout)) {
    issues.push({ path, message: t('issue.layout', { layout, list: LAYOUTS.join(', ') }) });
    layout = 'auto';
  }
  if (layout === 'auto') layout = autoLayout(body, media);

  const heading = body.match(/^#{1,3}\s+(.+)$/m);
  const firstLine = body.split('\n').find(l => l.trim())?.replace(/^\s*(>|[-*+]|\d+[.)])\s*/, '').replace(/[*_`~=#]/g, '').trim() || '';
  const title = String(meta.title || (heading ? heading[1].replace(/[*_`~=]/g, '').trim() : (media[0]?.caption || firstLine.slice(0, 40))));

  return { file: path, index, meta, style, layout, body, notes, media, title };
}

/**
 * 截圖標註:`x y w h [#顏色] [標籤文字]`,前四個是在圖片上的百分比位置(左、上、寬、高)。
 * 例:`52 5 40 25 我說需求`、`10 40 30 20 #1e88e5 AI 給做法`。
 */
export function parseMark(value) {
  const parts = String(value).trim().split(/\s+/);
  const nums = parts.slice(0, 4).map(Number);
  if (nums.length < 4 || nums.some(n => !Number.isFinite(n) || n < 0 || n > 100)) return null;
  const [x, y, w, h] = nums;
  if (w <= 0 || h <= 0 || x + w > 100.5 || y + h > 100.5) return null;
  let rest = parts.slice(4);
  let color = null;
  if (rest[0] && /^#[0-9a-f]{3,8}$/i.test(rest[0])) { color = safeColor(rest[0]); rest = rest.slice(1); }
  const label = rest.join(' ').replace(/^["']|["']$/g, '').slice(0, 40);
  return { x, y, w, h, color, label };
}

function autoLayout(body, media) {
  const text = body.trim();
  if (media.length > 1) return 'gallery'; // 好幾個單獨一行的圖片 / 影片:並排
  if (media.length && !text) return 'full';
  if (media.length && text.split('\n').filter(l => l.trim()).every(l => /^\s*>/.test(l) || /^\s*(—|--|──)/.test(l))) return 'quote'; // 引言 + 照片 = 引言加頭像
  if (media.length) return 'split';
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length && lines.every(l => /^\s*>/.test(l) || /^\s*(—|--|──)/.test(l))) return 'quote';
  const big = lines[0]?.match(/^##\s+(.+)$/);
  if (big && big[1].length <= 14 && lines.length <= 3) return 'number';
  return 'text';
}

function coerce(v) {
  if (/^(true|false)$/i.test(v)) return /^true$/i.test(v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/^["']|["']$/g, '');
}
