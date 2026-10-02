/* 公告源独立于主站：生产环境读取 GitHub Pages，本地预览读取本地 JSON。 */
(() => {
  const requests = new Map();
  let sourcePromise;

  async function fetchJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
        cache: "no-cache"
      });
      if (!response.ok) throw new Error(`公告请求失败 (${response.status})`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function isLocalPreview() {
    return ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  }

  async function getBaseUrl() {
    if (!sourcePromise) {
      sourcePromise = fetchJSON("/data/site.json").then((config) => {
        const configured = isLocalPreview()
          ? config.announcementsLocalBaseUrl || "/data/announcements/"
          : config.announcementsBaseUrl;
        if (typeof configured !== "string" || !configured.trim()) {
          throw new Error("未配置公告地址");
        }
        const url = new URL(configured.endsWith("/") ? configured : configured + "/", location.origin);
        if (url.protocol !== "https:" && !(isLocalPreview() && url.protocol === "http:")) {
          throw new Error("公告地址需要使用 HTTPS");
        }
        return url;
      }).catch((error) => {
        sourcePromise = undefined;
        throw error;
      });
    }
    return sourcePromise;
  }

  function fileName(meta) {
    const name = meta.file || meta.id + ".json";
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(name) || name === "index.json") {
      throw new Error("公告文件名无效");
    }
    return name;
  }

  async function loadFile(name) {
    const base = await getBaseUrl();
    const url = new URL(name, base).href;
    if (!requests.has(url)) {
      requests.set(url, fetchJSON(url).catch((error) => {
        requests.delete(url);
        throw error;
      }));
    }
    return requests.get(url);
  }

  async function loadIndex() {
    const items = await loadFile("index.json");
    const ids = new Set();
    try {
      if (!Array.isArray(items)) throw new Error("公告索引格式错误");
      for (const item of items) {
        if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(item.id) ||
            typeof item.title !== "string" || typeof item.date !== "string" || ids.has(item.id)) {
          throw new Error("公告索引条目无效");
        }
        fileName(item);
        ids.add(item.id);
      }
    } catch (error) {
      requests.clear();
      throw error;
    }
    return items;
  }

  async function loadDetail(meta) {
    const name = fileName(meta);
    const data = await loadFile(name);
    if (!data || data.id !== meta.id || typeof data.title !== "string" || typeof data.content !== "string") {
      requests.clear();
      throw new Error("公告正文格式错误");
    }
    return data;
  }

  async function imageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const base = await getBaseUrl();
    try {
      const url = new URL(value, base);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  window.AnnouncementSource = {
    loadIndex,
    loadDetail,
    imageUrl,
    reset() { requests.clear(); sourcePromise = undefined; }
  };
})();
