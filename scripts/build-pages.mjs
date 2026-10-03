import { cp, mkdir, readFile, readdir, rm, writeFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AnnouncementFormat from "../assets/js/announcement-format.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] || "all";
if (!["all", "cloudflare", "github"].includes(target)) throw new Error("目标必须为 all、cloudflare 或 github");

async function json(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

async function validateAnnouncements() {
  const index = await json("data/announcements/index.json");
  if (!Array.isArray(index)) throw new Error("公告索引必须为数组");
  const ids = new Set();
  for (const meta of index) {
    if (!meta || typeof meta.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(meta.id) || typeof meta.title !== "string" ||
        typeof meta.date !== "string" || ids.has(meta.id)) throw new Error("公告索引条目无效或 ID 重复");
    ids.add(meta.id);
    const file = meta.file || meta.id + ".json";
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(file) || file === "index.json") throw new Error(`公告文件名无效：${file}`);
    const detail = await json(`data/announcements/${file}`);
    if (detail.id !== meta.id || typeof detail.title !== "string" || typeof detail.content !== "string") {
      throw new Error(`公告正文无效：${file}`);
    }
    try { AnnouncementFormat.validateMedia(detail); }
    catch (error) { throw new Error(`${file}：${error.message}`); }
  }
}

async function prepareOutput(name) {
  const dist = path.resolve(root, "dist");
  const output = path.resolve(dist, name);
  // 仅清理本项目两个已知产物目录，拒绝符号链接与目录跳转。
  if (!["cloudflare", "github-pages"].includes(name) || path.dirname(output) !== dist) throw new Error("输出目录越界");
  await mkdir(dist, { recursive: true });
  if ((await lstat(dist)).isSymbolicLink() || await realpath(dist) !== dist) throw new Error("dist 不可为链接目录");
  try {
    if ((await lstat(output)).isSymbolicLink() || await realpath(output) !== output) throw new Error("输出目录不可为链接目录");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  return output;
}

if (target === "all" || target === "github") {
  await validateAnnouncements();
  const output = await prepareOutput("github-pages");
  await cp(path.join(root, "data/announcements"), output, { recursive: true });
  await writeFile(path.join(output, ".nojekyll"), "");
  await writeFile(path.join(output, "index.html"), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DoctorIDD 公告数据</title><body><h1>DoctorIDD 公告数据</h1>
<p>本服务为主站提供公告索引与正文。</p><p><a href="./index.json">查看公告索引</a></p></body></html>\n`);
  console.log("GitHub Pages 公告产物：dist/github-pages（index.json 和公告正文）");
}

if (target === "all" || target === "cloudflare") {
  const config = await json("data/site.json");
  const source = new URL(config.announcementsBaseUrl);
  if (source.protocol !== "https:") throw new Error("生产公告地址必须使用 HTTPS");
  const output = await prepareOutput("cloudflare");
  for (const relative of ["index.html", "404.html", "logo.png", "assets", "announcements", "changelog", "plugins", "rules", "_headers"]) {
    await cp(path.join(root, relative), path.join(output, relative), { recursive: true });
  }
  await mkdir(path.join(output, "data"));
  for (const entry of await readdir(path.join(root, "data"), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await cp(path.join(root, "data", entry.name), path.join(output, "data", entry.name));
    }
  }
  // Functions 仍由项目根目录 functions/ 编译，仅 API 路径调用 Function。
  await writeFile(path.join(output, "_routes.json"), JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2) + "\n");
  console.log("Cloudflare Pages 主站产物：dist/cloudflare（公告通过 fetch 远程读取）");
}
