// فحص صياغة كتل <script> في index.html و login.html: يكتب كل كتلة لملف مؤقت ثم node --check
// (كتل type="module" تُكتب .mjs ليدعم الفحص على import/export)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
let fails = 0, blocks = 0;
for (const file of ['index.html', 'login.html']) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    i++; blocks++;
    const isModule = /type\s*=\s*["']module["']/i.test(m[1]);
    const line = html.slice(0, m.index).split(/\r?\n/).length;
    const tmp = path.join(os.tmpdir(), '_alfaclass_syntax_' + file.replace(/\W/g, '') + '_' + i + (isModule ? '.mjs' : '.js'));
    fs.writeFileSync(tmp, m[2], 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
      console.log('ok   - ' + file + ' كتلة #' + i + (isModule ? ' (module)' : '') + ' تفتح عند سطر ' + line);
    } catch (e) {
      fails++;
      const out = String((e.stderr && e.stderr.toString()) || e.message).replace(new RegExp(tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), file + '#' + i);
      console.log('FAIL - ' + file + ' كتلة #' + i + ' تفتح عند سطر ' + line + ':\n' + out.trim());
    }
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}
console.log('\nالنتيجة: ' + blocks + ' كتلة، ' + fails + ' فاشلة');
process.exit(fails ? 1 : 0);

