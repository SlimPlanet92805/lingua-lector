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

If you passed a --...-key flag, there is nothing to configure in the app: the
page served at http://localhost:8787/ is told which providers this proxy holds
a key for, and fills in their Base URL itself. Just pick that provider in
settings and start reading -- the API key field can stay empty.

For a provider you did NOT pass a key for, set its Base URL by hand if you want
its requests relayed (this solves CORS only, not the "key in the browser"
question -- your real key still goes in the app's settings and is forwarded).

The one thing people get wrong here: that Base URL must point at THIS SERVER,
not at the provider. Starting this script and then typing the provider's own
address (say https://integrate.api.nvidia.com/v1) into the app's Base URL field
does not route anything through the proxy -- the browser calls NVIDIA directly
and you get the very CORS error you started the proxy to avoid. The provider's
address belongs on this script's --openai-base-url flag; the app's Base URL
field gets the localhost one:

  Base URL:  http://localhost:8787/anthropic        (Anthropic)
             http://localhost:8787/openai/v1         (OpenAI-compatible --
                                                        also NVIDIA/Groq/
                                                        Together/local
                                                        Ollama/vLLM/etc, see
                                                        --openai-base-url)
             http://localhost:8787/gemini/v1beta     (Gemini)

IMPORTANT: open the app from http://localhost:8787/ (this server opens it for
you). Double-clicking dist/lingua-lector.html gives the page an origin of
"null", and the proxy refuses those -- otherwise any other local HTML file
could call this proxy and spend a server-side key. See --allow-origin if you
have a genuine reason to override that.

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

# Only these browser headers are ever forwarded upstream. This is an
# allow-list rather than the old "forward everything except hop-by-hop"
# deny-list: a deny-list silently passes along cookies, Referer, and anything
# else the browser decides to add, which the AI provider has no business
# seeing. The provider's own auth headers are added conditionally in _proxy().
ALLOWED_UPSTREAM_HEADERS = {"content-type", "accept"}

# The headers each provider uses to carry a *browser-supplied* key. These are
# forwarded only when no server-side key is configured for that provider --
# otherwise the server-side key wins and the browser's value is dropped.
PROVIDER_AUTH_HEADERS = {
    "anthropic": {"x-api-key", "anthropic-version",
                  "anthropic-dangerous-direct-browser-access"},
    "openai": {"authorization"},
    "gemini": {"x-goog-api-key"},
}

# What a browser is allowed to send us on a cross-origin call. Previously "*",
# which combined with a server-side key meant any page could spend your quota.
CORS_ALLOWED_REQUEST_HEADERS = ", ".join(sorted(
    {"content-type", "accept"} | set().union(*PROVIDER_AUTH_HEADERS.values())
))

# Where each provider's Base URL points on this proxy. Used both for the
# startup hints and for the config injected into the served page.
PROXY_PATHS = {
    "anthropic": "/anthropic",
    "openai": "/openai/v1",
    "gemini": "/gemini/v1beta",
}


