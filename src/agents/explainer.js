// The Explainer: answers questions about the latest agent run. It can only see numbers
// through tools that call the engine or read the stored run, so every figure it quotes is traceable.
const E = require('../engine/engine');
const llm = require('./llm');
const { describeCard } = require('./scout');

const LINE_FORMULAS = {
  econ: 'Economic contribution = contribution minus working capital carry (net revenue x payment days / 365 x cost of capital).',
  contrib: 'Contribution = net revenue minus cost of goods minus freight and handling.',
  net: 'Net revenue = invoice sales minus promotion spend minus rebates minus slotting fees.',
  promoCost: 'Promotion spend = promoted units x shelf price x depth x our share of promo cost.',
  retTotal: 'Retailer total margin = front margin (retail sales minus invoice cost plus promotion funding received) plus back margin (rebates and slotting received).',
  units: 'Units = baseline weekly units x perceived price response x cross effects x distribution response, over 52 weeks with promotion lift and post-promotion dip.',
  shapley: 'The lever bridge uses Shapley attribution: each lever group gets its average contribution across every order the changes could be made in, so the bars sum exactly to the total.'
};

const TOOLS = [
  { name: 'get_run_overview', description: 'Summary of the latest agent run: accounts, diagnosis narratives, opportunity cards with headline numbers and critic verdicts.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_card', description: 'Full detail of one opportunity card: changes, both P&L deltas, Shapley bridge by lever, ledger, risks, critic checks.', input_schema: { type: 'object', properties: { card_id: { type: 'string' } }, required: ['card_id'] } },
  { name: 'get_promotion_evaluations', description: 'Promotion evaluator results (incremental units, funding, profit, ROI) for an account id: fw, vm or bb.', input_schema: { type: 'object', properties: { account: { type: 'string' } }, required: ['account'] } },
  { name: 'run_scenario', description: 'Run a what-if on the engine for one account, starting from baseline or from a card. changes is a list of {sku, field, value}; field is one of on, shelf, size, w (promo weeks), d (depth 0-1), acv (0-1). terms is an object of term overrides: m_otc, m_pasta, rebate, oninv, fund (0-1), days, slot.', input_schema: { type: 'object', properties: { account: { type: 'string' }, from_card: { type: 'string' }, changes: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, field: { type: 'string' }, value: { type: 'number' } } } }, terms: { type: 'object' } }, required: ['account'] } },
  { name: 'explain_formula', description: 'How a line or method is calculated. key is one of econ, contrib, net, promoCost, retTotal, units, shapley.', input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } }
];

function compactCard(c) {
  return { id: c.id, account: c.accountName, title: c.title, us: Math.round(c.mfrDelta), retailer: Math.round(c.retDelta), critic: c.critic?.verdict, riskiest: c.risks[0]?.label };
}

async function explain(question, run, P, context = {}) {
  if (!llm.enabled()) return { text: 'The Explainer needs a Claude API key on the server (ANTHROPIC_API_KEY). Every number on screen can still be opened to see its formula.', trace: [] };
  const handlers = {
    get_run_overview: async () => ({ ranAt: run.finishedAt, diagnosis: Object.values(run.diagnosis).map(d => ({ account: E.ACC[d.account].name, narrative: d.narrative })), cards: run.cards.map(compactCard) }),
    get_card: async ({ card_id }) => { const c = run.cards.find(x => x.id === card_id); if (!c) return { error: 'No card ' + card_id }; const { state, ...rest } = c; return rest; },
    get_promotion_evaluations: async ({ account }) => run.promoEvals.filter(e => e.account === account),
    run_scenario: async ({ account, from_card, changes = [], terms = {} }) => {
      if (!E.ACC[account]) return { error: 'Unknown account ' + account };
      const card = from_card ? run.cards.find(x => x.id === from_card) : null;
      const st = E.clone(card ? card.state : E.BASE[account]);
      for (const ch of changes) if (st.lines[ch.sku] && ch.field in st.lines[ch.sku]) st.lines[ch.sku][ch.field] = ch.value;
      for (const k in terms) if (k in st.terms) st.terms[k] = terms[k];
      const d = describeCard(account, st, P);
      return { usDelta: Math.round(d.mfrDelta), retailerDelta: Math.round(d.retDelta), retailerMarginRate: d.retPct, hurdle: d.hurdle, range: d.range, byLever: d.shapley, changes: d.ledger, riskiest: d.risks[0] };
    },
    explain_formula: async ({ key }) => ({ key, formula: LINE_FORMULAS[key] || 'Unknown key' })
  };
  const sys = 'You are the Explainer agent in Limn RGM, a revenue growth management tool for a CPG manufacturer’s key account managers. Answer questions about the latest agent run. Every number you state must come from a tool result in this conversation; never estimate or compute figures yourself, call run_scenario instead. All data is synthetic. Be concise: a short paragraph or a few bullets. Money in $K or $M. No em dashes. Account ids: fw = FreshWay Grocery, vm = ValueMart, bb = BulkBarn Club. SKU ids: R24, R50, R100, R200 (Relivo ibuprofen counts), M24, TB24, M32, M45 (Casa Verde pasta sauce ounces).' +
    (context.account ? ` The user is looking at account ${context.account}.` : '') + (context.cardId ? ` The user is looking at card ${context.cardId}.` : '');
  return llm.toolLoop({ system: sys, messages: [{ role: 'user', content: question }], tools: TOOLS, handlers });
}

module.exports = { explain, TOOLS };
