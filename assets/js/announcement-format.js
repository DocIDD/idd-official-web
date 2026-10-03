/* 浏览器与发布 / 编辑脚本共用的公告格式规则。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AnnouncementFormat = factory();
})(globalThis, function () {
  function parse(content) {
    const value = String(content || "").replace(/\r/g, "");
    const pattern = /([!@]?)\[([^\]\n]*)\]\(([^\n)]+)\)/g;
    const tokens = [];
    let offset = 0;
    for (const match of value.matchAll(pattern)) {
      if (match.index > offset) tokens.push({ type: "text", text: value.slice(offset, match.index) });
      tokens.push({ type: match[1] === "!" ? "image" : match[1] === "@" ? "player" : "link", title: match[2], url: match[3].trim(), raw: match[0] });
      offset = match.index + match[0].length;
    }
    if (offset < value.length) tokens.push({ type: "text", text: value.slice(offset) });
    return tokens;
  }

  function extractUrl(raw) {
    const value = String(raw || "").trim();
    if (!/^<iframe\b/i.test(value)) return value;
    const match = value.match(/\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!match) throw new Error("嵌入代码缺少 src 地址");
    return (match[1] ?? match[2] ?? match[3]).replace(/&amp;/gi, "&").replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)));
  }

  function normalizePlayer(item, baseUrl = "https://announcements.invalid/") {
    if (!item || typeof item !== "object") throw new Error("播放器条目必须为对象");
    const type = item.type || "iframe";
    if (!["iframe", "netease", "bilibili", "audio", "video"].includes(type)) throw new Error("播放器类型无效");
    let raw = extractUrl(item.url);
    if (type === "netease" && /^\d+$/.test(raw)) raw = `https://music.163.com/song?id=${raw}`;
    if (type === "bilibili" && /^BV[\da-zA-Z]{10}$/.test(raw)) raw = `https://www.bilibili.com/video/${raw}`;
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error("请填写播放器地址");
    if (raw.startsWith("//")) raw = "https:" + raw;
    let url;
    try { url = new URL(raw, ["audio", "video"].includes(type) ? baseUrl : undefined); }
    catch (error) { throw new Error("播放器地址无效，请使用完整 HTTPS 链接或平台嵌入代码"); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("播放器地址需要使用 HTTPS");
    if (url.username || url.password) throw new Error("播放器地址不可包含账号密码");
    const title = typeof item.title === "string" && item.title.trim() ? item.title : "公告播放器";
    const result = { type: ["audio", "video"].includes(type) ? type : "iframe", url: url.href, originalUrl: url.href, title, provider: "外置播放器", layout: item.layout === "audio" ? "audio" : "video", height: 160 };
    if (result.type !== "iframe") {
      result.provider = result.type === "audio" ? "音频" : "视频";
      return result;
    }

    if (["music.163.com", "www.music.163.com"].includes(url.hostname)) {
      const songUrl = url.hash.startsWith("#/") ? new URL(url.hash.slice(1), url.origin) : url;
      let musicType = ({ "/song": "2", "/playlist": "0", "/album": "1" })[songUrl.pathname.replace(/\/$/, "")];
      if (url.pathname === "/outchain/player") musicType = url.searchParams.get("type");
      const id = songUrl.searchParams.get("id");
      if (!/^[012]$/.test(musicType || "") || !/^\d+$/.test(id || "")) throw new Error("网易云链接需要包含歌曲、歌单或专辑 ID");
      const height = musicType === "2" ? 66 : 310;
      result.url = `https://music.163.com/outchain/player?type=${musicType}&id=${id}&auto=0&height=${height}`;
      result.originalUrl = `https://music.163.com/${({ "2": "song", "0": "playlist", "1": "album" })[musicType]}?id=${id}`;
      result.provider = "网易云音乐";
      result.layout = "audio";
      result.height = height + 24;
    } else if (["www.bilibili.com", "bilibili.com", "m.bilibili.com", "player.bilibili.com"].includes(url.hostname)) {
      const bvid = url.searchParams.get("bvid") || url.pathname.match(/\/video\/(BV[\da-zA-Z]{10})/)?.[1];
      const aid = url.searchParams.get("aid") || url.pathname.match(/\/video\/av(\d+)/)?.[1];
      const episode = url.searchParams.get("episodeId");
      if (!/^BV[\da-zA-Z]{10}$/.test(bvid || "") && !/^\d+$/.test(aid || "") && !/^\d+$/.test(episode || "")) throw new Error("请使用完整的 B站视频链接（含 BV / av 编号）或官方嵌入代码");
      const player = new URL("https://player.bilibili.com/player.html");
      if (/^\d+$/.test(episode || "")) player.searchParams.set("episodeId", episode);
      else if (/^BV[\da-zA-Z]{10}$/.test(bvid || "")) player.searchParams.set("bvid", bvid);
      else player.searchParams.set("aid", aid);
      const part = url.searchParams.get("p") || url.searchParams.get("page") || "1";
      player.searchParams.set("p", /^[1-9]\d*$/.test(part) ? part : "1");
      for (const name of ["cid", "t"]) {
        const value = url.searchParams.get(name);
        if (/^\d+$/.test(value || "")) player.searchParams.set(name, value);
      }
      player.searchParams.set("autoplay", "0");
      result.url = player.href;
      result.originalUrl = player.searchParams.has("episodeId") ? url.href : `https://www.bilibili.com/video/${player.searchParams.get("bvid") || "av" + aid}/?p=${player.searchParams.get("p")}`;
      result.provider = "哔哩哔哩";
      result.layout = "video";
    } else if (type === "netease" || type === "bilibili") {
      throw new Error("链接与选择的播放器平台不匹配");
    }
    if (item.height != null) {
      if (!Number.isFinite(item.height) || item.height < 80 || item.height > 720) throw new Error("播放器高度需要为 80–720 之间的数字");
      result.height = item.height;
      result.fixedHeight = true;
    }
    return result;
  }

  function validateMedia(data) {
    if (data.images != null && (!Array.isArray(data.images) || data.images.some((image) => typeof image !== "string" && (!image || typeof image.url !== "string" || (image.alt != null && typeof image.alt !== "string"))))) {
      throw new Error("图片列表需要填写地址，或含 url 和 alt 的图片对象");
    }
    if (data.players != null) {
      if (!Array.isArray(data.players)) throw new Error("播放器必须为列表");
      for (const player of data.players) normalizePlayer(player);
    }
    for (const token of parse(data.content)) {
      if (token.type === "player") normalizePlayer({ url: token.url, title: token.title });
    }
  }
  return { parse, extractUrl, normalizePlayer, validateMedia };
});
