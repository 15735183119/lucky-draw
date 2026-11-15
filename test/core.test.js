const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  parseEntrantText,
  parseJSON,
  parseTweetId,
  preparePool,
  pickWinners,
  secureRandomInt,
  toCSV,
  formatBeijing,
  buildResultText,
  parseExcludeList,
} = require("../js/core.js");

test("parses handles, urls, and trailing text", () => {
  const parsed = parseEntrantText(`
# 注释
@alice
bob 我来了
https://x.com/carol
不是用户名
https://x.com/dave/status/2121740234060906755
`);
  assert.deepEqual(parsed.entries.map((entry) => entry.username), ["alice", "bob", "carol"]);
  assert.equal(parsed.entries[1].text, "我来了");
  assert.equal(parsed.skipped, 2);
});

test("parses Chinese and English CSV, including quotes and a zero follower count", () => {
  const parsed = parseEntrantText('用户名,昵称,粉丝数,评论\r\nalice,爱丽丝,"1,234","你好，世界"\r\nbob,鲍勃,0,路过\r\n');
  assert.equal(parsed.entries[0].username, "alice");
  assert.equal(parsed.entries[0].name, "爱丽丝");
  assert.equal(parsed.entries[0].followers, 1234);
  assert.equal(parsed.entries[0].text, "你好，世界");
  assert.equal(parsed.entries[1].followers, 0);
});

test("keeps a headerless single column whose first cell looks like a field name", () => {
  const parsed = parseEntrantText("text\nalice\n");
  assert.deepEqual(parsed.entries.map((entry) => entry.username), ["text", "alice"]);
});

test("reports a header without a username column", () => {
  const parsed = parseEntrantText("昵称,粉丝数\n爱丽丝,3\n");
  assert.equal(parsed.error, "missing-username-column");
  assert.equal(parsed.entries.length, 0);
});

test("parses JSON lists and an X API payload", () => {
  const list = parseJSON('[{"username":"@Amy","name":"艾米","followers":8,"text":"算我一个"}]');
  assert.equal(list.entries[0].username, "Amy");
  assert.equal(list.entries[0].followers, 8);

  const api = parseJSON(JSON.stringify({
    data: [{ id: "5", text: "抽奖", author_id: "9" }],
    includes: { users: [{ id: "9", username: "alice", name: "爱丽丝", public_metrics: { followers_count: 12 } }] },
  }));
  assert.equal(api.entries[0].username, "alice");
  assert.equal(api.entries[0].text, "抽奖");
  assert.equal(api.entries[0].followers, 12);
  assert.throws(() => parseJSON("{"), /bad-json/);
});

test("reads the status id from x.com and twitter.com urls", () => {
  assert.equal(parseTweetId("https://x.com/JohnWangbc/status/2121740234060906755"), "2121740234060906755");
  assert.equal(parseTweetId("https://twitter.com/JohnWangbc/status/2121740234060906755?s=20"), "2121740234060906755");
  assert.equal(parseTweetId("https://x.com/i/web/status/2121740234060906755"), "2121740234060906755");
  assert.equal(parseTweetId("2121740234060906755"), "2121740234060906755");
  assert.equal(parseTweetId("https://x.com/JohnWangbc"), null);
});

test("dedupes, prefers the reply that matches the keyword, and applies filters", () => {
  const raw = [
    { username: "Ann", name: "安", followers: 5, text: "路过" },
    { username: "@ann", name: "安", followers: 5, text: "我要抽奖" },
    { username: "JohnWangbc", name: "AsynFish", followers: 100, text: "抽奖" },
    { username: "zero", followers: 0, text: "抽奖" },
    { username: "ghost", followers: null, text: "抽奖" },
    { username: "quiet", followers: 3, text: "不相关" },
  ];
  const pool = preparePool(raw, {
    keyword: "抽奖",
    excludeHandles: ["@johnwangbc", "grok"],
    excludeZeroFollowers: true,
  });
  assert.equal(pool.rawCount, 6);
  assert.equal(pool.dedupedCount, 5);
  assert.deepEqual(pool.eligible.map((entry) => entry.username), ["ann", "ghost"]);
  assert.equal(pool.eligible[0].text, "我要抽奖");
  assert.equal(pool.excludedByHandle, 1);
  assert.equal(pool.excludedByFollowers, 1);
  assert.equal(pool.excludedByKeyword, 1);
});

