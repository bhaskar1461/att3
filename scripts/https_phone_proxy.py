import http.server
import socketserver
import ssl
import urllib.request
import urllib.error
import os
import sys

PORT = 5174
TARGET_URL = "http://127.0.0.1:5173"
CERT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "certs")
CERT_FILE = os.path.join(CERT_DIR, "cert.pem")
KEY_FILE = os.path.join(CERT_DIR, "key.pem")

class HttpsProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.proxy_request("GET")

    def do_POST(self):
        self.proxy_request("POST")

    def do_PUT(self):
        self.proxy_request("PUT")

    def do_DELETE(self):
        self.proxy_request("DELETE")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def address_string(self):
        return self.client_address[0]

    def log_message(self, format, *args):
        pass

    def proxy_request(self, method):
        dest_url = f"{TARGET_URL}{self.path}"
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len > 0 else None

        req_headers = {}
        for key, val in self.headers.items():
            if key.lower() not in ["host", "accept-encoding"]:
                req_headers[key] = val

        class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        opener = urllib.request.build_opener(NoRedirectHandler)
        req = urllib.request.Request(dest_url, data=body, headers=req_headers, method=method)

        try:
            with opener.open(req, timeout=15) as resp:
                self.send_response(resp.status)
                for key, val in resp.headers.items():
                    if key.lower() not in ["transfer-encoding", "content-length"]:
                        self.send_header(key, val)
                data = resp.read()
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for key, val in e.headers.items():
                if key.lower() not in ["transfer-encoding", "content-length"]:
                    self.send_header(key, val)
            data = e.read()
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as ex:
            self.send_error(502, f"Proxy Error: {str(ex)}")

class ThreadingHttpsServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    if not os.path.exists(CERT_FILE) or not os.path.exists(KEY_FILE):
        print(f"[ERROR] Missing SSL certificates in {CERT_DIR}")
        sys.exit(1)

    server = ThreadingHttpsServer(("0.0.0.0", PORT), HttpsProxyHandler)
    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    server.socket = ssl_context.wrap_socket(server.socket, server_side=True)

    print(f"[*] HTTPS Mobile Proxy listening on https://0.0.0.0:{PORT} -> forwarding to {TARGET_URL}")
    server.serve_forever()
