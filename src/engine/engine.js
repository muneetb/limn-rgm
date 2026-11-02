// Limn RGM calculation engine. Shared by the server (require) and the browser (script tag).
// Deterministic: agents never compute figures themselves; they call these functions.
// All data is synthetic.
const CATS = {
  otc: { name: 'OTC pain relief', brand: 'Relivo Ibuprofen 200mg', unit: 'tablet', unitPl: 'tablets', sizeLabel: 'Count' },
  pasta: { name: 'Pasta sauce', brand: 'Casa Verde', unit: 'oz', unitPl: 'oz', sizeLabel: 'Ounces' }
};
const SKUS = [
  { id: 'R24', cat: 'otc', name: 'Relivo 24 ct', size: 24 },
  { id: 'R50', cat: 'otc', name: 'Relivo 50 ct', size: 50 },
  { id: 'R100', cat: 'otc', name: 'Relivo 100 ct', size: 100 },
  { id: 'R200', cat: 'otc', name: 'Relivo 2x100 ct club', size: 200 },
  { id: 'M24', cat: 'pasta', name: 'Marinara 24 oz', size: 24 },
  { id: 'TB24', cat: 'pasta', name: 'Tomato Basil 24 oz', size: 24 },
  { id: 'M32', cat: 'pasta', name: 'Marinara 32 oz', size: 32 },
  { id: 'M45', cat: 'pasta', name: 'Marinara 45 oz club', size: 45 }
];
const SKU = Object.fromEntries(SKUS.map(s => [s.id, s]));

// b0 = baseline weekly units at the baseline ACV (for unlisted SKUs: potential if listed at that ACV)
const ACCOUNTS = [
  { id: 'fw', name: 'FreshWay Grocery', channel: 'Grocery', hurdle: 0.30,
    terms: { m_otc: 0.35, m_pasta: 0.30, rebate: 0.02, oninv: 0.04, days: 30, fund: 0.60, slot: 25000 },
    lines: {
      R24: { on: 1, b0: 9000, shelf: 4.49, w: 4, d: 0.20, acv: 0.90 },
      R50: { on: 1, b0: 14000, shelf: 7.49, w: 8, d: 0.25, acv: 0.85 },
      R100: { on: 1, b0: 18000, shelf: 12.99, w: 8, d: 0.25, acv: 0.70 },
      R200: { on: 0, b0: 4000, shelf: 21.99, w: 0, d: 0, acv: 0.50 },
      M24: { on: 1, b0: 60000, shelf: 3.49, w: 16, d: 0.28, acv: 0.95 },
      TB24: { on: 1, b0: 25000, shelf: 3.49, w: 12, d: 0.25, acv: 0.80 },
      M32: { on: 0, b0: 12000, shelf: 4.49, w: 4, d: 0.15, acv: 0.70 },
      M45: { on: 0, b0: 5000, shelf: 5.99, w: 0, d: 0, acv: 0.50 } } },
  { id: 'vm', name: 'ValueMart', channel: 'Mass', hurdle: 0.24,
    terms: { m_otc: 0.30, m_pasta: 0.27, rebate: 0.03, oninv: 0.03, days: 30, fund: 0.60, slot: 40000 },
    lines: {
      R24: { on: 1, b0: 7000, shelf: 3.97, w: 4, d: 0.15, acv: 0.95 },
      R50: { on: 1, b0: 12000, shelf: 6.97, w: 6, d: 0.20, acv: 0.95 },
      R100: { on: 1, b0: 15000, shelf: 11.47, w: 6, d: 0.20, acv: 0.90 },
      R200: { on: 0, b0: 5000, shelf: 19.97, w: 0, d: 0, acv: 0.60 },
      M24: { on: 1, b0: 30000, shelf: 3.29, w: 8, d: 0.15, acv: 0.95 },
      TB24: { on: 1, b0: 12000, shelf: 3.29, w: 6, d: 0.15, acv: 0.90 },
      M32: { on: 0, b0: 20000, shelf: 4.29, w: 4, d: 0.12, acv: 0.90 },
      M45: { on: 0, b0: 6000, shelf: 5.47, w: 0, d: 0, acv: 0.60 } } },
  { id: 'bb', name: 'BulkBarn Club', channel: 'Club', hurdle: 0.13,
    terms: { m_otc: 0.14, m_pasta: 0.14, rebate: 0.01, oninv: 0.02, days: 21, fund: 0.80, slot: 15000 },
    lines: {
      R24: { on: 0, b0: 2000, shelf: 3.99, w: 0, d: 0, acv: 0.50 },
      R50: { on: 0, b0: 3000, shelf: 6.49, w: 0, d: 0, acv: 0.50 },
      R100: { on: 0, b0: 6000, shelf: 10.99, w: 0, d: 0, acv: 0.80 },
      R200: { on: 1, b0: 9000, shelf: 19.99, w: 4, d: 0.15, acv: 1.00 },
      M24: { on: 0, b0: 6000, shelf: 2.99, w: 0, d: 0, acv: 0.50 },
      TB24: { on: 0, b0: 3000, shelf: 2.99, w: 0, d: 0, acv: 0.50 },
      M32: { on: 0, b0: 7000, shelf: 3.79, w: 0, d: 0, acv: 0.80 },
      M45: { on: 1, b0: 8000, shelf: 5.79, w: 4, d: 0.15, acv: 1.00 } } }
];
const ACC = Object.fromEntries(ACCOUNTS.map(a => [a.id, a]));

