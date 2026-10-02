/* DoctorIDD 官网 - 纯静态前端逻辑
   功能：
   1. 读取 data/*.json 渲染页面内容
   2. 服务器状态检测：优先走 Cloudflare Pages Function /api/status（MC Ping），
      本地静态预览或函数不可用时自动回退到 mcsrvstat.us
   3. 成员墙 / 项目墙 / 规则渲染
*/

const DATA_BASE = "/data/";

async function loadJSON(path) {
  const res = await fetch(DATA_BASE + path);
  if (!res.ok) throw new Error("加载失败: " + path);
  return res.json();
}

function el(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = el(id);
  if (node && value != null) node.textContent = value;
}

function setHTML(id, html) {
  const node = el(id);
  if (node) {
    node.innerHTML = html;
    revealContent(node);
  }
}

/* ---------- 全局加载 ---------- */
async function initGlobal(server) {
  if (document.body.dataset.page === "home") {
    document.title = `${server.name} · Minecraft 服务器官网`;
  }

  setText("site-brand", server.name);
  setText("hero-title", server.name);
  setText("hero-slogan", server.slogan);
  setText("hero-subtitle", server.slogan);

  // 服务器信息卡
  setText("site-name-about", server.name);
  setText("server-address", formatAddress(server.hostname, server.port) || server.address);
  setText("server-version", server.version);
  setText("server-type", server.type);
  setHTML("server-description", server.description);
  setText("server-open-hours", server.openHours || "8:30~23:57");

  // 特色标签
  const features = el("features-list");
  if (features && Array.isArray(server.features)) {
    features.innerHTML = server.features.map((f) => `<li>${f}</li>`).join("");
  }

  // 页脚
  setText("footer-brand", server.name);
  setText("footer-tagline", server.slogan);
  setText("footer-address", formatAddress(server.hostname, server.port) || server.address);
  setText("footer-email", server.contactEmail);
  setHTML("footer-community", buildCommunityLinks(server.communityLinks || []));

  // 状态刷新：主状态卡 + 每个连接地址
  const refreshBtn = document.querySelector(".refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => refreshAllStatuses(server));
  }

  await renderAddresses(server);
  await refreshAllStatuses(server);
}

function buildCommunityLinks(links) {
  return links
    .map((link) => `<a href="${link.url}" target="_blank" rel="noopener">${link.label}</a>`)
    .join("");
}

async function fetchServerStatus(host, port, fallbackApi) {
  // 优先用 Cloudflare Pages Function /api/status 做 MC Ping
  try {
    const workerUrl = `/api/status?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&timeout=15000`;
    const res = await fetch(workerUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.online === "boolean" && !(data.online === false && data.error)) return data;
    }
  } catch (err) {
    // 本地静态预览没有这个函数，继续走下面的回退
  }

  // 回退：mcsrvstat.us（仅本地预览 / 函数不可用时）
  const apiUrl = `${fallbackApi}${host}:${port}`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error("状态接口请求失败");
  return await res.json();
}

/* ---------- 状态检测 ---------- */
function setStatus(state, text) {
  const pill = el("status-pill");
  if (!pill) return;
  pill.className = "status-pill is-" + state;
  setText("status-text", text);
}

async function checkServerStatus(serverOverride) {
  const server = serverOverride || await loadJSON("server.json");
  const pill = el("status-pill");
  const players = el("server-players");
  const notice = el("server-notice");

  if (!pill) return;

  if (server.maintenance) {
    setStatus("maintenance", "维护中");
    if (players) players.innerHTML = "<span>—</span>";
    if (notice) notice.textContent = server.maintenanceNotice || "服务器维护中，恢复时间群内公告";
    return;
  }

  setStatus("loading", "检测中");
  if (notice) notice.textContent = "正在检测服务器状态…";

  try {
    const data = await fetchServerStatus(server.statusHost || server.hostname, server.port, server.statusApi);

    if (data.online) {
      const online = data.players?.online ?? 0;
      const max = data.players?.max ?? 0;
      const tcpOnly = data.mode === "tcp" || Boolean(data.note);
      setStatus("online", tcpOnly ? "在线（TCP）" : "在线");
      if (players) players.innerHTML = `<strong>${online}</strong><span>/ ${max}</span>`;
      if (notice) notice.textContent = data.note || "服务器在线，欢迎加入！";
      setText("server-version", data.version || server.version);
    } else {
      setStatus("offline", "离线");
      if (players) players.innerHTML = "<span>—</span>";
      if (notice) notice.textContent = "服务器当前离线，请稍后再试。";
    }
  } catch (err) {
    setStatus("offline", "离线 / 未知");
    if (players) players.innerHTML = "<span>—</span>";
    if (notice) notice.textContent = "状态检测失败，请点击刷新重试。";
  }
}

