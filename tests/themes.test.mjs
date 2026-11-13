// 主題:每個登記的主題都有完整的顏色變數、中英文名稱,而且文字對比夠(做法參考 reading-notes-vault)。
// 新增主題時這個測試會告訴你漏了哪個變數、哪個顏色太淡。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES, DARK, uiThemeFor } from '../app/player/themes.js';
import { LOCALE_ZH_HANT as zh } from '../app/core/locales/zh-Hant.js';
import { LOCALE_EN as en } from '../app/core/locales/en.js';

const css = readFileSync(new URL('../app/styles/themes.css', import.meta.url), 'utf8');

/** 某個主題區塊的變數(paper 也包含 :root 的預設)。 */
function varsOf(theme) {
  const re = theme === 'paper' ? /:root, \[data-theme="paper"\] \{([\s\S]*?)\n\}/ : new RegExp(`\\[data-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`);
  const m = css.match(re);
  if (!m) return null;
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(x => [x[1], x[2].trim()]));
}
const COLORS = ['bg', 'bg-deep', 'surface', 'ink', 'muted', 'line', 'shadow', 'accent', 'vignette', 'slide-bg', 'slide-ink', 'slide-muted', 'slide-soft', 'ok', 'danger', 'warn', 'info', 'mark', 'on-accent', 'bar'];

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('themes:每個主題都有完整的顏色變數與中英文名稱', () => {
  for (const th of THEMES) {
    const v = varsOf(th);
    assert.ok(v, `themes.css 缺少 [data-theme="${th}"]`);
    for (const k of COLORS) assert.ok(k in v, `主題 ${th} 缺少 --${k}`);
    assert.ok(zh['theme.' + th] && en['theme.' + th], `主題 ${th} 缺少中英文名稱(theme.${th})`);
    assert.match(css, new RegExp(`\\[data-theme="${th}"\\][^{]*\\{[^}]*color-scheme: ${DARK.has(th) ? 'dark' : 'light'}`), `主題 ${th} 的 color-scheme 與 DARK 清單不一致`);
  }
});

test('themes:文字對比(內文 ≥ 7、語意色 ≥ 4.5、次要文字、強調色與強調色底上的字 ≥ 3)', () => {
  for (const th of THEMES) {
    const v = varsOf(th);
    for (const bg of ['surface', 'bg']) {
      assert.ok(contrast(v.ink, v[bg]) >= 7, `${th}:--ink 在 --${bg} 上對比 ${contrast(v.ink, v[bg]).toFixed(2)} < 7`);
      assert.ok(contrast(v.muted, v[bg]) >= 3, `${th}:--muted 在 --${bg} 上對比太低`);
    }
    assert.ok(contrast(v['slide-ink'], v['slide-bg']) >= 7, `${th}:投影片文字對比太低`);
    assert.ok(contrast(v.accent, v.surface) >= 3, `${th}:--accent 對比太低`);
    assert.ok(contrast(v['on-accent'], v.accent) >= 3, `${th}:強調色底上的字(--on-accent)對比 ${contrast(v['on-accent'], v.accent).toFixed(2)} < 3`);
    for (const k of ['ok', 'danger', 'warn', 'info']) {
      for (const bg of ['surface', 'bg']) assert.ok(contrast(v[k], v[bg]) >= 4.5, `${th}:--${k} 在 --${bg} 上對比 ${contrast(v[k], v[bg]).toFixed(2)} < 4.5`);
    }
  }
});

test('themes:介面主題的選擇順序(外觀選單 → 深色模式 → 書庫設定)', () => {
  assert.equal(uiThemeFor('slate', { choice: '', dark: false }), 'slate');
  assert.equal(uiThemeFor('slate', { choice: '', dark: true }), 'ink');
  assert.equal(uiThemeFor('slate', { choice: 'sepia', dark: true }), 'sepia', '使用者的選擇優先於深色模式');
  assert.equal(uiThemeFor('nope', { choice: 'nope', dark: false }), 'paper', '不認得的名稱用 paper');
});
