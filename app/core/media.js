// 判斷媒體類型:本機圖片 / 本機影片 / 線上嵌入(YouTube、Bilibili、Google Drive、Vimeo)/
// 互動網頁(GitHub Pages、CodePen、簡報資料夾裡的 .html 檔)。

import { ext, isURL } from './names.js';

const IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const PAGE = new Set(['html', 'htm']);

/**
 * @returns {{ kind: 'image'|'video'|'audio'|'embed'|'page'|'unknown', src: string, provider?: string, embed?: string, thumb?: string, interactive?: boolean, remote: boolean }}
 */
export function classifyMedia(src) {
  const s = src.trim();
  const remote = isURL(s);
  if (remote) {
    let m;
    if ((m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/))) {
      const t = s.match(/[?&](?:t|start)=(\d+)/);
      return { kind: 'embed', src: s, remote, provider: 'YouTube',
        embed: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&playsinline=1${t ? `&start=${t[1]}` : ''}`,
        thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` };
    }
    if ((m = s.match(/bilibili\.com\/video\/(BV[\w]+|av\d+)/i)) || (m = s.match(/b23\.tv\/(BV[\w]+)/i))) {
      const id = m[1];
      const q = id.startsWith('av') ? `aid=${id.slice(2)}` : `bvid=${id}`;
      const p = s.match(/[?&]p=(\d+)/);
      return { kind: 'embed', src: s, remote, provider: 'Bilibili',
        embed: `https://player.bilibili.com/player.html?${q}&page=${p ? p[1] : 1}&autoplay=0&high_quality=1` };
    }
    if ((m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/))) {
      return { kind: 'embed', src: s, remote, provider: 'Google Drive', embed: `https://drive.google.com/file/d/${m[1]}/preview` };
    }
    if ((m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/))) {
      return { kind: 'embed', src: s, remote, provider: 'Vimeo', embed: `https://player.vimeo.com/video/${m[1]}` };
    }
    // 互動網頁:CodePen 的作品(顯示執行結果)、GitHub Pages 上的網頁
    if ((m = s.match(/^https:\/\/codepen\.io\/([\w-]+)\/(?:pen|full|details|embed)\/([\w-]+)/i))) {
      return { kind: 'embed', src: s, remote, provider: 'CodePen', interactive: true,
        embed: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result&editable=false` };
    }
    const path = s.split(/[?#]/)[0];
    if (/^https:\/\/[\w-]+\.github\.io(\/|$)/i.test(s) && !IMAGE.has(ext(path)) && !VIDEO.has(ext(path)) && !AUDIO.has(ext(path))) {
      return { kind: 'embed', src: s, remote, provider: 'GitHub Pages', interactive: true, embed: s };
    }
  }
  const e = ext(s.split(/[?#]/)[0]);
  if (!remote && PAGE.has(e)) return { kind: 'page', src: s, remote, provider: 'HTML', interactive: true };
  if (IMAGE.has(e)) return { kind: 'image', src: s, remote };
  if (VIDEO.has(e)) return { kind: 'video', src: s, remote };
  if (AUDIO.has(e)) return { kind: 'audio', src: s, remote };
  if (/^data:image\//.test(s)) return { kind: 'image', src: s, remote: true };
  return { kind: remote ? 'image' : 'unknown', src: s, remote };
}

/**
 * 素材路徑規則:
 *   media/a.jpg   → 相對於「簡報資料夾」(建議寫法,任何章節都通用)
 *   ./a.jpg       → 相對於這個 MD 檔所在的資料夾
 *   ../x/a.jpg    → 同上,可往上
 *   /a.jpg        → 相對於簡報資料夾
 */
export function resolveMediaPath(src, { projectPath, filePath }) {
  if (isURL(src)) return src;
  const parts = [];
  let rel = src;
  if (rel.startsWith('./') || rel.startsWith('../')) {
    parts.push(...filePath.split('/').slice(0, -1));
  } else {
    parts.push(...projectPath.split('/').filter(Boolean));
    rel = rel.replace(/^\/+/, '');
  }
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}
