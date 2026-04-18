"""
模擬退火（Simulated Annealing）排座最佳化。

以 utils.rules.evaluate 的違規加權總和作為目標函數（越低越好），
從某個初始解開始，透過「交換兩個可動座位上的學生」做鄰域搜尋，
溫度越高越容易接受變差的解，避免陷入局部最佳。

不可動座位（不會被交換）：
- 鎖定座位 (arrangement.locked_seats)
- 空位/走道 (classroom.empty_seats)
- 規則 enforce_fixed=True 時，fixed_position 所在的座位

超時（time_budget）一到就停止。
"""

from __future__ import annotations

import math
import random
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from utils import rules as rules_module

Seat = Tuple[int, int]


def _penalty(
    classroom: Dict[str, Any],
    students: List[Dict[str, Any]],
    arrangement: Dict[str, Any],
    rules: Dict[str, Any],
) -> int:
    """以 MAX_SCORE - score 作為 penalty（越低越好）。"""
    scored = rules_module.evaluate(classroom, students, arrangement, rules)
    return rules_module.MAX_SCORE - scored["score"]


def _clone_seats(seats: List[List[Optional[str]]]) -> List[List[Optional[str]]]:
    return [row[:] for row in seats]


def optimize(
    classroom: Dict[str, Any],
    students: List[Dict[str, Any]],
    arrangement: Dict[str, Any],
    rules: Dict[str, Any],
    *,
    time_budget: float = 3.0,
    max_iter: int = 20000,
    initial_temp: float = 50.0,
    cooling: float = 0.9995,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    """對 arrangement 進行模擬退火最佳化，回傳新的 arrangement dict 與統計資訊。"""

    rng = random.Random(seed)
    rows = int(classroom.get("rows") or 0)
    cols = int(classroom.get("cols") or 0)

    empty: Set[Seat] = set()
    for p in classroom.get("empty_seats") or []:
        if isinstance(p, (list, tuple)) and len(p) == 2:
            empty.add((int(p[0]), int(p[1])))

    locked: Set[Seat] = set()
    for p in arrangement.get("locked_seats") or []:
        if isinstance(p, (list, tuple)) and len(p) == 2:
            locked.add((int(p[0]), int(p[1])))

    # enforce_fixed 時，有 fixed_position 的學生其固定座位不動
    fixed_seats: Set[Seat] = set()
    if rules.get("enforce_fixed", True):
        for s in students or []:
            fp = s.get("fixed_position")
            if isinstance(fp, (list, tuple)) and len(fp) == 2:
                try:
                    fixed_seats.add((int(fp[0]), int(fp[1])))
                except (TypeError, ValueError):
                    pass

    # 可動座位：扣掉 empty / locked / fixed
    movable: List[Seat] = []
    for r in range(rows):
        for c in range(cols):
            p = (r, c)
            if p in empty or p in locked or p in fixed_seats:
                continue
            movable.append(p)

    seats = _clone_seats(arrangement.get("seats") or [])
    # 防呆：把 seats 補齊到正確尺寸
    if len(seats) != rows or any(len(row) != cols for row in seats):
        seats = [[None] * cols for _ in range(rows)]
        for r in range(min(rows, len(arrangement.get("seats") or []))):
            row = (arrangement.get("seats") or [])[r]
            if not isinstance(row, list):
                continue
            for c in range(min(cols, len(row))):
                seats[r][c] = row[c]

    working_arrangement = dict(arrangement)
    working_arrangement["seats"] = seats

    current_penalty = _penalty(classroom, students, working_arrangement, rules)
    best_seats = _clone_seats(seats)
    best_penalty = current_penalty

    if len(movable) < 2 or current_penalty == 0:
        scored = rules_module.evaluate(classroom, students, working_arrangement, rules)
        return {
            "arrangement": {**working_arrangement, "seats": best_seats},
            "score": scored["score"],
            "max_score": scored["max_score"],
            "violations": scored["violations"],
            "by_type": scored["by_type"],
            "iterations": 0,
            "accepted": 0,
            "improved": 0,
            "elapsed": 0.0,
        }

    temp = initial_temp
    start = time.perf_counter()
    iterations = 0
    accepted = 0
    improved = 0

    while iterations < max_iter:
        if (time.perf_counter() - start) >= time_budget:
            break
        iterations += 1

        # 隨機挑兩個可動座位交換
        i, j = rng.sample(range(len(movable)), 2)
        (r1, c1), (r2, c2) = movable[i], movable[j]
        if seats[r1][c1] is None and seats[r2][c2] is None:
            # 兩邊都空，不必交換
            continue

        seats[r1][c1], seats[r2][c2] = seats[r2][c2], seats[r1][c1]
        new_penalty = _penalty(classroom, students, working_arrangement, rules)
        delta = new_penalty - current_penalty

        if delta <= 0:
            current_penalty = new_penalty
            accepted += 1
            if new_penalty < best_penalty:
                best_penalty = new_penalty
                best_seats = _clone_seats(seats)
                improved += 1
                if best_penalty == 0:
                    break
        else:
            # 變差：以 Boltzmann 機率接受
            prob = math.exp(-delta / max(temp, 1e-6))
            if rng.random() < prob:
                current_penalty = new_penalty
                accepted += 1
            else:
                # 還原
                seats[r1][c1], seats[r2][c2] = seats[r2][c2], seats[r1][c1]

        temp *= cooling
        if temp < 0.01:
            temp = 0.01

    # 用 best_seats 做最終評估
    working_arrangement["seats"] = best_seats
    scored = rules_module.evaluate(classroom, students, working_arrangement, rules)
    return {
        "arrangement": {**working_arrangement, "seats": best_seats},
        "score": scored["score"],
        "max_score": scored["max_score"],
        "violations": scored["violations"],
        "by_type": scored["by_type"],
        "iterations": iterations,
        "accepted": accepted,
        "improved": improved,
        "elapsed": round(time.perf_counter() - start, 3),
    }