const P0 = {
  eps: { otc: -1.3, pasta: -1.8 },
  gamma: { otc: 0.4, pasta: 0.6 },
  promoEl: { otc: -2.3, pasta: -2.9 },
  dip: { otc: 0.20, pasta: 0.10 },
  percW: { otc: 0.5, pasta: 0.6 },
  fatigue: 0.02, delta: 0.8, incr: 0.65, transfer: 0.40, wacc: 0.08, compMatch: 0,
  cogsFix: { otc: 0.60, pasta: 0.35 }, cogsVar: { otc: 0.025, pasta: 0.035 },
  frtFix: { otc: 0.20, pasta: 0 }, frtVar: { otc: 0.0015, pasta: 0.012 }
};

const clone = o => JSON.parse(JSON.stringify(o));

function buildBase() {
  const b = {};
  for (const a of ACCOUNTS) {
    b[a.id] = { terms: clone(a.terms), lines: {} };
    for (const s of SKUS) b[a.id].lines[s.id] = Object.assign({ size: s.size }, clone(a.lines[s.id]));
  }
  return b;
}
const BASE = buildBase();

const cogsOf = (P, cat, size) => P.cogsFix[cat] + P.cogsVar[cat] * size;
const frtOf = (P, cat, size) => P.frtFix[cat] + P.frtVar[cat] * size;

const LINE_KEYS = ['units', 'promoUnits', 'consUnits', 'gross', 'onInv', 'invSales', 'promoCost', 'rebate', 'slotting', 'net', 'cogs', 'gp', 'freight', 'contrib', 'receivables', 'wc', 'econ', 'retSales', 'retFront', 'retBack', 'retTotal'];

let COMP = null; // competitor annual consumption volume by account and category, constant

