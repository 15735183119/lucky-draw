(function () {
  "use strict";

  const PUBLIC_URL = "https://AsynFish.github.io/lucky-draw/";
  const SETTINGS_KEY = "xianyu-draw-settings-v1";
  const SESSION_KEY = "xianyu-draw-session-v1";
  const MAX_PAGES = 20;
  const PAGE_BUDGET_MS = 45000;

  const state = {
    entries: [],
    result: null,
    drawing: false,
  };

  let fetchAbort = null;

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    if (tag === "button") node.type = "button";
    return node;
  }

  function loadJSON(storage, key) {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch (error) {
      return null;
    }
  }

  function saveSettings() {
    const data = {
      exclude: $("exclude").value,
      keyword: $("keyword").value,
      zero: $("zero-followers").checked,
      winners: $("winner-count").value,
      sourceUrl: $("source-url").value,
      proxyUrl: $("proxy-url").value.trim(),
      drawKey: $("draw-key").value,
      skip: $("skip-anim").checked,
      append: $("append-fetch").checked,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch (error) {
      /* private mode or a full disk */
    }
  }

  function persist() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        entries: state.entries,
        result: state.result,
      }));
    } catch (error) {
      /* the draw still works for this page view */
    }
  }

  function setMsg(id, text, kind) {
    const node = $(id);
    node.textContent = text || "";
    node.classList.toggle("ok", kind === "ok");
    node.classList.toggle("err", kind === "err");
  }

  function setTab(name) {
    const link = name === "link";
    $("panel-import").hidden = link;
    $("panel-link").hidden = !link;
    $("tab-import").setAttribute("aria-selected", String(!link));
    $("tab-link").setAttribute("aria-selected", String(link));
    $("tab-import").classList.toggle("is-on", !link);
    $("tab-link").classList.toggle("is-on", link);
  }

  function poolOptions() {
    return {
      keyword: $("keyword").value,
      excludeHandles: [$("exclude").value],
      excludeZeroFollowers: $("zero-followers").checked,
    };
  }

  function currentPrepared() {
    return LuckyDraw.preparePool(state.entries, poolOptions());
  }

  function readCount() {
    const n = Math.floor(Number($("winner-count").value));
    if (!Number.isFinite(n) || n < 1) return 1;
    return n;
  }

  function desiredCount(eligible) {
    let n = readCount();
    if (n > 50) n = 50;
    if (eligible > 0) n = Math.min(n, eligible);
    return n;
  }

  function renderPerson(entry) {
    const row = el("div", "person");
    const who = el("div", "who");
    const handle = el("span", "handle", `@${entry.username}`);
    handle.translate = false;
    who.append(handle);
    if (entry.name) who.append(el("span", "disp", entry.name));
    const meta = el("div", "meta", entry.followers === null ? "粉丝未知" : `${entry.followers.toLocaleString("zh-CN")} 粉`);
    row.append(who, meta);
    if (entry.text) row.append(el("p", "snippet", entry.text));
    return row;
  }

  function renderPool() {
    const prepared = currentPrepared();
    $("stat-raw").textContent = String(prepared.rawCount);
    $("stat-dedup").textContent = String(prepared.dedupedCount);
    $("stat-final").textContent = String(prepared.eligibleCount);

    const bits = [];
    const dupes = prepared.rawCount - prepared.dedupedCount;
    if (dupes > 0) bits.push(`去掉重复 ${dupes}`);
    if (prepared.excludedByHandle) bits.push(`排除账号 ${prepared.excludedByHandle}`);
    if (prepared.excludedByFollowers) bits.push(`去掉 0 粉 ${prepared.excludedByFollowers}`);
    if (prepared.excludedByKeyword) bits.push(`不含关键词 ${prepared.excludedByKeyword}`);
    $("stat-detail").textContent = bits.length ? bits.join(" · ") : (prepared.rawCount ? "每人只保留一条。" : "还没有名单。");

    const count = desiredCount(prepared.eligibleCount);
    $("odds").textContent = prepared.eligibleCount > 0
      ? `每位被抽中的概率相同：${count}/${prepared.eligibleCount}。`
      : "没有可抽取的人。";

    $("draw-btn").disabled = state.drawing || prepared.eligibleCount < 1;
    $("export-btn").disabled = prepared.eligibleCount < 1;
    $("winner-count").max = String(Math.max(1, Math.min(50, prepared.eligibleCount || 50)));

    const preview = $("preview");
    preview.replaceChildren();
    const shown = prepared.eligible.slice(0, 60);
    if (!shown.length) {
      preview.append(el("p", "empty", prepared.rawCount ? "筛选之后没有人了。放宽条件再抽。" : "名单还是空的。"));
    } else {
      for (const entry of shown) preview.append(renderPerson(entry));
    }
    const rest = prepared.eligibleCount - shown.length;
    $("preview-more").textContent = rest > 0 ? `还有 ${rest} 人没列出来，抽奖仍会算上他们。` : "";
    return prepared;
  }

  function addParsed(parsed, okText) {
    if (parsed.error === "missing-username-column") {
      setMsg("import-msg", "表头里没有用户名列。需要 username、handle 或「用户名」其中一列。", "err");
      return;
    }
    if (!parsed.entries.length) {
      setMsg("import-msg", "没有认出用户名。一行一个，可以带 @，也可以贴主页链接。", "err");
      return;
    }
    state.entries = state.entries.concat(parsed.entries);
    persist();
    renderPool();
    const skip = parsed.skipped ? `，跳过 ${parsed.skipped} 行` : "";
    setMsg("import-msg", `${okText}${parsed.entries.length} 条${skip}。重复的人会在去重时合成一条。`, "ok");
  }

  function addPaste() {
    const parsed = LuckyDraw.parseEntrantText($("paste").value);
    if (parsed.entries.length) $("paste").value = "";
    addParsed(parsed, "已加入 ");
  }

  async function handleFile(file) {
    if (!file) return;
    let text = "";
    try {
      text = await file.text();
    } catch (error) {
      setMsg("import-msg", "这个文件读不了。", "err");
      return;
    }
    const name = (file.name || "").toLowerCase();
    let parsed;
    try {
      if (name.endsWith(".json") || /^\s*[[{]/.test(text)) parsed = LuckyDraw.parseJSON(text);
      else parsed = LuckyDraw.parseEntrantText(text);
    } catch (error) {
      setMsg("import-msg", "这个 JSON 解析失败。请确认是 UTF-8 的数组或对象。", "err");
      return;
    }
    addParsed(parsed, `已从 ${file.name || "文件"} 加入 `);
  }

  function clearAll() {
    if (!state.entries.length && !state.result) return;
    if (!window.confirm("清空当前名单？这个标签页里的参与者和上一轮结果会被删掉。")) return;
    state.entries = [];
    state.result = null;
    persist();
    renderPool();
    renderResult(false);
    setMsg("import-msg", "名单已清空。", "ok");
  }

  function validateProxy(value) {
    const text = String(value || "").trim();
    if (!text) return { error: "empty" };
    let url;
    try {
      url = new URL(text);
    } catch (error) {
      return { error: "bad" };
    }
    if (url.username || url.password) return { error: "creds" };
    const host = url.hostname;
    const local = host === "localhost" || host === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return { url };
    return { error: "https" };
  }

  function messageFor(code) {
    switch (code) {
      case "missing_token":
        return "代理还没配 X 的 Token。请改用「导入」。";
      case "unauthorized":
        return "代理里的 Token 无效。请改用「导入」。";
      case "forbidden":
        return "这个 Token 没有搜索回复的权限。请改用「导入」。";
      case "payment_required":
        return "这个 X 开发者账号没有可用的搜索额度。请改用「导入」。";
      case "rate_limited":
        return "X 接口限流了。稍后再试，或改用「导入」。";
      case "bad_key":
        return "访问密钥不对。代理没设密钥就留空；设了就要填同一串。也可以改用「导入」。";
      case "invalid_id":
        return "帖子 ID 无效。请改用「导入」。";
      case "origin_not_allowed":
        return "代理没有放行这个网页。请改用「导入」，或把本站来源加进 Worker。";
      default:
        return "拉取失败。请改用「导入」，把名单贴进来。";
    }
  }

  function canonicalStatus(raw, id) {
    const text = String(raw || "").trim();
    try {
      const url = new URL(text);
      const host = url.hostname.replace(/^www\./, "");
      if (/^(x\.com|twitter\.com|mobile\.twitter\.com)$/i.test(host) && LuckyDraw.parseTweetId(text) === id) {
        url.hash = "";
        url.search = "";
        return url.toString();
      }
    } catch (error) {
      /* use the canonical status url */
    }
    return `https://x.com/i/status/${id}`;
  }

  function cleanSourceUrl(value) {
    const id = LuckyDraw.parseTweetId(value);
    if (!id) return "";
    return canonicalStatus(value, id);
  }

  async function fetchReplies() {
    const rawUrl = $("tweet-url").value;
    const id = LuckyDraw.parseTweetId(rawUrl);
    if (!id) {
      setMsg("link-msg", "认不出这条链接。请贴 x.com 或 twitter.com 的帖子链接，或一串帖子编号。", "err");
      return;
    }
    const proxy = validateProxy($("proxy-url").value);
    if (proxy.error === "empty") {
      setMsg("link-msg", "还没填写代理地址。浏览器过不去 X 的跨域限制，也不能把 Token 放在网页里。请先按 README 部署代理，或改用「导入」。", "err");
      return;
    }
    if (proxy.error === "creds") {
      setMsg("link-msg", "不要把 Token 写在网址里。地址只填代理的 https 链接，或改用「导入」。", "err");
      return;
    }
    if (proxy.error) {
      setMsg("link-msg", "代理地址需要是 https。只有本机调试可以用 http://127.0.0.1。没配好就改用「导入」。", "err");
      return;
    }

    saveSettings();
    if (fetchAbort) fetchAbort.abort();
    const controller = new AbortController();
    fetchAbort = controller;
    const button = $("fetch-replies");
    button.disabled = true;
    const key = $("draw-key").value;
    const collected = [];
    let pages = 0;
    let cursor = "";
    let truncated = false;
    let partial = false;
    const started = Date.now();

    try {
      while (pages < MAX_PAGES) {
        if (Date.now() - started > PAGE_BUDGET_MS) {
          truncated = true;
          break;
        }
        const endpoint = new URL(proxy.url);
        endpoint.searchParams.set("id", id);
        if (cursor) endpoint.searchParams.set("cursor", cursor);
        const headers = { Accept: "application/json" };
        if (key) headers["X-Draw-Key"] = key;
        let response;
        try {
          response = await fetch(endpoint, { headers, cache: "no-store", signal: controller.signal });
        } catch (error) {
          if (error && error.name === "AbortError") throw error;
          if (pages === 0) {
            setMsg("link-msg", "没连上代理。请检查地址是否可访问，或改用「导入」。", "err");
            return;
          }
          partial = true;
          break;
        }
        let data = null;
        try {
          data = await response.json();
        } catch (error) {
          data = null;
        }
        if (!response.ok || !data || data.error) {
          if (pages === 0) {
            setMsg("link-msg", messageFor(data && data.error), "err");
            return;
          }
          partial = true;
          break;
        }
        const parsed = LuckyDraw.parsePayload({ replies: data.replies || [] });
        collected.push.apply(collected, parsed.entries);
        pages += 1;
        setMsg("link-msg", `正在拉取…已得到 ${collected.length} 条回复`, "ok");
        cursor = data.next_cursor || "";
        if (!cursor) break;
      }
      if (cursor) truncated = true;
      if (!collected.length) {
        setMsg("link-msg", "这条帖子下面没有拉到回复。超过 7 天的帖、或 Token 没有搜索权限，都会这样。请改用「导入」。", "err");
        return;
      }
      if ($("append-fetch").checked) state.entries = state.entries.concat(collected);
      else state.entries = collected;
      $("source-url").value = canonicalStatus(rawUrl, id);
      saveSettings();
      persist();
      renderPool();
      const tail = truncated || partial ? "后面可能还有，这次先用已拉到的名单。" : "可以筛选后开奖。";
      const verb = $("append-fetch").checked ? "追加" : "放入";
      setMsg("link-msg", `已${verb} ${collected.length} 条回复。${tail}`, "ok");
    } catch (error) {
      if (!(error && error.name === "AbortError")) {
        setMsg("link-msg", "拉取失败。请改用「导入」，把名单贴进来。", "err");
      }
    } finally {
      button.disabled = false;
      if (fetchAbort === controller) fetchAbort = null;
    }
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportList(list) {
    if (!list || !list.length) return;
    const stamp = LuckyDraw.formatBeijing(new Date()).replace(/\D/g, "");
    download(`xianyu-entrants-${stamp}.csv`, LuckyDraw.toCSV(list));
  }

  function wantsSkip() {
    return $("skip-anim").checked || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function spinDuration(count, skip) {
    if (skip) return 180;
    if (count > 20) return 420;
    if (count > 8) return 1100;
    return 3200;
  }

  function buildSequence(pool, winner, spins) {
    const seq = [];
    const others = pool.filter((entry) => entry.username.toLowerCase() !== winner.username.toLowerCase());
    const source = others.length ? others : pool;
    let last = "";
    for (let i = 0; i < spins; i++) {
      let pick = source[LuckyDraw.secureRandomInt(source.length)];
      let guard = 0;
      while (source.length > 1 && pick.username === last && guard < 5) {
        pick = source[LuckyDraw.secureRandomInt(source.length)];
        guard += 1;
      }
      seq.push(pick);
      last = pick.username;
    }
    seq.push(winner);
    return seq;
  }

  function onceTransition(node) {
    return new Promise((resolve) => {
      const done = (event) => {
        if (event.propertyName && event.propertyName !== "transform") return;
        node.removeEventListener("transitionend", done);
        resolve();
      };
      node.addEventListener("transitionend", done);
    });
  }

  function spin(track, seq, height, duration) {
    track.replaceChildren();
    for (const entry of seq) {
      const item = document.createElement("div");
      item.className = "reel-item";
      item.style.height = `${height}px`;
      const handle = el("span", "reel-handle", `@${entry.username}`);
      handle.translate = false;
      item.append(handle);
      if (entry.name) item.append(el("span", "reel-sub", entry.name));
      track.append(item);
    }
    track.style.transition = "none";
    track.style.transform = "translateY(0px)";
    void track.offsetWidth;
    if (seq.length < 2 || duration <= 0) return wait(160);
    track.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.72, 0.08, 1)`;
    track.style.transform = `translateY(-${(seq.length - 1) * height}px)`;
    return Promise.race([onceTransition(track), wait(duration + 180)]);
  }

  function burst() {
    const canvas = $("confetti");
    const host = $("stage-card");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const colors = ["#6ef3c5", "#ffc56b", "#ff7a6e", "#f4fff9", "#9ad7ff"];
    const parts = Array.from({ length: 64 }, () => ({
      x: canvas.width * 0.5,
      y: canvas.height * 0.42,
      vx: (Math.random() - 0.5) * 11 * dpr,
      vy: (-Math.random() * 9 - 3) * dpr,
      g: 0.22 * dpr,
      w: (3 + Math.random() * 5) * dpr,
      h: (2 + Math.random() * 4) * dpr,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const started = performance.now();
    function frame(now) {
      const t = (now - started) / 1300;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts.forEach((part) => {
        part.x += part.vx;
        part.y += part.vy;
        part.vy += part.g;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.fillStyle = part.color;
        ctx.fillRect(part.x, part.y, part.w, part.h);
      });
      if (t < 1) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(frame);
  }

  async function playDraw(winners, pool) {
    const stage = $("stage");
    const track = $("reel-track");
    const reel = $("reel-window");
    const pinned = $("pinned");
    stage.hidden = false;
    pinned.replaceChildren();
    track.replaceChildren();
    reel.classList.remove("is-locked");
    $("stage-card").focus();
    await nextFrame();
    const height = reel.clientHeight || 118;
    const skip = wantsSkip();
    const duration = spinDuration(winners.length, skip);
    const spins = skip ? 0 : (duration > 2000 ? 32 : duration > 800 ? 16 : 8);
    for (let index = 0; index < winners.length; index++) {
      $("stage-kicker").textContent = `第 ${index + 1} / ${winners.length} 位`;
      $("stage-title").textContent = "正在滚动";
      reel.classList.remove("is-locked");
      const seq = buildSequence(pool, winners[index], spins);
      await spin(track, seq, height, seq.length < 2 ? 0 : duration);
      reel.classList.add("is-locked");
      $("stage-title").textContent = "锁定";
      $("live").textContent = `第 ${index + 1} 位：@${winners[index].username}`;
      const item = el("li", null, `${index + 1}. @${winners[index].username}`);
      item.translate = false;
      pinned.append(item);
      if (!skip && (winners.length <= 5 || index === winners.length - 1)) burst();
      await wait(skip ? 90 : 520);
    }
    await wait(skip ? 40 : 700);
  }

  async function startDraw() {
    if (state.drawing) return;
    state.drawing = true;
    $("draw-btn").disabled = true;
    let completed = false;
    try {
      const prepared = currentPrepared();
      if (!prepared.eligibleCount) {
        setMsg("draw-msg", "没有可抽取的人。", "err");
        return;
      }
      const typed = readCount();
      const count = desiredCount(prepared.eligibleCount);
      $("winner-count").value = String(count);
      if (typed > 50) setMsg("draw-msg", "单次最多 50 人，已按 50 人抽。人很多可以勾选跳过动画。", "ok");
      else setMsg("draw-msg", "", "");
      saveSettings();

      const pool = prepared.eligible.map((entry) => ({ ...entry }));
      let winners;
      try {
        winners = LuckyDraw.pickWinners(pool, count);
      } catch (error) {
        setMsg("draw-msg", "这台浏览器没有可用的加密随机数，这次没有开奖。请换最新版 Chrome、Safari 或 Firefox。", "err");
        return;
      }
      if (winners.length !== count) {
        setMsg("draw-msg", "抽取失败，没有产生结果。", "err");
        return;
      }

      const result = {
        drawnAt: new Date().toISOString(),
        winners,
        pool,
        rawCount: prepared.rawCount,
        dedupedCount: prepared.dedupedCount,
        eligibleCount: prepared.eligibleCount,
        sourceUrl: cleanSourceUrl($("source-url").value),
        keyword: $("keyword").value.trim(),
        excludedHandles: LuckyDraw.parseExcludeList($("exclude").value),
        excludeZeroFollowers: $("zero-followers").checked,
        publicUrl: PUBLIC_URL,
      };
      result.text = LuckyDraw.buildResultText({ ...result, drawnAt: new Date(result.drawnAt) });
      state.result = result;
      persist();
      completed = true;
      document.body.classList.add("is-drawing");
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      await playDraw(winners, pool);
    } finally {
      state.drawing = false;
      document.body.classList.remove("is-drawing");
      $("stage").hidden = true;
      renderPool();
      if (completed) renderResult(true);
    }
  }

  function safeTime(iso) {
    try {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "";
      return LuckyDraw.formatBeijing(date);
    } catch (error) {
      return "";
    }
  }

  async function copyText(area, button) {
    const text = area.value;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (error) {
      area.focus();
      area.select();
      try {
        ok = document.execCommand("copy");
      } catch (copyError) {
        ok = false;
      }
    }
    button.textContent = ok ? "已复制" : "请手动复制";
    setTimeout(() => {
      button.textContent = "复制结果文案";
    }, 1800);
  }

  function renderResult(scroll) {
    const section = $("result");
    const result = state.result;
    if (!result || !result.winners || !result.winners.length) {
      section.hidden = true;
      section.replaceChildren();
      return;
    }
    section.hidden = false;
    section.replaceChildren();

    const head = el("div", "result-head");
    head.append(el("p", "eyebrow", "已开奖"));
    const title = el("h2", null, "盒子打开了");
    title.id = "result-title";
    head.append(title);
    const meta = `${safeTime(result.drawnAt)}（北京时间） · 有效参与 ${result.eligibleCount} 人 · 抽出 ${result.winners.length} 人`;
    head.append(el("p", "result-meta", meta));
    const counts = el("p", "hint", `原始 ${result.rawCount} · 去重后 ${result.dedupedCount} · 筛选后 ${result.eligibleCount}`);
    head.append(counts);
    section.append(head);
    section.setAttribute("aria-labelledby", "result-title");

    const list = document.createElement("ol");
    list.className = "winners";
    result.winners.forEach((winner, index) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.className = "winner";
      link.href = `https://x.com/${winner.username}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.dataset.testid = "winner";
      const rank = el("span", `rank rank-${Math.min(index + 1, 4)}`, String(index + 1).padStart(2, "0"));
      const body = el("span", "winner-body");
      const handle = el("span", "handle", `@${winner.username}`);
      handle.translate = false;
      body.append(handle);
      const bits = [];
      if (winner.name) bits.push(winner.name);
      if (winner.followers === 0) bits.push("0 粉");
      else if (typeof winner.followers === "number") bits.push(`${winner.followers.toLocaleString("zh-CN")} 粉`);
      if (bits.length) body.append(el("span", "disp", bits.join(" · ")));
      if (winner.text) body.append(el("span", "snippet", winner.text));
      link.append(rank, body, el("span", "go", "主页"));
      item.append(link);
      list.append(item);
    });
    section.append(list);

    if (result.sourceUrl) {
      const source = el("p", "hint", "来源：");
      const link = document.createElement("a");
      link.href = result.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = result.sourceUrl;
      source.append(link);
      section.append(source);
    }

    const label = el("label", "field", "结果文案（可以改完再复制）");
    label.htmlFor = "result-copy";
    const area = document.createElement("textarea");
    area.id = "result-copy";
    area.rows = 10;
    area.spellcheck = false;
    area.value = result.text || "";
    const fitArea = () => {
      area.style.height = "auto";
      const border = area.offsetHeight - area.clientHeight;
      const needed = area.scrollHeight + Math.max(0, border);
      const next = Math.min(needed, 560);
      area.style.height = `${next}px`;
      area.style.overflowY = needed > 560 ? "auto" : "hidden";
    };
    area.addEventListener("input", () => {
      if (state.result) {
        state.result.text = area.value;
        persist();
      }
      fitArea();
    });
    section.append(label, area);
    fitArea();

    const row = el("div", "row");
    const copy = el("button", "btn primary", "复制结果文案");
    copy.addEventListener("click", () => copyText(area, copy));
    const exp = el("button", "btn ghost", "导出本轮参与名单");
    exp.addEventListener("click", () => exportList(result.pool));
    const again = el("button", "btn ghost", "再抽一次");
    again.addEventListener("click", () => {
      if (!window.confirm("再抽一次会换成新的随机结果，刚才那次作废。确定吗？")) return;
      startDraw();
    });
    row.append(copy, exp, again);
    section.append(row);
    section.append(el("p", "hint", "刷新这个标签页不会重抽。名单和结果都只在这台浏览器里。"));

    if (scroll) section.scrollIntoView({ behavior: wantsSkip() ? "auto" : "smooth", block: "start" });
  }

  function sanitizeSession(session) {
    if (!session || typeof session !== "object") return;
    if (Array.isArray(session.entries)) {
      state.entries = LuckyDraw.parsePayload(session.entries).entries;
    }
    if (!session.result || !Array.isArray(session.result.winners)) return;
    const winners = LuckyDraw.parsePayload(session.result.winners).entries;
    const pool = LuckyDraw.parsePayload(session.result.pool || []).entries;
    if (!winners.length) return;
    state.result = {
      ...session.result,
      winners,
      pool,
      sourceUrl: cleanSourceUrl(session.result.sourceUrl || ""),
    };
  }

  function bind() {
    $("tab-import").addEventListener("click", () => setTab("import"));
    $("tab-link").addEventListener("click", () => setTab("link"));
    $("add-paste").addEventListener("click", addPaste);
    $("clear-all").addEventListener("click", clearAll);
    $("file").addEventListener("change", () => {
      const file = $("file").files && $("file").files[0];
      handleFile(file);
      $("file").value = "";
    });
    $("fetch-replies").addEventListener("click", fetchReplies);
    $("draw-btn").addEventListener("click", startDraw);
    $("export-btn").addEventListener("click", () => exportList(currentPrepared().eligible));
    $("minus").addEventListener("click", () => {
      $("winner-count").value = String(Math.max(1, readCount() - 1));
      saveSettings();
      renderPool();
    });
    $("plus").addEventListener("click", () => {
      const prepared = currentPrepared();
      const cap = prepared.eligibleCount > 0 ? Math.min(50, prepared.eligibleCount) : 50;
      $("winner-count").value = String(Math.min(cap, readCount() + 1));
      saveSettings();
      renderPool();
    });
    $("winner-count").addEventListener("input", renderPool);
    $("winner-count").addEventListener("blur", () => {
      const prepared = currentPrepared();
      $("winner-count").value = String(desiredCount(prepared.eligibleCount));
      saveSettings();
      renderPool();
    });
    $("winner-count").addEventListener("wheel", (event) => event.preventDefault(), { passive: false });

    ["exclude", "keyword", "source-url", "proxy-url", "tweet-url"].forEach((id) => {
      $(id).addEventListener("input", () => {
        saveSettings();
        if (id === "exclude" || id === "keyword") renderPool();
      });
    });
    ["zero-followers", "skip-anim", "append-fetch"].forEach((id) => {
      $(id).addEventListener("change", () => {
        saveSettings();
        if (id === "zero-followers") renderPool();
      });
    });
    $("draw-key").addEventListener("input", saveSettings);

    let dragDepth = 0;
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("dragenter", (event) => {
      const types = event.dataTransfer && event.dataTransfer.types ? Array.from(event.dataTransfer.types) : [];
      if (!types.includes("Files")) return;
      dragDepth += 1;
      $("panel-import").classList.add("is-drop");
    });
    window.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $("panel-import").classList.remove("is-drop");
    });
    window.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      $("panel-import").classList.remove("is-drop");
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) {
        setTab("import");
        handleFile(file);
      }
    });
  }

  function init() {
    if (!window.LuckyDraw) return;
    const cfg = window.LUCKY_DRAW_CONFIG || {};
    const saved = loadJSON(localStorage, SETTINGS_KEY) || {};
    $("exclude").value = Object.prototype.hasOwnProperty.call(saved, "exclude") ? saved.exclude : "JohnWangbc\ngrok";
    $("keyword").value = saved.keyword || "";
    $("zero-followers").checked = Boolean(saved.zero);
    $("winner-count").value = saved.winners || "1";
    $("source-url").value = saved.sourceUrl || "";
    $("proxy-url").value = Object.prototype.hasOwnProperty.call(saved, "proxyUrl") ? saved.proxyUrl : (cfg.proxyUrl || "");
    $("draw-key").value = Object.prototype.hasOwnProperty.call(saved, "drawKey") ? saved.drawKey : (cfg.drawKey || "");
    $("skip-anim").checked = Boolean(saved.skip);
    $("append-fetch").checked = Boolean(saved.append);
    sanitizeSession(loadJSON(sessionStorage, SESSION_KEY));
    bind();
    renderPool();
    renderResult(false);
  }

  init();
})();
