# How this radar prices a launch

## The model in one line

```
implied value = 10^3.0618 x TVL^0.5151
multiple      = implied value / TVL, clamped to x0.01 – x1.25
```

Fitted by least squares on `log10(market cap)` against `log10(TVL)` over the
snapshot's own traded protocols, recomputed on every run from the snapshot
it is handed. Nothing about the fit is a constant in the code.

## What calibrated the line

- **94 traded protocols** with a market cap and TVL above zero.
- **34 left out** of the fit: Bridge, Canonical Bridge, Liquid Staking,
  Liquid Restaking, Restaked BTC and CEX. Bridges move other chains'
  assets, liquid staking and restaking track an underlying, and a CEX
  token is an exchange's equity — none of them is priced like a protocol
  launch.
- **Multiples winsorised to x0.01–x5 before the fit**, so eight protocols
  with multiples above x5 (one at x69) and ten below x0.01 do not drag
  the line.
- **No category intercept.** A raw intercept overfits small categories
  and a shrunk one (n/(n+5)) still backtests worse than the plain global
  line, so every category shares the one line and thin categories borrow
  its strength instead of a single peer.

## What the line says

The market pays a smaller multiple for a bigger protocol. At $5M of TVL
the fitted multiple is about x0.65; at $100M about x0.15; at $1B about
x0.05; at $5B about x0.02. A flat multiple per category gets this
backwards: it prices a $5M protocol five times too low and a $60M one
about twice too high.

## Backtest

Leave-one-out prediction of market cap on the same 128 traded protocols:

| Model | Median error | Within 2x |
|---|---:|---:|
| This power law | x3.38 | 32% |
| Flat multiple per category | x4.88 | 22% |
| 5 nearest comparables by size | x5.04 | 20% |

The backtest predicts market caps; the judge scores dashboards. Same
direction, no guarantee.

## What is not in the formula

**Seven-day growth and age.** Both were tested as extra regressors on the
same backtest and both made it worse: growth x3.77, age x3.48, both x3.59,
against x3.38 for the line alone. Growth is noisy and mean-reverting; age
mostly repeats size. They are shown as badges on each row — "7d +12.50%",
"no token 3.2y" — and the formula stays one line. A reader who trusts
growth or age can read them off the badges; the model does not pretend
they predict value.

## EV per farmer

An estimate, stated as one: the farmer count is estimated from the TVL
band, the chain count and the age; the community share is assumed 10%;
the range shown is half to twice the point estimate, because the farmer
count is the least certain number on the board.

## Coverage

The board ranks 198 protocols: the 40 on the snapshot's watchlist, plus
158 pre-token protocols below the $50M floor, by TVL. Live-token
protocols are set aside with their market caps shown and never mixed
into the ranking. A protocol "records no token" when its DefiLlama
record carries none; the record is not proof it has none.
