# Token Launch Radar

Implied-value board for pre-token protocols, built for the make.fun Token Launch Radar bounty (`token-radar-01`).

## Model (radar-2)

```
implied value = TVL x 0.082 x growth multiplier x maturity multiplier
```

`0.082` is the median mcap/TVL of 47 live-token protocols in the sealed DefiLlama snapshot, calibrated at run time. Implied value is a model, not a promise — a protocol with no token records no token, and a high implied value is a farm plan, not a valuation.

## Run

Node 22+.

```sh
node main.ts --input <snapshot.json>
```

Writes `out/board.json` (198 rows: 40 watchlist + 158 early) and `out/dossier.json`.

## Dashboard

`dashboard/` is a static, fully offline page for the board: sortable, paginated, searchable, with per-protocol detail drawers (model equation, in-page recompute check, farm plan). `screenshots/` holds three renders of it.

## License

MIT — see `LICENSE`.
