// 貼上的 HTML → Markdown:各種來源的 HTML 長相不同,這裡用具代表性的片段驗證結構有保留、雜訊有去掉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown as md, pasteMarkdown, parseHTML } from '../app/core/html-md.js';

test('標題、段落、行內格式', () => {
  assert.equal(md('<h1>標題</h1><p>一段 <strong>粗</strong>、<em>斜</em>、<del>刪</del>、<mark>亮</mark>、<code>x = 1</code>。</p>'),
    '# 標題\n\n一段 **粗**、*斜*、~~刪~~、==亮==、`x = 1`。');
});

test('連結與圖片;危險或內嵌的網址不留', () => {
  assert.equal(md('<p><a href="https://a.com/x (1)">站</a> <a href="javascript:alert(1)">壞</a> <a href="#top">錨</a></p>'), '[站](https://a.com/x%20%281%29) 壞 錨');
  assert.equal(md('<img src="https://a.com/p.png" alt="圖">'), '![圖](https://a.com/p.png)');
  assert.equal(md('<img src="data:image/png;base64,AAAA" alt="內嵌">'), '內嵌');
});

test('粗體的空白放在標記外面;相鄰的同樣標記合併', () => {
  assert.equal(md('<p><b> 粗 </b>字</p>'), '**粗** 字');
  assert.equal(md('<p><span style="font-weight:700">甲</span><span style="font-weight:700">乙</span>丙</p>'), '**甲乙**丙');
});

test('Google 文件:外層 <b font-weight:normal> 不是粗體,樣式裡的粗體、斜體、刪除線要認得', () => {
  const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h2 dir="ltr"><span style="font-size:16pt;font-weight:400">小標</span></h2>'
    + '<p dir="ltr"><span style="font-weight:700">重點</span><span> 與 </span><span style="font-style:italic">強調</span><span style="text-decoration:line-through"> 舊 </span></p></b>';
  assert.equal(md(html), '## 小標\n\n**重點** 與 *強調* ~~舊~~');
});

test('清單:巢狀、有序、起始編號、待辦', () => {
  assert.equal(md('<ul><li>甲<ul><li>子一</li><li>子二</li></ul></li><li>乙</li></ul>'), '- 甲\n  - 子一\n  - 子二\n- 乙');
  assert.equal(md('<ol start="3"><li>三</li><li>四<ol><li>四之一</li></ol></li></ol>'), '3. 三\n4. 四\n   1. 四之一');
  assert.equal(md('<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled> 未完成</li><li><input type="checkbox" checked disabled> 完成</li></ul>'), '- [ ] 未完成\n- [x] 完成');
});

test('清單項目裡包 <p>(Google 文件、Notion 的寫法)', () => {
  assert.equal(md('<ul><li><p dir="ltr"><span>甲</span></p></li><li><p><span>乙</span></p></li></ul>'), '- 甲\n- 乙');
});

test('省略結尾標籤的 <li>、<p> 也能解析', () => {
  assert.equal(md('<ul><li>甲<li>乙</ul><p>第一<p>第二'), '- 甲\n- 乙\n\n第一\n\n第二');
});

test('引用、分隔線', () => {
  assert.equal(md('<blockquote><p>引一</p><p>引二</p></blockquote><hr>'), '> 引一\n>\n> 引二\n\n---');
});

test('程式碼區塊:語言、保留縮排與空行,內容有 ``` 就加長圍欄', () => {
  assert.equal(md('<pre><code class="language-js">function f() {\n  return 1;\n}\n</code></pre>'), '```js\nfunction f() {\n  return 1;\n}\n```');
  assert.equal(md('<pre><code>a ```b``` c</code></pre>'), '````\na ```b``` c\n````');
  assert.equal(md('<pre><div>第一行</div><div>第二行</div></pre>'), '```\n第一行\n第二行\n```');
});

