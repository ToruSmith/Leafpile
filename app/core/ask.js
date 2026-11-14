// 對卡片問 AI:把畫布上選取的卡片(群組會展開成裡面的卡片),加上用線連到它們的卡片,組成一段提示詞。
// 和「用 AI 生成」一樣:不呼叫任何 API,只複製提示詞、開啟使用者自己選的 AI 網站。純邏輯,不碰畫面。

import { t } from './i18n.js';
import { withMembers } from './canvas-ops.js';

export const CARD_MAX = 6000;     // 每張選取的卡片最多帶多少字
export const NEIGHBOR_MAX = 300;  // 連線鄰居只帶開頭
export const TOTAL_MAX = 30000;   // 整段提示詞的內容上限(超過的卡片只留標題)

const cut = (s, n) => { const x = String(s || '').trim(); return x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x; };

/**
 * 從畫布挑出要問的卡片與它們的連線鄰居。
 * @param {{ nodes: object[], edges: object[] }} board
 * @param {string[]} ids  選取的節點(群組會帶進裡面的卡片)
 * @param {(node: object) => { title: string, text: string, private?: boolean } | null} read  讀一張卡片的內容;null = 略過(例如圖片)
 * @returns {{ cards: object[], neighbors: object[] }}
 */
export function askContext(board, ids, read) {
  const picked = withMembers(board.nodes || [], ids).filter(n => n.type !== 'group');
  const groups = withMembers(board.nodes || [], ids).filter(n => n.type === 'group' && n.label);
  const inSet = new Set(picked.map(n => n.id));
  const byId = new Map((board.nodes || []).map(n => [n.id, n]));
  const cards = picked.map(n => { const r = read(n); return r && { id: n.id, ...r }; }).filter(Boolean);
  const seen = new Set();
  const neighbors = [];
  for (const e of board.edges || []) {
    const a = inSet.has(e.fromNode), b = inSet.has(e.toNode);
    if (a === b) continue; // 兩端都選了(放在卡片裡)或都沒選
    const other = byId.get(a ? e.toNode : e.fromNode);
    if (!other || other.type === 'group' || seen.has(other.id)) continue;
    const r = read(other);
    if (!r) continue;
    seen.add(other.id);
    const from = cards.find(c => c.id === (a ? e.fromNode : e.toNode));
    neighbors.push({ id: other.id, ...r, label: String(e.label || ''), via: from?.title || '', out: a });
  }
  // 選取的卡片之間的連線,也告訴 AI
  const links = (board.edges || []).filter(e => inSet.has(e.fromNode) && inSet.has(e.toNode)).map(e => ({
    from: cards.find(c => c.id === e.fromNode)?.title || '', to: cards.find(c => c.id === e.toNode)?.title || '', label: String(e.label || ''),
  })).filter(l => l.from && l.to);
  return { cards, neighbors, links, groups: groups.map(g => g.label) };
}

/** 有幾張是私人筆記(複製給 AI 之前要先問)。 */
export const privateCount = ({ cards, neighbors }) => [...cards, ...neighbors].filter(c => c.private).length;

/** 組提示詞。question 留空時用預設的問題。 */
export function buildAskPrompt({ cards, neighbors = [], links = [], groups = [] }, question = '') {
  let budget = TOTAL_MAX;
  const blocks = cards.map(c => {
    const body = budget > 0 ? cut(c.text, Math.min(CARD_MAX, budget)) : t('ask.omitted');
    budget -= body.length;
    return t('ask.card', { title: c.title || t('ask.untitled'), text: body || t('ask.empty') });
  });
  const near = neighbors.map(n => t('ask.neighbor', { title: n.title || t('ask.untitled'), label: n.label ? t('ask.via', { label: n.label }) : '', text: cut(n.text, NEIGHBOR_MAX) }));
  const rel = links.map(l => t('ask.link', { from: l.from, to: l.to, label: l.label ? t('ask.via', { label: l.label }) : '' }));
  return t('ask.prompt', {
    question: String(question).trim() || t('ask.defaultQuestion'),
    n: cards.length,
    groups: groups.length ? t('ask.groups', { list: groups.join(t('check.sep')) }) : '',
    cards: blocks.join('\n'),
    links: rel.length ? t('ask.linksHead') + '\n' + rel.join('\n') + '\n' : '',
    neighbors: near.length ? t('ask.neighborsHead') + '\n' + near.join('\n') + '\n' : '',
  }).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