/* ---------- 连接地址卡片：显示 IP / 来源 / 状态，状态获取地址不渲染到页面 ---------- */
let cachedAddresses = null;

async function loadAddresses() {
  if (cachedAddresses) return cachedAddresses;
  cachedAddresses = await loadJSON("addresses.json");
  return cachedAddresses;
}

function formatAddress(host, port) {
  const p = Number(port || 25565);
  if (p === 25565) return host;
  return `${host}:${p}`;
}

function copyAddress(text, node) {
  const copied = () => {
    const original = node.dataset.ip || text;
    node.textContent = "已复制";
    node.classList.add("copied");
    setTimeout(() => {
      node.textContent = original;
      node.classList.remove("copied");
    }, 1200);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(copied).catch(() => fallbackCopy(text, copied));
  } else {
    fallbackCopy(text, copied);
  }
}

function fallbackCopy(text, done) {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
    done();
  } catch (err) {
    console.warn("复制失败", err);
  }
  document.body.removeChild(area);
}

async function renderAddresses(server) {
  const tbody = el("addresses-body");
  if (!tbody) return;

  try {
    const addresses = await loadAddresses();
    tbody.innerHTML = addresses
      .map((item, index) => {
        const display = formatAddress(item.statusHost, item.statusPort);
        return `
        <tr data-index="${index}">
          <td>
            <span class="address-ip" data-ip="${display}" title="点击复制">${display}</span>
          </td>
          <td class="address-source">${item.source}</td>
          <td class="address-node">${item.node || "—"}</td>
          <td>
            <span class="address-status is-loading" data-index="${index}">
              <span class="status-dot" aria-hidden="true"></span>
              <span>检测中</span>
            </span>
          </td>
        </tr>
      `;
      })
      .join("");

    tbody.querySelectorAll(".address-ip").forEach((node) => {
      node.addEventListener("click", () => copyAddress(node.dataset.ip, node));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" style="color: var(--ink-muted);">连接地址加载失败，请检查 data/addresses.json。</td></tr>`;
  }
}

function setAddressStatus(cell, state, text) {
  cell.className = "address-status is-" + state;
  cell.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${text}</span>`;
}

async function refreshAddressStatuses(server) {
  const tbody = el("addresses-body");
  if (!tbody) return;

  try {
    const addresses = await loadAddresses();

    // 并行检测所有线路，避免某条超时拖慢整张表
    await Promise.all(
      addresses.map(async (item, i) => {
        const cell = tbody.querySelector(`.address-status[data-index="${i}"]`);
        if (!cell) return;

        if (server.maintenance) {
          setAddressStatus(cell, "maintenance", "维护中");
          return;
        }

        setAddressStatus(cell, "loading", "检测中");

        try {
          // 状态获取地址：仅用于请求，不在页面展示
          const host = item.statusHost || server.statusHost || server.hostname;
          const port = item.statusPort || server.port;
          const data = await fetchServerStatus(host, port, server.statusApi);

          if (data.online) {
            setAddressStatus(cell, "online", data.mode === "tcp" ? "可用（TCP）" : "可用");
          } else {
            setAddressStatus(cell, "offline", "不可用");
          }
        } catch (err) {
          setAddressStatus(cell, "offline", "不可用");
        }
      })
    );
  } catch (err) {
    console.warn("地址状态刷新失败", err);
  }
}

async function refreshAllStatuses(server) {
  await checkServerStatus(server);
  await refreshAddressStatuses(server);
}

/* ---------- 返回顶部 ---------- */
function initSectionSwitch() {
  const backBtn = el("back-to-top");
  if (!backBtn) return;

  const header = document.querySelector(".site-header");
  const firstSection = document.querySelector("main .section");
  const threshold = header ? header.offsetHeight : 64;

  function update() {
    let visible = false;
    if (firstSection) {
      visible = firstSection.getBoundingClientRect().top <= threshold;
    } else {
      visible = window.scrollY > 0;
    }

    backBtn.classList.toggle("is-visible", visible);
    backBtn.setAttribute("aria-hidden", String(!visible));
  }

  backBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  });

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  update();
}

/* ---------- 成员墙 ---------- */
function tierLabel(tier) {
  const map = {
    owner: "服主",
    core: "核心",
    member: "成员"
  };
  return map[tier] || tier || "成员";
}

function memberAvatar(member) {
  // 1. 直接指定头像/皮肤 URL（最高优先级）
  if (member.avatar) return member.avatar;

  // 2. LittleSkin 角色名：自动获取该角色当前使用的皮肤头像
  const littleSkinName = member.littleSkin || member.littleSkinName;
  if (littleSkinName) {
    return `https://littleskin.cn/avatar/player/${encodeURIComponent(littleSkinName)}?png&size=64`;
  }

  // 3. LittleSkin 材质 TID：固定使用某套指定皮肤的头部
  if (member.littleSkinTid) {
    return `https://littleskin.cn/avatar/${Number(member.littleSkinTid)}?png&size=64`;
  }

  // 4. LittleSkin 材质文件 hash：固定使用某套指定皮肤的头部
  if (member.littleSkinHash) {
    return `https://littleskin.cn/avatar/hash/${member.littleSkinHash}?png&size=64`;
  }

  // 5. 原方案：Minecraft UUID 头像
  if (member.uuid) return `https://mc-heads.net/head/${member.uuid}`;

  // 6. 默认头像
  return `https://mc-heads.net/head/MHF_Steve`;
}

async function renderMembers() {
  const grid = el("members-grid");
  if (!grid) return;

  try {
    const members = await loadJSON("members.json");
    grid.innerHTML = members
      .map((member) => {
        const avatar = memberAvatar(member);
        const fallbackAvatar = member.uuid
          ? `https://mc-heads.net/head/${member.uuid}`
          : `https://mc-heads.net/head/MHF_Steve`;
        return `
          <article class="member-card">
            <img class="member-avatar" src="${avatar}" alt="${member.name} 的 MC 头像" loading="lazy" onerror="this.onerror=null; this.src='${fallbackAvatar}'">
            <div class="member-name">${member.name}</div>
            <span class="member-tier">${tierLabel(member.tier)}</span>
            ${member.role ? `<div class="member-role">${member.role}</div>` : ""}
          </article>
        `;
      })
      .join("");
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--ink-muted)">成员数据加载失败，请检查 data/members.json。</p>`;
  }
}

