import traceback
from http.server import BaseHTTPRequestHandler
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List

from api._lib.common import (
    build_table,
    pdf_available,
    read_json_body,
    send_bytes,
    send_json,
)

ROOT = Path(__file__).resolve().parents[2]


def _register_font():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # 專案內字型優先(跨平台/雲端)
    candidates = [
        ROOT / "fonts" / "NotoSansTC-Regular.ttf",
        ROOT / "fonts" / "NotoSansCJKtc-Regular.ttf",
        Path(r"C:\Windows\Fonts\msjh.ttc"),
        Path(r"C:\Windows\Fonts\mingliu.ttc"),
    ]
    for p in candidates:
        if not p.exists():
            continue
        try:
            if p.suffix.lower() == ".ttc":
                pdfmetrics.registerFont(TTFont("CJK", str(p), subfontIndex=0))
            else:
                pdfmetrics.registerFont(TTFont("CJK", str(p)))
            return "CJK"
        except Exception:
            continue
    return "Helvetica"


def _export_pdf(payload: Dict[str, Any]) -> bytes:
    from xml.sax.saxutils import escape

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    classroom, students, arrangement, grid = build_table(payload)
    font_name = _register_font()

    styles = getSampleStyleSheet()
    base = ParagraphStyle(
        "Base", parent=styles["Normal"],
        fontName=font_name, fontSize=9, leading=11,
    )
    title_style = ParagraphStyle(
        "Title", parent=styles["Title"],
        fontName=font_name, fontSize=14, leading=16, spaceAfter=6,
    )

    data: List[List[Any]] = []
    header = [""] + [f"C{c + 1}" for c in range(classroom.cols)]
    data.append([Paragraph(escape(h), base) for h in header])
    for r in range(classroom.rows):
        row = [Paragraph(escape(f"R{r + 1}"), base)]
        for c in range(classroom.cols):
            row.append(Paragraph(escape(grid[r][c] or ""), base))
        data.append(row)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=12 * mm, bottomMargin=12 * mm,
        title=str(arrangement.name or "Seating"),
    )

    elements: List[Any] = []
    elements.append(Paragraph(escape(str(payload.get("title") or arrangement.name or "Seating")), title_style))
    elements.append(Paragraph(escape(f"Classroom: {classroom.name} · Desk: {classroom.teacher_desk_position}"), base))
    elements.append(Spacer(1, 6 * mm))

    table = Table(data, repeatRows=1)
    table_style = TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#B0AEA5")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8E6DC")),
    ])

    empty = set((int(r), int(c)) for r, c in classroom.empty_seats)
    locked = set((int(r), int(c)) for r, c in arrangement.locked_seats)
    for r in range(classroom.rows):
        for c in range(classroom.cols):
            if (r, c) in empty:
                table_style.add("BACKGROUND", (1 + c, 1 + r), (1 + c, 1 + r), colors.HexColor("#F0EEE6"))
            elif (r, c) in locked:
                table_style.add("BACKGROUND", (1 + c, 1 + r), (1 + c, 1 + r), colors.HexColor("#DDEAF7"))

    table.setStyle(table_style)
    elements.append(table)
    doc.build(elements)
    return buf.getvalue()


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body, err = read_json_body(self)
        if err:
            send_json(self, 400, {"ok": False, "error": err})
            return
        if not pdf_available():
            send_json(self, 501, {"ok": False, "error": "reportlab not installed"})
            return
        try:
            payload = body.get("payload") or body
            filename = body.get("filename") or "seating.pdf"
            content = _export_pdf(payload)
            send_bytes(self, 200, content, "application/pdf", filename=filename)
        except Exception as ex:
            send_json(self, 400, {
                "ok": False,
                "error": str(ex),
                "trace": traceback.format_exc(limit=4),
            })
