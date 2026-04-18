from http.server import BaseHTTPRequestHandler

from api._lib.common import pdf_available, send_json, xlsx_available


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        send_json(self, 200, {
            "ok": True,
            "version": 1,
            "exports": {
                "pdf": pdf_available(),
                "xlsx": xlsx_available(),
            },
        })