def normalize_openai_upstream(url):
    """Accept an OpenAI-compatible base URL with or without a trailing "/v1".

    Every provider's own docs print the URL *with* it -- NVIDIA says
    `https://integrate.api.nvidia.com/v1`, DeepSeek `https://api.deepseek.com/v1`
    -- so that is what people paste. But the app already appends the whole
    `/v1/chat/completions` path (its Base URL is `http://localhost:PORT/openai/v1`),
    which produced `.../v1/v1/chat/completions` upstream and a bare 404 with
    nothing on screen to suggest what was wrong. Measured against NVIDIA:
    the doubled path is 404, the single one 200.

    Only a trailing `/v1` is stripped -- a host that genuinely serves under
    some other path keeps it.
    """
    url = url.rstrip("/")
    if url.endswith("/v1"):
        url = url[: -len("/v1")]
    return url


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
                        "(default: https://api.openai.com). A trailing /v1 is optional: "
                        "paste the URL exactly as the provider's docs give it.")
    p.add_argument("--gemini-key", default=os.environ.get("GEMINI_API_KEY", ""),
                   help="Gemini API key to inject server-side (optional)")
    p.add_argument("--timeout", type=int, default=int(os.environ.get("LINGUA_LECTOR_PROXY_TIMEOUT", "180")),
                   help="Seconds to wait for the upstream AI provider to respond before giving up "
                        "(default: 180). Some models/providers are slow -- raise this if you see "
                        "502 'read operation timed out' errors.")
    p.add_argument("--no-open", action="store_true",
                   help="Don't automatically open the app in your browser")
    p.add_argument("--host", default=os.environ.get("LINGUA_LECTOR_PROXY_HOST", "127.0.0.1"),
                   help="Address to bind. Defaults to 127.0.0.1 -- reachable only from this "
                        "machine. Pass 0.0.0.0 to also serve the app to phones and tablets on "
                        "your own network, which is the only practical way to run it on an "
                        "iPhone offline (iOS cannot open a local .html at all). SECURITY: on "
                        "0.0.0.0 anyone who can reach this machine on the network can use the "
                        "proxy, and if you passed a --...-key they can spend it. Fine on a home "
                        "network you control; do not do it on cafe or hotel Wi-Fi.")
    p.add_argument("--allow-origin", action="append", default=[], metavar="ORIGIN",
                   help="Additionally accept cross-origin requests from ORIGIN "
                        "(repeatable). By default only the app this server itself "
                        "serves (http://localhost:PORT) may call the proxy, so that "
                        "a random web page you have open cannot spend a server-side "
                        "key. Pass 'null' to allow pages opened as file://.")
    return p.parse_args()


def _inject_proxy_config(html, server_side_keys, origin):
    """Tell the page it is being served by this proxy, so the user doesn't have
    to go into settings and paste three Base URLs by hand.

    The app reads window.LINGUA_LECTOR_PROXY on startup and fills in the Base
    URL for any provider we hold a key for. Injected at serve time rather than
    baked into dist/ so the distributed file stays a pure static artifact.

    `origin` is derived from the request's own Host header rather than assumed
    to be localhost. With --host that assumption breaks in the worst way: a
    phone loading the app from http://192.168.1.5:8787/ would be handed a Base
    URL of http://localhost:8787/, which on a phone means the phone itself.
    """
    config = {
        "origin": origin,
        "providers": {
            provider: {
                "baseUrl": f"{origin}{PROXY_PATHS[provider]}",
                "hasServerKey": bool(key),
            }
            for provider, key in server_side_keys.items()
            if provider in PROXY_PATHS
        },
    }
    # "</" would end the script element early no matter where it appears.
    payload = json.dumps(config).replace("</", "<\\/")
    script = f"<script>window.LINGUA_LECTOR_PROXY = {payload};</script>".encode("utf-8")
    if b"</head>" in html:
        return html.replace(b"</head>", script + b"</head>", 1)
    return script + html


def make_handler(upstreams, server_side_keys, timeout, allowed_origins, port):
    class ProxyHandler(BaseHTTPRequestHandler):
        def _cors_headers(self):
            # No Origin header means a same-origin request (the app served by
            # this very server) or a non-browser client like curl. CORS is a
            # browser-enforced concept; sending the headers anyway would only
            # widen the surface for no benefit.
            origin = self.headers.get("Origin")
            if not origin or origin not in allowed_origins:
                return
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", CORS_ALLOWED_REQUEST_HEADERS)

        def _reject_disallowed_origin(self):
            """Answer and return True if this request comes from an origin we
            don't serve. Deliberately refuses *before* the upstream call, so a
            hostile page can't spend a server-side key even once."""
            origin = self.headers.get("Origin")
            if not origin or origin in allowed_origins:
                return False
            body = (
                "Refused: this proxy only answers the Lingua Lector page it serves.\n"
                "\n"
                f"  rejected Origin:  {origin}\n"
                f"  allowed:          {', '.join(sorted(allowed_origins))}\n"
                "\n"
                f"Open the app at http://localhost:{port}/ instead of opening the HTML\n"
                "file directly. A file:// page sends \"Origin: null\", which is rejected\n"
                "because any other local HTML file would then be able to use this proxy\n"
                "and spend your API key.\n"
                "\n"
                "If you really do need another origin:\n"
                f"  python3 server.py --allow-origin {origin}\n"
            ).encode("utf-8")
            self.send_response(403)
            # No CORS headers here on purpose -- the browser should block the
            # response body too. The text is for whoever reads the network tab.
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True

        def do_OPTIONS(self):
            if self._reject_disallowed_origin():
                return
            self.send_response(204)
            self._cors_headers()
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/" or path == "/lingua-lector.html":
                self._serve_app()
                return
            if self._reject_disallowed_origin():
                return
            self._proxy("GET")

        def do_POST(self):
            if self._reject_disallowed_origin():
                return
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
            # Whatever host:port the browser actually used to reach us -- which
            # with --host is a LAN address, not localhost.
            host = self.headers.get("Host") or f"localhost:{port}"
            body = _inject_proxy_config(APP_FILE.read_bytes(), server_side_keys,
                                        f"http://{host}")
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

            key = server_side_keys.get(provider, "")

            # Allow-list what reaches the provider. When we hold the key for
            # this provider the browser's auth headers are dropped entirely --
            # it has no legitimate key to send, and forwarding a stray one
            # would let the page override our own.
            forwardable = set(ALLOWED_UPSTREAM_HEADERS)
            if not key:
                forwardable |= PROVIDER_AUTH_HEADERS.get(provider, set())
            headers = {
                name: value
                for name, value in self.headers.items()
                if name.lower() in forwardable
            }

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


