/**
 * Optional CORS proxy for Lingua Lector, as a Cloudflare Worker.
 *
 * This is the no-install alternative to server.py: if you don't have Python
 * (or don't want to run anything on your own machine), you can deploy this
 * instead. It runs entirely on Cloudflare's free tier -- no local software,
 * no command line required, just a Cloudflare account and their web dashboard.
 *
 * It does the same job as server.py: relays your AI provider requests so
 * the browser doesn't hit a CORS block, and optionally holds your API key
 * as a Worker secret so it never touches the browser at all.
 *
 * SETUP (all via https://dash.cloudflare.com, no CLI needed)
 * -------------------------------------------------------------------------
 * 1. Sign in (or create a free account), go to Workers & Pages -> Create ->
 *    "Create Worker". Give it any name, e.g. "lingua-lector-proxy".
 * 2. Click "Edit code", delete the placeholder content, paste this entire
 *    file in, then "Deploy". You'll get a URL like
 *    https://lingua-lector-proxy.YOUR-SUBDOMAIN.workers.dev
 * 3. REQUIRED. In the Worker's Settings -> Variables, add a plain variable
 *    named ALLOWED_ORIGINS listing the page(s) allowed to call this Worker,
 *    comma-separated. If you open lingua-lector.html from your own disk, the
 *    value is the literal word:
 *      null
 *    If you host it somewhere, use that origin, e.g. https://you.github.io
 *    Without this, every request is refused -- see the comment on
 *    allowedOrigins() below for why that's the safe default.
 * 4. (Optional, for keeping your key off the browser entirely) Same Variables
 *    screen -> "Add secret" (not a plain variable -- secrets are encrypted
 *    and never shown again), add whichever of these you need:
 *    ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY. You can also add
 *    OPENAI_BASE_URL (a plain variable is fine for this one, it's not a
 *    secret) to point the /openai route at a different OpenAI-compatible
 *    host, e.g. https://integrate.api.nvidia.com for NVIDIA.
 * 5. In Lingua Lector's settings (AI 与模型 tab), set the Base URL to:
 *      Anthropic:     https://YOUR-WORKER-URL/anthropic
 *      OpenAI 兼容:   https://YOUR-WORKER-URL/openai/v1
 *      Gemini:        https://YOUR-WORKER-URL/gemini/v1beta
 *    If you set the matching secret in step 4, leave the API key field empty
 *    -- the app recognises a proxied Base URL and stops asking for a key. If
 *    you didn't, put your real key there as normal; the Worker relays it.
 *
 * This is a plain relay: it does not log, store, or inspect your requests
 * beyond what's needed to forward them. Cloudflare's own logs/observability
 * settings (off by default on a fresh Worker) are outside this script's
 * control -- check your Worker's Settings if that matters to you.
 */

const UPSTREAMS = {
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
};

// Which pages may call this Worker. Unlike server.py -- which serves the app
// itself and so knows its own origin -- a Worker has no idea where you keep
// your copy of lingua-lector.html, so you have to say.
//
// Set ALLOWED_ORIGINS as a Worker variable (Settings -> Variables, a plain
// variable is fine, it isn't a secret) to a comma-separated list, e.g.
//   https://yourname.github.io
// or, if you open the HTML file from your own disk, the literal
//   null
// (that's what a file:// page sends as its Origin).
//
// Leaving it unset means no browser page can use this Worker. That is
// deliberate: a Worker with a key secret in it and no origin check is a key
// anyone who finds the URL can spend.
function allowedOrigins(env) {
  return new Set(
    (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  );
}

// Only these browser headers are forwarded upstream -- an allow-list, so
// cookies/Referer/etc never reach the AI provider. Per-provider auth headers
// are added conditionally in fetch(), only when we hold no key of our own.
const ALLOWED_UPSTREAM_HEADERS = new Set(["content-type", "accept"]);

const PROVIDER_AUTH_HEADERS = {
  anthropic: ["x-api-key", "anthropic-version", "anthropic-dangerous-direct-browser-access"],
  openai: ["authorization"],
  gemini: ["x-goog-api-key"],
};

const CORS_ALLOWED_REQUEST_HEADERS = [
  "content-type", "accept",
  ...Object.values(PROVIDER_AUTH_HEADERS).flat(),
].join(", ");

// An origin that isn't on the list gets no CORS headers at all, so the browser
// blocks the response even though the Worker answered.
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOWED_REQUEST_HEADERS,
  };
}

// Refuse before touching the upstream, so a page that shouldn't be here can't
// spend a key even once.
function rejectDisallowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null; // not a browser cross-origin call
  const allowed = allowedOrigins(env);
  if (allowed.has(origin)) return null;
  const listed = allowed.size
    ? [...allowed].sort().join(", ")
    : "(none -- ALLOWED_ORIGINS is not set on this Worker)";
  return new Response(
    `Refused: this Worker does not accept requests from that page.\n\n` +
      `  rejected Origin:  ${origin}\n` +
      `  allowed:          ${listed}\n\n` +
      `Add the origin above to this Worker's ALLOWED_ORIGINS variable\n` +
      `(Cloudflare dashboard -> your Worker -> Settings -> Variables),\n` +
      `as a comma-separated list. For a page opened from disk via file://,\n` +
      `the origin to add is the literal word: null\n`,
    { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

export default {
  async fetch(request, env) {
    const refusal = rejectDisallowedOrigin(request, env);
    if (refusal) return refusal;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    const [, provider, ...rest] = url.pathname.split("/");

    const upstreams = {
      ...UPSTREAMS,
      openai: (env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, ""),
    };

    if (!upstreams[provider]) {
      return new Response(
        `Unknown provider "${provider}". Use one of: ${Object.keys(upstreams).map(p => "/" + p).join(", ")}`,
        { status: 404, headers: { ...corsHeaders(request, env), "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    let upstreamUrl = upstreams[provider] + "/" + rest.join("/") + url.search;

    const serverSideKeys = {
      anthropic: env.ANTHROPIC_API_KEY || "",
      openai: env.OPENAI_API_KEY || "",
      gemini: env.GEMINI_API_KEY || "",
    };
    const key = serverSideKeys[provider];

    // When we hold the key, the browser's own auth headers are dropped rather
    // than forwarded -- it has no legitimate key to send, and a stray one
    // would otherwise override ours.
    const forwardable = new Set(ALLOWED_UPSTREAM_HEADERS);
    if (!key) {
      for (const h of PROVIDER_AUTH_HEADERS[provider] || []) forwardable.add(h);
    }
    const headers = new Headers();
    for (const [name, value] of request.headers.entries()) {
      if (forwardable.has(name.toLowerCase())) headers.set(name, value);
    }

    if (provider === "anthropic" && key) {
      headers.set("x-api-key", key);
      headers.set("anthropic-version", "2023-06-01");
    } else if (provider === "openai" && key) {
      headers.set("Authorization", `Bearer ${key}`);
    } else if (provider === "gemini" && key && !upstreamUrl.includes("key=")) {
      upstreamUrl += (upstreamUrl.includes("?") ? "&" : "?") + `key=${encodeURIComponent(key)}`;
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: { message: String(e) } }), {
        status: 502,
        headers: { ...corsHeaders(request, env), "Content-Type": "application/json" },
      });
    }

    const responseHeaders = new Headers(corsHeaders(request, env));
    responseHeaders.set("Content-Type", upstreamResponse.headers.get("Content-Type") || "application/json");
    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: responseHeaders });
  },
};
