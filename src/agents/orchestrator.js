// Orchestrator: runs the layers in order (Sense, Diagnose, Prescribe, Critic) and stores the run.
// Each step writes to an activity log so people can see what the agents did and why.
const E = require('../engine/engine');
const { buildFeed } = require('../data/synthetic');
const { performanceAnalyst, promotionEvaluator } = require('./diagnose');
const { opportunityScout } = require('./scout');
const { critic } = require('./critic');
const llm = require('./llm');

async function runAgents({ store, P = E.P0, trigger = 'manual' } = {}) {
  const startedAt = new Date().toISOString();
  const id = startedAt.replace(/[:.]/g, '-');
  const log = [];
  const say = (agent, msg) => { log.push({ t: new Date().toISOString(), agent, msg }); console.log(`[${agent}] ${msg}`); };
  const u0 = { ...llm.usage };
  say('Orchestrator', `Run started (${trigger}). Language model ${llm.enabled() ? 'on: ' + llm.MODEL : 'off: using templates'}.`);

  // Sense: in this release the feed is synthetic; the Data steward role is a reconciliation check.
  const feed = buildFeed(P);
  const listed = new Set(feed.rows.map(r => r.account + r.sku)).size;
  say('Data steward', `Loaded ${feed.rows.length} weekly rows for ${listed} listed SKU-account pairs, week ending ${feed.asOf}. ${feed.planted.filter(p => p.fromWeek).length} market events detected in the feed.`);

  const diagnosis = await performanceAnalyst(feed, P, say);
  const promoEvals = await promotionEvaluator(feed, P, say);
  let cards = await opportunityScout(diagnosis, promoEvals, P, say);
  cards = await critic(cards, say);
  const blocked = cards.filter(c => c.critic.verdict === 'Blocked').length;
  say('Orchestrator', `Posted ${cards.length - blocked} card(s) to the inbox${blocked ? `, held back ${blocked} blocked by the Critic` : ''}.`);

  const run = {
    id, trigger, startedAt, finishedAt: new Date().toISOString(),
    llm: { enabled: llm.enabled(), model: llm.MODEL, calls: llm.usage.calls - u0.calls, inputTokens: llm.usage.input - u0.input, outputTokens: llm.usage.output - u0.output, errors: llm.usage.errors - u0.errors },
    feed: { asOf: feed.asOf, rows: feed.rows.length, planted: feed.planted },
    weekly: summarizeWeekly(feed), diagnosis, promoEvals, cards, log
  };
  if (store) { await store.put(`runs/${id}.json`, run); await store.put('runs/latest.json', run); }
  return run;
}

// Weekly units by account and category, for sparkline charts in the inbox.
function summarizeWeekly(feed) {
  const out = {};
  for (const r of feed.rows) {
    const k = r.account + ':' + r.cat;
    const o = out[k] || (out[k] = { actual: Array(52).fill(0), plan: Array(52).fill(0) });
    o.actual[r.week - 1] += r.units; o.plan[r.week - 1] += r.plan;
  }
  return out;
}

module.exports = { runAgents };
