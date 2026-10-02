// 双端口预览正式产物，验证公告跨域 fetch 与 GitHub 项目子路径。
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const announcementUrl = "http://localhost:8766/idd-official-web/";

function serve(folder, port, prefix = "/") {
  const directory = path.join(root, "dist", folder);
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    if (folder === "github-pages") response.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const url = new URL(request.url, `http://localhost:${port}`);
      if (folder === "cloudflare" && url.pathname === "/data/site.json") {
        const config = JSON.parse(await readFile(path.join(directory, "data/site.json"), "utf8"));
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ...config, announcementsLocalBaseUrl: announcementUrl }));
        return;
      }
      if (!url.pathname.startsWith(prefix)) throw new Error("Not found");
      let relative = decodeURIComponent(url.pathname.slice(prefix.length));
      if (!relative || relative.endsWith("/")) relative += "index.html";
      const file = path.resolve(directory, relative);
      const boundary = path.relative(directory, file);
      if (boundary.startsWith("..") || path.isAbsolute(boundary)) throw new Error("Not found");
      const data = await readFile(file);
      response.setHeader("Content-Type", (types[path.extname(file)] || "application/octet-stream") + "; charset=utf-8");
      response.end(data);
      if (folder === "github-pages" && file.endsWith(".json")) console.log(`公告跨域请求：${url.pathname}（Origin: ${request.headers.origin || "无"}）`);
    } catch (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  server.listen(port, "localhost", () => console.log(`${folder}：http://localhost:${port}${prefix}`));
  return server;
}

const servers = [serve("github-pages", 8766, "/idd-official-web/"), serve("cloudflare", 8767)];
process.on("SIGINT", () => servers.forEach((server) => server.close()));
