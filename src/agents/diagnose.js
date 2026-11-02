// Diagnose layer: the Performance analyst and the Promotion evaluator.
// The numbers come from the feed and the engine; the model only writes the explanation.
const E = require('../engine/engine');
const llm = require('./llm');
const { money, pct } = require('./format');

function unitEconomics(aid, P) {
  const r = E.computeAccount(aid, E.BASE[aid], P);
  const t = E.BASE[aid].terms, out = {};
  for (const s of E.SKUS) {
    const x = r.lines[s.id];
    if (!x.on) continue;
    out[s.id] = { invoice: x.invoice, cogs: x.cogsUnit, freight: x.frtUnit, contrib: x.invoice * (1 - t.rebate) - x.cogsUnit - x.frtUnit, fund: t.fund };
  }
  return out;
}

const DRIVER_LABEL = { 'comp-cut': 'Competitor price cut', 'cost-up': 'Input cost increase', 'acv-loss': 'Distribution loss', normal: 'Normal variation' };

// Performance analyst: last 4 weeks against plan, in contribution dollars, grouped by cause.
async function performanceAnalyst(feed, P, log) {
  const out = {};
  const recent = feed.rows.filter(r => r.week > 48);
  for (const a of E.ACCOUNTS) {
    const ue = unitEconomics(a.id, P);
    const groups = {};
    for (const row of recent.filter(r => r.account === a.id)) {
      const u = ue[row.sku];
      const driver = row.events.find(e => DRIVER_LABEL[e]) || 'normal';
      const g = groups[driver] || (groups[driver] = { driver, label: DRIVER_LABEL[driver], skus: new Set(), unitsDiff: 0, impact: 0, plan: 0 });
      g.skus.add(E.SKU[row.sku].name);
      g.unitsDiff += row.units - row.plan;
      g.plan += row.plan;
      g.impact += (row.units - row.plan) * u.contrib - row.units * u.cogs * (row.cogsIdx - 1);
    }
    const items = Object.values(groups)
      .map(g => ({ driver: g.driver, label: g.label, skus: [...g.skus], unitsDiff: Math.round(g.unitsDiff), unitsPct: g.plan ? g.unitsDiff / g.plan : 0, impact4w: g.impact, annualized: g.impact * 13 }))
      .filter(i => i.driver !== 'normal' || Math.abs(i.impact4w) > 15000)
      .sort((x, y) => Math.abs(y.impact4w) - Math.abs(x.impact4w));
    const event = feed.planted.filter(p => p.account === a.id && p.fromWeek);
    const facts = items.map(i => `${i.label} (${i.skus.join(', ')}): units ${pct(i.unitsPct)} vs plan, contribution ${money(i.impact4w, true)} over 4 weeks, ${money(i.annualized, true)} a year if it persists`).join('\n');
    let narrative = await llm.write({
      model: llm.FAST_MODEL, maxTokens: 300,
      system: 'You are the Performance analyst agent in Limn RGM, a revenue growth management tool for a CPG manufacturer. Write for a key account manager. Use only the facts given; do not invent numbers. Two or three plain sentences, no bullet points, no em dashes.',
      prompt: `Account: ${a.name} (${a.channel}). Last 4 weeks versus plan, by cause:\n${facts || 'No material variance.'}\nKnown market events: ${event.map(e => e.note).join('; ') || 'none'}.\nExplain what changed and what deserves attention first.`
    });
    if (!narrative) {
      const top = items[0];
      narrative = top && top.driver !== 'normal'
        ? `${top.label} is the main story at ${a.name}: ${top.skus.join(', ')} ran ${pct(Math.abs(top.unitsPct))} ${top.unitsPct < 0 ? 'below' : 'above'} plan, worth ${money(top.impact4w, true)} of contribution over 4 weeks (${money(top.annualized, true)} a year if it persists).`
        : `${a.name} is tracking plan within normal variation over the last 4 weeks.`;
    }
    out[a.id] = { account: a.id, items, narrative };
    log('Performance analyst', `${a.name}: ${items.length} variance group(s); ${items[0] ? items[0].label + ' ' + money(items[0].impact4w, true) + ' over 4 weeks' : 'on plan'}.`);
  }
  return out;
}

// Promotion evaluator: incrementality and profit for every promotion block in the year.
async function promotionEvaluator(feed, P, log) {
  const evals = [];
  for (const a of E.ACCOUNTS) {
    const ue = unitEconomics(a.id, P);
    for (const s of E.SKUS) {
      const rows = feed.rows.filter(r => r.account === a.id && r.sku === s.id);
      if (!rows.length) continue;
      const promoSet = new Set(rows.filter(r => r.promo).map(r => r.week));
      if (!promoSet.size) continue;
      const byWeek = Object.fromEntries(rows.map(r => [r.week, r]));
      const blocks = [];
      for (const r of rows) if (r.promo && !promoSet.has(r.week - 1)) { let e = r.week; while (promoSet.has(e + 1)) e++; blocks.push([r.week, e]); }
      let incr = 0, funding = 0, promoUnits = 0, baseSum = 0;
      for (const [st, en] of blocks) {
        const window = rows.filter(r => r.week >= st - 8 && r.week <= en + 8 && !r.promo && !promoSet.has(r.week - 1) && !(r.events || []).length).map(r => r.units).sort((x, y) => x - y);
        const base = window.length ? window[Math.floor(window.length / 2)] : rows[0].plan;
        for (let w = st; w <= en; w++) { const r = byWeek[w]; incr += r.units - base; promoUnits += r.units; baseSum += base; funding += r.units * r.shelf * r.depth * ue[s.id].fund; }
        const after = byWeek[en + 1];
        if (after && !after.promo) incr += after.units - base;
      }
      const depth = rows.find(r => r.promo).depth;
      const profit = incr * ue[s.id].contrib - funding;
      evals.push({ account: a.id, accountName: a.name, sku: s.id, skuName: s.name, events: blocks.length, weeksOnDeal: promoSet.size, depth, observedLift: baseSum ? promoUnits / baseSum : 1, incrUnits: Math.round(incr), funding, profit, roi: funding ? profit / funding : 0, verdict: !funding ? 'Earning' : profit / funding < -0.10 ? 'Losing' : profit / funding < 0.10 ? 'Break-even' : profit / funding < 0.25 ? 'Marginal' : 'Earning' });
    }
  }
  const losing = evals.filter(e => e.verdict === 'Losing');
  log('Promotion evaluator', `Scored ${evals.length} promoted SKU-account pairs; ${losing.length} losing money: ${losing.map(e => e.skuName + ' at ' + e.accountName + ' ' + money(e.profit, true)).join('; ') || 'none'}.`);
  return evals;
}

module.exports = { performanceAnalyst, promotionEvaluator, unitEconomics };