/* ---------- 项目墙 ---------- */
async function renderProjects() {
  const grid = el("projects-grid");
  if (!grid) return;

  try {
    const projects = await loadJSON("projects.json");
    grid.innerHTML = projects
      .map((project) => `
        <a class="project-card" href="${project.url}" target="_blank" rel="noopener">
          <div class="project-card__top">
            <span class="project-card__icon">${project.icon || "📦"}</span>
            <span class="project-card__name">${project.name}</span>
          </div>
          <div class="project-card__author">${project.author}</div>
          <div class="project-card__desc">${project.description}</div>
        </a>
      `)
      .join("");
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--ink-muted)">项目数据加载失败，请检查 data/projects.json。</p>`;
  }
}

/* ---------- 快捷链接 ---------- */
async function renderQuickLinks() {
  const grid = el("quick-links");
  if (!grid) return;

  try {
    const links = await loadJSON("quicklinks.json");
    grid.innerHTML = links
      .map((link) => `
        <a class="quick-link" href="${link.url}" target="_blank" rel="noopener">
          <span class="quick-link__icon">${link.icon || "🔗"}</span>
          <span class="quick-link__body">
            <span class="quick-link__title">${link.title}</span>
            ${link.description ? `<span class="quick-link__desc">${link.description}</span>` : ""}
          </span>
        </a>
      `)
      .join("");
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--ink-muted)">快捷链接加载失败，请检查 data/quicklinks.json。</p>`;
  }
}

/* ---------- 公告 ---------- */
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function cleanLinkUrl(raw) {
  return raw.replace(/[)\]），。、；.!?]+$/g, "");
}

