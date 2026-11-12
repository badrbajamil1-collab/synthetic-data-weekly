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

FONT_DIR = "C:/Windows/Fonts"
try:
    pdfmetrics.registerFont(TTFont("SegoeUI", f"{FONT_DIR}/segoeui.ttf"))
    pdfmetrics.registerFont(TTFont("SegoeUI-Bold", f"{FONT_DIR}/segoeuib.ttf"))
    pdfmetrics.registerFont(TTFont("SegoeUI-Italic", f"{FONT_DIR}/segoeuii.ttf"))
    pdfmetrics.registerFont(TTFont("SegoeUI-SemiBold", f"{FONT_DIR}/segoeuisl.ttf"))
    FONT_REG, FONT_BOLD, FONT_ITALIC, FONT_SEMI = (
        "SegoeUI",
        "SegoeUI-Bold",
        "SegoeUI-Italic",
        "SegoeUI-SemiBold",
    )
except Exception:  # noqa: BLE001 - fall back to built-ins on non-Windows
    FONT_REG, FONT_BOLD, FONT_ITALIC, FONT_SEMI = (
        "Helvetica",
        "Helvetica-Bold",
        "Helvetica-Oblique",
        "Helvetica-Bold",
    )

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
        "Drift metric",
        "A measured distance between synthetic and real data. Higher drift predicts a worse "
        "drop in accuracy when a model trained on synthetic data meets real records.",
    ),
    (
        "Jensen–Shannon divergence",
        "A symmetric measure of how different two probability distributions are. Zero means "
        "identical; the study this week found it the best single predictor of transfer loss.",
    ),
    (
        "Verified self-training",
        "Generate synthetic data, filter it with a verifier score, retrain on what survives. "
        "Repeating this on a model's own output is what causes model collapse.",
    ),
    (
        "Visit sequence",
        "In sequential synthesis, the order in which variables are generated. Each variable is "
        "conditioned on the ones before it, so the order changes the quality of the result.",
    ),
    (
        "Fully conditional specification",
        "The alternative to sequential synthesis: generate each variable from all the others "
        "rather than from a fixed order. More flexible, more hyperparameters, more compute.",
    ),
    (
        "Differentially private synthetic data",
        "Synthetic records produced with a mathematical guarantee that no individual in the "
        "source data can be identified from the output. The privacy budget ε sets the "
        "trade-off: a lower ε means stronger privacy but usually lower analytical utility.",
    ),
    (
        "Synthetic control arm",
        "A simulated control group for a clinical trial, generated from prior trials and "
        "real-world data instead of recruiting and randomising real patients.",
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
    counts = (
        f"{len(report.get('top_picks', []))} top picks · "
        f"{len(report.get('tools', []))} new tools · "
        f"{len(report.get('worth_a_look', []))} worth a look"
    )
    story.append(Paragraph(escape(counts), STYLE["subject"]))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.6, color=NAVY, spaceBefore=2, spaceAfter=2))

    # --- glossary first (reader onboarding) ---
    story += _section("Glossary of terms used this week")
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
            story.append(
                Paragraph(
                    f"{_link(tool['url'], tool['name'], font=FONT_SEMI, size=9.5)}"
                    f" — {escape(' '.join(tool['note'].split()))}",
                    STYLE["bullet"],
                    bulletText="•",
                )
            )
            wim = (tool.get("why_it_matters") or "").strip()
            if wim:
                story.append(
                    Paragraph(
                        f"Why it matters for Well7: {escape(' '.join(wim.split()))}",
                        STYLE["why"],
                    )
                )
            story.append(Spacer(1, 5))
    else:
        story.append(Paragraph("Nothing worth listing this week.", STYLE["body"]))

    # --- worth a look ---
    story += _section("Worth a look (lower priority)")
    extra = report.get("worth_a_look", [])
    if extra:
        for item in extra:
            story.append(
                Paragraph(
                    f"{_link(item['url'], item['title'], font=FONT_REG, size=9.5)}"
                    f" — {escape(' '.join(item['note'].split()))}",
                    STYLE["bullet"],
                    bulletText="•",
                )
            )
            wim = (item.get("why_it_matters") or "").strip()
            if wim:
                story.append(
                    Paragraph(
                        f"Why it matters for Well7: {escape(' '.join(wim.split()))}",
                        STYLE["why"],
                    )
                )
            story.append(Spacer(1, 5))
    else:
        story.append(Paragraph("Nothing this week.", STYLE["body"]))

    counts_line = format_source_counts(report)
    if counts_line:
        story.append(Spacer(1, 10))
        story.append(HRFlowable(width="100%", thickness=0.5, color=RULE, spaceBefore=2, spaceAfter=6))
        story.append(Paragraph(escape(counts_line), STYLE["footer"]))

    doc.build(story)
    return path
