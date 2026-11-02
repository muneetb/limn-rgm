const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine/engine');
const { optimizeAccount } = require('../src/engine/optimizer');

test('baseline accounts clear their retailer hurdles', () => {
  for (const a of E.ACCOUNTS) {
    const r = E.computeAccount(a.id, E.BASE[a.id], E.P0);
    assert.ok(r.tot.retPct >= a.hurdle, `${a.id} retailer margin ${r.tot.retPct}`);
    assert.ok(r.tot.econ > 0);
  }
});

test('Shapley bridge sums exactly to the total change', () => {
  for (const k of Object.keys(E.STORIES)) {
    const s = E.clone(E.BASE); E.STORIES[k].apply(s);
    for (const aid of ['fw', 'vm']) {
      const total = E.computeAccount(aid, s[aid], E.P0).tot.econ - E.computeAccount(aid, E.BASE[aid], E.P0).tot.econ;
      const sum = Object.values(E.shapley(aid, s[aid], E.P0, 'econ')).reduce((x, y) => x + y, 0);
      assert.ok(Math.abs(total - sum) < 1e-6, `${k}/${aid}: ${total} vs ${sum}`);
    }
  }
});

test('ledger items plus interaction reconcile to the scenario', () => {
  const s = E.clone(E.BASE); E.STORIES.otc.apply(s);
  const L = E.ledger('fw', s.fw, E.P0);
  const total = E.computeAccount('fw', s.fw, E.P0).tot.econ - E.computeAccount('fw', E.BASE.fw, E.P0).tot.econ;
  const sum = L.items.reduce((x, i) => x + i.mfr, 0) + L.interMfr;
  assert.ok(Math.abs(total - sum) < 1e-6);
});

test('optimizer results are feasible: hurdle met, no ladder breach, never worse than baseline', () => {
  for (const a of E.ACCOUNTS) for (const [levers, mode] of [[['promo', 'terms'], 'winwin'], [['promo'], 'ours'], [['price'], 'winwin'], [['promo', 'price', 'assort'], 'winwin']]) {
    const res = optimizeAccount(a.id, E.P0, { levers, mode });
    const r = E.computeAccount(a.id, res.state, E.P0);
    assert.ok(r.tot.retPct >= a.hurdle - 1e-9, `${a.id} ${levers} hurdle`);
    assert.deepStrictEqual(E.ladderBreaches(res.state), []);
    assert.ok(res.gain >= -1, `${a.id} ${levers} gain ${res.gain}`);
    if (mode === 'winwin') assert.ok(res.retGain >= -0.5, `${a.id} ${levers} retailer ${res.retGain}`);
  }
});
