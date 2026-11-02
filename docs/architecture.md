# Architecture notes (release 0.1)

Design documents: Phase 1 evaluation and the agentic architecture live as Claude docs; this file records what the code does.

## Flow of one agent run

1. **Data steward** builds the synthetic feed (`src/data/synthetic.js`): 52 weeks per listed account and SKU, following the
   engine baseline, with seeded noise and four planted events (competitor price cut at FreshWay pasta, OTC cost increase at
   ValueMart, a distribution loss at BulkBarn, and a deep, frequent Marinara promotion at FreshWay).
2. **Performance analyst** compares the last 4 weeks with plan per account, converts unit gaps to contribution dollars, and
   groups them by cause. The model writes the narrative from those facts.
3. **Promotion evaluator** finds each promotion block, estimates a baseline from the median of clean surrounding weeks,
   counts incremental units including the post-promotion week, and prices them against our funding on every promoted unit.
4. **Opportunity scout** chooses plays per account. When the evaluator flags losing promotions it searches promotion plays
   first and pins them to the top of the inbox. Plays: rebalance promotion and funding (both sides no worse off),
   cut losing promotions (retailer only needs its hurdle), everyday price, range extension, combined plan.
5. **Optimizer** (coordinate ascent over the engine) searches promotion weeks and depth, shelf price within 5%,
   channel-appropriate new listings, rebate and promotion funding share. Constraints: retailer hurdle, optional
   "retailer no worse off", price ladder, trade rate cap. Infeasible plans carry at least a $1M penalty.
6. **Critic** applies hard rules and a short model review. Verdicts: Pass, Pass with warnings, Blocked.
7. The run is stored as `runs/<id>.json` and `runs/latest.json`.

## Where to take it next

- Counter-offer agent and contract terms reader (next release in the agentic design).
- Real data connectors replacing the synthetic feed; the Model calibrator to estimate elasticities from it.
- Account memory per retailer for the Retailer response predictor.
- Outcome tracker and agent hit rates, which decide when an agent can move up the autonomy ladder.
- Optional: GitHub Actions deploy with Workload Identity Federation, replacing the manual `deploy.sh` step.
