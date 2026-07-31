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
 * 3. (Optional, for keeping your key off the browser entirely) In the
 *    Worker's Settings -> Variables -> "Add secret" (not a plain variable --
 *    secrets are encrypted and never shown again), add whichever of these
 *    you need: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY. You can
 *    also add OPENAI_BASE_URL (a plain variable is fine for this one, it's
 *    not a secret) to point the /openai route at a different OpenAI-
 *    compatible host, e.g. https://integrate.api.nvidia.com for NVIDIA.
 * 4. In Lingua Lector's settings (AI 与模型 tab), set the Base URL to:
 *      Anthropic:     https://YOUR-WORKER-URL/anthropic
 *      OpenAI 兼容:   https://YOUR-WORKER-URL/openai/v1
 *      Gemini:        https://YOUR-WORKER-URL/gemini/v1beta
 *    If you set the matching secret in step 3, the API key field in the app
 *    can be any placeholder text. If you didn't, put your real key there as
 *    normal -- the Worker just relays it.
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

const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
  "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-forwarded-for",
  "x-forwarded-proto",
]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
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
        { status: 404, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    let upstreamUrl = upstreams[provider] + "/" + rest.join("/") + url.search;

    const headers = new Headers();
    for (const [name, value] of request.headers.entries()) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== "origin") {
        headers.set(name, value);
      }
    }

    const serverSideKeys = {
      anthropic: env.ANTHROPIC_API_KEY || "",
      openai: env.OPENAI_API_KEY || "",
      gemini: env.GEMINI_API_KEY || "",
    };
    const key = serverSideKeys[provider];
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
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const responseHeaders = new Headers(corsHeaders());
    responseHeaders.set("Content-Type", upstreamResponse.headers.get("Content-Type") || "application/json");
    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: responseHeaders });
  },
};
