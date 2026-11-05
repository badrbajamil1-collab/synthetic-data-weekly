import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

pdf_path = "Synthetic_Data_Weekly_Report_Oct_2026.pdf"
doc = SimpleDocTemplate(
    pdf_path,
    pagesize=letter,
    rightMargin=40,
    leftMargin=40,
    topMargin=40,
    bottomMargin=40
)

styles = getSampleStyleSheet()

# Custom styles
primary_color = colors.HexColor("#1A365D")  # Deep Navy
accent_color = colors.HexColor("#2B6CB0")   # Medium Blue
text_color = colors.HexColor("#2D3748")     # Charcoal
light_bg = colors.HexColor("#F7FAFC")       # Off-white / light slate
border_color = colors.HexColor("#E2E8F0")

title_style = ParagraphStyle(
    'DocTitle',
    parent=styles['Heading1'],
    fontName='Helvetica-Bold',
    fontSize=20,
    leading=24,
    textColor=primary_color,
    spaceAfter=4
)

subtitle_style = ParagraphStyle(
    'DocSubTitle',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=11,
    leading=14,
    textColor=accent_color,
    spaceAfter=15
)

section_heading = ParagraphStyle(
    'SectionHeading',
    parent=styles['Heading2'],
    fontName='Helvetica-Bold',
    fontSize=13,
    leading=17,
    textColor=primary_color,
    spaceBefore=10,
    spaceAfter=5
)

body_style = ParagraphStyle(
    'BodyTextCustom',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=9,
    leading=12.5,
    textColor=text_color
)

item_title = ParagraphStyle(
    'ItemTitle',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=9.5,
    leading=13,
    textColor=accent_color
)

item_meta = ParagraphStyle(
    'ItemMeta',
    parent=styles['Normal'],
    fontName='Helvetica-Oblique',
    fontSize=8,
    leading=10.5,
    textColor=colors.HexColor("#718096")
)

table_header_style = ParagraphStyle(
    'TableHeader',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=8.5,
    leading=11,
    textColor=colors.white
)

table_body_style = ParagraphStyle(
    'TableBody',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=7.8,
    leading=10.5,
    textColor=text_color
)

table_term_style = ParagraphStyle(
    'TableTerm',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=8,
    leading=10.5,
    textColor=primary_color
)

story = []

# 1. Title & Header
story.append(Paragraph("Synthetic Data Weekly", title_style))
story.append(Paragraph("Week of 19–29 Oct 2026 · Curated by Research Agent", subtitle_style))
story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceAfter=10))

# 2. Trend of the week box
story.append(Paragraph("Trend of the Week", section_heading))
trend_text = (
    "Over the past 10 days, synthetic tabular research has zeroed in on <b>privacy-constrained enterprise "
    "deployments</b> and <b>continuous diffusion</b>. Instead of unconstrained generation, new work prioritizes "
    "differential privacy under high-dimensional telemetry, federated multi-party tabular synthesis without central "
    "data lakes, and continuous diffusion architectures capable of handling mixed continuous-categorical tables. "
    "At the same time, new membership inference audits highlight that naive inference-time synthesis remains vulnerable "
    "to training data memorization."
)
trend_table = Table([[Paragraph(trend_text, body_style)]], colWidths=[532])
trend_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), light_bg),
    ('BOX', (0,0), (-1,-1), 1, border_color),
    ('PADDING', (0,0), (-1,-1), 7),
]))
story.append(trend_table)
story.append(Spacer(1, 8))

# 3. Glossary Section (Placed upfront right after Trend)
story.append(Paragraph("Glossary of Key Technical Terms", section_heading))

glossary_data = [
    [Paragraph("Term", table_header_style), Paragraph("Plain-English Definition & Enterprise Context", table_header_style)],
    [Paragraph("Differential Privacy<br/>(DP / ε-DP)", table_term_style), Paragraph("Mathematical guarantee ensuring outputs do not reveal whether any individual record was in the training set. ε measures the privacy budget: lower ε means stronger privacy but usually lower analytical utility.", table_body_style)],
    [Paragraph("Tabular Data", table_term_style), Paragraph("Structured information in rows/columns (SQL/CSVs) mixing continuous numeric values (salary, age) and discrete categories (diagnosis codes, nationality).", table_body_style)],
    [Paragraph("Time-Series Data", table_term_style), Paragraph("Data points ordered chronologically where sequence and intervals matter (patient vital signs, bank transactions, telemetry).", table_body_style)],
    [Paragraph("Mode-Specific<br/>Normalization", table_term_style), Paragraph("Technique in CTGAN splitting multi-modal numerical distributions into clusters so neural networks don't blur rare values.", table_body_style)],
    [Paragraph("Conditional Generation", table_term_style), Paragraph("Synthesizing records that satisfy specific filters (e.g. 'generate 5,000 patient records where Age > 65 and Diagnosis = Diabetes').", table_body_style)],
    [Paragraph("Membership Inference<br/>Attack (MIA)", table_term_style), Paragraph("An adversarial audit testing whether an attacker can determine if a specific person's record was used to train the generator.", table_body_style)],
    [Paragraph("Latent Space / VAE", table_term_style), Paragraph("An intermediate compressed space where messy columns are mapped into continuous coordinates prior to generative sampling.", table_body_style)],
    [Paragraph("Federated Synthesis", table_term_style), Paragraph("Training a synthesizer across distributed hospitals or banks without sharing or centralizing raw private CSVs.", table_body_style)],
    [Paragraph("Foreign Key (FK)<br/>Integrity", table_term_style), Paragraph("Maintaining relational validity across tables (e.g. orders must link to valid, existing synthetic customer IDs).", table_body_style)]
]

