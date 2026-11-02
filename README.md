# Limn RGM

Agentic revenue growth management for CPG key account managers preparing a joint business plan (JBP).
This is the first release: six agents working over a deterministic calculation engine, on **synthetic data only**.

## What it does

Every weekday morning a scheduled job runs the agents. People open the **Agent inbox**:

| Layer | Agent | What it does |
| --- | --- | --- |
| Sense | Data steward | Loads the weekly sell-through feed (synthetic in this release, with four planted market events) |
| Diagnose | Performance analyst | Last 4 weeks against plan by account, in contribution dollars, grouped by cause |
| Diagnose | Promotion evaluator | Incremental units, funding and profit for every promoted SKU over 52 weeks |
| Prescribe | Opportunity scout | Picks which searches to run per account (promotion first when promotions are losing money), runs the optimizer, posts the top 3 opportunity cards |
| Govern | Critic | Hard rules in code (retailer hurdle, price ladder, promotion limits, price range, legal notes) plus a short model review; blocked cards never reach the inbox |
| Prescribe | JBP planner | Turns a card into a deal package: both P&Ls, give and get, retailer proposal, executive summary |
| All | Explainer | Answers questions using engine tools only, so every number it quotes is traceable |

Each card opens in the **Plan** view (the interactive prototype: levers, bridge by lever, deal for both sides, give and get).

**Design rule:** agents never compute figures. They call `src/engine/engine.js` (P&L, Shapley bridge, ledger, sensitivity)
and `src/engine/optimizer.js` (constrained search). The same engine file runs in the browser for live what-ifs.

Without an `ANTHROPIC_API_KEY`, everything still runs: the agents write template text and the Explainer is off.

## Run locally

```bash
npm install
npm test                      # 10 tests: engine maths, optimizer constraints, agents (with a fake model), API
npm start                     # http://localhost:8080 ; runs stored in ./data; no login locally
ANTHROPIC_API_KEY=sk-... npm start   # with model-written text and the Explainer
npm run agents                # one agent run from the command line
```

Optional settings: `LIMN_MODEL` (default `claude-sonnet-5-5`), `LIMN_FAST_MODEL` (default `claude-haiku-5-5`),
`BUCKET` (store runs in Cloud Storage instead of ./data), `PORT`.

## Deploy to Google Cloud

In Cloud Shell (or on a Mac with the gcloud CLI signed in):

```bash
git clone https://github.com/muneetb/limn-rgm.git && cd limn-rgm
./deploy.sh
```

This deploys the agentic release as its own Cloud Run service, `limn-rgm-v2`, next to the original tester page
(`limn-rgm`, which it does not touch). Both use the same named logins, stored as password hashes in the Secret
Manager secret `limn-rgm-users`. The script is safe to re-run; after `git pull`, run it again to redeploy.

It creates, all named `limn-rgm-v2`: a service account, a bucket for agent runs, the web service (logins required),
and the job `limn-rgm-v2-agents` with a weekday 6:10 am Central schedule. It optionally stores a Claude API key in
the secret `limn-rgm-anthropic-key`.

## Manage access

`./users.sh` manages logins for both pages: `list`, `add <name>`, `off <name>`, `on <name>`, `reset <name>`,
`remove <name>`. Changes apply in about 30 seconds with no rebuild.

## Repository layout

```
src/engine/      engine.js (calculation spine, shared with the browser), optimizer.js
src/data/        synthetic.js (52-week feed with planted events)
src/agents/      diagnose, scout, critic, jbp, explainer, orchestrator, llm (Claude API wrapper)
src/store/       Cloud Storage or local JSON store
src/auth.js      named logins (htpasswd from the limn-rgm-users secret)
src/server.js    web service and API      src/job.js   scheduled agent run
deploy.sh, users.sh   Google Cloud deploy and login management
public/          the app (inbox, plan, compare, assumptions, executive summary)
docs/            architecture notes
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Version, store, model status |
| GET | `/api/latest` | Latest agent run (runs one if none exists) |
| POST | `/api/agents/run` | Run the agents now |
| POST | `/api/jbp` `{cardId}` | Build a JBP package for a card |
| POST | `/api/explain` `{question, context}` | Ask the Explainer |

All data in this repository is invented for demonstration.
