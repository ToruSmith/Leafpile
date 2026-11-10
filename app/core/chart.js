// 圖表資料解析與座標軸級距。render.js(畫圖)與 check.js(檢查)共用,純函式、零依賴。

/**
 * 把表格裡的一格轉成數字。支援千分位、全形負號(−)、%、單位後綴(點、億、張…)與常見貨幣前綴。
 * 無法解析(空白、N/A、—、文字)時回傳 null。
 */
const MISSING = /^(n\/?a|na|null|none|—|–|-|－|無|缺)$/i; // i18n-ok:缺值的寫法

export function parseNumber(cell) {
  let s = String(cell ?? '').trim();
  if (!s || MISSING.test(s)) return null;
  s = s.replace(/^(NT\$|US\$|HK\$|NTD|USD|\$|¥|€|£)\s*/i, '');
  const m = s.match(/^([+\-−–－]?)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*([^\d].*)?$/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return m[1] && m[1] !== '+' ? -n : n;
}

/**
 * 從投影片內文取出第一個表格。第一欄是標籤,其餘欄是數列。
 * @returns {null | { labels: string[], series: { name: string, values: (number|null)[] }[], before: string, after: string, bad: { row: number, col: number, text: string }[] }}
 */
export function parseChartTable(body) {
  const lines = String(body).split('\n');
  const start = lines.findIndex((l, k) => l.includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[k + 1] || ''));
  if (start < 0) return null;
  let end = start + 2;
  while (end < lines.length && lines[end].includes('|') && lines[end].trim()) end++;
  const row = l => l.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
  const header = row(lines[start]);
  const rows = lines.slice(start + 2, end).map(row);
  const bad = [];
  const series = header.slice(1).map((name, k) => ({
    name,
    values: rows.map((r, ri) => {
      const v = parseNumber(r[k + 1]);
      if (v == null && String(r[k + 1] ?? '').trim() && !MISSING.test(String(r[k + 1]).trim())) bad.push({ row: ri + 1, col: k + 2, text: String(r[k + 1]) });
      return v;
    }),
  }));
  return { labels: rows.map(r => r[0] ?? ''), series, before: lines.slice(0, start).join('\n'), after: lines.slice(end).join('\n'), bad };
}

/**
 * 座標軸範圍:一定包含 0,級距為 1/2/5×10ⁿ,選「不超過 6 格」中最細的級距。
 * @returns {{ lo: number, hi: number, step: number, ticks: number[] }}
 */
export function niceScale(min, max) {
  let lo = Math.min(0, min), hi = Math.max(0, max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) hi = lo + 1;
  const range = hi - lo;
  let step = 1;
  for (let e = Math.floor(Math.log10(range / 6)) - 1; ; e++) {
    const hit = [1, 2, 5].map(m => m * 10 ** e).find(s => Math.ceil(hi / s - 1e-9) - Math.floor(lo / s + 1e-9) <= 6);
    if (hit) { step = hit; break; }
  }
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Number(v.toFixed(decimals)));
  return { lo: ticks[0], hi: ticks.at(-1), step, ticks };
}
