# DoctorIDD 官网（静态版 + Pages Function）

纯静态 Minecraft 服务器官网，主站部署到 Cloudflare Pages，公告 JSON 单独部署到 GitHub Pages。
主站的首页、公告详情和更新历史都通过 `fetch` 读取同一公告源；公告更新无需重新上传主站。
服务器状态检测优先使用项目内的 `functions/api/status.js`（Minecraft Server List Ping），
本地静态预览或函数不可用时自动回退到第三方 API：`https://api.mcsrvstat.us/3/`。

## 目录结构

```text
webpage/
├── index.html              首页
├── functions/
│   └── api/status.js       Cloudflare Pages Function：MC 状态/线路检测
├── rules/index.html        规则与加入
├── plugins/index.html      服务器组件（可选）
├── changelog/index.html    更新历史 Changelog（服务器 / 服务日志）
├── announcements/
│   └── view.html           公告独立详情页（?id=xxx）
├── 404.html
├── logo.png            主界面 Logo 原图
├── data/
│   ├── server.json         服务器配置 / 状态 / 联系
│   ├── site.json           GitHub Pages 公告源 / 本地预览公告源
│   ├── addresses.json      连接地址卡片（IP / 来源 / 状态）
│   ├── announcements/
│   │   ├── index.json      公告索引（置顶 / 首页展示 / 摘要）
│   │   ├── server-announcement.json
│   │   └── example-2.json
│   ├── changelog.json      服务器 / 服务更新日志
│   ├── members.json        成员墙
│   ├── projects.json       项目 / 开源组件
│   ├── quicklinks.json     About 区快捷链接卡片
│   └── rules.json          规则 / 加入 / 审核 / 免责
├── assets/
│   ├── css/style.css       样式
│   ├── js/app.js           前端逻辑
│   ├── avatars/            成员头像本地文件（避免运行时依赖外部慢速头像源）
│   ├── images/logo-thumb.png  网页图标（略缩图）
│   └── images/logo.svg     原 SVG 占位（可删除）
├── scripts/
│   ├── fetch-avatars.mjs   下载成员头像到本地 assets/avatars/
│   ├── status-server.mjs   Node 版上海回退 MC 状态服务（可选）
│   └── status-server.py     Python 版上海回退 MC 状态服务（可选）
└── README.md
```

## 本地预览

因为页面需要 `fetch` 读取 JSON，不能直接用 `file://` 打开，请用项目自带的本地开发服务器：

```bash
cd webpage
node dev-server.mjs
```

然后访问：<http://localhost:8765>

这个本地服务除了提供静态文件，还会模拟 Cloudflare Pages Function 的 `/api/status`，
所以本地也能直接测 Minecraft Server List Ping 的结果。
端口可以用环境变量改：

```bash
PORT=9000 node dev-server.mjs
```

## 修改内容

### 本地表单编辑器

在项目根目录运行 `npm run editor`，浏览器打开 `http://127.0.0.1:8766`。
可结构化增删改公告、连接地址、项目、快捷链接、成员、规则、更新日志和服务器配置；列表支持上移、下移。
点击“保存当前分类”写入本地 `data/` 文件，公告索引与正文自动同步。每次保存前将旧文件备份到 `.editor-backups/`（不提交、不部署）。
删除公告会从索引移除，保留旧正文文件，便于恢复。其他程序修改文件后，编辑器会拒绝覆盖，需重新加载。
编辑器仅监听本机地址，无需登录，不会随网站部署。关闭终端或按 Ctrl+C 停止。
公告正文上方有“插入蓝链”“插入图片 / GIF”“插入网易云播放器”“插入B站播放器”按钮，在光标位置插入内容；播放器支持粘贴完整分享链接或官方 iframe 嵌入代码。
保存后可另开终端运行 `npm run dev`，在 `http://localhost:8765` 预览。
公告发布仍需 `npm run build:announcements`，然后提交 `data/announcements/` 并推送；其他主站内容用 `npm run deploy:cloudflare` 发布。

需要修改的内容都在 `data/` 下：

