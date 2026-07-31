#!/usr/bin/env python3
"""
Optional local server for Lingua Lector: CORS proxy + static file server +
auto-opens the app in your browser.

Lingua Lector is a single static HTML file with no backend, by design --
your API key lives in your browser and calls go straight from the browser
to the AI provider. That works out of the box for Anthropic (which
explicitly supports direct-from-browser calls), but NOT for every provider:
some AI APIs reject cross-origin (CORS) requests from a browser entirely,
which shows up in the app as "network request failed".

Running this script locally solves that, and optionally solves a second
problem too: normally your API key sits in the browser's localStorage. If
you'd rather it never touch the browser at all, this proxy can inject the
real key server-side (from an argument or environment variable you set only
on your own machine) while the browser only ever holds a placeholder value.

This is entirely optional -- if you don't run it, Lingua Lector still works
exactly as documented in the README (direct browser calls, your own key
pasted into the app's settings).

USAGE
-----
  # Just start it -- serves dist/lingua-lector.html and opens it in your
  # browser. No key here at all -- the browser's own key (from Lingua
  # Lector's settings) is forwarded upstream as-is, this is pure CORS relay.
  python3 server.py

  # Key(s) held server-side instead of in the browser. Works identically on
  # Windows/macOS/Linux (plain command-line flags, no shell-specific syntax):
  python3 server.py --anthropic-key sk-ant-... --openai-key sk-... --gemini-key AIza...

  # NVIDIA (or any other OpenAI-compatible host) via --openai-base-url:
  python3 server.py --openai-base-url https://integrate.api.nvidia.com --openai-key nvapi-...

Then in Lingua Lector's settings (AI 与模型 tab), for each provider you want
routed through this proxy, set:

  Base URL:  http://localhost:8787/anthropic        (Anthropic)
             http://localhost:8787/openai/v1         (OpenAI-compatible --
                                                        also NVIDIA/Groq/
                                                        Together/local
                                                        Ollama/vLLM/etc, see
                                                        --openai-base-url)
             http://localhost:8787/gemini/v1beta     (Gemini)

  API key:   leave it as whatever you like (e.g. "local-proxy") if you passed
             the matching --...-key flag above -- the proxy overrides it with
             the real key. If you did NOT pass a key for that provider, put
             your real key in the browser field as normal; the proxy just
             relays it (solving CORS only, not the "key in the browser"
             question).

All flags also work as environment variables (ANTHROPIC_API_KEY,
OPENAI_API_KEY, OPENAI_BASE_URL, GEMINI_API_KEY, LINGUA_LECTOR_PROXY_PORT) if
you prefer that -- a --flag always wins over the matching env var.

Run `python3 server.py --help` for all options.

No third-party dependencies -- this only uses the Python standard library.
"""
import argparse
import json
import os
import socketserver
import threading
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
APP_FILE = SCRIPT_DIR / "dist" / "lingua-lector.html"

HOP_BY_HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
}


def parse_args():
    p = argparse.ArgumentParser(
        description="Local CORS proxy + static server for Lingua Lector.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--port", type=int, default=int(os.environ.get("LINGUA_LECTOR_PROXY_PORT", "8787")),
                   help="Port to listen on (default: 8787)")
    p.add_argument("--anthropic-key", default=os.environ.get("ANTHROPIC_API_KEY", ""),
                   help="Anthropic API key to inject server-side (optional)")
    p.add_argument("--openai-key", default=os.environ.get("OPENAI_API_KEY", ""),
                   help="OpenAI-compatible API key to inject server-side (optional)")
    p.add_argument("--openai-base-url", default=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com"),
                   help="Upstream host for the /openai route -- override this to point at "
                        "NVIDIA, Groq, Together, a local Ollama/vLLM server, etc "
                        "(default: https://api.openai.com)")
    p.add_argument("--gemini-key", default=os.environ.get("GEMINI_API_KEY", ""),
                   help="Gemini API key to inject server-side (optional)")
    p.add_argument("--timeout", type=int, default=int(os.environ.get("LINGUA_LECTOR_PROXY_TIMEOUT", "180")),
                   help="Seconds to wait for the upstream AI provider to respond before giving up "
                        "(default: 180). Some models/providers are slow -- raise this if you see "
                        "502 'read operation timed out' errors.")
    p.add_argument("--no-open", action="store_true",
                   help="Don't automatically open the app in your browser")
    return p.parse_args()


