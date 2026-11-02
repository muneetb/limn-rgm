// Govern layer: the Critic. Hard rules are code, not prompts; the model adds a short
// second opinion only. Nothing reaches the inbox without a verdict.
const E = require('../engine/engine');
const llm = require('./llm');
const { money, pct } = require('./format');

function checks(card) {
  const aid = card.account, st = card.state, bs = E.BASE[aid];
  const out = [];
  const add = (level, rule, detail) => out.push({ level, rule, detail });
  if (card.retPct < card.hurdle) add('block', 'Retailer hurdle', `Retailer margin ${pct(card.retPct)} is below its ${pct(card.hurdle, 0)} hurdle.`);
  for (const b of E.ladderBreaches(st)) add('block', 'Price ladder', `${b.large} costs more per unit than ${b.small}.`);
  for (const s of E.SKUS) {
    const L = st.lines[s.id], B = bs.lines[s.id];
    if (!L.on) continue;
    if (L.w > 16) add('block', 'Promotion frequency', `${s.name} would be on deal ${L.w} weeks a year (limit 16).`);
    if (L.d > 0.30) add('block', 'Promotion depth', `${s.name} at ${pct(L.d, 0)} off exceeds the 30% limit.`);
    const ch = L.shelf / B.shelf - 1;
    if (Math.abs(ch) > 0.0525) add('warn', 'Outside observed price range', `${s.name} shelf price moves ${pct(ch)}; elasticities are estimated within about 5%.`);
    if (Math.abs(ch) > 1e-9) add('info', 'Retail price', `${s.name}: the shelf price is our recommendation; the retailer sets its own retail price.`);
    if (L.on && !B.on) add('info', 'New listing', `${s.name} assumes ${pct(1 - E.P0.incr, 0)} cannibalization and a slotting fee.`);
  }
  for (const k of Object.keys(bs.terms)) if (Math.abs(st.terms[k] - bs.terms[k]) > 1e-9) add('info', 'Equivalent terms', `Changed ${k}: offer comparable terms to competing retailers on equal conditions (pricing law review).`);
  if (card.retDelta < 0) add('warn', 'Retailer worse off', `The retailer gives up ${money(-card.retDelta)} a year; expect pushback and prepare an offset.`);
  if (card.range.lo < 0) add('warn', 'Uncertain sign', `If elasticities are 25% off, the result could be ${money(card.range.lo, true)}.`);
  if (card.risks[0] && card.risks[0].swing > 0.5 * card.mfrDelta) add('warn', 'Concentrated risk', `${card.risks[0].label} swings the result by ${money(card.risks[0].swing)}.`);
  if (Math.abs(card.interaction.mfr) > 0.3 * Math.abs(card.mfrDelta)) add('warn', 'Depends on combination', `${money(card.interaction.mfr, true)} of the gain only appears when the changes are made together.`);
  return out;
}

async function critic(cards, log) {
  for (const c of cards) {
    const list = checks(c);
    c.critic = { verdict: list.some(x => x.level === 'block') ? 'Blocked' : list.some(x => x.level === 'warn') ? 'Pass with warnings' : 'Pass', checks: list };
    log('Critic', `${c.accountName}, ${c.title}: ${c.critic.verdict}${list.filter(x => x.level !== 'info').length ? ' (' + list.filter(x => x.level !== 'info').map(x => x.rule).join(', ') + ')' : ''}.`);
  }
  // One model call for a short second opinion on the cards that pass.
  const passing = cards.filter(c => c.critic.verdict !== 'Blocked');
  if (passing.length && llm.enabled()) {
    const notes = await llm.writeJSON({
      model: llm.FAST_MODEL, maxTokens: 700,
      system: 'You are the Critic agent in Limn RGM. You review commercial recommendations skeptically before a key account manager sees them. Use only the facts given. No em dashes. Reply with JSON only.',
      prompt: 'For each recommendation, give one sentence on the most important thing that could make it fail in practice (retailer reaction, execution, data quality). Return a JSON array of strings in the same order.\n' +
        passing.map((c, i) => `${i + 1}. ${c.accountName}: ${c.title}. Us ${money(c.mfrDelta, true)}, retailer ${money(c.retDelta, true)}. Changes: ${c.ledger.map(l => l.label + ' ' + l.detail).join('; ')}. Rule findings: ${c.critic.checks.filter(x => x.level !== 'info').map(x => x.detail).join(' ') || 'none'}`).join('\n')
    });
    if (Array.isArray(notes)) passing.forEach((c, i) => { if (typeof notes[i] === 'string') c.critic.note = notes[i]; });
  }
  return cards;
}

module.exports = { critic, checks };