| 文件 | 内容 |
|---|---|
| `server.json` | 服务器名称、状态检测目标、版本、维护状态、联系方式等；`statusHost` 为主状态卡实际 Ping 的目标 |
| `site.json` | `announcementsBaseUrl` 为生产公告源；`announcementsFallbackBaseUrls` 为备用公告源数组（按顺序回退）；`announcementsMediaBaseUrl` 可选，单独指定图片 / 音视频的源；`announcementsLocalBaseUrl` 为本地预览公告源 |
| `addresses.json` | 连接地址卡片：展示 IP、来源、节点地址、每个地址的检测目标；展示 IP 由 `statusHost` + `statusPort` 拼接，端口 25565 自动隐藏 |
| `data/announcements/index.json` + `data/announcements/*.json` | 公告系统。`index.json` 每条包含 `id`、`file`、`date`、`title`、`sticky`、`showOnHome`、`summary`；每个公告单独一个 JSON 文件，含 `content`（换行写 `\n`）和 `images`（图床图片 URL 数组）；正文链接自动变蓝链；首页只展示 `showOnHome`，Changelog 展示全部公告并按时间从新到旧；独立详情页通过 `/announcements/view.html?id=<id>` 访问 |
| `changelog.json` | 更新历史 Changelog（只放 Minecraft 服务器 / 其他服务的日志，不放官网开发日志） |
| `members.json` | 成员列表。头像支持：`uuid`（MC 头像）、`littleSkin`（LittleSkin 角色名，自动取当前皮肤头像）、`littleSkinTid` / `littleSkinHash`（固定指定某套皮肤）、`avatar`（直接指定图片 URL，优先级最高） |
| `projects.json` | 项目 / 插件 / 开源组件卡片 |
| `quicklinks.json` | `// 01 ABOUT` 的快捷入口卡片：`title`、`description`、`url`、`icon` |
| `rules.json` | 规则、加入流程、审核须知、免责说明 |

公告文件提交到 `main` 后，由 GitHub Actions 单独发布。主站使用下文的 `npm run deploy:cloudflare` 上传；只有配置了 Cloudflare Git 集成时，主站才会自动部署。

### 新增公告

1. 在 `data/announcements/` 下新建 `你的公告id.json`，例如 `server-announcement.json`。
2. 在 `data/announcements/index.json` 中增加一条元数据：

```json
{
  "id": "server-announcement",
  "file": "server-announcement.json",
  "date": "2026-08-21",
  "title": "服务器公告",
  "sticky": true,
  "showOnHome": true,
  "summary": "首页展示的摘要"
}
```

3. 公告文件内容示例：

```json
{
  "id": "server-announcement",
  "date": "2026-08-21",
  "title": "服务器公告",
  "sticky": true,
  "showOnHome": true,
  "content": "第一行\n第二行",
  "images": [
    "https://你的图床/图片.png"
  ]
}
```

- `sticky`：置顶，首页会排在前面；
- `showOnHome`：是否在首页公告区展示；
- `images`：图床图片 URL 数组，会显示在公告详情页；
- 所有公告都会按 `date` 从新到旧出现在 Changelog 页。
- 首页仅请求索引中的摘要，不逐条下载正文；点击阅读全文时才请求对应公告文件。
- 正文支持下方的链接、图片和播放器标记，旧的普通文字与自动 HTTP/HTTPS 蓝链继续可用，HTML 标签不会被执行。
- 图片可用完整图床 URL，也可用相对公告服务根目录的路径，例如 `images/event.png`。本地图片放到 `data/announcements/images/`，会随公告单独发布。

### 在正文中插入链接、图片与播放器

推荐用本地编辑器的插入按钮，也可以直接在 `content` 中编写以下内容（手写 JSON 时，换行使用 `\n`）：

```text
报名地址：[点击报名](https://example.com/)

![活动海报](images/event.png)
![活动动图](images/event.gif)

@[背景音乐](https://music.163.com/song?id=347230)
@[活动录像](https://www.bilibili.com/video/BV1B7411m7LV/?p=1)
```

