const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine/engine');
const { runAgents } = require('../src/agents/orchestrator');
const { checks } = require('../src/agents/critic');
const { describeCard } = require('../src/agents/scout');
const { jbpPlanner } = require('../src/agents/jbp');
const llm = require('../src/agents/llm');

test('full agent run works with no model key and posts checked cards', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const run = await runAgents({});
  assert.ok(run.cards.length >= 3);
  for (const c of run.cards) {
    assert.ok(c.critic && c.critic.verdict);
    assert.ok(c.mfrDelta >= 25000);
    assert.ok(c.title && c.rationale);
  }
  assert.ok(run.promoEvals.some(e => e.verdict === 'Losing'));
  assert.ok(run.cards.some(c => c.triggeredBy === 'Promotion evaluator'), 'diagnosis should trigger a promotion play');
  assert.ok(run.log.some(l => l.agent === 'Critic'));
  for (const id of ['fw', 'vm', 'bb']) assert.ok(run.diagnosis[id].items[0].driver !== 'normal', `${id} planted event found`);
});

test('critic blocks a plan below the retailer hurdle', () => {
  const st = E.clone(E.BASE.fw); st.terms.m_otc = 0.10; st.terms.m_pasta = 0.10;
  const card = { account: 'fw', state: st, ...describeCard('fw', st, E.P0) };
  assert.ok(checks(card).some(x => x.level === 'block' && x.rule === 'Retailer hurdle'));
});

test('JBP planner builds a package from a card using templates', async () => {
  const run = await runAgents({});
  const p = await jbpPlanner(run.cards[0], E.P0);
  assert.strictEqual(p.writtenBy, 'template');
  assert.ok(p.proposal.length && p.execSummary.length);
  assert.ok(Math.abs(p.pnl.manufacturer[3].delta - run.cards[0].mfrDelta) < 1e-6);
});

test('agents use model output when a client is present, and the Explainer calls engine tools', async () => {
  const calls = [];
  llm._setClient({ messages: { create: async (req) => {
    calls.push(req);
    if (req.tools) {
      const hadResult = req.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'));
      if (!hadResult) return { stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', id: 't1', name: 'run_scenario', input: { account: 'fw', changes: [{ sku: 'M24', field: 'w', value: 8 }] } }] };
      const res = req.messages.at(-1).content[0].content;
      return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Engine says: ' + JSON.parse(res).usDelta }] };
    }
    if (/JSON array with one object per opportunity/.test(req.messages[0].content)) return { usage: {}, content: [{ type: 'text', text: '```json\n[{"title":"Model title","rationale":"Model rationale.","pitch":"Model pitch."}]\n```' }] };
    return { usage: {}, content: [{ type: 'text', text: 'Model narrative.' }] };
  } } });
  try {
    const run = await runAgents({});
    assert.strictEqual(run.diagnosis.fw.narrative, 'Model narrative.');
    assert.ok(run.cards.some(c => c.title === 'Model title' && c.writtenBy === 'model'));
    const { explain } = require('../src/agents/explainer');
    const out = await explain('What if Marinara ran 8 weeks?', run, E.P0);
    assert.match(out.text, /^Engine says: -?\d+/);
    assert.strictEqual(out.trace[0].tool, 'run_scenario');
  } finally { llm._setClient(null); }
});
