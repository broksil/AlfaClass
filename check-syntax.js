const fs = require('fs'), cp = require('child_process');
const html = fs.readFileSync('index.html', 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, i = 0, fail = 0;
while ((m = re.exec(html))) {
  if (/\bsrc\s*=/.test(m[1] || '')) continue;
  const code = m[2];
  if (!code.trim()) continue;
  i++;
  const f = `__check_block_${i}.js`;
  fs.writeFileSync(f, code);
  const r = cp.spawnSync('node', ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { fail++; console.log('FAIL block', i, '\n', r.stderr); }
  try { fs.unlinkSync(f); } catch (e) {}
}
console.log(`checked ${i} script blocks, ${fail} failed`);
process.exit(fail ? 1 : 0);