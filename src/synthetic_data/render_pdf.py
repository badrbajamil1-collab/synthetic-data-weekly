"""Render the weekly report to a reading PDF (reportlab).

Same content as the email, plus a short glossary first — the recipients are a
mixed audience and the terms below are the ones this week's items lean on.
"""

from datetime import date, datetime
from typing import Any, Dict, List

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from xml.sax.saxutils import escape

from synthetic_data.render import format_day, format_source_counts, format_week, subject_line

_FONT_CANDIDATES = (
    (
        ("SegoeUI", "C:/Windows/Fonts/segoeui.ttf"),
        ("SegoeUI-Bold", "C:/Windows/Fonts/segoeuib.ttf"),
        ("SegoeUI-Italic", "C:/Windows/Fonts/segoeuii.ttf"),
        ("SegoeUI-SemiBold", "C:/Windows/Fonts/segoeuisl.ttf"),
    ),
    (
        ("DejaVuSans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ("DejaVuSans-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ("DejaVuSans-Italic", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"),
        ("DejaVuSans-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ),
    (
        ("LiberationSans", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
        ("LiberationSans-Bold", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
        ("LiberationSans-Italic", "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf"),
        ("LiberationSans-Bold", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ),
)


def _register_fonts() -> tuple[str, str, str, str]:
    """Load Unicode TTF fonts (Windows SegoeUI, Linux DejaVu/Liberation) or Helvetica."""
    for family in _FONT_CANDIDATES:
        try:
            seen = set()
            for font_name, font_path in family:
                if font_name in seen:
                    continue
                pdfmetrics.registerFont(TTFont(font_name, font_path))
                seen.add(font_name)
            return family[0][0], family[1][0], family[2][0], family[3][0]
        except Exception:  # noqa: BLE001 - try next platform font set
            continue
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-Bold"


FONT_REG, FONT_BOLD, FONT_ITALIC, FONT_SEMI = _register_fonts()

NAVY = colors.HexColor("#0A2540")
COBALT = colors.HexColor("#1D4ED8")
TEXT = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")
RULE = colors.HexColor("#E2E8F0")
PALE = colors.HexColor("#F8FAFC")

MARGIN = 54
WIDTH = letter[0] - 2 * MARGIN

STYLE = {
    "kicker": ParagraphStyle(
        "kicker", fontName=FONT_SEMI, fontSize=8.5, leading=11, textColor=COBALT
    ),
    "title": ParagraphStyle(
        "title", fontName=FONT_BOLD, fontSize=21, leading=25, textColor=NAVY, spaceBefore=3
    ),
    "subject": ParagraphStyle(
        "subject", fontName=FONT_REG, fontSize=8.6, leading=12, textColor=MUTED, spaceBefore=5
    ),
    "h2": ParagraphStyle(
        "h2", fontName=FONT_SEMI, fontSize=12.5, leading=15, textColor=NAVY, spaceBefore=13
    ),
    "body": ParagraphStyle(
        "body", fontName=FONT_REG, fontSize=9.7, leading=14.2, textColor=TEXT
    ),
    "lead": ParagraphStyle(
        "lead", fontName=FONT_REG, fontSize=10.4, leading=15.6, textColor=TEXT
    ),
    "meta": ParagraphStyle(
        "meta", fontName=FONT_REG, fontSize=8.3, leading=11, textColor=MUTED, spaceBefore=1
    ),
    "pick": ParagraphStyle(
        "pick", fontName=FONT_SEMI, fontSize=10.6, leading=14, textColor=NAVY
    ),
    "num": ParagraphStyle(
        "num", fontName=FONT_BOLD, fontSize=12, leading=14, textColor=COBALT
    ),
    "bullet": ParagraphStyle(
        "bullet",
        fontName=FONT_REG,
        fontSize=9.5,
        leading=13.4,
        textColor=TEXT,
        leftIndent=11,
        bulletIndent=0,
        bulletFontName=FONT_REG,
        bulletFontSize=9.5,
    ),
    "gloss_term": ParagraphStyle(
        "gloss_term", fontName=FONT_SEMI, fontSize=8.5, leading=10.6, textColor=NAVY
    ),
    "gloss_def": ParagraphStyle(
        "gloss_def", fontName=FONT_REG, fontSize=8.1, leading=10.6, textColor=TEXT
    ),
    "footer": ParagraphStyle(
        "footer", fontName=FONT_REG, fontSize=7.8, leading=10, textColor=MUTED
    ),
    "why": ParagraphStyle(
        "why", fontName=FONT_ITALIC, fontSize=9.0, leading=12.8, textColor=MUTED, spaceBefore=2
    ),
}

GLOSSARY = [
    (
        "Differentially private synthetic data (ε-DP)",
        "Synthetic records produced with a mathematical guarantee that no individual in the "
        "source dataset can be identified from the output. The privacy budget ε sets the "
        "trade-off: a lower ε gives stronger privacy at the cost of analytical utility.",
    ),
    (
        "DP-SGD",
        "Differentially private stochastic gradient descent: clips per-example gradients and "
        "adds calibrated noise during neural-network training to bound individual data leakage.",
    ),
    (
        "Tabular synthesis (CTGAN / TVAE / Copula)",
        "Generative models built for mixed continuous and categorical tables, capturing "
        "marginal distributions and inter-column correlations without exposing source rows.",
    ),
    (
        "Membership inference attack (MIA)",
        "A privacy audit that tests whether an attacker can determine if a specific real "
        "record was present in a generator's training set.",
    ),
    (
        "Distribution drift",
        "Measured divergence (such as Jensen–Shannon or Wasserstein distance) between "
        "synthetic and real data distributions; higher drift predicts weaker downstream transfer.",
    ),
    (
        "Federated synthesis",
        "Training synthetic-data generators across multiple decentralized organizations "
        "without pooling raw sensitive tables into one location.",
    ),
    (
        "Synthetic control arm",
        "A simulated comparator group for clinical or policy evaluations, generated from "
        "historical trials and real-world records instead of recruiting additional subjects.",
    ),
]


def _link(url: str, label: str, color: str = COBALT, font: str = FONT_SEMI, size: float = 10.6) -> str:
    return (
        f'<a href="{escape(url, {chr(34): "&quot;"})}" color="{color}">'
        f'<font name="{font}" size="{size}">{escape(label)}</font></a>'
    )


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT_REG, 7.8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 30, "Auto-generated by the Synthetic Data Research Agent. Reply with feedback.")
    canvas.drawRightString(letter[0] - MARGIN, 30, f"{doc.page}")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 44, letter[0] - MARGIN, 44)
    canvas.restoreState()


def _section(title: str) -> List[Any]:
    return [
        Paragraph(escape(title), STYLE["h2"]),
        HRFlowable(width="100%", thickness=0.6, color=RULE, spaceBefore=2, spaceAfter=8),
    ]


def format_counts_line(report: Dict[str, Any]) -> str:
    """Format the PDF cover count line with correct singular/plural nouns."""
    n_picks = len(report.get("top_picks", []))
    n_tools = len(report.get("tools", []))
    n_worth = len(report.get("worth_a_look", []))
    return (
        f"{n_picks} top {'pick' if n_picks == 1 else 'picks'} · "
        f"{n_tools} new {'tool' if n_tools == 1 else 'tools'} · "
        f"{n_worth} worth a look"
    )


def render_pdf(report: Dict[str, Any], path: str) -> str:
    doc = BaseDocTemplate(
        path,
        pagesize=letter,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=52,
        title=subject_line(report),
        author="Well7 Research Lab",
    )
    frame = Frame(MARGIN, 52, WIDTH, letter[1] - MARGIN - 52, id="body", showBoundary=0)
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=_footer)])

    story: List[Any] = []

    story.append(Paragraph("WELL7 RESEARCH LAB · SYNTHETIC DATA WEEKLY", STYLE["kicker"]))
    story.append(
        Paragraph(f"Week of {escape(format_week(report['week_start'], report['week_end']))}", STYLE["title"])
    )
    story.append(Paragraph(escape(format_counts_line(report)), STYLE["subject"]))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.6, color=NAVY, spaceBefore=2, spaceAfter=2))

    # --- glossary first (reader onboarding) ---
    story += _section("Glossary of key terms")
    rows = []
    for term, definition in GLOSSARY:
        rows.append(
            [
                Paragraph(escape(term), STYLE["gloss_term"]),
                Paragraph(escape(definition), STYLE["gloss_def"]),
            ]
        )
    table = Table(rows, colWidths=[1.45 * inch, WIDTH - 1.45 * inch], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (0, -1), 10),
                ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
            ]
        )
    )
    story.append(table)

    # --- trend ---
    trend = (report.get("trend") or "").strip()
    if trend:
        story += _section("Trend of the week")
        story.append(Paragraph(escape(" ".join(trend.split())), STYLE["lead"]))

    # --- top picks ---
    story.append(PageBreak())
    story += _section("Top picks")
    for index, pick in enumerate(report.get("top_picks", []), start=1):
        summary = " ".join(pick["summary"].split())
        block = [
            Paragraph(str(index), STYLE["num"]),
            Paragraph(_link(pick["url"], pick["title"], font=FONT_SEMI, size=10.6), STYLE["pick"]),
            Paragraph(
                f'{escape(pick["source"])} · {escape(format_day(pick["published"]))}', STYLE["meta"]
            ),
            Spacer(1, 3),
            Paragraph(escape(summary), STYLE["body"]),
        ]
        wim = (pick.get("why_it_matters") or "").strip()
        if wim:
            block.append(Spacer(1, 2))
            block.append(
                Paragraph(
                    f"Why it matters for Well7: {escape(' '.join(wim.split()))}",
                    STYLE["why"],
                )
            )
        row = Table([[block[0], block[1:]]], colWidths=[20, WIDTH - 20], hAlign="LEFT")
        row.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]
            )
        )
        story.append(KeepTogether(row))

    # --- tools ---
    story += _section("New tools and datasets")
    tools = report.get("tools", [])
    if tools:
        for tool in tools:
            entry_block: List[Any] = [
                Paragraph(
                    f"{_link(tool['url'], tool['name'], font=FONT_SEMI, size=9.5)}"
                    f" — {escape(' '.join(tool['note'].split()))}",
                    STYLE["bullet"],
                    bulletText="•",
                )
            ]
            wim = (tool.get("why_it_matters") or "").strip()
            if wim:
                entry_block.append(
                    Paragraph(
                        f"Why it matters for Well7: {escape(' '.join(wim.split()))}",
                        STYLE["why"],
                    )
                )
            entry_block.append(Spacer(1, 5))
            story.append(KeepTogether(entry_block))
    else:
        story.append(Paragraph("Nothing worth listing this week.", STYLE["body"]))

    # --- worth a look ---
    story += _section("Worth a look (lower priority)")
    extra = report.get("worth_a_look", [])
    if extra:
        for item in extra:
            entry_block = [
                Paragraph(
                    f"{_link(item['url'], item['title'], font=FONT_REG, size=9.5)}"
                    f" — {escape(' '.join(item['note'].split()))}",
                    STYLE["bullet"],
                    bulletText="•",
                )
            ]
            wim = (item.get("why_it_matters") or "").strip()
            if wim:
                entry_block.append(
                    Paragraph(
                        f"Why it matters for Well7: {escape(' '.join(wim.split()))}",
                        STYLE["why"],
                    )
                )
            entry_block.append(Spacer(1, 5))
            story.append(KeepTogether(entry_block))
    else:
        story.append(Paragraph("Nothing this week.", STYLE["body"]))

    counts_line = format_source_counts(report)
    if counts_line:
        story.append(Spacer(1, 10))
        story.append(HRFlowable(width="100%", thickness=0.5, color=RULE, spaceBefore=2, spaceAfter=6))
        story.append(Paragraph(escape(counts_line), STYLE["footer"]))

    doc.build(story)
    return path
