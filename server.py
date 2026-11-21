import os
import sys
import mimetypes
from urllib.parse import urlparse, unquote
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(os.environ.get("PORT", 3000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CUSTOM_MIMES = {
    ".mjs": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8"
}

class VeyoraRequestHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urlparse(path)
        clean_path = unquote(parsed.path).lstrip("/")
        full_path = os.path.normpath(os.path.join(BASE_DIR, clean_path))
        
        # Security check: stay within BASE_DIR
        if not full_path.startswith(BASE_DIR):
            return os.path.join(BASE_DIR, "index.html")
            
        if os.path.isdir(full_path):
            index_path = os.path.join(full_path, "index.html")
            if os.path.exists(index_path):
                return index_path
        elif not os.path.exists(full_path):
            if os.path.exists(full_path + ".html"):
                return full_path + ".html"
            elif os.path.exists(os.path.join(full_path, "index.html")):
                return os.path.join(full_path, "index.html")
        return full_path

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def guess_type(self, path):
        base, ext = os.path.splitext(path)
        ext = ext.lower()
        if ext in CUSTOM_MIMES:
            return CUSTOM_MIMES[ext]
        return super().guess_type(path)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

if __name__ == "__main__":
    os.chdir(BASE_DIR)
    server_address = ("", PORT)
    httpd = HTTPServer(server_address, VeyoraRequestHandler)
    print(f"\n======================================================")
    print(f" Veyora Python Server running at http://localhost:{PORT}")
    print(f" Serving files from: {BASE_DIR}")
    print(f" Press Ctrl+C to stop.")
    print(f"======================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()
