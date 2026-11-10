// Node 版資料來源:讓建置腳本與檢查工具使用和瀏覽器完全相同的解析器(app/core)。

// 用命名空間匯入,避免打包成單檔時與 app/core 的同名函式衝突
import * as fsp from 'node:fs/promises';
import * as nodePath from 'node:path';

export function nodeSource(root) {
  const abs = nodePath.resolve(root);
  return {
    label: nodePath.basename(abs),
    root: abs,
    async list(path) {
      const entries = await fsp.readdir(nodePath.join(abs, path), { withFileTypes: true });
      return entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' }));
    },
    async readText(path) { return fsp.readFile(nodePath.join(abs, path), 'utf8'); },
    async mediaURL(path) { return path; },
  };
}

/**
 * 命令列的輸出語言:--lang 參數 → 環境變數(LC_ALL、LC_MESSAGES、LANG)→ 作業系統語系 → 繁中。
 * Windows 通常沒有 LANG,所以會用作業系統語系(繁中 Windows 會得到 zh-TW)。
 */
export function detectNodeLang(argv = process.argv) {
  const i = argv.indexOf('--lang');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find(a => a.startsWith('--lang='));
  if (eq) return eq.slice(7);
  for (const k of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const v = process.env[k];
    if (v && !/^(C|POSIX)(\.|$)/i.test(v)) return v;
  }
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return 'zh-Hant'; }
}

/** 走訪整棵樹,回傳 { 路徑: 清單 }(給 catalog.json 用)。 */
export async function walkTree(source, path = '', tree = {}) {
  const entries = await source.list(path);
  tree[path] = entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) if (e.kind === 'dir') await walkTree(source, path ? `${path}/${e.name}` : e.name, tree);
  return tree;
}
