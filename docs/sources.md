# Source list

The brief asks for 15–20 sources and 10–15 keywords before any collector code is
written. `config.yaml` is the authoritative copy; this document records *why* each
source is in the list, so a future change is a decision rather than a guess.

**18 sources, 6 collectors, 12 keywords.** Several sources issue more than one
search, so a full run makes 27 HTTP requests: 3 arXiv queries, 2 Google News
queries, 1 Reddit feed, 4 Hacker News queries, 4 GitHub searches, 13 blog feeds.
Every collector returns the same `Item` shape, so the rest of the pipeline handles
an item the same way regardless of origin.

| # | Source | Endpoint | Cadence | Why it earns a place |
|---|---|---|---|---|
| 1 | arXiv | `export.arxiv.org/api/query` — `all:"synthetic data"`, `all:"tabular synthesis"`, `all:"differential privacy" AND synthetic` | daily, Sun–Thu | The primary venue for new methods. Covers the technical core: generators, fidelity metrics, privacy guarantees. |
| 2 | Google News | `news.google.com/rss/search` — `"synthetic data"`, `"synthetic dataset"`, both `when:7d` | continuous | Catches industry news the blogs miss: funding, acquisitions, product launches, regulation. |
| 3 | Reddit — r/MachineLearning, r/LocalLLaMA, r/datascience | `reddit.com/r/MachineLearning+LocalLLaMA+datascience.rss` — one combined feed, because Reddit allows about one request per minute per IP | continuous | Practitioner argument about whether a method works. Three subreddits: research-heavy, local-model pragmatic, and enterprise/tabular. One request keeps the run under a minute. |
| 4 | Hacker News | Algolia API — `"synthetic data"`, `"tabular synthesis"`, `"synthetic dataset"`, `"data augmentation"` | continuous | Early signal on tools and posts that later become widely cited. Also the fastest source for "this paper is wrong" threads. |
| 5 | GitHub | search API — `synthetic-data`, `tabular-synthesis`, `differential-privacy`, `data-augmentation` | continuous | New open-source tooling shows up here before it is written about. Filtered on `pushed_at`, so treat it as noise-tolerant. |
| 6 | OpenAI | `openai.com/news/rss.xml` | irregular | Frontier-lab announcements shape what the field considers possible. |
| 7 | Google DeepMind | `deepmind.google/blog/rss.xml` | irregular | Same, with a stronger methods focus (diffusion, evaluation). |
| 8 | Google Research | `research.google/blog/rss/` | weekly-ish | Applied research write-ups, often with released code and benchmarks. |
| 9 | Google AI (Keyword) | `blog.google/technology/ai/rss/` | irregular | Product-level AI news; the commercial context for synthetic data. |
| 10 | Hugging Face | `huggingface.co/blog/feed.xml` | weekly-ish | Datasets and models, which is how synthetic data actually reaches users. |
| 11 | Microsoft Research | `microsoft.com/en-us/research/feed/` | irregular | Strong differential-privacy and tabular-synthesis group. |
| 12 | AWS ML Blog | `aws.amazon.com/blogs/machine-learning/feed/` | weekly-ish | Enterprise deployment patterns, including regulated industries. |
| 13 | BAIR (Berkeley) | `bair.berkeley.edu/blog/feed.xml` | monthly-ish | Deep, readable method explanations; often the best summary of a technique. |
| 14 | The Gradient | `thegradient.pub/rss/` | monthly-ish | Long-form analysis and critique rather than announcements. |
| 15 | Together AI | `together.ai/blog/rss.xml` | irregular | Open-model training data work, close to the synthetic-training-data thread. |
| 16 | TechCrunch AI | `techcrunch.com/category/artificial-intelligence/feed/` | daily | Market and funding context; usually the first place an acquisition appears. |
| 17 | KDnuggets | `kdnuggets.com/feed` | daily | Practitioner-oriented roundups; useful for spotting recurring themes across the week. |
| 18 | Center for Data Innovation | `datainnovation.org/feed/` | weekly-ish | Policy and governance angle — PDPL, GDPR, AI Act. Relevant to regulated buyers. |

## Keywords

`synthetic data`, `tabular data synthesis`, `differential privacy synthetic`,
`synthetic time-series`, `privacy-preserving synthetic data`, `CTGAN`, `PrivBayes`,
`synthetic document generation`, `data augmentation LLM`, `synthetic training data`,
`synthetic dataset`, `data synthesizer`.

Tuned for enterprise and Well7 priorities: tabular and time-series generation,
privacy guarantees, and regulated-industry use cases. Generic generative-AI news
(ChatGPT features, image models) is deliberately not a keyword.

The `keywords` list is the Phase 0 vocabulary; the collectors search each source's
own `queries`, `tags` or `subreddits` key, not this list directly.

## What is not on the list, and why

- **X / Twitter** — no usable free API; the signal is already echoed on HN and Reddit.
- **LinkedIn** — scraping is against their terms and the volume is low.
- **Vendor gated reports** (Gartner, Forrester) — paywalled, so a link cannot be verified.
- **Papers With Code trending** — folded into arXiv and GitHub coverage; a third
  overlapping feed adds duplicates rather than reach.

## Known limitations

- arXiv's `all:` search is loose. A paper that never writes "synthetic data" is
  invisible to it, which is why the keyword list is broad rather than exact.
- arXiv announces nothing on Friday or Saturday, so most weeks end with a date gap.
  That is expected, not a collector failure.
- GitHub search filters on `pushed_at`, not publication date, and returns repos that
  merely mention a query term. Its ranking is noise; treat it as a discovery net.
- Reddit allows roughly one request per minute per IP. The collector backs off
  15/30/45 s rather than failing, so a second full run inside a minute takes ~90 s.
