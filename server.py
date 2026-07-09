#!/usr/bin/env python3
import json
import os
import random
import string
import sys
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(ROOT, "public")
DATA_FILE = os.path.join(ROOT, "data", "announcements.json")

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}


def read_announcements():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r") as f:
        return json.load(f)


def write_announcements(items):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(items, f, indent=2)


def next_sunday():
    d = datetime.now()
    days_ahead = (6 - d.weekday()) % 7  # Monday=0 ... Sunday=6
    return (d + timedelta(days=days_ahead)).strftime("%Y-%m-%d")


def upcoming_sundays(count=12):
    first = datetime.strptime(next_sunday(), "%Y-%m-%d")
    return [(first + timedelta(weeks=i)).strftime("%Y-%m-%d") for i in range(count)]


def upcoming_months(count=6):
    d = datetime.now()
    months = []
    for i in range(1, count + 1):
        m = (d.month - 1 + i) % 12 + 1
        y = d.year + (d.month - 1 + i) // 12
        months.append(f"{y:04d}-{m:02d}")
    return months


def gen_id():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=10))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, rel_path):
        if rel_path == "" or rel_path == "/":
            rel_path = "index.html"
        rel_path = rel_path.lstrip("/")
        full_path = os.path.normpath(os.path.join(PUBLIC_DIR, rel_path))
        if not full_path.startswith(PUBLIC_DIR) or not os.path.isfile(full_path):
            self._send_json(404, {"error": "Not found"})
            return
        ext = os.path.splitext(full_path)[1]
        mime = MIME_TYPES.get(ext, "application/octet-stream")
        with open(full_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/next-sunday":
            self._send_json(200, {"date": next_sunday()})
            return

        if path == "/api/upcoming-sundays":
            self._send_json(200, {"dates": upcoming_sundays()})
            return

        if path == "/api/upcoming-months":
            self._send_json(200, {"months": upcoming_months()})
            return

        if path == "/api/announcements":
            items = read_announcements()
            service_date = query.get("serviceDate", [None])[0]
            newsletter_month = query.get("newsletterMonth", [None])[0]
            if service_date:
                items = [a for a in items if a.get("serviceDate") == service_date]
            if newsletter_month:
                items = [a for a in items if a.get("newsletterMonth") == newsletter_month]
            items.sort(key=lambda a: a.get("createdAt", ""))
            self._send_json(200, items)
            return

        self._send_static(path)

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/announcements":
            try:
                data = self._read_json_body()
            except json.JSONDecodeError:
                self._send_json(400, {"error": "Invalid JSON"})
                return

            title = (data.get("title") or "").strip()
            submitted_by = (data.get("submittedBy") or "").strip()
            service_date = data.get("serviceDate")
            newsletter_month = data.get("newsletterMonth")
            channel = data.get("channel")

            if not title:
                self._send_json(400, {"error": "Title is required"})
                return
            if not submitted_by:
                self._send_json(400, {"error": "Your name is required"})
                return
            if channel not in ("announce", "bulletin", "both", "newsletter"):
                self._send_json(400, {"error": "Invalid channel"})
                return
            if channel == "newsletter":
                if not newsletter_month:
                    self._send_json(400, {"error": "Newsletter month is required"})
                    return
                service_date = None
            else:
                if not service_date:
                    self._send_json(400, {"error": "Service date is required"})
                    return
                newsletter_month = None

            items = read_announcements()
            entry = {
                "id": gen_id(),
                "title": title,
                "description": (data.get("description") or "").strip(),
                "serviceDate": service_date,
                "newsletterMonth": newsletter_month,
                "submittedBy": submitted_by,
                "channel": channel,
                "createdAt": datetime.utcnow().isoformat(),
                "done": False,
            }
            items.append(entry)
            write_announcements(items)
            self._send_json(201, entry)
            return

        self._send_json(404, {"error": "Not found"})

    def do_PATCH(self):
        if self.path.startswith("/api/announcements/"):
            item_id = self.path.rsplit("/", 1)[-1]
            try:
                data = self._read_json_body()
            except json.JSONDecodeError:
                self._send_json(400, {"error": "Invalid JSON"})
                return

            items = read_announcements()
            for i, item in enumerate(items):
                if item["id"] == item_id:
                    item.update({k: v for k, v in data.items() if k != "id"})
                    items[i] = item
                    write_announcements(items)
                    self._send_json(200, item)
                    return
            self._send_json(404, {"error": "Not found"})
            return

        self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        if self.path.startswith("/api/announcements/"):
            item_id = self.path.rsplit("/", 1)[-1]
            items = read_announcements()
            next_items = [a for a in items if a["id"] != item_id]
            write_announcements(next_items)
            self._send_json(200, {"ok": True})
            return

        self._send_json(404, {"error": "Not found"})


def main():
    port = int(os.environ.get("PORT", 3000))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Church announcements app running at http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
