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
