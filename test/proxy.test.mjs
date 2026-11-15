import test from "node:test";
import assert from "node:assert/strict";
import worker, { mapPage } from "../proxy/src/index.js";

const TOKEN = "secret-token-should-never-leak";
const TWEET = "2121740234060906755";

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function page(body, token = TOKEN) {
  return worker.fetch(new Request(`https://worker.test/?id=${TWEET}`), {
    X_BEARER_TOKEN: token,
    ALLOWED_ORIGINS: "*",
  }).then(async (res) => ({ status: res.status, body: await res.json(), headers: res.headers }));
}

test("maps a search page and drops the root tweet", () => {
  const mapped = mapPage({
    data: [
      { id: TWEET, text: "原帖", author_id: "1" },
      { id: "8", text: "算我一个", author_id: "2" },
      { id: "9", text: "再回一条", author_id: "2" },
    ],
    includes: {
      users: [
        { id: "1", username: "JohnWangbc", name: "薛定谔的咸鱼", public_metrics: { followers_count: 10 } },
        { id: "2", username: "alice", name: "爱丽丝", public_metrics: { followers_count: 0 } },
      ],
    },
    meta: { next_token: "abc_DEF-123" },
  }, TWEET);
  assert.equal(mapped.replies.length, 2);
  assert.equal(mapped.replies[0].username, "alice");
  assert.equal(mapped.replies[0].followers, 0);
  assert.equal(mapped.replies[1].text, "再回一条");
  assert.equal(mapped.next_cursor, "abc_DEF-123");
});

test("asks recent search for replies and hides the bearer token", async () => {
  let seen = null;
  const result = await withFetch(async (url, init) => {
    seen = { url: new URL(url), auth: init.headers.Authorization };
    return new Response(JSON.stringify({
      data: [{ id: "5", text: "算我一个", author_id: "9" }],
      includes: { users: [{ id: "9", username: "alice", name: "爱丽丝", public_metrics: { followers_count: 12 } }] },
      meta: { result_count: 1 },
    }), { status: 200 });
  }, () => page());

  assert.equal(seen.auth, `Bearer ${TOKEN}`);
  assert.equal(seen.url.searchParams.get("query"), `conversation_id:${TWEET} is:reply -is:retweet`);
  assert.equal(seen.url.pathname, "/2/tweets/search/recent");
  assert.equal(result.body.replies[0].username, "alice");
  assert.equal(result.body.replies[0].followers, 12);
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
  assert.equal(result.headers.get("access-control-allow-origin"), "*");
});

test("forwards one cursor and never returns upstream bodies", async () => {
  const result = await withFetch(async (url) => {
    assert.equal(new URL(url).searchParams.get("next_token"), "abc_DEF-123");
    return new Response(`${TOKEN} leaked in body`, { status: 403 });
  }, async () => {
    const res = await worker.fetch(new Request(`https://worker.test/?id=${TWEET}&cursor=abc_DEF-123`), {
      X_BEARER_TOKEN: TOKEN,
    });
    return { status: res.status, text: await res.text() };
  });
  assert.equal(result.status, 502);
  const body = JSON.parse(result.text);
  assert.equal(body.error, "forbidden");
  assert.equal(result.text.includes(TOKEN), false);
});

test("rejects bad ids, missing tokens, and a wrong draw key without calling X", async () => {
  const result = await withFetch(async () => {
    throw new Error("should not call X");
  }, async () => {
    const badId = await worker.fetch(new Request("https://worker.test/?id=nope"), { X_BEARER_TOKEN: TOKEN });
    const missing = await worker.fetch(new Request(`https://worker.test/?id=${TWEET}`), {});
    const denied = await worker.fetch(new Request(`https://worker.test/?id=${TWEET}`, {
      headers: { "X-Draw-Key": "wrong" },
    }), { X_BEARER_TOKEN: TOKEN, DRAW_KEY: "right" });
    const health = await worker.fetch(new Request("https://worker.test/health"), {});
    return {
      badId: badId.status,
      missing: (await missing.json()).error,
      denied: (await denied.json()).error,
      health: await health.json(),
    };
  });
  assert.equal(result.badId, 400);
  assert.equal(result.missing, "missing_token");
  assert.equal(result.denied, "bad_key");
  assert.equal(result.health.ok, true);
  assert.equal(result.health.token_configured, false);
});

test("blocks browser origins that are not on the allowlist", async () => {
  const res = await worker.fetch(new Request(`https://worker.test/?id=${TWEET}`, {
    headers: { Origin: "https://evil.test" },
  }), {
    X_BEARER_TOKEN: TOKEN,
    ALLOWED_ORIGINS: "https://15735183119.github.io",
  });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("answers CORS preflight", async () => {
  const res = await worker.fetch(new Request("https://worker.test/?id=1", {
    method: "OPTIONS",
    headers: { Origin: "https://15735183119.github.io", "Access-Control-Request-Headers": "X-Draw-Key" },
  }), { ALLOWED_ORIGINS: "*" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://15735183119.github.io");
  assert.match(res.headers.get("access-control-allow-headers"), /X-Draw-Key/);
});
