// Synthetic weekly sell-through feed: 52 weeks per listed account and SKU.
// It follows the engine's baseline plan, adds seeded noise, and plants four events
// for the agents to find. Every number here is invented.
const E = require('../engine/engine');

// Small seeded random generator so every run of the feed is identical.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const PLANTED = [
  { id: 'comp-cut', account: 'fw', cat: 'pasta', fromWeek: 47, kind: 'competitor', note: 'Competitor marinara cut its shelf price about 6% at FreshWay', unitEffect: 0.93, compPriceIdx: 0.94 },
  { id: 'cost-up', account: 'vm', cat: 'otc', fromWeek: 49, kind: 'cost', note: 'Ibuprofen ingredient cost up 6% for OTC packs', cogsIdx: 1.06 },
  { id: 'acv-loss', account: 'bb', sku: 'R200', fromWeek: 50, kind: 'distribution', note: 'BulkBarn dropped the 2x100 ct pack in one region (ACV 100% to 85%)', acv: 0.85 },
  { id: 'deep-promo', account: 'fw', sku: 'M24', kind: 'promotion', note: 'Marinara 24 oz runs 16 weeks a year at 28% off' }
];

// Spread promo weeks across the year in 2-week blocks.
function promoWeeks(w) {
  const weeks = new Set();
  if (!w) return weeks;
  const blocks = Math.ceil(w / 2), gap = 52 / blocks;
  for (let b = 0; b < blocks; b++) {
    const start = Math.floor(2 + b * gap);
    for (let k = 0; k < 2 && weeks.size < w; k++) weeks.add(Math.min(52, start + k));
  }
  return weeks;
}

function weekStart(week, endDate = '2026-10-25') {
  const end = Date.parse(endDate + 'T00:00:00Z');
  return new Date(end - (52 - week) * 7 * 864e5).toISOString().slice(0, 10);
}

function buildFeed(P = E.P0, seed = 20261031) {
  const rand = rng(seed);
  const rows = [];
  for (const a of E.ACCOUNTS) {
    const st = E.BASE[a.id];
    const r = E.computeAccount(a.id, st, P);
    for (const s of E.SKUS) {
      const L = st.lines[s.id];
      if (!L.on) continue;
      const x = r.lines[s.id];
      const le = x.lift, w = L.w, dip = P.dip[s.cat];
      const q = x.units / (52 - w + le * w - dip * (le - 1) * w);
      const pw = promoWeeks(w);
      for (let wk = 1; wk <= 52; wk++) {
        const promo = pw.has(wk);
        const afterBlock = !promo && pw.has(wk - 1);
        let plan = promo ? q * le : q;
        if (afterBlock) plan -= dip * (le - 1) * q * 2;
        let units = plan * (1 + (rand() - 0.5) * 0.12);
        let acv = L.acv, cogsIdx = 1, compPriceIdx = 1;
        const events = [];
        for (const ev of PLANTED) {
          if (ev.account !== a.id || !ev.fromWeek || wk < ev.fromWeek) continue;
          if (ev.cat && ev.cat !== s.cat) continue;
          if (ev.sku && ev.sku !== s.id) continue;
          if (ev.unitEffect) units *= ev.unitEffect;
          if (ev.compPriceIdx) compPriceIdx = ev.compPriceIdx;
          if (ev.cogsIdx) cogsIdx = ev.cogsIdx;
          if (ev.acv) { units *= Math.pow(ev.acv / L.acv, P.delta); acv = ev.acv; }
          events.push(ev.id);
        }
        rows.push({ account: a.id, sku: s.id, cat: s.cat, week: wk, weekStart: weekStart(wk), units: Math.round(units), plan: Math.round(plan), shelf: L.shelf, promo, depth: promo ? L.d : 0, acv, cogsIdx, compPriceIdx, events });
      }
    }
  }
  return { asOf: weekStart(52), weeks: 52, rows, planted: PLANTED };
}

module.exports = { buildFeed, PLANTED, promoWeeks };
