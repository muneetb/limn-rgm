// Constrained search over lever combinations for one account.
// Coordinate ascent: for each SKU in turn, try every allowed option with the others held fixed,
// keep the best, and repeat until nothing improves. The engine is cheap, so thousands of
// evaluations take well under a second. Agents frame the problem; this code searches it.
const E = require('./engine');

const PROMO_WEEKS = [0, 4, 6, 8, 10, 12, 16];
const PROMO_DEPTH = [0.10, 0.15, 0.20, 0.25, 0.30];
const PRICE_MULT = [0.95, 1, 1.03, 1.05];
const REBATE_STEPS = [0, 0.005, 0.01, 0.015, 0.02, 0.03];
const FUND_STEPS = [-0.1, 0, 0.1, 0.2];
// New listings the account's channel can plausibly carry (club packs stay in club, and so on).
const ALLOW_NEW = { fw: ['M32'], vm: ['M32'], bb: ['M32'] };

function optionsFor(levers, baseLine, allowNew) {
  const promo = levers.includes('promo')
    ? [{ w: 0, d: 0 }].concat(PROMO_WEEKS.filter(w => w > 0).flatMap(w => PROMO_DEPTH.map(d => ({ w, d }))))
    : [{ w: baseLine.w, d: baseLine.d }];
  const price = levers.includes('price') ? PRICE_MULT.map(m => Math.round(baseLine.shelf * m * 100) / 100) : [baseLine.shelf];
  // v0 never proposes delisting; it may propose listing an unlisted SKU the channel can carry.
  const on = levers.includes('assort') && !baseLine.on && allowNew ? [0, 1] : [baseLine.on];
  const out = [];
  for (const o of on) for (const p of price) for (const pr of promo) out.push({ on: o, shelf: p, w: pr.w, d: pr.w ? pr.d : 0 });
  return out;
}

// mode 'winwin': retailer margin dollars must not fall; mode 'ours': retailer only needs to clear its hurdle.
function score(aid, st, P, base, mode, budgetCap) {
  const r = E.computeAccount(aid, st, P);
  const hurdle = E.ACC[aid].hurdle;
  let pen = 0;
  // Any violation costs at least $1M, so an infeasible plan never beats the feasible baseline.
  if (r.tot.retPct < hurdle) pen += 1e6 + (hurdle - r.tot.retPct) * 1e8;
  if (mode === 'winwin' && r.tot.retTotal < base.tot.retTotal - 0.5) pen += 1e6 + (base.tot.retTotal - r.tot.retTotal) * 10;
  const rate = r.tot.gross ? r.tot.trade / r.tot.gross : 0;
  if (rate > budgetCap) pen += 1e6 + (rate - budgetCap) * r.tot.gross * 10;
  pen += E.ladderBreaches(st).length * 1e7;
  return { value: r.tot.econ - pen, feasible: pen === 0, r };
}

function optimizeAccount(aid, P, { levers = ['promo'], mode = 'winwin', startState = null, maxPasses = 4 } = {}) {
  const base = E.computeAccount(aid, E.BASE[aid], P);
  // Trade spend may not rise as a share of gross sales by more than half a point.
  const budgetCap = base.tot.trade / base.tot.gross + 0.005;
  let st = E.clone(startState || E.BASE[aid]);
  let best = score(aid, st, P, base, mode, budgetCap);
  let evals = 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (const s of E.SKUS) {
      const B = E.BASE[aid].lines[s.id];
      const allowNew = (ALLOW_NEW[aid] || []).includes(s.id);
      if (!B.on && !(levers.includes('assort') && allowNew)) continue;
      for (const opt of optionsFor(levers, B, allowNew)) {
        const trial = E.clone(st);
        Object.assign(trial.lines[s.id], opt);
        if (!opt.on) { trial.lines[s.id].w = B.w; trial.lines[s.id].d = B.d; trial.lines[s.id].shelf = B.shelf; }
        const sc = score(aid, trial, P, base, mode, budgetCap); evals++;
        if (sc.value > best.value + 1) { best = sc; st = trial; improved = true; }
      }
    }
    // Account-level commercial terms: rebate and our share of promotion cost.
    if (levers.includes('terms')) {
      const bt = E.BASE[aid].terms;
      for (const dr of REBATE_STEPS) for (const df of FUND_STEPS) {
        const trial = E.clone(st);
        trial.terms.rebate = Math.round((bt.rebate + dr) * 1000) / 1000;
        trial.terms.fund = Math.max(0, Math.min(1, Math.round((bt.fund + df) * 100) / 100));
        const sc = score(aid, trial, P, base, mode, budgetCap); evals++;
        if (sc.value > best.value + 1) { best = sc; st = trial; improved = true; }
      }
    }
    if (!improved) break;
  }
  return { state: st, feasible: best.feasible, gain: best.r.tot.econ - base.tot.econ, retGain: best.r.tot.retTotal - base.tot.retTotal, evals, levers, mode };
}

module.exports = { optimizeAccount, PROMO_WEEKS, PROMO_DEPTH, PRICE_MULT, ALLOW_NEW };