function computeAccount(aid, st, P) {
  const bs = BASE[aid];
  const out = { lines: {}, cats: {}, tot: {} };
  for (const cat of ['otc', 'pasta']) {
    const ids = SKUS.filter(s => s.cat === cat).map(s => s.id);
    const idx = {};
    for (const id of ids) {
      const L = st.lines[id], B = bs.lines[id];
      const pu = L.shelf / L.size, pu0 = B.shelf / B.size;
      let raw = P.percW[cat] * (pu / pu0) + (1 - P.percW[cat]) * (L.shelf / B.shelf);
      raw = 1 + (raw - 1) * (1 - P.compMatch);
      idx[id] = raw;
    }
    const q = {};
    const both = ids.filter(id => st.lines[id].on && bs.lines[id].on);
    for (const id of ids) {
      const L = st.lines[id], B = bs.lines[id];
      if (!L.on) { q[id] = 0; continue; }
      let v = B.b0 * Math.pow(idx[id], P.eps[cat]) * Math.pow(Math.max(0.01, L.acv) / B.acv, P.delta);
      const sib = both.filter(k => k !== id);
      const wsum = sib.reduce((s, k) => s + bs.lines[k].b0, 0);
      for (const k of sib) v *= Math.pow(idx[k], P.gamma[cat] * bs.lines[k].b0 / wsum);
      q[id] = v;
    }
    // listing changes
    for (const id of ids) {
      const L = st.lines[id], B = bs.lines[id];
      const recv = both.filter(k => k !== id);
      const rsum = recv.reduce((s, k) => s + q[k], 0);
      if (!rsum) continue;
      if (L.on && !B.on) {
        const take = (1 - P.incr) * q[id];
        for (const k of recv) q[k] = Math.max(0, q[k] - take * q[k] / rsum);
      } else if (!L.on && B.on) {
        const give = P.transfer * B.b0;
        for (const k of recv) q[k] += give * q[k] / rsum;
      }
    }
    const t = st.terms, m = t['m_' + cat];
    for (const id of ids) {
      const L = st.lines[id], B = bs.lines[id];
      const r = Object.fromEntries(LINE_KEYS.map(k => [k, 0]));
      r.on = !!L.on;
      if (L.on) {
        const w = Math.max(0, Math.min(52, L.w)), d = Math.max(0, Math.min(0.9, L.d));
        const lift = Math.pow(1 - d, P.promoEl[cat]);
        const fat = Math.max(0.4, 1 - P.fatigue * Math.max(0, w - 6));
        const le = 1 + (lift - 1) * fat;
        r.lift = le;
        const reg = q[id] * (52 - w) - P.dip[cat] * (le - 1) * q[id] * w;
        const pro = q[id] * le * w;
        r.units = reg + pro; r.promoUnits = pro; r.consUnits = r.units * L.size;
        r.invoice = L.shelf * (1 - m); r.list = r.invoice / (1 - t.oninv);
        r.gross = r.units * r.list; r.invSales = r.units * r.invoice; r.onInv = r.gross - r.invSales;
        r.promoCost = pro * L.shelf * d * t.fund;
        r.rebate = t.rebate * r.invSales;
        r.slotting = (!B.on) ? t.slot : 0;
        r.net = r.invSales - r.promoCost - r.rebate - r.slotting;
        r.cogsUnit = cogsOf(P, cat, L.size); r.frtUnit = frtOf(P, cat, L.size);
        r.cogs = r.units * r.cogsUnit; r.gp = r.net - r.cogs;
        r.freight = r.units * r.frtUnit; r.contrib = r.gp - r.freight;
        r.receivables = r.net * t.days / 365; r.wc = r.receivables * P.wacc; r.econ = r.contrib - r.wc;
        r.retSales = r.units * L.shelf - pro * L.shelf * d;
        r.retFront = r.retSales - r.invSales + r.promoCost;
        r.retBack = r.rebate + r.slotting;
        r.retTotal = r.retFront + r.retBack;
        r.retPct = r.retSales ? r.retTotal / r.retSales : 0;
      }
      out.lines[id] = r;
    }
    const c = Object.fromEntries(LINE_KEYS.map(k => [k, ids.reduce((s, id) => s + out.lines[id][k], 0)]));
    const comp = (COMP && COMP[aid]) ? COMP[aid][cat] : 0;
    c.share = (c.consUnits + comp) ? c.consUnits / (c.consUnits + comp) : 0;
    c.pricePerUnit = c.consUnits ? c.retSales / c.consUnits : 0;
    out.cats[cat] = c;
  }
  out.tot = Object.fromEntries(LINE_KEYS.map(k => [k, out.cats.otc[k] + out.cats.pasta[k]]));
  out.tot.retPct = out.tot.retSales ? out.tot.retTotal / out.tot.retSales : 0;
  out.tot.trade = out.tot.onInv + out.tot.promoCost + out.tot.rebate + out.tot.slotting;
  return out;
}

