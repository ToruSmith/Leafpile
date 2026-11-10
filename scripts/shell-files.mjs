// 網站本身(遊戲機)的檔案清單與雜湊,給 service worker 預先快取。
// 簡報內容(content/)與 catalog.json 不在清單裡:那些一律走網路。
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const TOP = ['index.html', 'offline.html', 'embed.html', 'manifest.webmanifest', 'icon.svg',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

async function walk(root, dir, out) {
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) await walk(root, rel, out);
    else if (/\.(js|css)$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** 回傳 [{ path, hash }],路徑相對於網站根目錄、依字母排序。 */
export async function shellFiles(root) {
  const paths = [...TOP, ...(await walk(root, 'app', []))].sort();
  return Promise.all(paths.map(async path => ({ path, hash: createHash('sha256').update(await readFile(join(root, path))).digest('hex').slice(0, 12) })));
}

/** sw.js 用 importScripts 讀取的內容。 */
export function shellManifest(files) {
  const version = createHash('sha256').update(files.map(f => f.path + ':' + f.hash).join('\n')).digest('hex').slice(0, 12);
  return `// 自動產生(scripts/build-catalog.mjs),請不要手動修改。\nself.SHELL = ${JSON.stringify({ version, files: ['./', ...files.map(f => f.path)] }, null, 1)};\n`;
}
