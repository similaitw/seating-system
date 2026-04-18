"""共用 helpers,給各 Vercel serverless function 使用。"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# 讓 serverless function 能 import 專案根目錄的 models/ 與 utils/
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models.classroom import Classroom  # noqa: E402
from models.seating import SeatingArrangement  # noqa: E402
from models.student import Student  # noqa: E402


def json_default(obj: Any):
    if is_dataclass(obj):
        return asdict(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def coerce_gender(value: Any) -> str:
    v = str(value or "").strip().lower()
    if v in {"男", "m", "male", "man", "boy"}:
        return "男"
    if v in {"女", "f", "female", "woman", "girl"}:
        return "女"
    return "男"


def coerce_students(raw_students: Any) -> List[Student]:
    students: List[Student] = []
    seen_ids: set[str] = set()
    for idx, raw in enumerate(raw_students or []):
        if not isinstance(raw, dict):
            continue

        seat_number = raw.get("seat_number", raw.get("seatNumber", raw.get("seatnumber")))
        try:
            seat_number_int = int(seat_number) if seat_number is not None and seat_number != "" else (idx + 1)
        except Exception:
            seat_number_int = idx + 1

        student_id = str(raw.get("id") or raw.get("student_id") or raw.get("studentId") or "").strip()
        if not student_id:
            student_id = f"S{seat_number_int:02d}"
        while student_id in seen_ids:
            student_id = student_id + "_" + os.urandom(2).hex()
        seen_ids.add(student_id)

        fixed = raw.get("fixed_position", raw.get("fixedPosition"))
        fixed_position = None
        if isinstance(fixed, (list, tuple)) and len(fixed) == 2:
            try:
                fixed_position = (int(fixed[0]), int(fixed[1]))
            except Exception:
                fixed_position = None

        students.append(
            Student(
                id=student_id,
                seat_number=seat_number_int,
                name=str(raw.get("name") or raw.get("姓名") or ""),
                gender=coerce_gender(raw.get("gender") or raw.get("性別") or raw.get("sex")),
                height=(int(raw["height"]) if raw.get("height") not in (None, "") else None),
                vision_left=float(raw.get("vision_left", raw.get("visionLeft", 1.0)) or 1.0),
                vision_right=float(raw.get("vision_right", raw.get("visionRight", 1.0)) or 1.0),
                need_front_seat=bool(raw.get("need_front_seat", raw.get("needFrontSeat", False))),
                need_aisle_seat=bool(raw.get("need_aisle_seat", raw.get("needAisleSeat", False))),
                need_near_teacher=bool(raw.get("need_near_teacher", raw.get("needNearTeacher", False))),
                fixed_position=fixed_position,
                notes=str(raw.get("notes") or ""),
            )
        )
    return students


def coerce_classroom(raw: Dict[str, Any]) -> Classroom:
    payload = {
        "name": raw.get("name", "Classroom"),
        "rows": int(raw.get("rows", 5)),
        "cols": int(raw.get("cols", 6)),
        "teacher_desk_position": raw.get("teacher_desk_position", raw.get("teacherDeskPosition", "front")),
        "special_seats": raw.get("special_seats", raw.get("specialSeats", [])) or [],
        "empty_seats": raw.get("empty_seats", raw.get("emptySeats", [])) or [],
        "orientation": raw.get("orientation", "front"),
    }
    return Classroom.from_dict(payload)


def normalize_seats_matrix(seats: Any, rows: int, cols: int) -> List[List[Optional[str]]]:
    matrix: List[List[Optional[str]]] = [[None for _ in range(cols)] for _ in range(rows)]
    if not isinstance(seats, list):
        return matrix
    for r in range(min(rows, len(seats))):
        row = seats[r]
        if not isinstance(row, list):
            continue
        for c in range(min(cols, len(row))):
            v = row[c]
            matrix[r][c] = str(v) if v not in (None, "") else None
    return matrix


def coerce_arrangement(raw: Dict[str, Any], classroom: Classroom) -> SeatingArrangement:
    arrangement_id = str(raw.get("id") or "arr_" + os.urandom(4).hex())
    payload = {
        "id": arrangement_id,
        "name": raw.get("name", "Seating Arrangement"),
        "classroom_id": raw.get("classroom_id", raw.get("classroomId", "classroom_default")),
        "created_at": raw.get("created_at", raw.get("createdAt")),
        "seats": normalize_seats_matrix(raw.get("seats"), classroom.rows, classroom.cols),
        "locked_seats": raw.get("locked_seats", raw.get("lockedSeats", [])) or [],
    }
    if not payload["created_at"]:
        payload.pop("created_at", None)

    arrangement = SeatingArrangement.from_dict(payload)

    normalized_locked: List[Tuple[int, int]] = []
    empty = set((int(r), int(c)) for r, c in classroom.empty_seats)
    for r, c in arrangement.locked_seats:
        try:
            rr, cc = int(r), int(c)
        except Exception:
            continue
        if not (0 <= rr < classroom.rows and 0 <= cc < classroom.cols):
            continue
        if (rr, cc) in empty:
            continue
        normalized_locked.append((rr, cc))
    arrangement.locked_seats = normalized_locked
    return arrangement


def read_json_body(handler) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    try:
        length = int(handler.headers.get("Content-Length") or "0")
    except ValueError:
        return None, "Invalid Content-Length"
    if length <= 0:
        return None, "Empty request body"
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8")), None
    except Exception:
        return None, "Invalid JSON"


def send_json(handler, status: int, payload: Dict[str, Any]):
    raw = json.dumps(payload, ensure_ascii=False, default=json_default).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def send_bytes(handler, status: int, content: bytes, content_type: str, filename: Optional[str] = None):
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Cache-Control", "no-store")
    if filename:
        handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.send_header("Content-Length", str(len(content)))
    handler.end_headers()
    handler.wfile.write(content)


def pdf_available() -> bool:
    try:
        import reportlab  # noqa: F401
        return True
    except Exception:
        return False


def xlsx_available() -> bool:
    try:
        import openpyxl  # noqa: F401
        return True
    except Exception:
        return False


def build_table(payload: Dict[str, Any]):
    classroom = coerce_classroom(payload.get("classroom") or {})
    students = coerce_students(payload.get("students") or [])
    arrangement = coerce_arrangement(payload.get("arrangement") or {}, classroom)

    student_by_id = {s.id: s for s in students}
    empty = set((int(r), int(c)) for r, c in classroom.empty_seats)
    locked = set((int(r), int(c)) for r, c in arrangement.locked_seats)

    grid: List[List[str]] = []
    for r in range(classroom.rows):
        row: List[str] = []
        for c in range(classroom.cols):
            if (r, c) in empty:
                row.append("空位")
                continue
            sid = arrangement.get_student_at(r, c)
            if not sid:
                row.append("")
                continue
            s = student_by_id.get(sid)
            label = f"{s.seat_number:02d} {s.name}" if s else sid
            if (r, c) in locked:
                label = "🔒 " + label
            row.append(label)
        grid.append(row)

    return classroom, students, arrangement, grid
