const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'limn-'));
delete process.env.BUCKET; delete process.env.ANTHROPIC_API_KEY;
const { app } = require('../src/server');

test('API: health, latest run, JBP package, explainer without key', async () => {
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const h = await (await fetch(base + '/api/health')).json();
    assert.strictEqual(h.ok, true);
    const l = await (await fetch(base + '/api/latest')).json();
    assert.ok(l.run.cards.length);
    const id = l.run.cards[0].id;
    const j = await (await fetch(base + '/api/jbp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: id }) })).json();
    assert.strictEqual(j.package.cardId, id);
    const x = await (await fetch(base + '/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'why?' }) })).json();
    assert.match(x.text, /API key/);
    const page = await (await fetch(base + '/')).text();
    assert.match(page, /Agent inbox/);
    const eng = await fetch(base + '/engine.js');
    assert.strictEqual(eng.status, 200);
  } finally { srv.close(); }
});

test('named logins: refuses without a valid login, accepts users.sh-style hashes, ignores switched-off lines', async () => {
  const { execSync } = require('child_process');
  const h1 = execSync("openssl passwd -apr1 'right-pass'").toString().trim();
  const f = path.join(process.env.DATA_DIR, 'htpasswd');
  fs.writeFileSync(f, `muneet:${h1}\n#off jsmith:${h1}\n`);
  const express = require('express');
  const { basicAuth } = require('../src/auth');
  const a = express(); a.use(basicAuth(f)); a.get('/api/health', (q, r) => r.send('ok')); a.get('/x', (q, r) => r.send('hi ' + q.user));
  const srv = a.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const auth = (u, p) => ({ headers: { Authorization: 'Basic ' + Buffer.from(u + ':' + p).toString('base64') } });
  try {
    assert.strictEqual((await fetch(base + '/x')).status, 401);
    assert.strictEqual((await fetch(base + '/x', auth('muneet', 'wrong'))).status, 401);
    assert.strictEqual(await (await fetch(base + '/x', auth('muneet', 'right-pass'))).text(), 'hi muneet');
    assert.strictEqual((await fetch(base + '/x', auth('jsmith', 'right-pass'))).status, 401);
    assert.strictEqual((await fetch(base + '/api/health')).status, 200);
  } finally { srv.close(); }
});
