import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const loader = await readFile(new URL("../assets/js/announcements.js", import.meta.url), "utf8");
const app = await readFile(new URL("../assets/js/app.js", import.meta.url), "utf8");
const meta = { id: "news", file: "news.json", title: "活动公告", date: "2026-10-02", summary: "新的旅程", showOnHome: true };
const detail = { ...meta, content: "第一行\nhttps://example.com/?a=1&b=2", images: [] };

function environment({ hostname = "doctoridd.pages.dev", base = "https://docidd.github.io/idd-official-web", index = [meta], fetcher, timers = {} } = {}) {
  const calls = [];
  const nodes = new Map();
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout, ...timers,
    location: { hostname, origin: `https://${hostname}`, search: "?id=news" },
    document: { addEventListener() {}, getElementById: (id) => nodes.get(id), querySelectorAll: () => [] },
    console,
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      if (fetcher) return fetcher(url, options, calls);
      return { ok: true, json: async () => url === "/data/site.json"
        ? { announcementsBaseUrl: base, announcementsLocalBaseUrl: "/data/announcements/" }
        : String(url).endsWith("index.json") ? index : detail };
    }
  });
  context.window = context;
  vm.runInContext(loader, context);
  vm.runInContext(app, context);
  return { api: context.AnnouncementSource, calls, context, nodes };
}

function nodeStub() {
  return { innerHTML: "", textContent: "", attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, querySelectorAll: () => [], querySelector: () => ({ addEventListener() {} }) };
}

test("production uses the GitHub project subpath with CORS and no credentials", async () => {
  const env = environment();
  await env.api.loadIndex();
  await env.api.loadDetail(meta);
  assert.deepEqual(env.calls.map((call) => call.url), ["/data/site.json", "https://docidd.github.io/idd-official-web/index.json", "https://docidd.github.io/idd-official-web/news.json"]);
  assert.equal(env.calls[1].options.credentials, "omit");
  assert.equal(env.calls[1].options.mode, "cors");
  assert.equal(env.calls[1].options.cache, "no-cache");
});

test("loopback preview reads local announcements, including IPv6", async () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    const env = environment({ hostname });
    await env.api.loadIndex();
    assert.equal(env.calls[1].url, `https://${hostname}/data/announcements/index.json`);
  }
});

test("concurrent consumers share the index request", async () => {
  const env = environment();
  await Promise.all([env.api.loadIndex(), env.api.loadIndex(), env.api.loadIndex()]);
  assert.equal(env.calls.length, 2);
});

test("failed requests can be retried without using stale local data", async () => {
  let fail = true;
  const env = environment({ fetcher: async (url) => {
    if (url === "/data/site.json") return { ok: true, json: async () => ({ announcementsBaseUrl: "https://example.com/" }) };
    if (fail) return { ok: false, status: 503 };
    return { ok: true, json: async () => [meta] };
  } });
  await assert.rejects(env.api.loadIndex(), /503/);
  fail = false;
  await env.api.loadIndex();
  assert.equal(env.calls.length, 3);
  assert.ok(env.calls.every((call) => !call.url.includes("/data/announcements/")));
});

test("malformed indexes, duplicate IDs, unsafe paths and HTTP production sources are rejected", async () => {
  await assert.rejects(environment({ index: {} }).api.loadIndex(), /格式错误/);
  await assert.rejects(environment({ index: [meta, meta] }).api.loadIndex(), /条目无效/);
  await assert.rejects(environment({ index: [{ ...meta, file: "../server.json" }] }).api.loadIndex(), /文件名无效/);
  await assert.rejects(environment({ base: "http://example.com/" }).api.loadIndex(), /HTTPS/);
});

test("reset refreshes configuration and index", async () => {
  const env = environment();
  await env.api.loadIndex();
  env.api.reset();
  await env.api.loadIndex();
  assert.equal(env.calls.length, 4);
});

test("slow requests are aborted after eight seconds", async () => {
  let expire;
  let duration;
  const env = environment({
    timers: { setTimeout(callback, ms) { expire = callback; duration = ms; return 1; }, clearTimeout() {} },
    fetcher: (url, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted"))))
  });
  const pending = env.api.loadIndex();
  assert.equal(duration, 8000);
  expire();
  await assert.rejects(pending, /aborted/);
});

test("relative images resolve to the announcement service and script URLs are ignored", async () => {
  const env = environment();
  assert.equal(await env.api.imageUrl("images/event.png"), "https://docidd.github.io/idd-official-web/images/event.png");
  assert.equal(await env.api.imageUrl("javascript:alert(1)"), "");
});

test("home renders summaries with one index request, escapes titles and clears loading state", async () => {
  const env = environment({ index: [{ ...meta, title: '<img src=x onerror="alert(1)">' }] });
  const list = nodeStub();
  env.nodes.set("announcements-list", list);
  await vm.runInContext("renderAnnouncements()", env.context);
  assert.match(list.innerHTML, /新的旅程/);
  assert.match(list.innerHTML, /&lt;img/);
  assert.doesNotMatch(list.innerHTML, /<img src=x/);
  assert.equal(list.attributes["aria-busy"], "false");
  assert.equal(env.calls.length, 2);
});

test("text escapes HTML while preserving links and trailing punctuation", () => {
  const env = environment();
  const html = vm.runInContext('autoLinkLine(\'<script>alert(1)</script> https://example.com/?a=1&b=2.\')', env.context);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.ok(html.endsWith("</a>."));
});

test("missing announcements show a clear detail state without requesting arbitrary files", async () => {
  const env = environment({ index: [] });
  const content = nodeStub();
  const title = nodeStub();
  env.nodes.set("announcement-detail-content", content);
  env.nodes.set("announcement-detail-title", title);
  await vm.runInContext("renderAnnouncementDetail()", env.context);
  assert.equal(title.textContent, "公告不存在");
  assert.equal(content.attributes["aria-busy"], "false");
  assert.equal(env.calls.length, 2);
});

test("build separates the main site from announcements and developer files", async () => {
  execFileSync(process.execPath, ["scripts/build-pages.mjs"], { cwd: new URL("..", import.meta.url), stdio: "pipe" });
  for (const file of ["dist/cloudflare/index.html", "dist/cloudflare/announcements/view.html", "dist/cloudflare/data/site.json", "dist/github-pages/index.json", "dist/github-pages/server-announcement.json"]) {
    await access(new URL("../" + file, import.meta.url));
  }
  for (const file of ["dist/cloudflare/data/announcements/index.json", "dist/cloudflare/.wrangler", "dist/cloudflare/scripts", "dist/cloudflare/README.md", "dist/github-pages/assets/js/app.js"]) {
    await assert.rejects(access(new URL("../" + file, import.meta.url)));
  }
  const routes = JSON.parse(await readFile(new URL("../dist/cloudflare/_routes.json", import.meta.url), "utf8"));
  assert.deepEqual(routes.include, ["/api/*"]);
  for (const file of ["index.html", "announcements/view.html", "changelog/index.html", "plugins/index.html", "rules/index.html"]) {
    const html = await readFile(new URL("../dist/cloudflare/" + file, import.meta.url), "utf8");
    assert.ok(html.indexOf("/assets/js/announcements.js") < html.indexOf("/assets/js/app.js"));
    assert.ok(html.includes("/assets/js/announcements.js"));
  }
});