test("keeps accounts with unknown follower counts when the zero-follower filter is on", () => {
  const pool = preparePool(
    [
      { username: "zero", followers: 0, text: "a" },
      { username: "ghost", text: "b" },
      { username: "rich", followers: 10, text: "c" },
    ],
    { excludeZeroFollowers: true, keyword: "", excludeHandles: [] },
  );
  assert.deepEqual(pool.eligible.map((entry) => entry.username).sort(), ["ghost", "rich"]);
});

test("fisher-yates follows the injected random stream", () => {
  const seq = [2, 0, 1];
  let cursor = 0;
  const winners = pickWinners(
    ["a", "b", "c", "d"].map((username) => ({ username, name: "", followers: null, text: "" })),
    2,
    (max) => {
      const value = seq[cursor++] % max;
      return value;
    },
  );
  assert.deepEqual(winners.map((entry) => entry.username), ["d", "b"]);
});

test("crypto sampler stays inside the pool and does not repeat a person", () => {
  const pool = ["a", "b", "c", "d", "e"].map((username) => ({ username, name: "", followers: null, text: "" }));
  for (let i = 0; i < 30; i++) {
    const winners = pickWinners(pool, 3);
    const names = winners.map((entry) => entry.username);
    assert.equal(new Set(names).size, 3);
    for (const name of names) assert.ok(pool.some((entry) => entry.username === name));
  }
  assert.equal(secureRandomInt(1), 0);
  assert.throws(() => secureRandomInt(0), /positive integer/);
});

test("csv round-trips and the result text cites the draw", () => {
  const csv = toCSV([{ username: "li_ly", name: "李雷", followers: 0, text: "你好，世界" }]);
  const again = parseEntrantText(csv);
  assert.equal(again.entries[0].name, "李雷");
  assert.equal(again.entries[0].text, "你好，世界");
  assert.equal(again.entries[0].followers, 0);
  assert.match(csv, /^\uFEFF/);

  const text = buildResultText({
    drawnAt: new Date("2026-11-15T12:00:00Z"),
    winners: [{ username: "li_ly" }],
    rawCount: 4,
    dedupedCount: 3,
    eligibleCount: 2,
    excludedHandles: parseExcludeList("JohnWangbc grok"),
    excludeZeroFollowers: false,
    keyword: "",
    sourceUrl: "https://x.com/JohnWangbc/status/2121740234060906755",
    publicUrl: "https://AsynFish.github.io/lucky-draw/",
  });
  assert.match(text, /@li_ly\s+https:\/\/x\.com\/li_ly/);
  assert.match(text, /2026-11-15 20:00:00/);
  assert.match(text, /有效参与：2 人/);
  assert.match(text, /@JohnWangbc/);
  assert.equal(formatBeijing(new Date("2026-11-15T12:00:00Z")), "2026-11-15 20:00:00");
});

test("the page is Chinese, credits the host, and does not embed a token", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "..", "proxy", "src", "index.js"), "utf8");
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /by @JohnWangbc · 用 AI 搓的抽奖器/);
  assert.match(html, /https:\/\/x\.com\/JohnWangbc/);
  assert.match(html, /js\/core\.js/);
  assert.doesNotMatch(html + app, /X_BEARER_TOKEN|api\.x\.com/);
  assert.match(worker, /X_BEARER_TOKEN/);
  assert.doesNotMatch(worker, /Bearer [A-Za-z0-9]{20,}/);
});