glossary_table = Table(glossary_data, colWidths=[130, 402])
glossary_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), primary_color),
    ('ALIGN', (0,0), (-1,-1), 'LEFT'),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, light_bg]),
    ('GRID', (0,0), (-1,-1), 0.5, border_color),
]))

story.append(glossary_table)
story.append(Spacer(1, 10))

# 4. Top Picks
story.append(Paragraph("Top Picks", section_heading))

top_picks = [
    {
        "title": "1. DiffLTM: Continuous Diffusions Large Tabular Models for Conditional Generation",
        "meta": "arXiv:2610.30472 · Published 21 Oct 2026",
        "summary": "Introduces continuous diffusion conditioning specifically engineered for mixed continuous and high-cardinality categorical tables. Directly addresses latency and feature-coupling bottlenecks present in earlier hybrid discrete-continuous tabular models."
    },
    {
        "title": "2. Faithful Federated Tabular Data Synthesis",
        "meta": "arXiv:2610.33403 · Published 24 Oct 2026",
        "summary": "A multi-client synthesis framework that trains high-fidelity tabular generators across decentralized institutions without sharing raw records. Highly applicable to multi-hospital clinical trials and inter-bank consortium analytics."
    },
    {
        "title": "3. PRISMA: Differentially Private Synthetic In-Car Telemetry via Differentiable Simulation",
        "meta": "arXiv:2610.35521 · Published 26 Oct 2026",
        "summary": "Combines physical dynamics simulations with strict differential privacy bounds (ε-DP) to synthesize complex telemetry and sensor streams without suffering dimensional utility degradation."
    },
    {
        "title": "4. Membership Inference Attack on Private Evolution",
        "meta": "arXiv:2610.30514 · Published 21 Oct 2026",
        "summary": "Demonstrates that black-box, evolutionary synthetic generators can inadvertently leak individual training records under membership inference queries. Provides essential empirical auditing criteria for compliance teams under PDPL/GDPR."
    },
    {
        "title": "5. Two Is Enough: Binary Classification Priors Suffice for In-Context Tabular Prediction",
        "meta": "arXiv:2610.27569 · Published 20 Oct 2026",
        "summary": "Reveals that tabular foundation transformers (like TabPFN) pretrained solely on synthetic binary classification priors transfer to multi-class problems, cutting pretraining compute."
    },
    {
        "title": "6. TxnQA: Benchmarking Analytical Reasoning over Transaction Event Sequences",
        "meta": "arXiv:2610.27256 · Published 19 Oct 2026",
        "summary": "A benchmark assessing reasoning over longitudinal merchant transaction histories, establishing where flat tabular synthesis falls short and sequential temporal models are required."
    }
]

for p in top_picks:
    story.append(Paragraph(p["title"], item_title))
    story.append(Paragraph(p["meta"], item_meta))
    story.append(Paragraph(p["summary"], body_style))
    story.append(Spacer(1, 5))

story.append(Spacer(1, 6))

# 5. Tools and Lower priority side-by-side or stacked
story.append(Paragraph("New Tools & Datasets", section_heading))
tools = [
    ("HuggingFaceFW/finephrase", "486B-token open corpus of didactic prompts and prompt playbooks for text-model pretraining; it is text data, not a tabular dataset.")
]
for name, desc in tools:
    story.append(Paragraph(f"• <b>{name}</b> — {desc}", body_style))
    story.append(Spacer(1, 3))

story.append(Spacer(1, 6))
story.append(Paragraph("Worth a Look (Lower Priority)", section_heading))
lower = [
    ("Beyond feature attribution: Recovering latent interaction structures in machine learning models", "Method to expose hidden non-linear feature interactions in complex tabular models (arXiv:2610.34962)."),
    ("Practical Auditing of Differentially Private Graph Release Mechanisms", "Empirical auditing toolkit evaluating privacy leakage across non-relational graph and network structures (arXiv:2610.31294).")
]
for title, desc in lower:
    story.append(Paragraph(f"• <b>{title}</b> — {desc}", body_style))
    story.append(Spacer(1, 3))

story.append(Spacer(1, 10))
story.append(HRFlowable(width="100%", thickness=1, color=border_color, spaceAfter=8))
story.append(Paragraph("<i>Auto-generated by the Synthetic Data Research Agent. Reply with feedback.</i>", item_meta))

doc.build(story)
print(f"PDF successfully generated: {pdf_path}")
