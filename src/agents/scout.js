// Prescribe layer: the Opportunity scout.
// It decides which searches to run for each account (informed by the diagnosis), hands
// each search to the optimizer, then packages the results as opportunity cards.
const E = require('../engine/engine');
const { optimizeAccount } = require('../engine/optimizer');
// shareSavings is kept for the Explainer and future plays; the scout now searches terms directly.
const llm = require('./llm');
const { money, pct } = require('./format');

const MIN_GAIN = 25000;

// After a promotion cut, offer the retailer part of the savings as rebate so it is no worse off.
function shareSavings(aid, st, P) {
  const baseRet = E.computeAccount(aid, E.BASE[aid], P).tot.retTotal;
  const f = x => { const h = E.clone(st); h.terms.rebate = E.BASE[aid].terms.rebate + x; return E.computeAccount(aid, h, P).tot.retTotal - baseRet; };
  if (f(0) >= 0) return st;
  let lo = 0, hi = 0.15;
  if (f(hi) < 0) return null;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (f(m) >= 0) hi = m; else lo = m; }
  const h = E.clone(st); h.terms.rebate = Math.ceil((E.BASE[aid].terms.rebate + hi) * 1000) / 1000;
  return h;
}

function describeCard(aid, st, P) {
  const b = E.computeAccount(aid, E.BASE[aid], P), s = E.computeAccount(aid, st, P);
  const led = E.ledger(aid, st, P);
  const sh = E.shapley(aid, st, P, 'econ');
  const rng = E.deltaRange(aid, st, P, 'econ');
  const risk = E.riskRank(aid, st, P).filter(x => x.swing > 500).slice(0, 3).map(x => ({ label: x.a.label, kind: x.a.kind, lo: x.lo, hi: x.hi, swing: x.swing }));
  return {
    mfrDelta: s.tot.econ - b.tot.econ, retDelta: s.tot.retTotal - b.tot.retTotal, netDelta: s.tot.net - b.tot.net,
    retPct: s.tot.retPct, baseRetPct: b.tot.retPct, hurdle: E.ACC[aid].hurdle,
    tradeDelta: s.tot.trade - b.tot.trade, receivablesDelta: s.tot.receivables - b.tot.receivables,
    shapley: sh, range: { lo: rng.lo, hi: rng.hi }, risks: risk,
    ledger: led.items.map(i => ({ label: i.label, detail: i.detail, mfr: i.mfr, ret: i.ret, tag: i.tag })), interaction: { mfr: led.interMfr, ret: led.interRet }
  };
}

const PLAYS = {
  rebalance: { levers: ['promo', 'terms'], mode: 'winwin', name: 'Rebalance promotion and funding' },
  cut: { levers: ['promo'], mode: 'ours', name: 'Cut losing promotions' },
  price: { levers: ['price'], mode: 'winwin', name: 'Everyday price moves' },
  assort: { levers: ['assort'], mode: 'ours', name: 'Range extension' },
  combined: { levers: ['promo', 'price', 'assort'], mode: 'winwin', name: 'Combined plan, both sides gain' }
};

async function opportunityScout(diagnosis, promoEvals, P, log) {
  const cards = [];
  for (const a of E.ACCOUNTS) {
    const losing = promoEvals.filter(e => e.account === a.id && e.verdict === 'Losing');
    const order = losing.length ? ['rebalance', 'cut', 'combined', 'price', 'assort'] : ['combined', 'price', 'assort', 'rebalance'];
    log('Opportunity scout', `${a.name}: searching ${order.map(k => PLAYS[k].name.toLowerCase()).join(', ')}${losing.length ? ' (promotion first, flagged by the Promotion evaluator)' : ''}.`);
    const seen = new Set();
    const found = [];
    for (const key of order) {
      const play = PLAYS[key];
      const res = optimizeAccount(a.id, P, { levers: play.levers, mode: play.mode });
      const st = res.state;
      if (!st || !res.feasible) continue;
      const sig = JSON.stringify(st);
      if (seen.has(sig) || sig === JSON.stringify(E.BASE[a.id])) continue;
      seen.add(sig);
      const d = describeCard(a.id, st, P);
      if (d.mfrDelta < MIN_GAIN) continue;
      found.push({ id: `${a.id}-${key}`, account: a.id, accountName: a.name, play: key, playName: play.name, mode: play.mode, triggeredBy: (key === 'rebalance' || key === 'cut') && losing.length ? 'Promotion evaluator' : 'Nightly search', evals: res.evals, state: st, ...d });
    }
    // A play triggered by the diagnosis always makes the cut; the rest are ranked by value to us.
    found.sort((x, y) => y.mfrDelta - x.mfrDelta);
    const pinned = found.filter(c => c.triggeredBy === 'Promotion evaluator');
    const top = pinned.concat(found.filter(c => !pinned.includes(c))).slice(0, 3);
    // One model call per account writes titles and rationales from the computed facts.
    const facts = top.map((c, i) => `${i + 1}. ${c.playName}. Us ${money(c.mfrDelta, true)}, retailer ${money(c.retDelta, true)}, retailer margin ${pct(c.retPct)} vs hurdle ${pct(c.hurdle, 0)}. Changes: ${c.ledger.map(l => l.label + ' (' + l.detail + ')').join('; ')}. Riskiest assumption: ${c.risks[0]?.label || 'none'}.`).join('\n');
    const written = top.length ? await llm.writeJSON({
      maxTokens: 900,
      system: 'You are the Opportunity scout agent in Limn RGM. You package optimizer results for a key account manager preparing a joint business plan. Use only the numbers given. No em dashes. Reply with JSON only.',
      prompt: `Account ${a.name} (${a.channel}). Diagnosis: ${diagnosis[a.id]?.narrative || ''}\nOpportunities found by the optimizer:\n${facts}\nReturn a JSON array with one object per opportunity, in order, each {"title": "under 9 words", "rationale": "two sentences on why this works and the trade-off", "pitch": "one sentence the account manager could say to the retailer buyer, without revealing our margins"}.`
    }) : null;
    top.forEach((c, i) => {
      const w = Array.isArray(written) ? written[i] : null;
      c.title = (w && w.title) || templateTitle(c);
      c.rationale = (w && w.rationale) || templateRationale(c);
      c.pitch = (w && w.pitch) || 'This plan grows your category margin while keeping shoppers on our brands.';
      c.writtenBy = w ? 'model' : 'template';
    });
    log('Opportunity scout', `${a.name}: ${found.length} feasible plan(s) above ${money(MIN_GAIN)}; posting top ${top.length}.`);
    cards.push(...top);
  }
  return cards;
}

function templateTitle(c) {
  const lead = c.ledger.slice().sort((x, y) => Math.abs(y.mfr) - Math.abs(x.mfr))[0];
  return `${c.playName}${lead ? ': ' + lead.label.split(':')[0] : ''}`;
}
function templateRationale(c) {
  const both = c.retDelta >= 0 ? 'Both sides gain' : 'We gain more than the retailer gives up';
  return `${both}: us ${money(c.mfrDelta, true)}, retailer ${money(c.retDelta, true)} a year. Most of the result rests on ${c.risks[0] ? c.risks[0].label.toLowerCase() : 'the base demand model'}.`;
}

module.exports = { opportunityScout, describeCard, shareSavings, MIN_GAIN };
