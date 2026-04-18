"""
座位規則評分引擎（Python 實作）。

與前端 web/app.js 的 evaluateViolations() 對齊，作為未來最佳化排座的目標函數。

輸入：classroom / students / arrangement / rules 的原始 dict（與前端 JSON 同格式）。
輸出：
  violations: List[dict]，每筆包含 type/message/seat_positions/student_ids/severity
  score: int，分數越高越好（無違規為滿分 1000，每個違規按權重扣分）
  by_type: Dict[str, int]，各類型違規數量
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

Seat = Tuple[int, int]

# 違規嚴重度（扣分權重）。數字越大代表越嚴重。
SEVERITY: Dict[str, int] = {
    "fixed": 100,         # 固定座位未遵守：硬性違規
    "avoid": 50,          # 不可相鄰配對
    "front": 30,          # 需前排
    "near_teacher": 25,   # 需靠近講桌
    "aisle": 20,          # 需走道
    "gender": 10,         # 相鄰同性別
}

MAX_SCORE = 1000


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


def _normalize_seat_pairs(raw: Any) -> List[Seat]:
    out: List[Seat] = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            out.append((_as_int(item[0]), _as_int(item[1])))
    return out


def _is_aisle(row: int, col: int, cols: int, empty: Set[Seat]) -> bool:
    if col == 0 or col == cols - 1:
        return True
    if (row, col - 1) in empty:
        return True
    if (row, col + 1) in empty:
        return True
    return False


def _pos_by_student(seats: List[List[Optional[str]]]) -> Dict[str, Seat]:
    pos: Dict[str, Seat] = {}
    for r, row in enumerate(seats or []):
        if not isinstance(row, list):
            continue
        for c, sid in enumerate(row):
            if sid:
                pos[str(sid)] = (r, c)
    return pos


def _normalize_seats(seats: Any, rows: int, cols: int) -> List[List[Optional[str]]]:
    matrix: List[List[Optional[str]]] = [[None] * cols for _ in range(rows)]
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


def evaluate(
    classroom: Dict[str, Any],
    students: List[Dict[str, Any]],
    arrangement: Dict[str, Any],
    rules: Dict[str, Any],
) -> Dict[str, Any]:
    """評估目前座位安排的違規清單與分數。"""

    rows = _as_int(classroom.get("rows"), 0)
    cols = _as_int(classroom.get("cols"), 0)
    desk = str(classroom.get("teacher_desk_position") or "front")
    empty_seats: Set[Seat] = set(_normalize_seat_pairs(classroom.get("empty_seats")))

    seats = _normalize_seats(arrangement.get("seats"), rows, cols)
    pos_by_sid = _pos_by_student(seats)
    student_by_id: Dict[str, Dict[str, Any]] = {}
    for s in students or []:
        if isinstance(s, dict) and s.get("id"):
            student_by_id[str(s["id"])] = s

    rules = rules or {}
    violations: List[Dict[str, Any]] = []

    def add(
        type_: str,
        message: str,
        seat_positions: Optional[List[Seat]] = None,
        student_ids: Optional[List[str]] = None,
    ) -> None:
        violations.append({
            "type": type_,
            "message": message,
            "seat_positions": [list(p) for p in (seat_positions or [])],
            "student_ids": list(student_ids or []),
            "severity": SEVERITY.get(type_, 10),
        })

    # Fixed seat
    if rules.get("enforce_fixed", True):
        for s in students or []:
            if not isinstance(s, dict):
                continue
            fixed = s.get("fixed_position")
            if not (isinstance(fixed, (list, tuple)) and len(fixed) == 2):
                continue
            r, c = _as_int(fixed[0]), _as_int(fixed[1])
            name = s.get("name") or s.get("id") or "?"
            if not (0 <= r < rows and 0 <= c < cols):
                add("fixed", f"{name} 的固定座位超出範圍（{r + 1},{c + 1}）", [], [s.get("id")])
                continue
            if (r, c) in empty_seats:
                add("fixed", f"{name} 的固定座位在空位/走道（{r + 1},{c + 1}）", [(r, c)], [s.get("id")])
                continue
            occupant = seats[r][c] if 0 <= r < len(seats) and 0 <= c < len(seats[r]) else None
            if occupant != s.get("id"):
                ids = [s.get("id")]
                if occupant:
                    ids.append(occupant)
                add("fixed", f"{name} 必須在固定座位（{r + 1},{c + 1}）", [(r, c)], ids)

    # need_front_seat
    if rules.get("check_front", True):
        band = _clamp(_as_int(rules.get("front_rows"), 2), 1, 10)
        for s in students or []:
            if not s.get("need_front_seat"):
                continue
            sid = str(s.get("id"))
            pos = pos_by_sid.get(sid)
            name = s.get("name") or sid
            if not pos:
                add("front", f"{name} 需要前排，但尚未安排座位", [], [sid])
                continue
            if pos[0] >= band:
                add("front", f"{name} 需要前排（前 {band} 排）", [pos], [sid])

    # need_near_teacher
    if rules.get("check_near_teacher", False):
        band = _clamp(_as_int(rules.get("near_band"), 2), 1, 10)
        for s in students or []:
            if not s.get("need_near_teacher"):
                continue
            sid = str(s.get("id"))
            pos = pos_by_sid.get(sid)
            name = s.get("name") or sid
            if not pos:
                add("near_teacher", f"{name} 需要靠近講桌，但尚未安排座位", [], [sid])
                continue
            r, c = pos
            ok = True
            if desk == "front":
                ok = r < band
            elif desk == "back":
                ok = r >= rows - band
            elif desk == "left":
                ok = c < band
            elif desk == "right":
                ok = c >= cols - band
            if not ok:
                add("near_teacher", f"{name} 需要靠近講桌（範圍 {band}）", [pos], [sid])

    # need_aisle_seat
    if rules.get("check_aisle", False):
        for s in students or []:
            if not s.get("need_aisle_seat"):
                continue
            sid = str(s.get("id"))
            pos = pos_by_sid.get(sid)
            name = s.get("name") or sid
            if not pos:
                add("aisle", f"{name} 需要走道旁，但尚未安排座位", [], [sid])
                continue
            r, c = pos
            if not _is_aisle(r, c, cols, empty_seats):
                add("aisle", f"{name} 需要走道旁（左右邊界或鄰空位）", [pos], [sid])

    # Alternating gender (adjacent)
    if rules.get("alternating_gender", True):
        for r in range(rows):
            for c in range(cols):
                sid = seats[r][c] if r < len(seats) and c < len(seats[r]) else None
                if not sid:
                    continue
                s = student_by_id.get(str(sid))
                if not s:
                    continue
                # right
                if c + 1 < cols:
                    sid2 = seats[r][c + 1] if c + 1 < len(seats[r]) else None
                    if sid2:
                        s2 = student_by_id.get(str(sid2))
                        if s2 and s.get("gender") == s2.get("gender"):
                            add(
                                "gender",
                                f"相鄰同性別：{s.get('name')}（{s.get('gender')}）與 {s2.get('name')}（{s2.get('gender')}）",
                                [(r, c), (r, c + 1)],
                                [str(sid), str(sid2)],
                            )
                # down
                if r + 1 < rows:
                    sid2 = seats[r + 1][c] if r + 1 < len(seats) and c < len(seats[r + 1]) else None
                    if sid2:
                        s2 = student_by_id.get(str(sid2))
                        if s2 and s.get("gender") == s2.get("gender"):
                            add(
                                "gender",
                                f"相鄰同性別：{s.get('name')}（{s.get('gender')}）與 {s2.get('name')}（{s2.get('gender')}）",
                                [(r, c), (r + 1, c)],
                                [str(sid), str(sid2)],
                            )

    # Avoid pairs
    for pair in rules.get("avoid_pairs") or []:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        a, b = str(pair[0]), str(pair[1])
        pa = pos_by_sid.get(a)
        pb = pos_by_sid.get(b)
        if not pa or not pb:
            continue
        if abs(pa[0] - pb[0]) + abs(pa[1] - pb[1]) == 1:
            sa = student_by_id.get(a, {}).get("name") or a
            sb = student_by_id.get(b, {}).get("name") or b
            add("avoid", f"配對不可相鄰：{sa} ↔ {sb}", [pa, pb], [a, b])

    # Tally
    by_type: Dict[str, int] = {}
    penalty = 0
    for v in violations:
        by_type[v["type"]] = by_type.get(v["type"], 0) + 1
        penalty += v["severity"]

    score = max(0, MAX_SCORE - penalty)

    return {
        "violations": violations,
        "score": score,
        "max_score": MAX_SCORE,
        "by_type": by_type,
    }
