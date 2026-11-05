**Subject:** Synthetic Data Weekly — Week of 30 Oct – 5 Nov 2026

## Trend of the week

This week's selection centers on differential privacy as a unifying layer for synthetic data generation. CoRTeC releases noisy count files that any generator can decode without additional privacy cost, while SAVANT integrates attention-based variational autoencoders with DP-SGD to explore how dataset size interacts with privacy budgets. A federated approach trains local diffusion models under differential privacy, and a modular algorithm library provides building blocks for such pipelines. Across these works, membership inference attacks serve as a common benchmark, with results showing attack success reduced to chance levels under formal guarantees, though utility costs vary by architecture and data modality.

## Top picks

1. [CoRTeC: A Differentially Private Release for Synthetic Tabular Data, Decodable by Any Generator](https://arxiv.org/abs/2611.06342)
   *arXiv · 4 Nov 2026*
   CoRTeC releases differentially private synthetic tabular data by spending a privacy budget once on a file of noisy counts — group sizes, outcome balances, column histograms per outcome, and outcome rates in cells — that anyone can decode into synthetic rows at no privacy cost using a maximum-entropy decoder or language models that never see real records. At ε=2 on Adult the release trains classifiers within 0.02 AUC of a real sample; on NHANES and bank marketing it stays within 0.05 AUC without the selection step. Controls show utility comes from the release and selection step, no private row reaches a model, no generated row copies a real one, and the strongest membership attack remains far below the budget bound.

2. [MaheshBhushan/campus-cham-privacy (stars: 0)](https://github.com/MaheshBhushan/campus-cham-privacy)
   *GitHub · 4 Nov 2026*
   A prototype for a THD Campus Cham learning journal generates synthetic student and helpdesk ticket data with embedded personal identifiers and ground-truth spans to evaluate anonymization techniques. It tests releases against GDPR criteria using k-anonymity, differential privacy twins, and text masking with spaCy and GLiNER, measuring re-identification risk via Anonymeter and utility via statistical and ML metrics. The framework exposes assumptions and lower-bound risk estimates for real-world validation.

3. [Exploring the Privacy--Size Tradeoff for Differentially Private Self-Attentive Variational Autoencoders](https://arxiv.org/abs/2611.05582)
   *arXiv · 3 Nov 2026*
   SAVANT, a self-attentive variational autoencoder for tabular data trained with DP-SGD, combines attention, VAE, and differential privacy in one model. Evaluated against PrivBayes and MST on two public datasets across privacy budgets and dataset sizes, it shows that more data generally increases utility under the same DP guarantee. Marginal mechanisms absorb most utility loss from strict budgets, while DP-SGD exchanges data for budget at a worse rate; membership-inference attacks detected no aggregate signal.

4. [nathanielkang/CrossSynth (stars: 0)](https://github.com/nathanielkang/CrossSynth)
   *GitHub · 31 Oct 2026*
   When sites train generators on uneven shards, the synthetic union can keep the counts and still miss the joints. CrossSynth is a federated tabular synthesizer. Each party trains a local diffusion model under differential privacy.

5. [opendp/opendp (stars: 447)](https://github.com/opendp/opendp)
   *GitHub · 5 Nov 2026*
   OpenDP Library is a modular collection of differential privacy algorithms implemented in Rust with Python and R bindings. It enables building privacy-preserving computations using multiple privacy models based on a programming framework. Synthetic data practitioners can use it to add differential privacy guarantees, though they should evaluate known and unknown issues for privacy-critical applications.

6. [dariemjnr/membership-inference-dp-gpt2 (stars: 1)](https://github.com/dariemjnr/membership-inference-dp-gpt2)
   *GitHub · 4 Nov 2026*
   A GitHub notebook evaluates membership inference attacks on GPT-2 fine-tuned with LoRA on 1,200 synthetic clinic records using DP-SGD at ε=8 and ε=1. Without differential privacy, a reference attack identifies 82% of training records at 1% false positive rate; DP reduces attack success to chance levels (~1% TPR) but increases validation perplexity from 5.65 to 15.59 (ε=8) and 73.72 (ε=1). Training for only 5 epochs without DP yields lower perplexity (4.33) and reduced leakage (AUC 0.602), suggesting early stopping mitigates risk. Results are limited by small model size, synthetic data, single seed, and loss-only attacks.

## New tools and datasets

- [NVIDIA-NeMo/DataDesigner (stars: 2396)](https://github.com/NVIDIA-NeMo/DataDesigner) — NVIDIA's DataDesigner framework generates multimodal synthetic datasets with dependency-aware fields, validation, plugin extensions, and external tool integration for production-grade data creation.

## Worth a look (lower priority)

- [Synthetic Data Standard Launches Independent Certification for Synthetic Research Data - EIN Presswire](https://einpresswire.com/article/954272739/synthetic-data-standard-launches-independent-certification-for-synthetic-research-data) — Synthetic Data Standard launched a field guide defining six synthetic data types and an independent certification with a 14-member advisory council, giving buyers a shared language and audit standard for synthetic research data.
- [Pure Differentially Private Query Release via Laplace Input Smoothing](https://arxiv.org/abs/2611.04721) — An efficient algorithm releases k statistical queries under pure differential privacy with error O(min{1, sqrt(log(d/β) log k / (Nε))}) via Laplace input smoothing and multiplicative weights, producing a synthetic histogram and resolving a conjecture.
- [Structured Priors: Towards an algebra of component priors for prior-data fitted networks](https://arxiv.org/abs/2611.04056) — Structured priors replace hand-built generators with algebraically proven operators for prior-data fitted networks, showing mixed components match or exceed individual performance on regression benchmarks and achieve comparable errors with less data, though model averaging fails.

---

Auto-generated by the Synthetic Data Research Agent. Reply with feedback.
