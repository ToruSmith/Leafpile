// 空資料夾的起手式:要寫進去的檔案清單(只產生內容,真正寫檔由呼叫端做)。
// 規則:不覆蓋任何已有的檔案(呼叫端用 expect: null);只寫 .md 與 .yml。
//   'empty'  = 設定檔 + 一個「收件匣」主題(筆記與簡報各一個資料夾),書架馬上能用
//   'sample' = 再加一篇歡迎筆記

import { t, getLang } from './i18n.js';

const q = s => JSON.stringify(String(s)); // YAML 字串一律加引號,避免冒號、井字號出問題

export function scaffoldFiles(kind = 'sample', { title = '' } = {}) {
  const lang = getLang() === 'en' ? 'en' : 'zh-Hant';
  const topic = [
    `name: ${q(t('scaffold.topicName'))}`,
    `description: ${q(t('scaffold.topicDesc'))}`,
    'category: inbox',
    'color: "#8a8178"',
    '',
  ].join('\n');
  const files = [
    {
      path: '_site.yml',
      text: [
        `leafpile: 1`,
        `title: ${q(title || t('scaffold.siteTitle'))}`,
        `description: ${q(t('scaffold.siteDesc'))}`,
        'theme: paper',
        `lang: ${lang}`,
        '',
        'categories:',
        '  - id: inbox',
        `    name: ${q(t('scaffold.topicName'))}`,
        '    color: "#8a8178"',
        '',
      ].join('\n'),
    },
    { path: 'notes/01-inbox/_topic.yml', text: topic },
    { path: 'slides/01-inbox/_topic.yml', text: topic },
  ];
  if (kind === 'sample') files.push({ path: 'notes/01-inbox/welcome.md', text: t('scaffold.welcome') });
  return files;
}
