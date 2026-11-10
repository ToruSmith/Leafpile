// 測試用的記憶體資料來源:用一個 { '路徑': '內容' } 物件模擬資料夾。

export function memorySource(files, label = 'test') {
  const reads = [];
  const list = async (path) => {
    const prefix = path ? path + '/' : '';
    const seen = new Map();
    for (const f of Object.keys(files)) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const [head, ...tail] = rest.split('/');
      if (!head) continue;
      seen.set(head, tail.length ? 'dir' : 'file');
    }
    if (!seen.size && path) throw new Error('not found: ' + path);
    return [...seen].map(([name, kind]) => ({ name, kind }));
  };
  return {
    label, reads,
    list,
    async readText(path) {
      reads.push(path);
      if (!(path in files)) throw new Error('not found: ' + path);
      return files[path];
    },
    async mediaURL(path) { return 'mem://' + path; },
  };
}
