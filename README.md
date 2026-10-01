# Investments Dashboard (mirror)

Static site: `index.html` (tab shell) + `tabs.json`, `templates/` (Summary and stock pages), `crypto/` (crypto regime page),
`stocks/<CODE>/{settings,side,data}.json`, `stocks/_engine/` (collector + scoring engine), `macro.json`.

- Master copy: the Claude artifact "Investments Dashboard" (live). This repo is an exact copy of it (Option B, from 1 Oct 2026). Never edit files here by hand; change the artifact and copy it across.
- One scheduled task refreshes the data daily at 09:00 SGT: "Investments - Stocks and Crypto Refresh". It updates `stocks/*/data.json`, `stocks/*/side.json`, `macro.json` and `crypto/data.json`.
- Every other file changes only when Kenneth promotes a change from the Framework chat.
- Tabs: Summary, Crypto, AAPL, AMD, SPCX, GLD (gold, scored with the commodity version of the framework).
- History lives in this repo's commit log; there is no archive folder.
- Vercel serves the repo root as a static site (no build step) and redeploys on every push to `main`.

Analysis, not advice.
