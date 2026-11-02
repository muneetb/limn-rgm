// Prescribe layer: the JBP planner. Turns an accepted opportunity card into a deal package:
// both P&Ls, give and get, a retailer-facing proposal and an executive summary.
const E = require('../engine/engine');
const llm = require('./llm');
const { money, pct } = require('./format');

function pnl(aid, st, P) {
  const b = E.computeAccount(aid, E.BASE[aid], P).tot, s = E.computeAccount(aid, st, P).tot;
  const row = (label, k) => ({ label, base: b[k], plan: s[k], delta: s[k] - b[k] });
  return {
    manufacturer: [row('Net revenue', 'net'), row('Trade investment', 'trade'), row('Contribution', 'contrib'), row('Economic contribution', 'econ'), row('Receivables', 'receivables')],
    retailer: [row('Retail sales', 'retSales'), row('Front margin', 'retFront'), row('Back margin', 'retBack'), row('Total margin', 'retTotal')],
    retPct: { base: b.retPct, plan: s.retPct }
  };
}

async function jbpPlanner(card, P) {
  const aid = card.account, acc = E.ACC[aid];
  const p = pnl(aid, card.state, P);
  const gives = card.ledger.filter(l => l.tag === 'Give'), gets = card.ledger.filter(l => l.tag === 'Get'), both = card.ledger.filter(l => l.tag === 'Win-win');
  const retFacts = `Retail sales ${money(p.retailer[0].delta, true)}, total retailer margin ${money(p.retailer[3].delta, true)}, margin rate ${pct(p.retPct.base)} to ${pct(p.retPct.plan)} (hurdle ${pct(acc.hurdle, 0)}). Changes: ${card.ledger.map(l => l.label + ' (' + l.detail + ')').join('; ')}.`;
  const out = await llm.writeJSON({
    maxTokens: 1400,
    system: 'You are the JBP planner agent in Limn RGM. You draft joint business plan materials for a CPG key account manager. The retailer proposal must never reveal the manufacturer’s own margins or contribution. Use only the numbers given. No em dashes. Reply with JSON only.',
    prompt: `Account: ${acc.name} (${acc.channel}). Plan: ${card.title}. ${card.rationale}\nRetailer view: ${retFacts}\nOur view: economic contribution ${money(card.mfrDelta, true)} (range ${money(card.range.lo, true)} to ${money(card.range.hi, true)}), net revenue ${money(card.netDelta, true)}, trade ${money(card.tradeDelta, true)}. Riskiest assumption: ${card.risks[0]?.label || 'none'}. Critic: ${card.critic?.verdict}; ${card.critic?.note || ''}\nReturn JSON {"proposal": ["3 to 5 short paragraphs for the retailer buyer: the opportunity, what each side commits to, what the retailer gains, next steps"], "execSummary": ["3 to 4 sentences for our commercial executive: the ask, the value to us with its range, the main risk, the decision needed"], "talkingPoints": ["4 short bullets for the meeting"]}`
  });
  const template = {
    proposal: [
      p.retailer[3].delta >= 0 ? `We propose a plan for ${acc.name} that grows your category margin by ${money(p.retailer[3].delta)} a year, taking your margin rate from ${pct(p.retPct.base)} to ${pct(p.retPct.plan)}.` : `We propose a plan for ${acc.name} that moves the category from deep, frequent promotion toward everyday value, lifting your margin rate from ${pct(p.retPct.base)} to ${pct(p.retPct.plan)}. (Internal note: total retailer margin falls ${money(-p.retailer[3].delta)} a year; prepare an offset before sharing.)`,
      `What changes: ${card.ledger.map(l => l.label + ' (' + l.detail + ')').join('; ')}.`,
      'Next steps: agree the calendar and any display or space commitments, then review results together after the first quarter.'
    ],
    execSummary: [`${card.title} at ${acc.name} adds ${money(card.mfrDelta, true)} of economic contribution a year (range ${money(card.range.lo, true)} to ${money(card.range.hi, true)}) and changes the retailer’s margin by ${money(card.retDelta, true)}.`, `Main risk: ${card.risks[0]?.label || 'model error'}. Critic verdict: ${card.critic?.verdict || 'not reviewed'}.`, 'Decision: approve the account manager to open the conversation on these terms.'],
    talkingPoints: card.ledger.slice(0, 4).map(l => `${l.label}: ${l.detail}`)
  };
  return {
    cardId: card.id, account: aid, accountName: acc.name, title: card.title, createdAt: new Date().toISOString(),
    writtenBy: out ? 'model' : 'template', pnl: p, gives, gets, winWin: both,
    proposal: (out && out.proposal) || template.proposal,
    execSummary: (out && out.execSummary) || template.execSummary,
    talkingPoints: (out && out.talkingPoints) || template.talkingPoints,
    risks: card.risks, critic: card.critic
  };
}

module.exports = { jbpPlanner, pnl };
