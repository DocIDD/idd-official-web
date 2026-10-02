#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""上海回退 MC 状态服务（Python 版，无需 Node.js）

用法：
    python3 status-server.py
    PORT=2096 python3 status-server.py

接口：
    GET /health
    GET /api/status?host=frp-sun.com&port=31067&timeout=15000
"""

import json
import os
import socket
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# Cloudflare Workers fetch 只允许访问部分端口；2096 在允许列表内。
DEFAULT_PORT = 2096


def varint(value):
    """把整数编码成 Minecraft VarInt 字节串。"""
    out = bytearray()
    while True:
        b = value & 0x7F
        value >>= 7
        if value:
            b |= 0x80
        out.append(b)
        if not value:
            return bytes(out)


def recv_exact(sock, size):
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("连接被服务器关闭")
        data += chunk
    return data


def read_varint(sock):
    value = 0
    shift = 0
    while True:
        b = recv_exact(sock, 1)[0]
        value |= (b & 0x7F) << shift
        if not (b & 0x80):
            return value
        shift += 7


def flatten_motd(desc):
    if not desc:
        return ""
    if isinstance(desc, str):
        return desc
    text = ""
    if isinstance(desc, dict):
        if desc.get("text"):
            text += desc["text"]
        for part in desc.get("extra", []) or []:
            text += flatten_motd(part)
    return text


def build_status_request(host, port):
    host_bytes = host.encode("utf-8")
    body = (
        varint(47)
        + varint(len(host_bytes))
        + host_bytes
        + struct.pack(">H", port)
        + varint(1)
    )
    return varint(len(body) + 1) + varint(0) + body


STATUS_REQUEST = bytes([0x01, 0x00])


def mc_ping(host, port, timeout_ms=15000):
    timeout = timeout_ms / 1000.0
    connected = False
    sock = None

    try:
        sock = socket.create_connection((host, port), timeout=timeout)
        connected = True
        sock.settimeout(timeout)

        sock.sendall(build_status_request(host, port) + STATUS_REQUEST)

        read_varint(sock)  # packet length
        packet_id = read_varint(sock)
        if packet_id != 0x00:
            raise ConnectionError("意外的响应包 ID: %s" % packet_id)

        json_length = read_varint(sock)
        raw = recv_exact(sock, json_length)
        data = json.loads(raw.decode("utf-8"))

        return {
            "online": True,
            "host": host,
            "port": port,
            "version": (data.get("version") or {}).get("name", ""),
            "protocol": (data.get("version") or {}).get("protocol"),
            "players": {
                "online": (data.get("players") or {}).get("online", 0),
                "max": (data.get("players") or {}).get("max", 0),
            },
            "motd": flatten_motd(data.get("description")),
            "favicon": data.get("favicon"),
        }
    except socket.timeout:
        if connected:
            return {
                "online": True,
                "mode": "tcp",
                "host": host,
                "port": port,
                "version": "",
                "players": {"online": 0, "max": 0},
                "motd": "",
                "favicon": None,
                "note": "TCP 连通，MC 状态查询被线路屏蔽",
            }
        return {"online": False, "host": host, "port": port, "error": "连接超时"}
    except Exception as exc:
        return {"online": False, "host": host, "port": port, "error": str(exc)}
    finally:
        if sock:
            try:
                sock.close()
            except Exception:
                pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # 减少日志刷屏
        pass

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)

        if url.path == "/health":
            self._send_json({"ok": True})
            return

        if url.path != "/api/status":
            self._send_json({"error": "not found"}, 404)
            return

        params = parse_qs(url.query)
        host = (params.get("host", [""])[0]).strip()
        port_str = params.get("port", ["25565"])[0]
        timeout_str = params.get("timeout", ["15000"])[0]

        try:
            port = int(port_str)
        except ValueError:
            port = 0

        if not host:
            self._send_json({"online": False, "error": "missing host"}, 400)
            return

        if port < 1 or port > 65535:
            self._send_json({"online": False, "error": "invalid port"}, 400)
            return

        try:
            timeout_ms = int(timeout_str)
        except ValueError:
            timeout_ms = 15000

        timeout_ms = max(1000, min(timeout_ms, 30000))
        result = mc_ping(host, port, timeout_ms)
        self._send_json(result)


def main():
    port = int(os.environ.get("PORT", DEFAULT_PORT))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"上海 MC 状态服务已启动：http://0.0.0.0:{port}")
    print(f"测试：curl \"http://<公网IP>:{port}/api/status?host=frp-sun.com&port=31067\"")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()