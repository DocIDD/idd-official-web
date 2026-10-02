// Cloudflare Pages Function: /api/status
// 通过 Minecraft Server List Ping 从 Cloudflare 边缘节点直接检测线路/服务器是否可用。
// 支持普通域名直连、IP 直连和樱花FRP等 TCP 转发线路。

import { connect } from "cloudflare:sockets";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store"
};

// 上海阿里云轻量服务器上的回退状态 API（无域名也能用公网 IP 访问）。
// 优先读 Cloudflare 环境变量 SHANGHAI_STATUS_API，没设置时用下面这个默认值。
const SHANGHAI_STATUS_API = "http://139.196.54.254:2096";

function json(data, status = 200) {
  // build 字段用于确认线上是否已经是带上海回退的新版
  return new Response(JSON.stringify({ build: "v2-fallback", ...data }), {
    status,
    headers: JSON_HEADERS
  });
}

function varInt(value) {
  const bytes = [];
  while (true) {
    let b = value & 0x7f;
    value >>>= 7;
    if (value !== 0) b |= 0x80;
    bytes.push(b);
    if (value === 0) break;
  }
  return Uint8Array.from(bytes);
}

function concat(arrays) {
  let total = 0;
  for (const arr of arrays) total += arr.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

// Minecraft 1.7+ 状态协议握手包
function buildStatusRequest(host, port) {
  const hostBytes = new TextEncoder().encode(host);
  const body = concat([
    varInt(47), // 协议版本：47 常用于状态查询，绝大多数服务器都会响应
    varInt(hostBytes.length),
    hostBytes,
    new Uint8Array([(port >> 8) & 0xff, port & 0xff]),
    varInt(1) // next state = 1 (status)
  ]);

  // 完整包 = [VarInt 包头长度] + [VarInt packet id=0x00] + [body]
  return concat([
    varInt(body.length + 1),
    varInt(0),
    body
  ]);
}

// 状态请求：packet id = 0x00，无额外字段
const STATUS_REQUEST = Uint8Array.from([0x01, 0x00]);

// 从 socket.readable 流中按需读取
class StreamReader {
  constructor(reader) {
    this.reader = reader;
    this.buffer = new Uint8Array(0);
    this.offset = 0;
  }

  async ensure(size) {
    while (this.buffer.length - this.offset < size) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error("服务器未返回完整数据");
      const merged = new Uint8Array(this.buffer.length + value.length);
      merged.set(this.buffer);
      merged.set(value, this.buffer.length);
      this.buffer = merged;
    }
  }

  async readVarInt() {
    let value = 0;
    let shift = 0;
    while (true) {
      await this.ensure(1);
      const b = this.buffer[this.offset++];
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return value >>> 0;
  }

  async readBytes(size) {
    await this.ensure(size);
    const result = this.buffer.slice(this.offset, this.offset + size);
    this.offset += size;
    return result;
  }
}

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

async function mcServerStatus(host, port, timeoutMs = 10000) {
  let socket;
  let timer;
  let connected = false;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // 如果 TCP 已连通但 MC 状态包没有返回，说明是 FRP 屏蔽了状态查询；
      // 此时线路本身可用，交给上层降级为 TCP 在线。
      reject(new Error(connected ? "STATUS_TIMEOUT" : "连接超时"));
      try {
        socket?.close();
      } catch {
        // ignore
      }
    }, timeoutMs);
  });

  const work = (async () => {
    socket = connect({ hostname: host, port });

    // 等待 TCP 连接真正建立
    if (socket.opened) {
      await socket.opened;
    }
    connected = true;

    const writer = socket.writable.getWriter();
    await writer.write(buildStatusRequest(host, port));
    await writer.write(STATUS_REQUEST);
    // 不主动关闭写端，让服务器正常返回状态响应

    const reader = socket.readable.getReader();
    const br = new StreamReader(reader);

    const packetLength = await br.readVarInt();
    const packetId = await br.readVarInt();
    if (packetId !== 0x00) {
      throw new Error("意外的响应包 ID: " + packetId);
    }

    const jsonLength = await br.readVarInt();
    const jsonBytes = await br.readBytes(jsonLength);
    const text = new TextDecoder().decode(jsonBytes);
    return JSON.parse(text);
  })();

  // 如果超时先触发，work 后续的拒绝不再被 unhandled rejection 报告
  work.catch(() => {});

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    try {
      socket?.close();
    } catch {
      // ignore
    }
  }
}