def make_handler(upstreams, server_side_keys, timeout):
    class ProxyHandler(BaseHTTPRequestHandler):
        def _cors_headers(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors_headers()
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/" or path == "/lingua-lector.html":
                self._serve_app()
                return
            self._proxy("GET")

        def do_POST(self):
            self._proxy("POST")

        def _serve_app(self):
            if not APP_FILE.exists():
                self.send_response(404)
                self._cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(
                    b"dist/lingua-lector.html not found -- run build.py first, "
                    b"or open the file directly in your browser."
                )
                return
            body = APP_FILE.read_bytes()
            self.send_response(200)
            self._cors_headers()
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _proxy(self, method):
            path = self.path.lstrip("/")
            provider, _, rest = path.partition("/")

            if provider not in upstreams:
                self.send_response(404)
                self._cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(
                    f'Unknown provider "{provider}". '
                    f'Use one of: {", ".join("/" + p for p in upstreams)}'.encode("utf-8")
                )
                return

            upstream_url = upstreams[provider] + "/" + rest
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else None

            # forward the browser's own headers (Content-Type, and whatever
            # auth header it sent) as a baseline, then override with the
            # server-side key if one is configured for this provider
            headers = {}
            for name, value in self.headers.items():
                if name.lower() not in HOP_BY_HOP_HEADERS and name.lower() != "origin":
                    headers[name] = value

            key = server_side_keys.get(provider, "")
            if provider == "anthropic" and key:
                headers["x-api-key"] = key
                headers["anthropic-version"] = "2023-06-01"
            elif provider == "openai" and key:
                headers["Authorization"] = f"Bearer {key}"
            elif provider == "gemini" and key:
                sep = "&" if "?" in upstream_url else "?"
                if "key=" not in upstream_url:
                    upstream_url += f"{sep}key={key}"

            req = urllib.request.Request(upstream_url, data=body, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    self.send_response(resp.status)
                    self._cors_headers()
                    self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                    self.end_headers()
                    self.wfile.write(resp.read())
            except urllib.error.HTTPError as e:
                self.send_response(e.code)
                self._cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(e.read())
            except Exception as e:  # noqa: BLE001 -- report any upstream failure to the browser
                self.send_response(502)
                self._cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": str(e)}}).encode("utf-8"))

        def log_message(self, format, *args):  # noqa: A002 -- quiet by default
            pass

    return ProxyHandler


def main():
    args = parse_args()

    upstreams = {
        "anthropic": "https://api.anthropic.com",
        "openai": args.openai_base_url.rstrip("/"),
        "gemini": "https://generativelanguage.googleapis.com",
    }
    server_side_keys = {
        "anthropic": args.anthropic_key,
        "openai": args.openai_key,
        "gemini": args.gemini_key,
    }
    configured = [p for p, k in server_side_keys.items() if k]

    url = f"http://localhost:{args.port}/"
    print(f"Lingua Lector local server listening on {url}")
    if configured:
        print(f"Server-side keys configured for: {', '.join(configured)}")
    else:
        print("No server-side keys configured -- pure CORS relay, browser-supplied keys are forwarded as-is.")
    print("Point a provider's Base URL in Lingua Lector's settings at, e.g.:")
    print(f"  http://localhost:{args.port}/anthropic")
    print(f"  http://localhost:{args.port}/openai/v1   (upstream: {upstreams['openai']})")
    print(f"  http://localhost:{args.port}/gemini/v1beta")

    if not args.no_open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    handler = make_handler(upstreams, server_side_keys, args.timeout)
    with socketserver.ThreadingTCPServer(("127.0.0.1", args.port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
