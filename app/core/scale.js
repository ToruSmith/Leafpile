// 筆記閱讀字級:十級,0.8 到 2.2 倍。純邏輯,瀏覽器與測試共用。

// 舊版只有 0.9、1、1.12、1.25、1.4,這些值都還在清單裡,升級後已存的設定不會被重設
export const SCALES = [0.8, 0.9, 1, 1.12, 1.25, 1.4, 1.6, 1.8, 2, 2.2];
export const DEFAULT_SCALE = 1;

/** 顯示成百分比,例如 1.12 → "112%"。 */
export const pct = v => Math.round(v * 100) + '%';

/** 讀回存起來的字級;不在清單裡(壞資料、手改過)就回到預設。 */
export function parseScale(raw) {
  const v = Number(raw);
  return raw != null && raw !== '' && SCALES.includes(v) ? v : DEFAULT_SCALE;
}

/** 從目前字級往上(+1)或下(-1)走一級,到頭就停;0 = 回到預設。 */
export function stepScale(cur, d) {
  if (d === 0) return DEFAULT_SCALE;
  const i = SCALES.indexOf(cur), base = i < 0 ? SCALES.indexOf(DEFAULT_SCALE) : i;
  return SCALES[Math.min(SCALES.length - 1, Math.max(0, base + d))];
}
