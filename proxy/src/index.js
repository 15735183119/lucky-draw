/**
 * 咸鱼抽奖 · 回复代理
 *
 * 浏览器不能直接调用 X API（跨域，且 Bearer Token 不能出现在网页里）。
 * 本 Worker 只接受帖子 id，用 Secret 里的 Token 调 recent search，再把回复名单返回给页面。
 * 部署步骤见仓库 README 的「贴帖子链接」。
 *
 * Secrets（不要写进 wrangler.toml，也不要提交到仓库）：
 *   X_BEARER_TOKEN  必填
 *   DRAW_KEY        可选。设置后，请求必须带请求头 X-Draw-Key
 */

const CURSOR = /^[A-Za-z0-9+/=_-]{1,512}$/;
const SEARCH_PATH = /^\/2\/tweets\/search\/(recent|all)$/;

export function mapPage(payload, tweetId) {
  const users = new Map(((payload && payload.includes && payload.includes.users) || []).map((user) => [user.id, user]));
  const replies = [];
  for (const tweet of (payload && payload.data) || []) {
    if (!tweet || String(tweet.id) === String(tweetId)) continue;
    const user = users.get(tweet.author_id);
    if (!user || !user.username) continue;
    const username = String(user.username).replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) continue;
    const followers = user.public_metrics ? user.public_metrics.followers_count : null;
    replies.push({
      username,
      name: String(user.name || "").slice(0, 80),
      followers: Number.isFinite(followers) && followers >= 0 ? Math.floor(followers) : null,
      text: String(tweet.text || "").replace(/\s+/g, " ").trim().slice(0, 500),
      id: tweet.id,
    });
  }
  const next = payload && payload.meta ? payload.meta.next_token : null;
  return {
    replies,
    next_cursor: typeof next === "string" && CURSOR.test(next) ? next : null,
  };
}

function isOriginAllowed(origin, env) {
  const raw = String(env.ALLOWED_ORIGINS ?? "*").trim();
  if (!raw || raw === "*") return true;
  if (!origin) return true;
  return raw.split(",").map((item) => item.trim()).filter(Boolean).includes(origin);
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Accept, Content-Type, X-Draw-Key",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(body, status, origin, allowed) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (allowed) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(body), { status, headers });
}

function safeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function keyOk(request, env) {
  const expected = env.DRAW_KEY || "";
  if (!expected) return true;
  return safeEqual(request.headers.get("X-Draw-Key") || "", expected);
}

function errorCode(status) {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 402) return "payment_required";
  if (status === 429) return "rate_limited";
  return "x_api_error";
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = isOriginAllowed(origin, env);

    if (request.method === "OPTIONS") {
      if (!allowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin, allowed);
    if (!allowed) return json({ error: "origin_not_allowed" }, 403, "", false);

    if (url.pathname.endsWith("/health")) {
      return json({
        ok: true,
        token_configured: Boolean(env.X_BEARER_TOKEN),
        key_required: Boolean(env.DRAW_KEY),
      }, 200, origin, true);
    }

    if (!keyOk(request, env)) return json({ error: "bad_key" }, 401, origin, true);

    const id = url.searchParams.get("id") || "";
    if (!/^\d{8,22}$/.test(id)) return json({ error: "invalid_id" }, 400, origin, true);

    const cursor = url.searchParams.get("cursor") || "";
    if (cursor && !CURSOR.test(cursor)) return json({ error: "invalid_cursor" }, 400, origin, true);

    if (!env.X_BEARER_TOKEN) return json({ error: "missing_token" }, 500, origin, true);

    const apiBase = String(env.X_API_BASE || "https://api.x.com").replace(/\/$/, "");
    const searchPath = env.X_SEARCH_PATH || "/2/tweets/search/recent";
    if (!SEARCH_PATH.test(searchPath) || !/^https:\/\/[a-z0-9.-]+$/i.test(apiBase)) {
      return json({ error: "bad_config" }, 500, origin, true);
    }

    const upstreamUrl = new URL(`${apiBase}${searchPath}`);
    upstreamUrl.searchParams.set("query", `conversation_id:${id} is:reply -is:retweet`);
    upstreamUrl.searchParams.set("max_results", "100");
    upstreamUrl.searchParams.set("tweet.fields", "author_id,text,created_at");
    upstreamUrl.searchParams.set("expansions", "author_id");
    upstreamUrl.searchParams.set("user.fields", "username,name,public_metrics");
    if (cursor) upstreamUrl.searchParams.set("next_token", cursor);

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: {
          Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
          "User-Agent": "lucky-draw-proxy",
        },
      });
    } catch (error) {
      return json({ error: "upstream_unreachable" }, 502, origin, true);
    }

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return json({ error: errorCode(upstream.status), upstream_status: upstream.status }, 502, origin, true);
    }

    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch (error) {
      return json({ error: "x_api_error", upstream_status: upstream.status }, 502, origin, true);
    }

    const page = mapPage(payload, id);
    return json({
      tweet_id: id,
      replies: page.replies,
      next_cursor: page.next_cursor,
      result_count: page.replies.length,
    }, 200, origin, true);
  },
};
