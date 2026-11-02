// Entry point for the scheduled Cloud Run Job: one full agent run, then exit.
const { makeStore } = require('./store/store');
const { runAgents } = require('./agents/orchestrator');

runAgents({ store: makeStore(), trigger: process.env.RUN_TRIGGER || 'scheduled' })
  .then(run => { console.log(`Run ${run.id} done: ${run.cards.length} card(s).`); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
