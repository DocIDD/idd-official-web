/* 公告源独立于主站：生产环境读取 GitHub Pages 或国内镜像，本地预览读取本地 JSON。
   公告源可以配置多个，主源失败时按顺序回退，避免单个公共 CDN 失效就完全看不到公告。 */
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

  function toBase(value, message) {
    if (typeof value !== "string" || !value.trim()) throw new Error(message || "未配置公告地址");
    const url = new URL(value.endsWith("/") ? value : value + "/", location.origin);
    if (url.protocol !== "https:" && !(isLocalPreview() && url.protocol === "http:")) {
      throw new Error("公告地址需要使用 HTTPS");
    }
    return url;
  }

  function unique(list) {
    return list.filter((url, index) => list.findIndex((other) => other.href === url.href) === index);
  }

  async function getSources() {
    if (!sourcePromise) {
      sourcePromise = fetchJSON("/data/site.json").then((config) => {
        if (isLocalPreview()) {
          const local = toBase(config.announcementsLocalBaseUrl || "/data/announcements/");
          return { json: [local], media: [local] };
        }
        const primary = toBase(config.announcementsBaseUrl);
        // 图片 / 音视频可单独走更快的一路，未配置时与主源相同。
        const media = toBase(config.announcementsMediaBaseUrl || config.announcementsBaseUrl);
        const extras = (Array.isArray(config.announcementsFallbackBaseUrls) ? config.announcementsFallbackBaseUrls : [])
          .map((value) => toBase(value, "备用公告地址"));
        return { json: unique([primary, ...extras]), media: unique([media, ...extras]) };
      }).catch((error) => {
        sourcePromise = undefined;
        throw error;
      });
    }
    return sourcePromise;
  }

  // 记住上次成功的源并优先使用，避免每次都先等失效源超时。
  const preferred = { json: "", media: "" };

  function order(list, key) {
    const hit = list.findIndex((url) => url.href === preferred[key]);
    return hit > 0 ? [list[hit], ...list.filter((_, index) => index !== hit)] : list;
  }

  function fileName(meta) {
    const name = meta.file || meta.id + ".json";
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(name) || name === "index.json") {
      throw new Error("公告文件名无效");
    }
    return name;
  }

  async function loadFile(name) {
    const list = order((await getSources()).json, "json");
    let lastError;
    for (const base of list) {
      const url = new URL(name, base).href;
      try {
        if (!requests.has(url)) {
          requests.set(url, fetchJSON(url).catch((error) => {
            requests.delete(url);
            throw error;
          }));
        }
        const value = await requests.get(url);
        preferred.json = base.href;
        return value;
      } catch (error) {
        // 单个源失败（被墙 / 超时 / 缓存坏）时继续尝试下一个，不直接放弃。
        lastError = error;
      }
    }
    throw lastError || new Error("公告源不可用");
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

  // 图片 / 音视频是直接交给浏览器加载的，无法逐张回退；
  // 这里先用体积很小的 index.json 探一次哪个源可用（详情页流程中已缓存，等于免费），
  // 之后所有媒体都走这个源。全部失败时仍返回首选，交给浏览器自己尝试。
  async function mediaBase() {
    const list = order((await getSources()).media, "media");
    for (const base of list) {
      const url = new URL("index.json", base).href;
      try {
        if (!requests.has(url)) {
          requests.set(url, fetchJSON(url).catch((error) => {
            requests.delete(url);
            throw error;
          }));
        }
        await requests.get(url);
        preferred.media = base.href;
        return base;
      } catch (error) {
        // 继续尝试下一个源
      }
    }
    return list[0];
  }

  async function imageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const base = await mediaBase();
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
    reset() {
      requests.clear();
      sourcePromise = undefined;
      preferred.json = "";
      preferred.media = "";
    }
  };
})();
