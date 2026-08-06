import http.server
import socketserver
import urllib.request
import urllib.error
import os
import sys

PORT = 8088
DIST_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
BACKEND_URL = "http://127.0.0.1:8000"

class ProxyAndStaticHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/") or self.path.startswith("/docs") or self.path.startswith("/openapi.json") or self.path.startswith("/redoc"):
            self.proxy_request("GET")
        else:
            req_path = self.translate_path(self.path)
            if not os.path.exists(req_path) and not os.path.splitext(req_path)[1]:
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.proxy_request("POST")
        else:
            self.send_error(405, "Method not allowed")

    def do_PUT(self):
        if self.path.startswith("/api/"):
            self.proxy_request("PUT")
        else:
            self.send_error(405, "Method not allowed")

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            self.proxy_request("DELETE")
        else:
            self.send_error(405, "Method not allowed")

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self.proxy_request("OPTIONS")
        else:
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.end_headers()

    def proxy_request(self, method):
        target_url = f"{BACKEND_URL}{self.path}"
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        req_headers = {}
        for key in self.headers:
            if key.lower() not in ["host", "accept-encoding"]:
                req_headers[key] = self.headers[key]

        class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        opener = urllib.request.build_opener(NoRedirectHandler)
        req = urllib.request.Request(target_url, data=body, headers=req_headers, method=method)

        try:
            with opener.open(req) as resp:
                self.send_response(resp.status)
                for key, val in resp.headers.items():
                    if key.lower() not in ["transfer-encoding", "content-length"]:
                        self.send_header(key, val)
                response_data = resp.read()
                self.send_header("Content-Length", str(len(response_data)))
                self.end_headers()
                self.wfile.write(response_data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for key, val in e.headers.items():
                if key.lower() not in ["transfer-encoding", "content-length"]:
                    self.send_header(key, val)
            err_data = e.read()
            self.send_header("Content-Length", str(len(err_data)))
            self.end_headers()
            self.wfile.write(err_data)
        except Exception as ex:
            self.send_error(502, f"Proxy Error: {str(ex)}")

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), ProxyAndStaticHTTPRequestHandler) as httpd:
        print(f"[*] Dev Server listening on http://0.0.0.0:{PORT} (Proxying /api -> {BACKEND_URL})")
        httpd.serve_forever()
