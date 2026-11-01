# Synthetic Tabular Data Generation in Python

A structured overview of generative models, frameworks, and practical approaches for tabular data generation.

---

## 1. Approaches Overview

### A. Classical & Deep Generative Models (Non-LLM)
Specialized neural networks and statistical models designed specifically for tabular data (handling continuous, discrete, skewed, and multimodal distributions):
- **CTGAN (Conditional Table GAN):** GAN-based architecture using mode-specific normalization for non-Gaussian continuous distributions and conditional generators for imbalanced discrete categories.
- **TVAE (Tabular Variational Autoencoder):** VAE-based model tailored for tabular data. Often faster to train and more stable than GANs, with strong density estimation performance.
- **CopulaGAN:** Hybrid approach combining classical statistical copulas (to capture inter-column dependencies) with neural networks.
- **ARGAN (Autoregressive GAN):** Advanced GAN architecture leveraging autoregressive modeling to capture complex multi-feature relationships.

### B. LLM & Transformer-Based Approaches
Methods leveraging large language models and autoregressive transformers for tabular synthesis:
- Treats table rows as serialized text sequences (e.g., key-value or prompt formats).
- Notable implementations: **GReaT** (Generation of Realistic Tabular data with fine-tuned transformers), TabLLM.
- Useful when datasets have rich semantic descriptions, high-cardinality categorical text, or require few-shot synthesis.

---

## 2. Key Python Libraries & Ecosystems

Rather than implementing architectures from scratch, standard workflows use these libraries:

- **SDV (Synthetic Data Vault):**
  - Comprehensive, industry-standard library supporting single-table, multi-table, and sequential data.
  - Provides plug-and-play implementations of **CTGAN**, **TVAE**, and **CopulaGAN**.
  - Includes automated quality evaluations and constraint validation.

- **ydata-synthetic:**
  - Dedicated package for generative models tailored to structured data.
  - Implements various GAN architectures (CTGAN, WGAN, WGAN-GP, CWGAN) with data profiling integration.

---

## 3. Comparison & Practical Recommendations

| Model / Tool | Architecture / Category | Best For | Key Characteristics |
| :--- | :--- | :--- | :--- |
| **CTGAN** | Deep Learning (GAN) | General tabular data, multimodal features | Handles class imbalance & non-Gaussian columns |
| **TVAE** | Deep Learning (VAE) | Fast, stable baseline synthesis | Faster convergence; avoids GAN training instability |
| **CopulaGAN** | Statistical Copula + GAN | Strongly correlated numerical features | Combines classical statistics with neural synthesis |
| **ARGAN** | Autoregressive GAN | Complex, interdependent feature structures | Enhanced conditional fidelity |
| **SDV** | Python Framework | End-to-end pipelines & evaluation | Best ecosystem to run CTGAN, TVAE, and CopulaGAN |

---

## 4. Suggested Workflow / Where to Start

1. **Default Starting Point:** Use **SDV** with **TVAE** or **CTGAN** as your initial baseline; it provides a unified API and built-in quality evaluation metrics.
2. **If GAN training suffers from mode collapse / instability:** Switch to **TVAE** for faster, smoother convergence.
3. **If columns have tight mathematical or parametric correlations:** Try **CopulaGAN**.
4. **If your table has heavy natural language text or semantic fields:** Look into LLM-based tabular generation (e.g., **GReaT**).