function autoLinkLine(text) {
  const value = String(text || "");
  const pattern = /(https?:\/\/[^\s<>"'（）()\[\]{}，。；、！？\u4e00-\u9fff]+)/g;
  let html = "";
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    const url = cleanLinkUrl(match[0]);
    html += escapeHTML(value.slice(offset, match.index));
    html += `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(url)}</a>`;
    html += escapeHTML(match[0].slice(url.length));
    offset = match.index + match[0].length;
  }
  return html + escapeHTML(value.slice(offset));
}

function renderAnnouncementContent(content, maxLines = Infinity) {
  const lines = String(content || "")
    .replace(/\r/g, "")
    .split("\n");

  const shown = lines.slice(0, maxLines);
  let html = shown.map(autoLinkLine).join("<br>");

  if (lines.length > maxLines) {
    html += '<br><span class="announcement-truncated">…</span>';
  }

  return html;
}

async function loadAnnouncementIndex() {
  return window.AnnouncementSource.loadIndex();
}

function announcementError(target, retry, message = "公告暂时无法加载，请稍后重试。") {
  target.innerHTML = `<div class="announcement-state" role="status"><p>${escapeHTML(message)}</p><button class="btn btn--ghost announcement-retry" type="button">重新加载</button></div>`;
  target.querySelector("button").addEventListener("click", () => {
    window.AnnouncementSource.reset();
    retry();
  }, { once: true });
}

function announcementLoading(target) {
  target.setAttribute("aria-busy", "true");
  target.innerHTML = '<div class="announcement-skeleton" role="status"><span class="sr-only">公告加载中…</span><i></i><i></i><i></i></div>';
}

function announcementHref(id) {
  return `/announcements/view.html?id=${encodeURIComponent(id)}`;
}

function sortAnnouncements(items, stickyFirst = false) {
  return [...items].sort((a, b) => {
    if (stickyFirst && a.sticky !== b.sticky) {
      return a.sticky ? -1 : 1;
    }
    return String(b.date || "").localeCompare(String(a.date || ""));
  });
}

function renderAnnouncementSummary(summary) {
  if (!summary) return "";
  return autoLinkLine(summary).replace(/\n/g, "<br>");
}

async function renderAnnouncements() {
  const list = el("announcements-list");
  if (!list) return;
  announcementLoading(list);
  try {
    const all = await loadAnnouncementIndex();
    const items = sortAnnouncements(
      all.filter((item) => item.showOnHome !== false),
      true
    );

    const cards = items.map((item) => {
        return `
          <article class="announcement-card ${item.sticky ? "is-sticky" : ""}">
            <div class="announcement-date font-mono">
              ${item.sticky ? '<span class="announcement-sticky">置顶</span>' : ""}
              ${escapeHTML(item.date)}
            </div>
            <h3><a class="announcement-title-link" href="${announcementHref(item.id)}">${escapeHTML(item.title)}</a></h3>
            <p>${renderAnnouncementSummary(item.summary || "点击查看公告正文。")}</p>
            <a class="announcement-more-link" href="${announcementHref(item.id)}">阅读全文 <span aria-hidden="true">↗</span></a>
          </article>
        `;
      });

    list.innerHTML = cards.join("") || '<p class="announcement-state">暂无公告，敬请期待。</p>';
    revealContent(list);
  } catch (err) {
    announcementError(list, renderAnnouncements);
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

async function renderAnnouncementDetail() {
  const contentEl = el("announcement-detail-content");
  if (!contentEl) return;

  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    setText("announcement-detail-title", "未指定公告");
    contentEl.innerHTML = "<p style=\"color:var(--ink-muted)\">未指定公告 ID。</p>";
    return;
  }
  announcementLoading(contentEl);
  try {
    const index = await loadAnnouncementIndex();
    const meta = index.find((item) => item.id === id);
    if (!meta) {
      setText("announcement-detail-title", "公告不存在");
      contentEl.innerHTML = '<p class="announcement-state">这条公告可能已移除，请返回首页查看其他公告。</p>';
      return;
    }

    const data = await window.AnnouncementSource.loadDetail(meta);
    setText("announcement-detail-title", data.title);
    setText("announcement-detail-date", data.date);
    if (document.title) document.title = `${data.title} · DoctorIDD`;

    setHTML(
      "announcement-detail-content",
      renderAnnouncementContent(data.content, Infinity)
    );

    const imagesEl = el("announcement-detail-images");
    if (imagesEl && Array.isArray(data.images)) {
      imagesEl.innerHTML = (await Promise.all(data.images
        .map(async (img) => {
          const url = await window.AnnouncementSource.imageUrl(typeof img === "string" ? img : img?.url);
          const alt = typeof img === "string" ? "" : img?.alt || "";
          if (!url) return "";
          return `
            <figure class="announcement-image">
              <img src="${escapeHTML(url)}" alt="${escapeHTML(alt)}" loading="lazy" decoding="async">
              ${alt ? `<figcaption>${escapeHTML(alt)}</figcaption>` : ""}
            </figure>
          `;
        })))
        .join("");
    }
  } catch (err) {
    setText("announcement-detail-title", "公告暂时无法加载");
    announcementError(contentEl, renderAnnouncementDetail);
  } finally {
    contentEl.setAttribute("aria-busy", "false");
  }
}

/* ---------- 更新历史 Changelog（含全部公告，按时间从新到旧） ---------- */
async function renderChangelog() {
  const list = el("changelog-list");
  if (!list) return;

  try {
    const changelog = await loadJSON("changelog.json");
    let announcements = [];
    let announcementsFailed = false;
    try {
      announcements = await loadAnnouncementIndex();
    } catch (err) {
      announcementsFailed = true;
    }

    const entries = [
      ...changelog.map((item) => ({
        type: "changelog",
        date: item.date,
        version: item.version,
        changes: item.changes || []
      })),
      ...announcements.map((item) => ({
        type: "announcement",
        date: item.date,
        title: item.title,
        summary: item.summary || "",
        id: item.id
      }))
    ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    list.innerHTML = entries
      .map((entry) => {
        if (entry.type === "announcement") {
          return `
            <article class="changelog-item announcement-changelog-item">
              <div class="changelog-head">
                <span class="changelog-version font-mono">公告</span>
                <span class="changelog-date font-mono">${escapeHTML(entry.date)}</span>
              </div>
              <h3 class="changelog-announcement-title">${escapeHTML(entry.title)}</h3>
              ${entry.summary ? `<p class="changelog-announcement-summary">${renderAnnouncementSummary(entry.summary)}</p>` : ""}
              <a class="announcement-more-link" href="${announcementHref(entry.id)}">查看公告 →</a>
            </article>
          `;
        }

        return `
          <article class="changelog-item">
            <div class="changelog-head">
              <span class="changelog-version font-mono">${entry.version}</span>
              <span class="changelog-date font-mono">${entry.date}</span>
            </div>
            <ul class="changelog-changes">
              ${entry.changes.map((change) => `<li>${change}</li>`).join("")}
            </ul>
          </article>
        `;
      })
      .join("");
    if (announcementsFailed) {
      const warning = document.createElement("div");
      list.prepend(warning);
      announcementError(warning, renderChangelog, "公告暂时无法加载，以下更新记录仍可查看。");
    }
    revealContent(list);
  } catch (err) {
    list.innerHTML = `<p style="color:var(--ink-muted)">更新记录加载失败，请检查 data/changelog.json。</p>`;
  }
}

/* ---------- 规则渲染（首页摘要 + 规则页） ---------- */
async function renderRules() {
  const summary = el("rules-summary");
  const list = el("rules-list");
  const steps = el("join-steps");
  const review = el("review-notes");
  const disclaimer = el("disclaimer-notes");

  if (!summary && !list && !steps && !review && !disclaimer) return;

  try {
    const rules = await loadJSON("rules.json");

    if (summary) {
      summary.innerHTML = `
        <div>
          <h3>规则与加入</h3>
          <p>${rules.intro || ""}</p>
          <p class="server-notice">${rules.version || ""}</p>
        </div>
        <a class="btn btn--primary" href="/rules/">查看完整规则 →</a>
      `;
    }

    if (list) {
      list.innerHTML = rules.rules
        .map((rule) => `
          <li class="rule-item">
            <span class="rule-num">${rule.num}</span>
            <span>${rule.text}</span>
          </li>
        `)
        .join("");
      const head = el("rules-version");
      if (head) head.textContent = `规则版本 ${rules.version || ""}`;
    }

    if (steps) {
      steps.innerHTML = rules.joinSteps
        .map((step, i) => `
          <li class="step">
            <span class="step__idx">0${i + 1}</span>
            <div>
              <div class="step__name">${step.icon || ""} ${step.name}</div>
              <span class="step__note">${step.note}</span>
            </div>
          </li>
        `)
        .join("");
    }

    if (review) {
      review.innerHTML = rules.reviewNotes
        .map((note) => `<li>${note}</li>`)
        .join("");
    }

    if (disclaimer) {
      disclaimer.innerHTML = rules.disclaimer
        .map((note) => `<li>${note}</li>`)
        .join("");
    }
  } catch (err) {
    const target = list || summary;
    if (target) target.innerHTML = `<p style="color:var(--ink-muted)">规则数据加载失败，请检查 data/rules.json。</p>`;
  }
}

/* ---------- 主题切换 ---------- */
function initTheme() {
  const toggle = el("theme-toggle");
  const root = document.documentElement;

  let stored = null;
  try {
    stored = localStorage.getItem("theme");
  } catch (err) {
    // 隐私模式 / 环境限制时忽略，默认跟随系统
  }

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initial = stored || (prefersDark ? "dark" : "light");
  root.dataset.theme = initial;

  if (!toggle) return;

  const syncToggle = () => {
    const dark = root.dataset.theme === "dark";
    toggle.textContent = dark ? "☀️" : "🌙";
    toggle.setAttribute("aria-label", dark ? "切换亮色模式" : "切换深色模式");
  };

  syncToggle();
  toggle.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (err) {
      // ignore
    }
    syncToggle();
  });
}

/* ---------- 移动端导航菜单 ---------- */
function initNavMenu() {
  const toggle = el("nav-toggle");
  const nav = el("site-nav");
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
    nav.classList.toggle("is-open", open);
    document.body.classList.toggle("nav-open", open);
  };

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  // 当前页面导航高亮
  const activeHref = {
    announcement: "/#announcements",
    rules: "/#rules",
    plugins: "/plugins/",
    changelog: "/changelog/"
  }[document.body.dataset.page];

  if (activeHref) {
    nav.querySelectorAll("a").forEach((link) => {
      if (link.getAttribute("href") === activeHref) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (
      nav.classList.contains("is-open") &&
      !nav.contains(event.target) &&
      !toggle.contains(event.target)
    ) {
      setOpen(false);
    }
  });
}

/* ---------- 轻量入场动画：只观察新增内容，不接管滚动 ---------- */
let revealObserver;
const revealSelector = ".section-head, .server-card, .quick-link, .announcement-card, .member-card, .project-card, .rules-summary, .rules-block";

function revealContent(root = document) {
  if (!revealObserver) return;
  root.querySelectorAll(revealSelector).forEach((node, index) => {
    if (node.dataset.revealReady) return;
    node.dataset.revealReady = "true";
    node.style.setProperty("--reveal-delay", `${Math.min(index % 6, 3) * 60}ms`);
    node.classList.add("reveal-pending");
    revealObserver.observe(node);
  });
}

function initVisualEffects() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!reduceMotion.matches && "IntersectionObserver" in window) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove("reveal-pending");
        entry.target.classList.add("reveal-enter");
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0, rootMargin: "0px 0px -32px 0px" });
    revealContent();
    reduceMotion.addEventListener("change", (event) => {
      if (!event.matches || !revealObserver) return;
      revealObserver.disconnect();
      revealObserver = null;
      document.querySelectorAll(".reveal-pending").forEach((node) => node.classList.remove("reveal-pending"));
    });
  }

  if (document.body.dataset.page !== "home") return;
  const header = document.querySelector(".site-header");
  const sections = [...document.querySelectorAll("main > section[id]")];
  const links = [...document.querySelectorAll('.site-nav a[href^="/#"]')];
  let scheduled = false;
  const update = () => {
    scheduled = false;
    header?.classList.toggle("is-scrolled", window.scrollY > 24);
    const current = sections.filter((section) => section.getBoundingClientRect().top <= 160).pop();
    links.forEach((link) => {
      const active = link.hash === `#${current?.id}`;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };
  window.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

/* ---------- 初始化：公告与状态检测独立加载 ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initNavMenu();
  initVisualEffects();
  if (document.body.dataset.page === "home") initSectionSwitch();

  const globalTask = (async () => {
    try {
      const server = await loadJSON("server.json");
      await initGlobal(server);
    } catch (err) {
      console.error(err);
      setStatus("offline", "配置加载失败");
      const notice = el("server-notice");
      if (notice) notice.textContent = "无法读取 data/server.json，请使用本地 HTTP 服务或检查文件路径。";
    }
  })();

  await Promise.allSettled([
    globalTask, renderAnnouncements(), renderMembers(), renderProjects(),
    renderQuickLinks(), renderChangelog(), renderRules(),
    document.body.dataset.page === "announcement" ? renderAnnouncementDetail() : Promise.resolve()
  ].map((task) => Promise.resolve(task).finally(() => revealContent())));
  revealContent();
});
