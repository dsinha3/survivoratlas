#!/usr/bin/env python3
"""Serve Survivor Atlas and refresh ESPN odds on demand."""

from __future__ import annotations

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import refresh_odds

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/odds":
            odds = ROOT / "odds.json"
            if not odds.exists():
                self.send_json(404, {"error": "No odds file yet. Re-pull first."})
                return
            self.send_json(200, json.loads(odds.read_text()))
            return
        if path == "/api/status":
            odds = ROOT / "odds.json"
            if not odds.exists():
                self.send_json(200, {"updatedAt": None})
                return
            data = json.loads(odds.read_text())
            self.send_json(
                200,
                {
                    "updatedAt": data.get("updatedAt"),
                    "currentWeek": data.get("currentWeek"),
                    "source": data.get("source"),
                },
            )
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/refresh":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            result = refresh_odds.refresh()
            self.send_json(200, result)
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": str(exc)})

    def send_json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Survivor Atlas at http://{HOST}:{PORT}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