function initComp() {
  COMP = {};
  for (const a of ACCOUNTS) {
    const r = computeAccount(a.id, BASE[a.id], P0);
    COMP[a.id] = { otc: r.cats.otc.consUnits * 1.8, pasta: r.cats.pasta.consUnits * 1.6 };
  }
}
initComp();

// Lever groups for attribution
const GROUPS = [
  { id: 'price', name: 'Price', fields: ['shelf'] },
  { id: 'pack', name: 'Pack architecture', fields: ['size'] },
  { id: 'promo', name: 'Promotion', fields: ['w', 'd'] },
  { id: 'assort', name: 'Assortment', fields: ['on', 'acv'] },
  { id: 'terms', name: 'Commercial terms', fields: [] }
];

function hybrid(aid, st, set) {
  const bs = BASE[aid];
  const h = { terms: clone(set.has('terms') ? st.terms : bs.terms), lines: {} };
  for (const id in bs.lines) {
    const L = clone(bs.lines[id]);
    for (const g of GROUPS) if (set.has(g.id)) for (const f of g.fields) L[f] = st.lines[id][f];
    h.lines[id] = L;
  }
  return h;
}

function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }

function shapley(aid, st, P, metric) {
  const n = GROUPS.length, ids = GROUPS.map(g => g.id);
  const cache = new Map();
  const v = mask => {
    if (cache.has(mask)) return cache.get(mask);
    const set = new Set(ids.filter((_, i) => mask & (1 << i)));
    const val = metricOf(computeAccount(aid, hybrid(aid, st, set), P), metric);
    cache.set(mask, val); return val;
  };
  const res = {};
  ids.forEach((g, i) => {
    let s = 0;
    for (let mask = 0; mask < (1 << n); mask++) {
      if (mask & (1 << i)) continue;
      const k = bits(mask);
      s += fact(k) * fact(n - k - 1) / fact(n) * (v(mask | (1 << i)) - v(mask));
    }
    res[g] = s;
  });
  return res;
}
function bits(m) { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; }
function metricOf(r, metric) { return metric === 'ret' ? r.tot.retTotal : r.tot.econ; }

function scaleP(P, f) {
  const q = clone(P);
  for (const c of ['otc', 'pasta']) { q.eps[c] *= f; q.gamma[c] *= f; q.promoEl[c] *= f; }
  q.delta *= f; return q;
}
function deltaRange(aid, st, P, metric) {
  const base = metricOf(computeAccount(aid, BASE[aid], P), metric);
  const vals = [0.75, 1, 1.25].map(f => { const q = scaleP(P, f); return metricOf(computeAccount(aid, st, q), metric) - metricOf(computeAccount(aid, BASE[aid], q), metric); });
  return { lo: Math.min(...vals), hi: Math.max(...vals), mid: vals[1], base };
}

