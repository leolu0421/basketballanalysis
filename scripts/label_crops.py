#!/usr/bin/env python3
"""
Minimal local web UI for labeling jersey-number training crops (no
dependencies beyond the Python standard library). Run it, open the printed
URL in a browser, and type the jersey number shown in each image — or mark
it unreadable. Labels are appended incrementally to labels.csv in the
crops directory, so you can stop anytime and resume later; already-labeled
crops are skipped automatically.

Deliberately no "not our team" option: this model only learns to read
digits off a jersey, not who's on which team (an opponent's colors are
different every game, so a model trained to recognize "this color =
opponent" wouldn't generalize past this one game anyway — see README).
Label EVERY readable jersey number you see, including opponents' — a 7 is
a 7 regardless of whose jersey it's on, and that variety makes the model
read numbers more reliably across different colors and fonts. Which
number belongs to which of *your* current players is resolved separately,
live, from your team's roster in the app — not from anything trained here.

Usage:
    python3 label_crops.py <crops_dir> [--port 8765]
"""
import argparse
import csv
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

UNREADABLE = "UNREADABLE"

PAGE_TEMPLATE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Label jersey crops</title>
<style>
body {{ font-family: system-ui, sans-serif; text-align: center; background: #111; color: #eee; padding: 2rem; }}
img {{ max-height: 55vh; border-radius: 8px; border: 2px solid #444; }}
input {{ font-size: 1.5rem; padding: 0.5rem; width: 6rem; text-align: center; }}
button {{ font-size: 1rem; padding: 0.6rem 1.1rem; margin: 0.3rem; border-radius: 6px; border: none; cursor: pointer; background: #2a5; color: #fff; }}
button.secondary {{ background: #444; }}
.progress {{ color: #999; margin-bottom: 1rem; }}
.hint {{ color: #888; font-size: 0.85rem; max-width: 26rem; margin: 0.5rem auto 0; }}
</style></head>
<body>
<div class="progress">{done} / {total} labeled</div>
<img src="/image/{filename}"><br><br>
<form method="POST" action="/label">
  <input type="hidden" name="filename" value="{filename}">
  <input type="text" name="label" autofocus placeholder="#" inputmode="numeric">
  <button type="submit">Save &amp; next</button>
  <br><br>
  <button class="secondary" type="submit" name="skip" value="{unreadable}" formnovalidate>Can't read it</button>
  <p class="hint">Type whatever number is visible, even on an opponent's jersey — this model only learns to read digits, not whose team they're on.</p>
</form>
</body></html>"""

DONE_PAGE = """<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:4rem;background:#111;color:#eee;">
<h2>All crops labeled</h2><p>labels.csv is ready for training_jersey_classifier.py.</p></body></html>"""


def load_labeled_filenames(csv_path):
    labeled = set()
    if os.path.exists(csv_path):
        with open(csv_path, newline="") as f:
            for row in csv.reader(f):
                if row:
                    labeled.add(row[0])
    return labeled


def append_label(csv_path, filename, label):
    with open(csv_path, "a", newline="") as f:
        csv.writer(f).writerow([filename, label])


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/image/"):
            filename = self.path[len("/image/") :]
            filepath = os.path.join(self.server.crops_dir, filename)
            if not os.path.isfile(filepath):
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.end_headers()
            with open(filepath, "rb") as f:
                self.wfile.write(f.read())
            return

        labeled = load_labeled_filenames(self.server.csv_path)
        remaining = [f for f in self.server.crop_files if f not in labeled]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        if not remaining:
            self.wfile.write(DONE_PAGE.encode())
            return
        html = PAGE_TEMPLATE.format(
            filename=remaining[0],
            done=len(labeled),
            total=len(self.server.crop_files),
            unreadable=UNREADABLE,
        )
        self.wfile.write(html.encode())

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode()
        data = parse_qs(body)
        filename = data.get("filename", [""])[0]
        label = data.get("skip", [None])[0] or data.get("label", [""])[0].strip()
        if filename and label:
            append_label(self.server.csv_path, filename, label)
        self.send_response(303)
        self.send_header("Location", "/")
        self.end_headers()

    def log_message(self, format, *args):
        pass  # keep the terminal quiet


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("crops_dir")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    crop_files = sorted(f for f in os.listdir(args.crops_dir) if f.lower().endswith(".jpg"))
    if not crop_files:
        print(f"No .jpg crops found in {args.crops_dir}")
        return

    server = HTTPServer(("0.0.0.0", args.port), Handler)
    server.crops_dir = args.crops_dir
    server.csv_path = os.path.join(args.crops_dir, "labels.csv")
    server.crop_files = crop_files

    print(f"Labeling {len(crop_files)} crops.")
    print(f"Open http://localhost:{args.port} in your browser.")
    server.serve_forever()


if __name__ == "__main__":
    main()
