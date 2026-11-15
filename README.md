# 咸鱼抽奖

从 X 帖子的回复里抽奖。页面是简体中文，不用登录，导入的名单只留在你自己的浏览器里。

线上地址：<https://15735183119.github.io/lucky-draw/>

给 [@JohnWangbc](https://x.com/JohnWangbc)（薛定谔的咸鱼）现场用。公平性写在页面上：先用 `crypto.getRandomValues` 抽出结果，滚动动画只是把已经抽中的人演出来。

## 今晚最快怎么开奖

贴链接拉回复要先部署代理，还要有带搜索权限的 X Token。来不及就用导入，一样能抽。

1. 打开上面的网址（仓库要先按下面「部署到 GitHub Pages」合并并打开 Pages）。
2. 停在「导入」。把参与者贴进文本框，一行一个，点「加入名单」。或者上传 CSV / JSON。
3. 「排除这些账号」里已经写了 `JohnWangbc` 和 `grok`，按需要改。
4. 右边看三个数：原始、去重后、筛选后。选出中奖人数，点「开始抽奖」。
5. 动画结束后，复制结果文案发回帖子下面，再点「导出本轮参与名单」把这一轮的名单存下来。

正式开奖前，先用几个人名彩排一遍。结果保存在这个标签页里，刷新不会重抽。换一轮要点「再抽一次」。

来源帖可以填在「来源帖」里，会写进结果文案。今晚这场是：

`https://x.com/JohnWangbc/status/2121740234060906755`

## 页面上有什么

- **导入**：粘贴或上传。格式见页面里的「支持的格式」，下面也有一份。
- **贴帖子链接**：有代理之后，粘贴 `x.com` / `twitter.com` 的帖子链接，拉取这条帖子的回复。
- **筛选**：按用户名去重（一个人只留一条）；可排除指定账号；可去掉粉丝数为 0 的账号（没有粉丝数的会留下）；可要求评论里包含某段文字。
- **开抽**：1 到 50 人。抽样没有放回、没有加权。人数一多，动画会自动加快，也可以勾选「跳过滚动动画」。
- **结果**：中奖者链到其 X 主页，带北京时间、人数，文案可以改完再复制。导出的 CSV 是这一轮真正参与抽奖的名单，方便公开核对。

系统开了「减少动态效果」时，滚动会缩短。

## 导入格式

纯文本，一行一个：

```text
@alice
bob
https://x.com/carol
dave 算我一个
```

`#` 开头是注释。行尾多出来的字会当成评论。帖子链接不会被当成用户名。

CSV / TSV（逗号、制表符或分号）。表头可以用：

| 含义 | 认这些名字 |
| --- | --- |
| 用户名（必须有，除非文件没有表头） | `username` `handle` `screen_name` `用户名` `账号` |
| 昵称 | `name` `昵称` |
| 粉丝数 | `followers` `followers_count` `粉丝数` |
| 评论 | `text` `评论` `内容` |

没有表头时按「用户名, 昵称, 粉丝数, 评论」读。只有一列就全是用户名。

JSON：

```json
["alice", "bob"]
```

```json
[{"username": "alice", "name": "爱丽丝", "followers": 10, "text": "算我一个"}]
```

```json
{"replies": [{"username": "alice", "followers": 10, "text": "算我一个"}]}
```

也认 X 接口那种 `{ "data": [...], "includes": { "users": [...] } }`。请用 UTF-8。导出的 CSV 带 BOM，Excel 能直接打开中文。

## 部署到 GitHub Pages

静态页面，没有后端。导入这条路不需要服务器。

仓库所有者要做一次设置，否则工作流不会发布：

1. 把本分支的 PR 合并进 `main`。
2. 打开仓库 **Settings → Pages → Build and deployment**。
3. **Source 选 GitHub Actions**（不要选 Deploy from a branch）。
4. 到 **Actions** 看 “Deploy GitHub Pages”。变绿之后打开 <https://15735183119.github.io/lucky-draw/> 。
5. 如果提示 `github-pages` 环境要批准，点 **Approve and deploy**。
6. 免费的 GitHub Pages 要求仓库是 **Public**。

工作流在 `.github/workflows/pages.yml`，只在推到 `main` 时发布 `index.html`、`styles.css` 和 `js/`。代理代码不会放到网页上。

本地先看：

```bash
python3 -m http.server 4173
```

浏览器打开 <http://127.0.0.1:4173/> 。

## 贴帖子链接：为什么要代理，怎么装

浏览器调用 X API 会被跨域拦住，而且 Bearer Token 一旦写进网页，所有打开页面的人都能看见。所以链接模式走一个你自己部署的 Cloudflare Worker：网页只把帖子编号发给它，Token 放在 Cloudflare 的 Secret 里。

没配代理，或拉取失败时，页面会提示改用「导入」。导入不依赖这一节。

选 Cloudflare Worker 是因为：免费额度够一场直播，可以存 Secret，能自己加 CORS，仓库里不用放任何密钥。GitHub Pages 本身不能藏 Token，也不能代你去请求 X。

Worker 做的事：`GET /?id=帖子编号`，向 X 的 recent search 查 `conversation_id:编号 is:reply -is:retweet`，一页最多 100 条。网页会自己翻页，大约 45 秒或 2000 条为止。返回用户名、昵称、粉丝数和评论。

限制要知道：

- 只能拿到**最近 7 天**的公开回复。今晚这篇帖在 7 天以内。更早的帖子请用导入。
- 楼中楼也算这条帖子的回复。转帖和引用不算。
- X 的**免费开发者套餐通常没有 recent search**。需要能调用 `GET /2/tweets/search/recent` 的 Bearer Token（Basic 或按量开通了搜索的项目）。没有这个权限就用导入，不要临时去买也行。
- 代理地址相当于一把会花额度的钥匙。不要写进 `js/config.js`，不要发到帖子里。开完奖可以在 Cloudflare 把这个 Worker 关掉。

### 用网页后台部署（不用装命令行）

1. 注册 [Cloudflare](https://dash.cloudflare.com/)（免费计划即可），进入 **Workers & Pages → Create → Worker**。
2. 把 `proxy/src/index.js` 全部贴进编辑器，部署。
3. 打开这个 Worker 的 **Settings → Variables and Secrets → Add**。
4. 类型选 **Secret**，名称填 `X_BEARER_TOKEN`，值粘贴 X Developer Portal 里该 App 的 Bearer Token。Deploy。
5. 可选：再加一个 Secret，名称 `DRAW_KEY`，值自己编一串。设了之后，抽奖页的「访问密钥」要填同一串，别人只拿到地址也拉不了。
6. 复制 `*.workers.dev` 地址。浏览器打开 `https://你的地址/health`，应看到 `{"ok":true,"token_configured":true,...}`。
7. 打开抽奖页 →「贴帖子链接」→「代理地址」填这个 https 地址 → 如有密钥就填「访问密钥」。它们只存在这台浏览器。
8. 粘贴帖子链接，点「拉取回复」。

Token 只放 Secret。不要写进 `wrangler.toml`，不要提交到这个仓库，也不要贴在聊天里。

### 用 Wrangler

在 `proxy` 目录：

```bash
cd proxy
npx wrangler login
npx wrangler secret put X_BEARER_TOKEN
npx wrangler secret put DRAW_KEY
npx wrangler deploy
```

`DRAW_KEY` 那一步可以不做。部署结束时终端会打印 workers.dev 地址，填回抽奖页。

想限制只有自己的 Pages 能调用时，把 `proxy/wrangler.toml` 里的 `ALLOWED_ORIGINS` 改成：

```toml
ALLOWED_ORIGINS = "https://15735183119.github.io"
```

改完要重新部署。默认 `*` 是为了少一次配置；配合「不要公开代理地址」，必要时再加 `DRAW_KEY`。

有 full-archive 权限、帖子又超过 7 天时，才把 `X_SEARCH_PATH` 改成 `/2/tweets/search/all`。

## 公平性和隐私

- 去重之后，用 Fisher–Yates 洗牌，随机整数来自 `crypto.getRandomValues`，并用拒绝采样去掉取模偏差。
- 每位进入中奖名单的概率相同，页面上写的是 `中奖人数/筛选后人数`。
- 结果在动画开始前就写进这个标签页。刷新只会把那一次结果拿回来。
- 没有登录，没有 X OAuth，没有统计脚本，也没有第三方字体。导入的名单不会发到任何服务器。
- 只有「拉取回复」会把帖子编号（和你自己填的访问密钥）发给你填的那个代理地址。

## 开发

```bash
node --test test/core.test.js test/proxy.test.mjs
```

需要 Node 20 或更新。代理测试用的是假的 X 响应，不会访问 X，仓库里也没有 Token。
