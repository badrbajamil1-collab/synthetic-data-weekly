# Phase 2 — ranked list, 4 November 2026

The brief's Phase 2 deliverable: *"a ranked list you can compare with your manual
report."* This folder is that list, frozen, so it survives the next weekly run
overwriting `ranked.json` at the repo root.

| File | What it is |
|---|---|
| `ranked-2026-11-04.json` | All 222 items, sorted, with `score`, `well7_fit`, `reason`, `score_status`, `duplicate_of`, `scored_by` |
| `score-cache-2026-11-04.json` | The score cache from that run, so the exact scores are reproducible without spending quota |

## The run

| Measure | Result |
|---|---|
| Items in / out | 222 / 222 |
| Scored | 222 (100%) |
| Unscored | 0 |
| Model calls | 15 |
| Transport retries | 0 |
| Duplicate stories collapsed | 4 |
| Wall clock | ~3 minutes |
| Model | `nvidia/nemotron-3-ultra-550b-a55b:free` |

Reproduce without any network calls:

```powershell
uv run python rank_items.py      # cached: 222, calls: 0
```

## Top 10 as ranked

| # | Score | Well7 | Source | Item |
|---|---|---|---|---|
| 1 | 10 | 10 | github | `nathanielkang/CrossSynth` — federated DP tabular synthesis |
| 2 | 9 | 10 | github | `Sejal116/federated-hospitals-simulation` |
| 3 | 9 | 10 | hn | Pepperwind — 223-table, 79M-row fictional dataset |
| 4 | 9 | 9 | github | `opendp/opendp` (447 stars) |
| 5 | 9 | 9 | github | `pfeifferj/telecom-lora-experiments` |
| 6 | 9 | 9 | arxiv | Structured Priors — algebra of component priors for TabPFN |
| 7 | 9 | 9 | news | Microsoft Copilot synthetic data for enterprise evaluation |
| 8 | 9 | 8 | arxiv | Pure DP Query Release via Laplace Input Smoothing |
| 9 | 9 | 8 | news | Open-source toolkit grading synthetic brain recordings |
| 10 | 9 | 7 | github | `bhusalb/privacy-preserving-icl` |

## Score distribution

```
10 | 1
 9 | 9
 8 | 10
 7 | 10
 6 | 5
 5 | 15
 4 | 5
 3 | 15
 2 | 41
 1 | 111
```

**The tail is the finding, not a bug.** 152 of 222 items scored 1–2, and spot-checking
confirms they are noise: a Fashion-MNIST tutorial, LLM inference benchmarks, 3D
Gaussian splatting, a Reddit thread about conference reviewing. Phase 1 documents that
arXiv's `all:` search matches loosely and GitHub returns repos that merely mention the
query; this is that looseness, measured.

**The weakness is the head.** Five of the top ten are GitHub repos, three with zero
stars. The rubric rewards "new tools", and a repo description reading "federated
differentially private tabular synthesis" satisfies every keyword whether it is a
serious project or a student exercise. The model is faithful to the text and blind to
substance. See `docs/one-page-note.md` for the comparison against the manual report.