// Assumption register (editable)
const ASSUMPTIONS = [
  { key: 'eps.otc', label: 'Own price elasticity, OTC', kind: 'Modeled', note: 'Response of units to perceived price, per tablet blend' },
  { key: 'eps.pasta', label: 'Own price elasticity, pasta sauce', kind: 'Modeled', note: 'Response of units to perceived price, per ounce blend' },
  { key: 'gamma.otc', label: 'Cross elasticity within range, OTC', kind: 'Modeled', note: 'How much sibling SKUs gain when one gets dearer' },
  { key: 'gamma.pasta', label: 'Cross elasticity within range, pasta', kind: 'Modeled', note: 'Least stable estimate in most categories' },
  { key: 'promoEl.otc', label: 'Promotion depth elasticity, OTC', kind: 'Modeled', note: '25% off gives about 1.9x lift' },
  { key: 'promoEl.pasta', label: 'Promotion depth elasticity, pasta', kind: 'Modeled', note: '28% off gives about 2.6x lift' },
  { key: 'dip.otc', label: 'Post-promotion dip, OTC', kind: 'Modeled', note: 'Share of incremental units lost after the event (pantry loading)' },
  { key: 'dip.pasta', label: 'Post-promotion dip, pasta', kind: 'Modeled', note: 'Share of incremental units lost after the event' },
  { key: 'fatigue', label: 'Promotion fatigue per week above 6', kind: 'Assumption', note: 'Lift erodes as deals become frequent' },
  { key: 'delta', label: 'Distribution response (ACV exponent)', kind: 'Modeled', note: 'Confounded with store quality; treat with care' },
  { key: 'percW.otc', label: 'Pack perception weight, OTC', kind: 'Assumption', note: '1 = shoppers judge price per tablet, 0 = shelf price only' },
  { key: 'percW.pasta', label: 'Pack perception weight, pasta', kind: 'Assumption', note: '1 = price per ounce, 0 = shelf price only' },
  { key: 'incr', label: 'New SKU incrementality', kind: 'Assumption', note: 'Share of a new listing that is new to the brand' },
  { key: 'transfer', label: 'Delist transfer rate', kind: 'Assumption', note: 'Share of a delisted SKU that moves to siblings' },
  { key: 'compMatch', label: 'Competitor price response', kind: 'Assumption', note: '0 = competitors hold, 1 = they fully match our moves' },
  { key: 'wacc', label: 'Cost of capital', kind: 'Assumption', note: 'Used to cost receivables' }
];
const getP = (P, key) => key.split('.').reduce((o, k) => o[k], P);
const setP = (P, key, val) => { const ks = key.split('.'); let o = P; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; };

function riskRank(aid, st, P) {
  const list = [];
  for (const a of ASSUMPTIONS) {
    const v = getP(P, a.key);
    const vals = [-1, 1].map(sgn => {
      const q = clone(P);
      setP(q, a.key, a.key === 'compMatch' ? Math.max(0, Math.min(1, v + 0.25 * sgn)) : v * (1 + 0.25 * sgn));
      return computeAccount(aid, st, q).tot.econ - computeAccount(aid, BASE[aid], q).tot.econ;
    });
    list.push({ a, swing: Math.abs(vals[1] - vals[0]), lo: Math.min(...vals), hi: Math.max(...vals) });
  }
  return list.sort((x, y) => y.swing - x.swing);
}