- 图片保持原格式，GIF、动态 WebP、APNG 可以直接展示；图片说明显示在下方，附有“打开原图”入口。
- 网易云支持歌曲、歌单和专辑的完整链接。编辑器还接受歌曲数字 ID；B站接受 BV 编号、完整视频链接和官方嵌入代码。`b23.tv` 短链接请先打开，再复制完整视频地址。
- 外置播放器由访客点击加载，不自动播放；网易云使用紧凑高度，B站按 16:9 自适应。是否能够播放取决于平台版权、登录限制与网络情况，卡片提供“在原站打开”。
- `summary` 也可写 `[文字](https://地址)`，首页仅展示摘要和链接，不加载播放器或图片。

如果希望把媒体统一放在正文后面，可以继续使用 `images`，并增加可选的 `players` 列表，例如：

```json
{
  "images": ["images/event.gif", { "url": "images/poster.png", "alt": "活动海报" }],
  "players": [
    { "type": "netease", "title": "背景音乐", "url": "https://music.163.com/song?id=347230" },
    { "type": "bilibili", "title": "活动录像", "url": "https://www.bilibili.com/video/BV1B7411m7LV/" },
    { "type": "audio", "title": "录音", "url": "media/event.mp3" },
    { "type": "video", "title": "录像文件", "url": "media/event.mp4", "poster": "images/poster.png" },
    { "type": "iframe", "title": "其他平台", "url": "https://example.com/embed/video", "height": 360 }
  ]
}
```

直接音视频文件使用浏览器播放控件；相对地址的文件放在 `data/announcements/` 中，随 GitHub Pages 发布。通用 iframe 使用平台提供的 HTTPS 嵌入地址，平台必须允许外部嵌入。编辑器会从 iframe 代码中只提取地址，不执行其中的 HTML 或脚本。

