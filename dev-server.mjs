// 本地测试用开发服务器
// 用法：node dev-server.mjs
// 默认端口 8765，可通过 PORT 环境变量修改。
//
// 与 python3 -m http.server 的区别：
// 1. 同样提供静态文件；
// 2. 额外提供 /api/status，用 Node net 在本机执行 Minecraft Server List Ping，
//    用于在本地模拟 Cloudflare Pages Function 的行为。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8765);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function varInt(value) {
  const bytes = [];
  while (true) {
    let b = value & 0x7f;
    value >>>= 7;
    if (value !== 0) b |= 0x80;
    bytes.push(b);
    if (value === 0) break;
  }
  return Buffer.from(bytes);
}

function concat(buffers) {
  return Buffer.concat(buffers);
}

function buildStatusRequest(host, port) {
  const hostBytes = Buffer.from(host, "utf8");
  const body = concat([
    varInt(47),
    varInt(hostBytes.length),
    hostBytes,
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    varInt(1)
  ]);
  return concat([
    varInt(body.length + 1),
    varInt(0),
    body
  ]);
}

const STATUS_REQUEST = Buffer.from([0x01, 0x00]);

function flattenMOTD(desc) {
  if (!desc) return "";
  if (typeof desc === "string") return desc;
  let text = "";
  if (desc.text) text += desc.text;
  if (Array.isArray(desc.extra)) {
    for (const part of desc.extra) text += flattenMOTD(part);
  }
  return text;
}

function mcPing(host, port, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    let finished = false;

    const timer = setTimeout(() => {
      finish(false, new Error("连接超时"));
    }, timeoutMs);

    function finish(ok, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      if (ok) resolve(value);
      else reject(value);
    }

    socket.on("connect", () => {
      socket.write(buildStatusRequest(host, port));
      socket.write(STATUS_REQUEST);
    });

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        let pos = 0;
        function readVarInt() {
          let value = 0;
          let shift = 0;
          while (true) {
            const b = buf[pos++];
            value |= (b & 0x7f) << shift;
            if ((b & 0x80) === 0) break;
            shift += 7;
          }
          return value >>> 0;
        }

        readVarInt(); // packet length
        const packetId = readVarInt();
        if (packetId !== 0x00) return;

        const jsonLength = readVarInt();
        if (buf.length < pos + jsonLength) return;

        const text = buf.slice(pos, pos + jsonLength).toString("utf8");
        const data = JSON.parse(text);
        finish(true, data);
      } catch (err) {
        finish(false, err);
      }
    });

    socket.on("error", (err) => finish(false, err));
    socket.on("close", () => {
      if (!finished) finish(false, new Error("连接被服务器关闭"));
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // 本地模拟 Cloudflare Pages Function：/api/status
  if (url.pathname === "/api/status") {
    const host = (url.searchParams.get("host") || "").trim();
    const port = Number(url.searchParams.get("port") || 25565);

    if (!host) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ online: false, error: "missing host" }));
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ online: false, error: "invalid port" }));
      return;
    }

    const rawTimeout = Number(url.searchParams.get("timeout") || 10000);
    const timeoutMs = Number.isFinite(rawTimeout)
      ? Math.min(Math.max(rawTimeout, 1000), 30000)
      : 10000;

    try {
      const status = await mcPing(host, port, timeoutMs);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        online: true,
        host,
        port,
        version: status.version?.name || "",
        protocol: status.version?.protocol ?? null,
        players: {
          online: status.players?.online ?? 0,
          max: status.players?.max ?? 0
        },
        motd: flattenMOTD(status.description),
        favicon: status.favicon || null
      }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        online: false,
        host,
        port,
        error: err?.message || "连接失败"
      }));
    }
    return;
  }

  // 静态文件
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  let filePath = path.resolve(ROOT, "." + pathname);
  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (pathname.endsWith("/")) {
    filePath = path.join(filePath, "index.html");
  }

  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch (err) {
    try {
      const notFound = await fs.promises.readFile(path.join(ROOT, "404.html"));
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(notFound);
    } catch (_) {
      res.writeHead(404);
      res.end("Not Found");
    }
  }
});

server.listen(PORT, () => {
  console.log(`本地开发服务器已启动：http://localhost:${PORT}`);
  console.log(`本地 MC 状态接口：http://localhost:${PORT}/api/status?host=doctoridd.net&port=25565`);
});
