# Investments Dashboard (mirror)

Static site: `index.html` (tab shell) + `tabs.json`, `templates/` (Summary and stock pages), `crypto/` (crypto regime page),
`stocks/<CODE>/{settings,side,data}.json`, `stocks/_engine/` (collector + scoring engine), `macro.json`.

- Master copy: the Claude artifact "Investments Dashboard" (live). This repo is a mirror (Option B, from 1 Oct 2026).
- Daily updates are pushed by two scheduled tasks after they publish to the artifact:
  - Investments – Stocks Refresh (06:47 SGT, Tue–Sat): `stocks/*/data.json`, `stocks/*/side.json`, `macro.json`
  - Investments – Daily Refresh (08:46 SGT, daily): `crypto/data.json`
- Every other file changes only when the Framework chat promotes a change.
- Vercel serves the repo root as a static site (no build step).

Analysis, not advice.
