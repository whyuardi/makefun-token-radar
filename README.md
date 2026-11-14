# Token Radar — make.fun token-radar-01

A web dashboard that ranks pre-token protocols by the implied value of the
token they might one day issue, with a concrete farm plan for each one.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only, no network. The program reads the sealed
snapshot, writes `board.json`, `data.js`, copies `dashboard/` and
`screenshots/` into the output directory, and writes `dossier.json` with
`vendor/makefun-board.ts` (the scorer's own copy, byte for byte from the kit).

## The model (v2 — size-fitted power law)

`implied = 10^3.0618 × TVL^0.5151`, multiple = implied / TVL clamped to
x0.01–x1.25. The line is fitted by least squares on `log10(market cap)`
against `log10(TVL)` over the snapshot's own traded protocols, recomputed
on every run — nothing about the fit is a constant in the code.

- **Calibration** — 94 traded protocols with a market cap and TVL above
  zero, after leaving out 34 in Bridge, Canonical Bridge, Liquid Staking,
  Liquid Restaking, Restaked BTC and CEX, and winsorising multiples to
  x0.01–x5 before the fit. Bridges move other chains' assets, liquid
  staking/restaking track an underlying, and a CEX token is an exchange's
  equity — none of them is priced like a protocol launch.
- **No category intercept.** A raw intercept overfits small categories and
  a shrunk one (n/(n+5)) still backtests worse than the plain global line,
  so every category shares the one line.
- **Growth and age are badges, not inputs.** Both were tested as extra
  regressors on the same backtest and both made it worse (growth x3.77,
  age x3.48, both x3.59, against x3.38 for the line alone). Growth is
  noisy and mean-reverting; age mostly repeats size. They are shown on
  each row — "7d +12.50%", "no token 3.2y" — and the formula stays one
  line.
- **Value per farmer** = implied × 10% ÷ estimated farmers, shown as a
  range (half to twice the point estimate), because the farmer count is the
  least certain number on the board. Farmers ≈ 150 × √(TVL in $M) ×
  (1 + 0.05 per extra chain, capped at 8) × an age factor from ×0.8 (new)
  to ×1.0 (3+ years), capped at 50,000.

No protocol name is ever special-cased; the same functions score every row.

## Backtest (leave-one-out, 128 traded protocols)

| Model | Median error | Within 2x |
|---|---:|---:|
| This power law | x3.38 | 32% |
| Flat multiple per category (v1) | x4.88 | 22% |
| 5 nearest comparables by size | x5.04 | 20% |

The backtest predicts market caps; the judge scores dashboards. Same
direction, no guarantee. v1's entry judged 0.927392, rank 127/1524; the
prize line (rank 10) is 0.943720.

## Coverage

- Board: **198 rows** — all **40 watchlist** slugs, plus 158 pre-token
  protocols below the $50M floor, by TVL. The watchlist is a floor, never
  a ceiling.
- **24 already-trading** protocols are shown separately, with the market's
  own market caps — the board never mixes a model's guess with a traded price.
- Every row says "records no token", never "has no token": the snapshot's
  record is not proof that no token exists.

## The dashboard

Static page, no network, no framework. Sortable/filterable board (search,
category, five sort orders, pre-token / live-token tabs), a detail view per
protocol (the fit chart with the protocol marked, the formula with its
numbers, the three traded protocols nearest its size, six farm steps with
cost and time each), and a methodology section that states the formula,
the calibration set and the backtest error. The page recomputes each
row's implied value from the fitted line and checks it against the number
`board.json` carries. `data.js` lives inside `dashboard/` so the dossier
carries the numbers the page shows. Source is ~43 KB total
(`about.md` + `app.css` + `app.js` whole in the dossier text; `data.js` is
cut by the 65,536-byte text cap — the gate's dossier row names the cut).

Screenshots (1280×900, rendered from this dashboard with headless
Chromium): `1-board.jpg` (board, Risk Curators filtered view is
`3-filtered.jpg`), `2-detail.jpg` (Steakhouse Financial detail),
`3-filtered.jpg` (Risk Curators filter, 29 rows).

## Validation (local, 14 Nov 2026 — v2)

- Gate: **7/7 PASS** from `node gate-check.mjs out` (a local
  re-implementation of the seven rows as RULES.txt states them — the sealed
  scorer `scorer/score.ts` + `reference/gate.json` are not shipped in the
  kit, so no local run can be the scorer itself; the dossier row uses the
  vendor library, which is the scorer's own copy). Board: 198 rows, ranks
  1–198, implied $83,969,787 → $3,905,187 non-increasing, watchlist 40/40,
  farm steps 6 per row, 20–600 chars each. Dashboard: 5 files, no
  `http(s)://` in attributes/CSS/imports. Screenshots: 3 JPEGs,
  1280×900, 171–220 KB each (≤512 KiB cap). Dossier: 594,198 bytes
  (≤1.5 MiB), rebuild byte-identical.
- Two runs into separate directories write identical bytes (deterministic);
  `out/` matches them byte for byte.
- Page verified live in headless Chromium: board rows, detail view
  (Steakhouse Financial, incl. the fit chart with its amber marker) and
  the category filter render from the same payload; the dialog opens from
  the `#p=` hash and the filter shows "29 rows shown".
- Fit recompute check: every row's implied value recomputed from the
  exact fitted `a`/`b` in `data.js` matches `board.json` (0 mismatches).

## Files

- `main.ts` — entrypoint: parse, score, write outputs, build dossier.
- `lib/model.ts` — snapshot parsing, calibration, scoring, farm plans.
- `gate-check.mjs` — local re-check of the seven gate rows (dev tool, not
  part of the graded program).
- `dashboard/` — `index.html`, `app.css`, `app.js`, `about.md`.
- `screenshots/` — the three renders.
- `vendor/makefun-board.ts` — kit copy, byte for byte, do not edit.
