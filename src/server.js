// Limn RGM web service: serves the app and the agent API.
// On Cloud Run every request must carry a named login from the limn-rgm-users secret (see src/auth.js).
const path = require('path');
const express = require('express');
const E = require('./engine/engine');
const { makeStore } = require('./store/store');
const { runAgents } = require('./agents/orchestrator');
const { jbpPlanner } = require('./agents/jbp');
const { explain } = require('./agents/explainer');
const llm = require('./agents/llm');
const pkg = require('../package.json');
const fs = require('fs');
const { basicAuth } = require('./auth');

const app = express();
app.use(express.json({ limit: '1mb' }));
// Named logins (same secret and users.sh as the original tester page). Off when AUTH_FILE is unset, e.g. locally.
const AUTH_FILE = process.env.AUTH_FILE;
if (AUTH_FILE) {
  if (!fs.existsSync(AUTH_FILE)) console.error(`[auth] AUTH_FILE ${AUTH_FILE} not found: every request will be refused until it exists.`);
  app.use(basicAuth(AUTH_FILE));
}
const store = makeStore();
let running = null;

const user = req => req.user || 'local';

app.get('/api/health', (req, res) => res.json({ ok: true, version: pkg.version, store: store.kind, llm: llm.enabled(), model: llm.MODEL }));
app.get('/engine.js', (req, res) => res.type('application/javascript').sendFile(path.join(__dirname, 'engine', 'engine.js')));

app.get('/api/latest', async (req, res, next) => {
  try {
    let run = await store.get('runs/latest.json');
    if (!run && !running) running = runAgents({ store, trigger: 'first visit' }).finally(() => { running = null; });
    if (!run) run = await running;
    res.json({ run, running: !!running, llm: llm.enabled(), version: pkg.version });
  } catch (e) { next(e); }
});

app.post('/api/agents/run', async (req, res, next) => {
  try {
    if (running) return res.status(409).json({ error: 'A run is already in progress.' });
    running = runAgents({ store, trigger: 'manual by ' + user(req) }).finally(() => { running = null; });
    const run = await running;
    res.json({ run });
  } catch (e) { next(e); }
});

app.post('/api/jbp', async (req, res, next) => {
  try {
    const run = await store.get('runs/latest.json');
    const card = run && run.cards.find(c => c.id === req.body.cardId);
    if (!card) return res.status(404).json({ error: 'Card not found in the latest run.' });
    const pack = await jbpPlanner(card, E.P0);
    pack.requestedBy = user(req);
    await store.put(`jbp/${run.id}/${card.id}.json`, pack);
    res.json({ package: pack });
  } catch (e) { next(e); }
});

app.post('/api/explain', async (req, res, next) => {
  try {
    const q = String(req.body.question || '').slice(0, 2000);
    if (!q) return res.status(400).json({ error: 'Ask a question.' });
    const run = await store.get('runs/latest.json');
    if (!run) return res.status(409).json({ error: 'No agent run yet.' });
    const out = await explain(q, run, E.P0, req.body.context || {});
    res.json(out);
  } catch (e) { next(e); }
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server: ' + err.message }); });

if (require.main === module) {
  const port = process.env.PORT || 8080;
  app.listen(port, () => console.log(`Limn RGM ${pkg.version} on :${port} (store ${store.kind}, model ${llm.enabled() ? llm.MODEL : 'off'}, logins ${AUTH_FILE ? 'required' : 'off'})`));
}
module.exports = { app };
