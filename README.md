# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/pachiris/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/pachiris/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads one sealed DefiLlama snapshot, finds the protocols that record no token
yet and are not a wrapped or staked product of one that trades, and ranks them by what their launch
would be worth. Prices are not guessed — each pre-token protocol is priced off the live-token protocols
in its own category in the same snapshot (the median market-cap ÷ TVL, shrunk toward the global median
when a category has few peers), then adjusted for 7-day TVL momentum, age and chain breadth. The entry
hands in a ranked board (board.json), a static dashboard with a detail view and a farm plan for every
protocol, and the dossier the judge reads. Model version: radar-2 (lib/model.ts states the formula).

## Run it

```sh
node main.ts --input <directory holding snapshot.json> --output <output directory>
```

With no arguments the program reads /input/snapshot.json and writes /output, the grader's mounts.
Node 22.18 or later, standard library only. It writes board.json, data.js, dashboard/, screenshots/
and dossier.json to the output directory.

---

<sub>Entered on [make.fun](https://make.fun/?ref=k6332neg&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
