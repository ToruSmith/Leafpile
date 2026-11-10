// 多語系:兩份字串表一致、程式用到的鍵都存在、程式裡沒有寫死的中文。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { LOCALE_ZH_HANT } from '../app/core/locales/zh-Hant.js';
import { LOCALE_EN } from '../app/core/locales/en.js';
import { STAGES } from '../app/player/layouts.js';
import { THEMES } from '../app/player/themes.js';
import { t, detectDeckLang } from '../app/core/i18n.js';

const root = new URL('../', import.meta.url);
async function files(dir, ext = /\.(js|mjs)$/) {
  const out = [];
  for (const e of await readdir(new URL(dir, root), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...await files(p, ext)); else if (ext.test(e.name)) out.push(p);
  }
  return out;
}
const src = async p => readFile(new URL(p, root), 'utf8');
const codeFiles = [...await files('app'), ...await files('scripts')];
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('兩份字串表的鍵完全一致', () => {
  assert.deepEqual(Object.keys(LOCALE_EN).sort(), Object.keys(LOCALE_ZH_HANT).sort());
});

test('兩份字串表的參數佔位一致', () => {
  for (const k of Object.keys(LOCALE_ZH_HANT)) assert.equal(placeholders(LOCALE_EN[k]), placeholders(LOCALE_ZH_HANT[k]), k);
});

test('程式裡用到的每個鍵都存在', async () => {
  const used = new Set();
  for (const f of codeFiles) {
    const s = await src(f);
    for (const m of s.matchAll(/\bt\(\s*'([^']+)'/g)) if (!m[1].endsWith('.')) used.add(m[1]); // 'stage.' + k 這類動態鍵另外檢查
    for (const m of s.matchAll(/\[\s*'[^']*',\s*'(key\.[\w.]+)'\s*\]/g)) used.add(m[1]); // 播放器的快捷鍵清單
  }
  for (const k of Object.keys(STAGES)) used.add('stage.' + k);
  for (const k of THEMES) used.add('theme.' + k);
  for (const k of ['library', 'topic', 'deck']) used.add('check.kind.' + k);
  const missing = [...used].filter(k => !(k in LOCALE_ZH_HANT));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 150, `只找到 ${used.size} 個鍵,掃描可能壞了`);
});

test('程式裡沒有寫死的中文(locales 與註解除外;語法關鍵字以 i18n-ok 標記)', async () => {
  const bad = [];
  for (const f of codeFiles.filter(f => f.startsWith('app/') && !f.includes('/locales/'))) {
    const s = (await src(f)).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    s.split('\n').forEach((line, i) => {
      if (line.includes('i18n-ok')) return;
      const code = line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1');
      if (/[㐀-鿿]/.test(code)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('有用 t() 的檔案,不能把 t 拿來當變數名稱(會蓋掉翻譯函式)', async () => {
  const bad = [];
  for (const f of codeFiles) {
    const s = await src(f);
    if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from/.test(s)) continue;
    const re = /\b(const|let|var)\s+t\b|\(\s*t\s*[,)]|,\s*t\s*[)\]]|\[\s*t\s*,|\bt\s*=>|function\s+\w+\(\s*t\b/g;
    s.split('\n').forEach((line, i) => { if (re.test(line.replace(/\/\/.*$/, ''))) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`); re.lastIndex = 0; });
  }
  assert.deepEqual(bad, []);
});

test('簡報語言判斷', () => {
  assert.equal(detectDeckLang(null, 'Quarterly review'), 'en');
  assert.equal(detectDeckLang(null, 'Mdslide Pile', '把資料夾變成會動的簡報'), 'zh-Hant');
  assert.equal(detectDeckLang('en', '中文標題'), 'en');
  assert.equal(detectDeckLang('zh-TW', 'English'), 'zh-Hant');
  assert.equal(t('slide.thanks', null, 'en'), 'Thank you');
  assert.equal(t('slide.thanks', null, 'zh-Hant'), '謝謝');
});

test('每個版型在編輯模式的選單裡都有名稱(鍵是動態組出來的,一般檢查抓不到)', async () => {
  const { LAYOUTS } = await import('../app/core/slide.js');
  const { LOCALE_ZH_HANT } = await import('../app/core/locales/zh-Hant.js');
  const { LOCALE_EN } = await import('../app/core/locales/en.js');
  for (const l of LAYOUTS) {
    assert.ok(LOCALE_ZH_HANT['layoutName.' + l], `zh-Hant 缺少 layoutName.${l}`);
    assert.ok(LOCALE_EN['layoutName.' + l], `en 缺少 layoutName.${l}`);
  }
});
