// 上海阿里云轻量服务器用的独立 MC 状态服务
// 作用：从上海节点执行 Minecraft Server List Ping，给 Cloudflare Pages Function 做回退。
//
// 部署方法（不需要域名 / ICP）：
//   1. 把本文件放到上海服务器，执行：node status-server.mjs
//   2. 默认监听 2096 端口，可用 PORT 环境变量改：PORT=9000 node status-server.mjs
//   3. 在阿里云安全组放行对应 TCP 端口（建议只放行 Cloudflare 出口 IP，或至少限制来源）
//   4. 在 Cloudflare Pages 环境变量里设置：
//        SHANGHAI_STATUS_API = http://<上海服务器公网IP>:2096
//
// 测试：
//   curl "http://<上海服务器公网IP>:2096/api/status?host=frp-sun.com&port=31067"

import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT || 2096);

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

function mcPing(host, port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    let finished = false;
    let connected = false;

    const timer = setTimeout(() => {
      finish(false, new Error(connected ? "STATUS_TIMEOUT" : "连接超时"));
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
      connected = true;
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

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname !== "/api/status") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const host = (url.searchParams.get("host") || "").trim();
  const port = Number(url.searchParams.get("port") || 25565);
  const rawTimeout = Number(url.searchParams.get("timeout") || 15000);
  const timeoutMs = Number.isFinite(rawTimeout)
    ? Math.min(Math.max(rawTimeout, 1000), 30000)
    : 15000;

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
    // 如果 TCP 已连通但状态查询被 FRP 屏蔽，降级为 TCP 在线
    if (err?.message === "STATUS_TIMEOUT") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        online: true,
        mode: "tcp",
        host,
        port,
        version: "",
        players: { online: 0, max: 0 },
        motd: "",
        favicon: null,
        note: "TCP 连通，MC 状态查询被线路屏蔽"
      }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      online: false,
      host,
      port,
      error: err?.message || "连接失败"
    }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`上海 MC 状态服务已启动：http://0.0.0.0:${PORT}`);
  console.log(`测试：curl "http://<公网IP>:${PORT}/api/status?host=frp-sun.com&port=31067"`);
});