function solve(f, lo, hi) {
  let flo = f(lo), fhi = f(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
function breakEvenACV(aid, st, P) {
  const b = computeAccount(aid, BASE[aid], P).tot.econ;
  const f = x => { const h = clone(st); for (const id in h.lines) if (h.lines[id].on) h.lines[id].acv = Math.max(0.05, Math.min(1, h.lines[id].acv + x)); return computeAccount(aid, h, P).tot.econ - b; };
  return solve(f, -0.6, 0.6);
}
function marginHeadroom(aid, st, P) {
  const b = computeAccount(aid, BASE[aid], P).tot.econ;
  const f = x => { const h = clone(st); h.terms.m_otc += x; h.terms.m_pasta += x; return computeAccount(aid, h, P).tot.econ - b; };
  return solve(f, -0.25, 0.25);
}

// Give and get ledger: each change applied alone to the baseline
function ledger(aid, st, P) {
  const bs = BASE[aid];
  const b = computeAccount(aid, bs, P).tot;
  const items = [];
  const TERM_LABEL = { m_otc: 'Retailer margin, OTC', m_pasta: 'Retailer margin, pasta', rebate: 'Annual rebate', oninv: 'On-invoice allowance', days: 'Payment terms', fund: 'Promo funding share', slot: 'Slotting fee per new listing' };
  const fmtT = (k, v) => k === 'days' ? v + ' days' : k === 'slot' ? '$' + Math.round(v / 1000) + 'K' : (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
  for (const k in bs.terms) if (Math.abs(bs.terms[k] - st.terms[k]) > 1e-9) {
    const h = clone(bs); h.terms[k] = st.terms[k];
    items.push({ label: TERM_LABEL[k], detail: fmtT(k, bs.terms[k]) + ' to ' + fmtT(k, st.terms[k]), h });
  }
  for (const s of SKUS) {
    const B = bs.lines[s.id], L = st.lines[s.id];
    for (const g of GROUPS) {
      if (!g.fields.length) continue;
      const changed = g.fields.filter(f => Math.abs(+B[f] - +L[f]) > 1e-9);
      if (!changed.length) continue;
      const h = clone(bs); for (const f of g.fields) h.lines[s.id][f] = L[f];
      let detail = '';
      if (g.id === 'price') detail = '$' + B.shelf.toFixed(2) + ' to $' + L.shelf.toFixed(2);
      if (g.id === 'pack') detail = B.size + ' to ' + L.size + ' ' + CATS[s.cat].unitPl;
      if (g.id === 'promo') detail = B.w + ' wks at ' + Math.round(B.d * 100) + '% to ' + L.w + ' wks at ' + Math.round(L.d * 100) + '%';
      if (g.id === 'assort') detail = (B.on !== L.on) ? (L.on ? 'new listing' : 'delisted') + (L.on ? ', ACV ' + Math.round(L.acv * 100) + '%' : '') : 'ACV ' + Math.round(B.acv * 100) + '% to ' + Math.round(L.acv * 100) + '%';
      items.push({ label: s.name + ': ' + g.name.toLowerCase(), detail, h });
    }
  }
  let sumM = 0, sumR = 0;
  for (const it of items) {
    const r = computeAccount(aid, it.h, P).tot;
    it.mfr = r.econ - b.econ; it.ret = r.retTotal - b.retTotal; delete it.h;
    it.tag = it.mfr >= 0 && it.ret >= 0 ? 'Win-win' : it.mfr < 0 && it.ret >= 0 ? 'Give' : it.mfr >= 0 && it.ret < 0 ? 'Get' : 'Lose-lose';
    sumM += it.mfr; sumR += it.ret;
  }
  const s = computeAccount(aid, st, P).tot;
  return { items, interMfr: (s.econ - b.econ) - sumM, interRet: (s.retTotal - b.retTotal) - sumR };
}

const STORIES = {
  otc: { name: 'OTC: downsize plus distribution', note: 'FreshWay. Relivo 100 ct goes to 90 ct at the same $12.99; OTC retailer margin 35% to 37%; 100 ct promotion 8 to 5 weeks; ACV +10 points on the three OTC packs.',
    apply: s => { const a = s.fw; a.lines.R100.size = 90; a.terms.m_otc = 0.37; a.lines.R100.w = 5; for (const id of ['R24', 'R50', 'R100']) a.lines[id].acv = Math.min(1, +(a.lines[id].acv + 0.10).toFixed(2)); } },
  pasta: { name: 'Pasta: shallower promotion plus 32 oz', note: 'FreshWay Marinara 24 oz promotion 16 weeks at 28% to 12 weeks at 20%. ValueMart lists Marinara 32 oz at $4.29 and moves payment terms from 30 to 60 days.',
    apply: s => { s.fw.lines.M24.w = 12; s.fw.lines.M24.d = 0.20; s.vm.lines.M32.on = 1; s.vm.terms.days = 60; } }
};

// Price ladder: within a category, a larger listed pack must not cost more per unit than a smaller one.
function ladderBreaches(st) {
  const out = [];
  for (const cat of ['otc', 'pasta']) {
    const listed = SKUS.filter(s => s.cat === cat && st.lines[s.id].on).map(s => ({ s, size: st.lines[s.id].size, pu: st.lines[s.id].shelf / st.lines[s.id].size })).sort((a, b) => a.size - b.size);
    for (let i = 1; i < listed.length; i++) {
      const a = listed[i - 1], b = listed[i];
      if (b.size > a.size && b.pu > a.pu + 1e-9) out.push({ small: a.s.name, large: b.s.name, smallPU: a.pu, largePU: b.pu });
    }
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { CATS, SKUS, SKU, ACCOUNTS, ACC, P0, BASE, computeAccount, shapley, deltaRange, riskRank, breakEvenACV, marginHeadroom, ledger, STORIES, clone, GROUPS, ASSUMPTIONS, getP, setP, ladderBreaches, LINE_KEYS };
