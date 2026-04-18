import traceback
from http.server import BaseHTTPRequestHandler

from api._lib.common import (
    coerce_arrangement,
    coerce_classroom,
    coerce_students,
    read_json_body,
    send_json,
)
from utils import optimize as optimize_module
from utils import rules as rules_module
from utils.auto_arrange import AutoArrange


def _run(mode, classroom, students, arrangement):
    if mode == "seat_number":
        return AutoArrange.by_seat_number(students, classroom, arrangement)
    if mode == "alternating_gender":
        return AutoArrange.alternating_gender(students, classroom, arrangement)
    if mode == "by_height":
        return AutoArrange.by_height(students, classroom, arrangement)
    if mode == "by_vision":
        return AutoArrange.by_vision(students, classroom, arrangement)
    if mode == "random":
        return AutoArrange.random_arrange(students, classroom, arrangement)
    raise ValueError(f"Unsupported mode: {mode}")


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body, err = read_json_body(self)
        if err:
            send_json(self, 400, {"ok": False, "error": err})
            return
        try:
            mode = str(body.get("mode") or "")
            payload = body.get("payload") or body
            classroom = coerce_classroom(payload.get("classroom") or {})
            students = coerce_students(payload.get("students") or [])
            arrangement = coerce_arrangement(payload.get("arrangement") or {}, classroom)
            rules_dict = payload.get("rules") or {}

            if mode == "optimize":
                seed_mode = str(body.get("seed_mode") or "seat_number")
                if seed_mode not in {"seat_number", "alternating_gender", "by_height", "by_vision", "random"}:
                    seed_mode = "seat_number"
                seeded = _run(seed_mode, classroom, students, arrangement)

                time_budget = float(body.get("time_budget") or 3.0)
                time_budget = max(0.5, min(time_budget, 8.0))  # Vercel 免費 10s 上限

                result = optimize_module.optimize(
                    classroom=classroom.to_dict(),
                    students=[s.to_dict() for s in students],
                    arrangement=seeded.to_dict(),
                    rules=rules_dict,
                    time_budget=time_budget,
                )
                send_json(self, 200, {
                    "ok": True,
                    "arrangement": result["arrangement"],
                    "violations": result["violations"],
                    "score": result["score"],
                    "max_score": result["max_score"],
                    "by_type": result["by_type"],
                    "stats": {
                        "iterations": result["iterations"],
                        "accepted": result["accepted"],
                        "improved": result["improved"],
                        "elapsed": result["elapsed"],
                        "seed_mode": seed_mode,
                    },
                })
                return

            result = _run(mode, classroom, students, arrangement)
            scored = rules_module.evaluate(
                classroom=classroom.to_dict(),
                students=[s.to_dict() for s in students],
                arrangement=result.to_dict(),
                rules=rules_dict,
            )
            send_json(self, 200, {
                "ok": True,
                "arrangement": result.to_dict(),
                "violations": scored["violations"],
                "score": scored["score"],
                "max_score": scored["max_score"],
                "by_type": scored["by_type"],
            })
        except Exception as ex:
            send_json(self, 400, {
                "ok": False,
                "error": str(ex),
                "trace": traceback.format_exc(limit=4),
            })