// Cloudflare Workers 的 fetch() 对部分端口有限制，会返回 403。
// 这里改用 cloudflare:sockets 的 connect() 直接发 HTTP/1.1 请求，绕过 fetch 的端口限制。
async function httpGetViaSocket(host, port, path, timeoutMs = 15000) {
  let socket;
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("HTTP 连接超时")), timeoutMs);
  });

  const work = (async () => {
    socket = connect({ hostname: host, port });
    if (socket.opened) {
      await socket.opened;
    }

    const writer = socket.writable.getWriter();
    const request =
      `GET ${path} HTTP/1.1\r\n` +
      `Host: ${host}\r\n` +
      "User-Agent: CloudflarePagesStatus/1.0\r\n" +
      "Connection: close\r\n" +
      "\r\n";
    await writer.write(new TextEncoder().encode(request));

    const reader = socket.readable.getReader();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    const text = new TextDecoder().decode(concat(chunks));
    const headerEnd = text.indexOf("\r\n\r\n");
    const statusLine = text.split("\r\n")[0] || "";
    const status = Number(statusLine.split(" ")[1] || 0);
    const body = headerEnd >= 0 ? text.slice(headerEnd + 4) : text;
    return { status, body };
  })();

  work.catch(() => {});

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    try {
      socket?.close();
    } catch {
      // ignore
    }
  }
}

async function fetchFromShanghai(fallbackApi, host, port, timeoutMs) {
  if (!fallbackApi) throw new Error("未配置上海回退 API");

  const base = fallbackApi.replace(/\/+$/, "");
  const url = new URL(base);
  const path =
    `/api/status?host=${encodeURIComponent(host)}` +
    `&port=${encodeURIComponent(port)}` +
    `&timeout=${encodeURIComponent(timeoutMs)}`;

  const res = await httpGetViaSocket(url.hostname, Number(url.port || 80), path, timeoutMs);
  if (res.status !== 200) {
    throw new Error(`上海回退 HTTP ${res.status}`);
  }

  let data;
  try {
    data = JSON.parse(res.body);
  } catch (err) {
    throw new Error("上海回退返回非 JSON");
  }

  if (!data || typeof data.online !== "boolean") {
    throw new Error("上海回退返回格式错误");
  }
  return data;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const host = (url.searchParams.get("host") || "").trim();
  const port = Number(url.searchParams.get("port") || 25565);

  if (!host) {
    return json({ online: false, error: "missing host" }, 400);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return json({ online: false, error: "invalid port" }, 400);
  }

  const rawTimeout = Number(url.searchParams.get("timeout") || 10000);
  const timeoutMs = Number.isFinite(rawTimeout)
    ? Math.min(Math.max(rawTimeout, 1000), 30000)
    : 10000;

  const fallbackApi = (env?.SHANGHAI_STATUS_API || SHANGHAI_STATUS_API || "").trim();

  try {
    const status = await mcServerStatus(host, port, timeoutMs);
    return json({
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
    });
  } catch (err) {
    // 如果配置了上海回退 API，优先让上海服务器去 Ping（它到宁波专线通常可达）
    let shanghaiData = null;
    let fallbackError = null;
    try {
      shanghaiData = await fetchFromShanghai(fallbackApi, host, port, timeoutMs);
    } catch (e) {
      fallbackError = e?.message || String(e);
    }

    if (shanghaiData) {
      return json(shanghaiData);
    }

    // TCP 已连通但 MC 状态查询被 FRP 屏蔽时，降级为“线路可用”
    if (err?.message === "STATUS_TIMEOUT") {
      return json({
        online: true,
        mode: "tcp",
        host,
        port,
        version: "",
        players: { online: 0, max: 0 },
        motd: "",
        favicon: null,
        note: "TCP 连通，MC 状态查询被线路屏蔽"
      });
    }

    return json({
      online: false,
      host,
      port,
      error: err?.message || "连接失败",
      ...(fallbackError ? { fallbackError } : {})
    });
  }
}
