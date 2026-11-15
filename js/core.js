(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LuckyDraw = api;
})(globalThis, function () {
  "use strict";

  const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
  const HEADER_MAP = {
    username: "username",
    handle: "username",
    screen_name: "username",
    screenname: "username",
    user_name: "username",
    user: "username",
    author: "username",
    用户名: "username",
    账号: "username",
    帐号: "username",
    name: "name",
    display_name: "name",
    displayname: "name",
    nickname: "name",
    full_name: "name",
    昵称: "name",
    名字: "name",
    姓名: "name",
    followers: "followers",
    follower: "followers",
    followers_count: "followers",
    followerscount: "followers",
    follower_count: "followers",
    fans: "followers",
    粉丝: "followers",
    粉丝数: "followers",
    text: "text",
    tweet: "text",
    comment: "text",
    reply: "text",
    content: "text",
    full_text: "text",
    body: "text",
    评论: "text",
    内容: "text",
    文本: "text",
    推文: "text",
  };

  function normalizeHandle(raw) {
    let s = String(raw ?? "").trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s) || /(?:^|\/\/)(?:www\.)?(?:x|twitter|mobile\.twitter)\.com\//i.test(s)) {
      if (/\/status(?:es)?\/\d+/i.test(s)) return null;
      const match = s.match(/(?:x\.com|twitter\.com)\/@?([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/i);
      if (!match) return null;
      if (/^(i|intent|share|home|search|explore|hashtag)$/i.test(match[1])) return null;
      return match[1];
    }
    s = s.replace(/^@+/, "");
    const token = s.split(/\s+/)[0].replace(/[，,;；。]+$/g, "");
    const handle = token.replace(/^@+/, "");
    if (!HANDLE.test(handle)) return null;
    return handle;
  }

  function parseFollowers(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0) return null;
      return Math.floor(value);
    }
    const s = String(value).trim().replace(/[,，\s]/g, "");
    if (!s || s === "-" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }

  function finalizeEntry(entry) {
    const username = normalizeHandle(entry && (entry.username || entry.handle || ""));
    if (!username) return null;
    return {
      username,
      name: String((entry && entry.name) || "").trim().slice(0, 80),
      followers: parseFollowers(entry ? entry.followers : null),
      text: String((entry && entry.text) || "").replace(/\s+/g, " ").trim().slice(0, 500),
    };
  }

  function parseTweetId(input) {
    const s = String(input ?? "").trim();
    if (!s) return null;
    if (/^\d{8,22}$/.test(s)) return s;
    const match = s.match(/(?:status|statuses)\/(\d{8,22})/i);
    return match ? match[1] : null;
  }

  function canonHeader(value) {
    const original = String(value ?? "").replace(/^\uFEFF/, "").trim();
    if (!original) return null;
    if (HEADER_MAP[original]) return HEADER_MAP[original];
    const key = original.toLowerCase().replace(/\s+/g, "_");
    return HEADER_MAP[key] || null;
  }

  function detectDelimiter(line) {
    const counts = { ",": 0, "\t": 0, ";": 0 };
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          i += 1;
          continue;
        }
        inQuotes = !inQuotes;
      } else if (!inQuotes && Object.prototype.hasOwnProperty.call(counts, c)) {
        counts[c] += 1;
      }
    }
    let best = "";
    let n = 0;
    for (const delimiter of [",", "\t", ";"]) {
      if (counts[delimiter] > n) {
        best = delimiter;
        n = counts[delimiter];
      }
    }
    return best;
  }

  function parseRows(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cell += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c !== "\r") {
        cell += c;
      }
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function lineToEntrant(line) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    const handle = normalizeHandle(trimmed);
    if (!handle) return null;
    let text = "";
    if (!/^https?:\/\//i.test(trimmed)) {
      const body = trimmed.replace(/^@+/, "");
      const space = body.search(/\s/);
      if (space > 0) text = body.slice(space + 1).trim();
    }
    return finalizeEntry({ username: handle, name: "", followers: null, text });
  }

  function parseDelimited(text) {
    const source = String(text ?? "").replace(/^\uFEFF/, "");
    const firstLine = source.split(/\r?\n/).find((line) => line.trim()) || "";
    const delimiter = detectDelimiter(firstLine) || ",";
    let records = parseRows(source, delimiter).filter((row) => row.some((cell) => String(cell).trim() !== ""));
    if (records.length && /^sep\s*=\s*.$/i.test(String(records[0][0]).trim()) && records[0].length === 1) {
      records = records.slice(1);
    }
    if (!records.length) return { entries: [], skipped: 0 };
    const mapped = records[0].map(canonHeader);
    const known = mapped.filter(Boolean);
    const hasHeader = mapped.includes("username") || known.length >= 2;
    let start = 0;
    const index = { username: 0, name: 1, followers: 2, text: 3 };
    if (hasHeader) {
      start = 1;
      index.username = -1;
      index.name = -1;
      index.followers = -1;
      index.text = -1;
      mapped.forEach((field, i) => {
        if (field && index[field] < 0) index[field] = i;
      });
      if (index.username < 0) {
        return { entries: [], skipped: Math.max(0, records.length - 1), error: "missing-username-column" };
      }
    }
    const entries = [];
    let skipped = 0;
    for (const row of records.slice(start)) {
      const entry = finalizeEntry({
        username: index.username >= 0 ? row[index.username] : "",
        name: index.name >= 0 ? row[index.name] : "",
        followers: index.followers >= 0 ? row[index.followers] : null,
        text: index.text >= 0 ? row[index.text] : "",
      });
      if (!entry) skipped += 1;
      else entries.push(entry);
    }
    return { entries, skipped };
  }

  function parseEntrantText(text) {
    const cleaned = String(text ?? "").replace(/^\uFEFF/, "");
    const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    if (!lines.length) return { entries: [], skipped: 0 };
    const delimiter = detectDelimiter(lines[0]);
    if (delimiter) {
      const delimited = lines.filter((line) => line.includes(delimiter)).length;
      if (delimited >= Math.ceil(lines.length * 0.5)) return parseDelimited(cleaned);
    }
    const entries = [];
    let skipped = 0;
    for (const line of lines) {
      const entry = lineToEntrant(line);
      if (!entry) skipped += 1;
      else entries.push(entry);
    }
    return { entries, skipped };
  }

  function collectObjects(list) {
    const entries = [];
    let skipped = 0;
    for (const item of list) {
      if (typeof item === "string") {
        const entry = lineToEntrant(item);
        if (entry) entries.push(entry);
        else skipped += 1;
        continue;
      }
      if (!item || typeof item !== "object") {
        skipped += 1;
        continue;
      }
      const metrics = item.public_metrics || {};
      const entry = finalizeEntry({
        username: item.username || item.handle || item.screen_name || item.screenName || item.user_name || item.user || "",
        name: item.name || item.display_name || item.displayName || item.nickname || "",
        followers: item.followers ?? item.followers_count ?? item.followersCount ?? item.follower_count ?? metrics.followers_count ?? item.fans,
        text: item.text ?? item.tweet ?? item.comment ?? item.reply ?? item.content ?? item.full_text ?? "",
      });
      if (!entry) skipped += 1;
      else entries.push(entry);
    }
    return { entries, skipped };
  }

  function fromTwitterPayload(data) {
    const users = new Map(((data.includes && data.includes.users) || []).map((user) => [user.id, user]));
    if (!users.size) return null;
    const entries = [];
    let skipped = 0;
    for (const tweet of data.data || []) {
      const user = users.get(tweet.author_id) || {};
      const entry = finalizeEntry({
        username: user.username || "",
        name: user.name || "",
        followers: user.public_metrics ? user.public_metrics.followers_count : null,
        text: tweet.text || "",
      });
      if (!entry) skipped += 1;
      else entries.push(entry);
    }
    return { entries, skipped };
  }

  function normalizeJSON(data) {
    if (Array.isArray(data)) {
      if (data.every((item) => typeof item === "string")) return parseEntrantText(data.join("\n"));
      return collectObjects(data);
    }
    if (data && typeof data === "object") {
      if (Array.isArray(data.replies)) return collectObjects(data.replies);
      if (Array.isArray(data.entries)) return collectObjects(data.entries);
      if (Array.isArray(data.users) && !Array.isArray(data.data)) return collectObjects(data.users);
      if (Array.isArray(data.data)) {
        const twitter = fromTwitterPayload(data);
        if (twitter) return twitter;
        return collectObjects(data.data);
      }
    }
    return { entries: [], skipped: 0 };
  }

  function parseJSON(text) {
    let data;
    try {
      data = JSON.parse(String(text ?? "").replace(/^\uFEFF/, ""));
    } catch (error) {
      const wrapped = new Error("bad-json");
      wrapped.cause = error;
      throw wrapped;
    }
    return normalizeJSON(data);
  }

  function parsePayload(data) {
    if (typeof data === "string") {
      const trimmed = data.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJSON(trimmed);
      return parseEntrantText(data);
    }
    return normalizeJSON(data);
  }

  function parseExcludeList(text) {
    const seen = new Set();
    const handles = [];
    for (const part of String(text ?? "").split(/[\s,，;；]+/)) {
      const handle = normalizeHandle(part);
      if (!handle) continue;
      const key = handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      handles.push(handle);
    }
    return handles;
  }

  function scoreEntry(entry) {
    let score = 0;
    if (entry.name) score += 4;
    if (entry.followers !== null) score += 4;
    if (entry.text) score += 2 + Math.min(entry.text.length, 80) / 80;
    return score;
  }

  function pickRepresentative(group, keyword) {
    let pool = group;
    if (keyword) {
      const matched = group.filter((entry) => entry.text.toLowerCase().includes(keyword));
      if (matched.length) pool = matched;
    }
    let best = pool[0];
    let bestScore = scoreEntry(best);
    for (let i = 1; i < pool.length; i++) {
      const next = scoreEntry(pool[i]);
      if (next > bestScore) {
        best = pool[i];
        bestScore = next;
      }
    }
    return {
      username: best.username,
      name: best.name,
      followers: best.followers,
      text: best.text,
    };
  }

  function preparePool(rawEntries, options) {
    const settings = options || {};
    const keyword = String(settings.keyword || "").trim().toLowerCase();
    const exclude = new Set(parseExcludeList((settings.excludeHandles || []).join("\n")).map((handle) => handle.toLowerCase()));
    const groups = new Map();
    let rawCount = 0;
    for (const item of rawEntries || []) {
      const entry = finalizeEntry(item || {});
      if (!entry) continue;
      rawCount += 1;
      const key = entry.username.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const deduped = [];
    for (const group of groups.values()) deduped.push(pickRepresentative(group, keyword));
    let excludedByHandle = 0;
    let excludedByFollowers = 0;
    let excludedByKeyword = 0;
    const eligible = [];
    for (const entry of deduped) {
      if (exclude.has(entry.username.toLowerCase())) {
        excludedByHandle += 1;
        continue;
      }
      if (settings.excludeZeroFollowers && entry.followers === 0) {
        excludedByFollowers += 1;
        continue;
      }
      if (keyword && !entry.text.toLowerCase().includes(keyword)) {
        excludedByKeyword += 1;
        continue;
      }
      eligible.push(entry);
    }
    return {
      rawCount,
      dedupedCount: deduped.length,
      eligibleCount: eligible.length,
      eligible,
      excludedByHandle,
      excludedByFollowers,
      excludedByKeyword,
    };
  }

  function secureRandomInt(max) {
    if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) {
      throw new Error("max must be a positive integer up to 2^32");
    }
    if (max === 1) return 0;
    const range = 0x100000000;
    const limit = range - (range % max);
    const buf = new Uint32Array(1);
    let value = 0;
    do {
      crypto.getRandomValues(buf);
      value = buf[0];
    } while (value >= limit);
    return value % max;
  }

  // Fisher–Yates with an unbiased integer. Winners are a simple random sample:
  // each subset of the requested size is equally likely, and so is each order.
  function pickWinners(entrants, count, rng) {
    const random = rng || secureRandomInt;
    const pool = (entrants || []).slice();
    const n = Math.min(pool.length, Math.max(0, count | 0));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = random(i + 1);
      if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("rng out of range");
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, n).map((entry) => ({
      username: entry.username,
      name: entry.name,
      followers: entry.followers,
      text: entry.text,
    }));
  }

  function csvCell(value) {
    const text = String(value ?? "").replace(/\r?\n/g, " ");
    if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function toCSV(list) {
    const rows = [["username", "profile_url", "name", "followers", "text"]];
    for (const entry of list || []) {
      rows.push([
        entry.username,
        `https://x.com/${entry.username}`,
        entry.name || "",
        entry.followers === null || entry.followers === undefined ? "" : String(entry.followers),
        entry.text || "",
      ]);
    }
    return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  }

  function formatBeijing(date) {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      numberingSystem: "latn",
    }).formatToParts(date);
    const get = (type) => {
      const part = parts.find((item) => item.type === type);
      return part ? part.value : "00";
    };
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
  }

  function buildResultText(info) {
    const winners = info.winners || [];
    const lines = [
      "🎉 咸鱼抽奖结果",
      `时间：${formatBeijing(info.drawnAt instanceof Date ? info.drawnAt : new Date(info.drawnAt))}（北京时间）`,
      `有效参与：${info.eligibleCount} 人（原始 ${info.rawCount}，去重后 ${info.dedupedCount}）`,
      `中奖：${winners.length} 人`,
      "",
    ];
    winners.forEach((winner, index) => {
      lines.push(`${index + 1}. @${winner.username}  https://x.com/${winner.username}`);
    });
    lines.push("");
    const rules = ["按用户名去重，一人一条"];
    if (info.excludedHandles && info.excludedHandles.length) {
      rules.push(`已排除 ${info.excludedHandles.map((handle) => `@${handle}`).join(" ")}`);
    }
    if (info.excludeZeroFollowers) rules.push("已去掉粉丝数为 0 的账号");
    if (info.keyword) rules.push(`评论需包含「${String(info.keyword).replace(/\s+/g, " ").slice(0, 40)}」`);
    lines.push(`${rules.join("。")}。`);
    lines.push("用 crypto.getRandomValues 抽样，动画只回放已经抽出的结果。");
    if (info.sourceUrl) lines.push(`来源：${info.sourceUrl}`);
    if (info.publicUrl) lines.push(`抽奖器：${info.publicUrl}`);
    return lines.join("\n");
  }

  return {
    normalizeHandle,
    parseFollowers,
    parseTweetId,
    parseEntrantText,
    parseJSON,
    parsePayload,
    parseExcludeList,
    preparePool,
    secureRandomInt,
    pickWinners,
    toCSV,
    formatBeijing,
    buildResultText,
  };
});
