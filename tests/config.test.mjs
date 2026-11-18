// app/config.js 每個頁面都會載入:語法錯了整個網站就打不開,所以一定要能載入,而且值的格式正確(或留空)。
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('app/config.js 能載入,Google 設定是空的或格式正確', async () => {
  const { GOOGLE } = await import('../app/config.js');
  assert.ok(GOOGLE.clientId === '' || /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(GOOGLE.clientId), `用戶端 ID 格式不對(多了空白或換行?):${JSON.stringify(GOOGLE.clientId)}`);
  assert.ok(GOOGLE.apiKey === '' || /^AIza[\w-]{35}$/.test(GOOGLE.apiKey), 'API 金鑰格式不對(多了空白或換行?)');
});