test('表格:第一列當表頭、| 要跳脫、合併欄補空、單格版面表格當一般內容', () => {
  assert.equal(md('<table><thead><tr><th>月</th><th>數字</th></tr></thead><tbody><tr><td>1 月</td><td>a|b</td></tr><tr><td colspan="2">合</td></tr></tbody></table>'),
    '| 月 | 數字 |\n| --- | --- |\n| 1 月 | a\\|b |\n| 合 |  |');
  assert.equal(md('<table><tr><td><p>只是排版</p><p>第二段</p></td></tr></table>'), '只是排版\n\n第二段');
});

test('雜訊:script、style、按鈕、svg、註解、隱藏元素都不進來', () => {
  assert.equal(md('<!--StartFragment--><style>p{color:red}</style><script>alert(1)</script><p>內容<button>複製</button><svg><path/></svg></p><div hidden>藏</div><!--EndFragment-->'), '內容');
});

test('HTML 實體', () => {
  assert.equal(md('<p>A&amp;B &lt;tag&gt; &#x4E2D;&#25991; 3&nbsp;&times;&nbsp;4</p>'), 'A&B <tag> 中文 3 × 4');
});

test('段落開頭長得像 Markdown 時加反斜線,不會變成清單或標題', () => {
  assert.equal(md('<div># 不是標題</div><div>- 不是清單</div><div>1. 不是編號</div>'), '\\# 不是標題\n\n\\- 不是清單\n\n\\1. 不是編號');
});

test('<br> 變成換行;外層 div 與 span 只是包裝', () => {
  assert.equal(md('<div><span>第一行<br>第二行</span></div>'), '第一行  \n第二行');
});

test('details/summary、dl', () => {
  assert.equal(md('<details><summary>標題</summary><p>內容</p></details>'), '**標題**\n\n內容');
  assert.equal(md('<dl><dt>詞</dt><dd>解釋</dd></dl>'), '**詞**\n\n解釋');
});

test('壞掉的 HTML 不會丟錯', () => {
  for (const h of ['<', '<p', '<p><b>未關', '</div></p>', '<a href="x', '<table><td>孤</td>', '<ul><ul><li>x', '', null, undefined]) assert.doesNotThrow(() => md(h));
  assert.equal(md('<p><b>未關'), '**未關**');
});

test('parseHTML:script 內容不被當成標籤', () => {
  const t = parseHTML('<script>if (a<b) { x = "<p>" }</script><p>好</p>');
  assert.equal(t.kids.length, 1);
  assert.equal(t.kids[0].tag, 'p');
});

test('pasteMarkdown:有結構才轉,沒有就回傳 null(照原本貼純文字)', () => {
  // 網頁:標題與連結 → 轉
  assert.equal(pasteMarkdown('<h2>標</h2><p><a href="https://x.com">連結</a></p>', '標\n連結'), '## 標\n\n[連結](https://x.com)');
  // 程式編輯器複製的上色文字:只有 span 與 div,沒有結構 → null
  assert.equal(pasteMarkdown('<meta charset="utf-8"><div style="color:#ccc;font-family:Menlo"><div><span style="color:#569cd6">const</span><span> x = 1;</span></div></div>', 'const x = 1;'), null);
  // 純 Markdown 原文被包成 div 複製:不轉
  assert.equal(pasteMarkdown('<div># 標題</div><div>- 甲</div>', '# 標題\n- 甲'), null);
  // 純文字剪貼簿(沒有 HTML)
  assert.equal(pasteMarkdown('', 'abc'), null);
  assert.equal(pasteMarkdown(null, 'abc'), null);
  // 只有 HTML、沒有純文字
  assert.equal(pasteMarkdown('<ul><li>甲</li></ul>', ''), '- 甲');
});

test('pasteMarkdown:太大的 HTML 不處理', () => {
  assert.equal(pasteMarkdown('<p>' + 'x'.repeat(3_100_000) + '</p>', 'y'), null);
});
