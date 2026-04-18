import traceback
from http.server import BaseHTTPRequestHandler

from api._lib.common import (
    coerce_arrangement,
    coerce_classroom,
    coerce_students,
    read_json_body,
    send_json,
)
from utils import rules as rules_module


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body, err = read_json_body(self)
        if err:
            send_json(self, 400, {"ok": False, "error": err})
            return
        try:
            payload = body.get("payload") or body
            classroom = coerce_classroom(payload.get("classroom") or {})
            students = coerce_students(payload.get("students") or [])
            arrangement = coerce_arrangement(payload.get("arrangement") or {}, classroom)
            scored = rules_module.evaluate(
                classroom=classroom.to_dict(),
                students=[s.to_dict() for s in students],
                arrangement=arrangement.to_dict(),
                rules=payload.get("rules") or {},
            )
            send_json(self, 200, {
                "ok": True,
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