def _lan_address():
    """This machine's address on the local network, for the "open this on your
    phone" hint. Uses a UDP socket to a public address purely to ask the OS
    which interface it would route through -- nothing is actually sent."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:  # noqa: BLE001 -- no network, or an unusual setup
        return None


def main():
    args = parse_args()

    upstreams = {
        "anthropic": "https://api.anthropic.com",
        "openai": normalize_openai_upstream(args.openai_base_url),
        "gemini": "https://generativelanguage.googleapis.com",
    }
    server_side_keys = {
        "anthropic": args.anthropic_key,
        "openai": args.openai_key,
        "gemini": args.gemini_key,
    }
    configured = [p for p, k in server_side_keys.items() if k]

    # Both spellings of the loopback address: which one the browser sends as
    # Origin depends on which one is in the address bar.
    allowed_origins = {
        f"http://localhost:{args.port}",
        f"http://127.0.0.1:{args.port}",
    } | set(args.allow_origin)

    lan_ip = _lan_address() if args.host == "0.0.0.0" else None
    if lan_ip:
        # The phone reaches us at the LAN address, so that origin has to be on
        # the list too -- and so does the bare IP without a port, for browsers
        # that normalise it away.
        allowed_origins.add(f"http://{lan_ip}:{args.port}")

    url = f"http://localhost:{args.port}/"
    print(f"Lingua Lector local server listening on {url}")
    if lan_ip:
        print(f"Also reachable on your network at http://{lan_ip}:{args.port}/")
        print("  -> open that on a phone or tablet; iOS cannot open a local .html at all,")
        print("     and Android blocks network requests from one, so this is the way.")
        print("  !! Anyone who can reach this machine on the network can use this proxy.")
        if configured:
            print("  !! You passed a key, so they could also spend it. Home network only.")
    if configured:
        print(f"Server-side keys configured for: {', '.join(configured)}")
        print("The app served here configures those providers automatically --")
        print("you shouldn't need to touch Base URL in settings.")
        if "openai" in configured:
            print(f"  /openai/v1 forwards to: {upstreams['openai']}/v1")
    else:
        print("No server-side keys configured -- pure CORS relay, browser-supplied keys are forwarded as-is.")
        print("Point a provider's Base URL in Lingua Lector's settings at, e.g.:")
        print(f"  http://localhost:{args.port}/anthropic")
        print(f"  http://localhost:{args.port}/openai/v1   (upstream: {upstreams['openai']})")
        print(f"  http://localhost:{args.port}/gemini/v1beta")
    print(f"Accepting browser requests from: {', '.join(sorted(allowed_origins))}")
    print("Open the app at the URL above -- a file:// page will be refused.")

    if not args.no_open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    handler = make_handler(upstreams, server_side_keys, args.timeout,
                           allowed_origins, args.port)
    with socketserver.ThreadingTCPServer((args.host, args.port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
