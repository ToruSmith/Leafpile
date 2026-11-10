// 顏色值白名單。設定檔與投影片裡的顏色會直接放進 style 屬性,
// 只接受下列格式,避免 `red;background:url(...)` 這類內容注入樣式。
//   #rgb  #rrggbb  #rrggbbaa   rgb()/rgba()/hsl()/hsla()(只含數字)   英文顏色名稱(red、teal…)

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.\s,/%+-]+(?:deg)?[\d.\s,/%+-]*\)$/i;
const NAMED = /^[a-z]{3,24}$/i;

/** 合法就回傳整理過的顏色字串,否則回傳 null。 */
export function safeColor(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v || v.length > 64) return null;
  return HEX.test(v) || FUNC.test(v) || NAMED.test(v) ? v : null;
}