本次新增显示能力后，需要先重新部署一次 Cloudflare 主站，并推送新增的格式脚本与工作流；之后只更新公告文字和媒体文件时，推送公告即可。B站参数依据[官方播放器文档](https://player.bilibili.com/)。

## 成员头像本地化

考虑到 `mc-heads.net` 访问慢，项目已支持把成员头像下载到本地：

```text
assets/avatars/
```

运行时只加载本地文件，不再依赖 mc-heads.net。

新增或修改成员后，重新执行一次：

```bash
node scripts/fetch-avatars.mjs
```

脚本会：

1. 读取 `data/members.json`；
2. 优先用 LittleSkin 下载头像；有 `uuid` 的成员用 minotar.net 下载 Minecraft 官方皮肤头像；
3. 保存到 `assets/avatars/`；
4. 自动把 `members.json` 的 `avatar` 字段指向本地文件。

之后提交 Git 即可，头像会随网站一起静态部署。

## 页面视觉与动效

页面保留自由滚动，加入网格与渐变背景、首屏分层入场、板块与卡片滚动入场、导航位置高亮、卡片悬停反馈和公告加载占位。
系统开启“减少动态效果”时，会关闭动画并使用普通返回顶部。

- 滚动到 `//01 ABOUT` 后，右下角出现圆形「返回顶部」按钮；
- 点击按钮平滑回到首页 Hero；
- 页面可以自由上下滚动，多个板块可以同屏浏览。

## 暗色模式与导航

- 右上角月亮/太阳按钮可切换亮色 / 暗色模式，选择会保存到 `localStorage`；
- 首次访问默认跟随系统 `prefers-color-scheme`；
- 全站页面已统一使用顶部导航菜单，移动端自动折叠为抽屉菜单（`#nav-toggle` 打开 / Esc 或点击外部关闭）；
- 内页 JSON 统一使用根路径 `/data/` 加载，确保首页和内页（公告详情、Changelog、规则、组件）都能正常渲染。

## 服务器状态

状态卡逻辑：

1. `server.json` 中 `maintenance` 为 `true` 时，直接显示“维护中”。
2. 否则优先请求自己的 Pages Function：

```text
/api/status?host=doctoridd.net&port=25565
```

这个函数会在 Cloudflare 边缘节点对目标执行一次 Minecraft Server List Ping：

```text
host        = server.json 的 statusHost，或 addresses.json 里每条线路的 statusHost（域名 / IP / FRP 节点）
port        = addresses.json 里的 statusPort
```

3. 主状态卡：返回 `online: true` 时显示“在线 + 人数/最大人数”，`false` 时显示“离线”。
4. 连接地址表：每条线路按 `online` 显示“可用 / 不可用”，即玩家能否通过这条线路连上 MC 服务器。

因为是从公网边缘直连目标端口，所以对于樱花FRP这类线路，
判断的是“玩家实际能否通过这条线路连上 MC 服务器”，而不是只看隧道是否注册。

5. 本地用 `node dev-server.mjs` 预览时，`/api/status` 会在本机直接执行同样的 MC Ping，效果与 Cloudflare 部署后一致。
   如果使用普通的 `python3 -m http.server`（没有 `/api/status`），前端会自动回退到：

```text
https://api.mcsrvstat.us/3/<host>:<port>
```

所以两种方式都能显示状态，推荐使用项目自带的 `dev-server.mjs`。

刷新页面或点击“刷新状态”按钮才会重新检测。

### 上海回退状态服务（解决 Cloudflare 到宁波专线超时）

如果 Cloudflare 边缘节点连不到某些国内 FRP 线路（例如 `frp-sun.com:31067` 宁波专线），
可以让上海阿里云轻量服务器（`139.196.54.254`）代为执行 MC Ping：

1. 把 `scripts/status-server.py`（或 `status-server.mjs`）放到上海服务器。有 `python3` 就优先用 Python 版：

   ```bash
   python3 status-server.py
   ```

   如果没有 `python3`，再安装 Node.js 后用：

   ```bash
   node status-server.mjs
   ```

2. 默认监听 `2096` 端口，可在阿里云安全组放行该 TCP 端口。
3. Cloudflare Pages Function 在直连超时后会自动回退请求：

   ```text
   http://139.196.54.254:2096/api/status?host=frp-sun.com&port=31067
   ```

4. 如果端口或地址变了，在 Cloudflare Pages 环境变量里设置：

   ```text
   SHANGHAI_STATUS_API = http://139.196.54.254:2096
   ```

这样宁波专线就能由上海服务器检测后返回结果，页面显示“可用 / 在线”。

## 日常更新流程（固定步骤）

本站有**两个互相独立的发布目标**，这是大多数问题的根源，先记住这张表：

| 你改的东西 | 发布到哪里 | 怎么发布 |
|---|---|---|
| `data/announcements/**`（公告索引、正文、`images/` 图片） | GitHub Pages 公告源 | **自动**：push 到 `main` 即触发 |
| `data/` 下其他 JSON（`server` / `projects` / `quicklinks` / `members` / `rules` / `changelog` / `addresses` / `site`） | Cloudflare 主站 | **手动**：`npm run deploy:cloudflare` |
| HTML、`assets/css/style.css`、`assets/js/*.js` | Cloudflare 主站 | **手动**：`npm run deploy:cloudflare` |

**核心规则**：只有公告是 push 后自动上线的；**其余任何改动都必须手动执行一次 `npm run deploy:cloudflare`，push 不会自动部署主站。**

### 场景 A：只改公告文字（最常见）

```powershell
npm run editor                     # 打开 http://127.0.0.1:8766，改完点“保存当前分类”
npm test                           # 可选：确认公告数据合法
git add data/announcements
git commit -m "公告：xxx"
git push                           # 自动触发工作流，1~2 分钟后公告上线
```

推送后可在这里确认工作流结果：仓库 **Actions → Publish announcement data**。

### 场景 B：公告里要用图片、GIF 或播放器

新增这类内容前，先确认主站已经支持对应渲染（见下方「顺序要求」）。步骤：

1. 把图片放进 `data/announcements/images/`（该目录随公告一起发布）：
   ```powershell
   # 例：data/announcements/images/活动海报.jpg
   ```
2. `npm run editor` → 公告分类 → 正文上方按钮插入，或用「图片地址 / `images` 字段」。
   地址**从 `data/announcements/` 开始算，不要加开头的 `/`**：
   ```
   images/活动海报.jpg      ✅  → 公告源/images/活动海报.jpg
   /images/活动海报.jpg     ❌  → 主站根目录，会 404
   https://图床/图.png      ✅  推荐，最省事
   ```
3. 提交并推送（`git add data/announcements && git commit && git push`）。

### 场景 C：改主站内容或样式

改 `data/server.json`、`data/projects.json` 等，或改 HTML / CSS / JS 之后：

```powershell
npm run dev                        # 先在 http://localhost:8765 本地确认
npm run deploy:cloudflare          # 部署主站
git add -A
git commit -m "xxx"
git push                           # 让仓库与线上保持一致
```

### ⚠️ 顺序要求（重要，曾踩过坑）

**如果新增的公告用到了主站还不支持的新写法**（例如第一次使用图片 / 播放器标记），必须**先部署主站、再推公告**：

```powershell
npm run deploy:cloudflare          # ① 主站先拿到新渲染器
git push                           # ② 再发布公告内容
```

反过来做的话，公告会先上线，而主站还没有对应渲染器，页面上会直接显示 `![](images/xx.jpg)`、`@[标题](url)` 这样的原始文字，看起来像坏了。此时补一次 `npm run deploy:cloudflare` 即可恢复，数据没丢。

**同理**：改动 `assets/js/announcement-format.js`、`assets/js/app.js` 后，也要记得部署主站——旧代码配新公告内容会渲染异常。

### 发新公告的完整示例

```powershell
npm run editor
# ① 选「服务器公告」→ 新增条目 → 填 id / file / 日期 / 标题 / 正文
# ② 需要图片就放 data/announcements/images/，正文用 images/文件名.jpg
# ③ 点「保存当前分类」，看到“已保存”后关掉终端（Ctrl+C）

npm test                           # 确认数据合法
git add data/announcements
git commit -m "公告：新增第③周目公告"
git push
```

隔 1~2 分钟打开 `https://docidd.github.io/idd-official-web/index.json` 应能看到新公告；再刷新主站首页确认显示正常。

### 常见坑

- **push 了但主站没变** → 正常。主站是手动部署的，执行 `npm run deploy:cloudflare`。
- **公告图不显示** → 检查地址有没有多写开头的 `/`；确认图片确实提交进了 `data/announcements/images/`。
- **页面显示 `![](...)` 原始文字** → 主站渲染器没更新，执行 `npm run deploy:cloudflare`。
- **编辑器保存报错“文件已被其他窗口或程序修改”** → 有别的程序改过文件，点「重新加载」再改。每次保存前会自动备份到 `.editor-backups/`。
- **删除公告** → 编辑器只从索引移除，正文文件会保留（便于恢复），这是有意设计。

## 部署到 Cloudflare Pages

### 1. 首次启用 GitHub Pages 公告服务

现有仓库：`DocIDD/idd-official-web`，默认公告地址：

```text
https://docidd.github.io/idd-official-web/
```

1. 将本次代码及 `.github/workflows/announcements-pages.yml` 提交并推送到该仓库的 `main` 分支。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Publish announcement data** 中执行 **Run workflow**；后续 `data/announcements/` 的变更会自动触发发布。
4. 检查 `https://docidd.github.io/idd-official-web/index.json` 能返回公告数组，再上传主站。GitHub Pages 首次生效可能需要稍等。

工作流只上传 `dist/github-pages`，其中包含公告索引、正文和图片。
配置 `data/site.json` 中的 `announcementsBaseUrl` 可以使用独立公告仓库或自定义域名，地址必须为 HTTPS。
路径应指向包含 `index.json` 的目录，可带或不带尾部 `/`。如果改用独立仓库，可把 `dist/github-pages` 内容发布到新仓库的 Pages；当前工作流默认发布到当前仓库。

### 2. 上传 Cloudflare Pages 主站（你的命令方式）

在项目根目录运行：

```bash
npm run deploy:cloudflare
```

等价于先生成主站产物，再上传：

```bash
node scripts/build-pages.mjs cloudflare
npx wrangler pages deploy dist/cloudflare --project-name doctoridd --branch=main
```

请将原来的 `pages deploy .` 改为 `pages deploy dist/cloudflare`。
构建脚本仅收集主站静态资源，公告 JSON、开发脚本、README 和 `.wrangler` 缓存不会进入主站产物。
从项目根目录运行上传命令，Wrangler 会继续编译根目录 `functions/` 的状态接口。
`dist/cloudflare/_routes.json` 将 Function 调用限定到 `/api/*`。

如果以后改用 Cloudflare Git 集成，构建命令填 `npm run build:cloudflare`，输出目录填 `dist/cloudflare`。

### 3. 日常更新与验证

- **只改公告**：修改 `data/announcements/`，提交并推送到 `main`，等待公告发布工作流完成即可。
- **改主站或公告源地址**：执行 `npm run deploy:cloudflare`。
- **本地开发**：执行 `npm run dev`。`localhost`、`127.0.0.1` 与 IPv6 回环地址读取本地公告，无需先启用 GitHub Pages。
- **生成两个发布目录**：执行 `npm run build`。
- **预览两个服务的跨域读取**：执行 `npm run preview`，访问 `http://localhost:8767`。主站使用一个端口，公告使用另一个端口并模拟 GitHub 仓库子路径；此预览不运行本地状态 Function，状态检测会使用现有第三方回退。
- **验证公告加载与产物隔离**：执行 `npm test`。

公告请求使用 8 秒超时、跨域 GET（不携带凭据）和 HTTP 缓存重新验证。远程失败时显示重试按钮，不会悄悄展示旧的本地公告。
更换为自定义公告域名后，须确保它允许主站跨域读取 JSON（`Access-Control-Allow-Origin`）；上线后在浏览器确认首页、正文与更新历史均能正常加载。
公告请求与服务器状态检测并行，因此状态检测缓慢不会阻塞公告。

### 公告源与国内访问回退

`docidd.github.io` 在大陆访问不稳定，因此 `data/site.json` 默认把公告源指向 jsDelivr 的国内镜像，并配置了多条备用源：

```json
{
  "announcementsBaseUrl": "https://cdn.jsdmirror.com/gh/DocIDD/idd-official-web@main/data/announcements/",
  "announcementsFallbackBaseUrls": [
    "https://cdn.jsdelivr.net/gh/DocIDD/idd-official-web@main/data/announcements/",
    "https://gh-proxy.com/https://raw.githubusercontent.com/DocIDD/idd-official-web/main/data/announcements/",
    "https://docidd.github.io/idd-official-web/"
  ],
  "announcementsLocalBaseUrl": "/data/announcements/"
}
```

规则：

- 这些镜像走的是**仓库路径**（`gh/用户/仓库@分支/…`），不是 `github.io` —— gh-proxy 类公共反代的白名单里没有 `*.github.io`，直接代理 Pages 地址会返回代理首页 HTML。
- 请求按 `announcementsBaseUrl` → `announcementsFallbackBaseUrls` 顺序尝试，**任一条通即可**；上次成功的源会被记住并优先使用，避免反复等待失效源超时。
- **图片与音视频会跟随可用的源**，所以主源失效时图不会挂（图片是浏览器直接加载的，无法逐张回退，因此第一次解析时会用体积很小的 `index.json` 探一次可用源）。
- 全部源都失败时仍会报错并显示「重新加载」按钮，不会静默展示旧内容。
- 修改公告源后需要 `npm run deploy:cloudflare`（`site.json` 属于主站产物）。

选择源时的注意点：

- 镜像有缓存。实测 `cdn.jsdmirror.com` 返回 `Cache-Control: max-age=300`（约 5 分钟），新公告通常几分钟内可见。
- 若要**强制立刻刷新**某条镜像的缓存，可调用 jsDelivr 的 purge 接口（公共可用，无需申请）：
  `https://purge.jsdelivr.net/gh/DocIDD/idd-official-web@main/data/announcements/index.json`
  对正文文件同理，把路径换成对应 `.json`。
- 公共反代（gh-proxy 类）随时可能改域名或停服，所以它只作为备用源，**不要单独依赖**。
- 也可以自建：把公告镜像到自己可控的域名 / CDN 上，填进 `announcementsBaseUrl` 即可，无需改代码。


`.gitignore` 已忽略构建产物和 Wrangler 缓存；此前已加入 Git 暂存区的缓存文件仍需在提交前自行取消跟踪。
发布步骤依据 [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) 与 [Cloudflare Pages 构建配置](https://developers.cloudflare.com/pages/configuration/build-configuration/)。
