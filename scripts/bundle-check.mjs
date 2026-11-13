#!/usr/bin/env node
// 把檢查工具打包成「單一檔案」dist/leafpile-check.mjs,可以直接複製到任何書庫資料夾使用。
// 內容由 app/core/ 與 scripts/node-source.mjs 自動組合,請不要手動修改 dist/ 裡的檔案;
// 改了 app/core/ 之後執行:node scripts/bundle-check.mjs(tests/bundle.test.mjs 會檢查是否同步)。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// 入口:從這兩個檔案開始,依 import 自動找出所有需要的模組並排好順序(不用手動維護清單)
const ENTRIES = ['app/core/check.js', 'app/core/index.js', 'app/core/i18n.js', 'scripts/node-source.mjs'];

async function collect() {
  const order = [], seen = new Set();
  const visit = async rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = await readFile(root + rel, 'utf8');
    for (const m of src.matchAll(/^import\s+[^;]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      await visit(new URL(m[1], 'file:///' + rel).pathname.slice(1));
    }
    order.push(rel); // 相依的模組先放
  };
  for (const e of ENTRIES) await visit(e);
  return order;
}

/** 模組的匯出名稱:export function/const/class 與 export { a, b }。 */
function exportsOf(src) {
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\};?\s*$/gm)) names.push(...m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  return names;
}

/** import { a, b as c } from './x.js' → const { a, b: c } = __m['app/core/x.js']; */
function localImport(clause, key) {
  const ns = clause.match(/^\*\s+as\s+([\w$]+)$/);
  if (ns) return `const ${ns[1]} = __m[${JSON.stringify(key)}];`;
  const named = clause.match(/^\{([^}]*)\}$/);
  if (!named) throw new Error('bundle-check: 不支援的 import 寫法:' + clause);
  const parts = named[1].split(',').map(x => x.trim()).filter(Boolean).map(x => x.replace(/\s+as\s+/, ': '));
  return `const { ${parts.join(', ')} } = __m[${JSON.stringify(key)}];`;
}

export async function bundle() {
  const nodeImports = new Set();
  const parts = [];
  for (const m of await collect()) {
    let src = await readFile(root + m, 'utf8');
    const names = exportsOf(src);
    src = src.replace(/^import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (line, clause, from) => {
      if (from.startsWith('node:')) { nodeImports.add(line.trim()); return ''; }
      return localImport(clause.trim(), new URL(from, 'file:///' + m).pathname.slice(1));
    });
    src = src.replace(/^export\s+(?=(async\s+)?(function|const|let|class)\b)/gm, '')
             .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
             .replace(/^#!.*\n/, '');
    // 每個模組包在自己的範圍裡:不同模組的同名私有函式(limit、readYaml…)才不會互相衝突
    parts.push(`// ───────── ${m} ─────────\n__m[${JSON.stringify(m)}] = (() => {\n${src.trim()}\nreturn { ${names.join(', ')} };\n})();\n`);
  }
  const version = JSON.parse(await readFile(root + 'package.json', 'utf8')).version || '';
  return `#!/usr/bin/env node
// Leafpile 書庫檢查工具(單檔版${version ? ' v' + version : ''})
// 由 scripts/bundle-check.mjs 自動產生,請不要手動修改。原始碼:https://github.com/ToruSmith/Leafpile
//
// 用法(需要 Node.js 18 以上):
//   node leafpile-check.mjs                 檢查這個檔案所在的資料夾(放在書庫根目錄時 = 整個書庫)
//   node leafpile-check.mjs <資料夾>         檢查指定的書庫(Leafpile 或 Mdslide Pile)、主題或單一簡報
//   node leafpile-check.mjs <資料夾> --slides 連每張投影片都列出來
//   node leafpile-check.mjs <資料夾> --lang en  英文輸出(預設依作業系統語言)
//   node leafpile-check.mjs <資料夾> --index    書庫索引:所有筆記、簡報、畫布與連結(給 AI 先看全貌)
//                                             --index=json 輸出 JSON;加 --public 只列公開的筆記
// Windows 也可以直接雙擊 check-library.cmd,Mac 雙擊 check-library.command。

${[...nodeImports].sort().join('\n')}
import { fileURLToPath as __toPath } from 'node:url';

const __m = {};
${parts.join('\n')}
// ───────── 命令列 ─────────
const { checkVault, formatReport } = __m['app/core/check.js'];
const { setLang } = __m['app/core/i18n.js'];
const { nodeSource, detectNodeLang } = __m['scripts/node-source.mjs'];
setLang(detectNodeLang());
const __args = process.argv.slice(2);
const __dir = __args.find((a, i) => !a.startsWith('--') && __args[i - 1] !== '--lang') || __toPath(new URL('.', import.meta.url));
const __index = __args.find(a => a === '--index' || a.startsWith('--index='));
if (__index) {
  const { libraryIndex, indexMarkdown } = __m['app/core/index.js'];
  const __idx = await libraryIndex(nodeSource(__dir), { publicOnly: __args.includes('--public') });
  console.log(__index === '--index=json' ? JSON.stringify(__idx, null, 2) : indexMarkdown(__idx));
} else {
  const __report = await checkVault(nodeSource(__dir));
  console.log(formatReport(__report, { verbose: process.argv.includes('--slides') }));
  if (__report.problems.length) process.exitCode = 1;
}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await mkdir(root + 'dist', { recursive: true });
  await writeFile(root + 'dist/leafpile-check.mjs', await bundle());
  console.log('已產生 dist/leafpile-check.mjs');
}
