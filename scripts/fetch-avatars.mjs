// 成员头像本地化脚本
// 用法：node scripts/fetch-avatars.mjs
//
// 从外部头像源下载当前 members.json 中每个成员的头像，
// 保存到 assets/avatars/，并自动把 members.json 的 avatar 字段指向本地文件。
// 这样网站运行时不再依赖 mc-heads.net 等慢速外部服务。

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "data", "members.json");
const AVATAR_DIR = path.join(ROOT, "assets", "avatars");

function safeName(input) {
  return String(input || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function download(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) throw new Error(`非图片响应: ${contentType}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8) throw new Error("图片数据过小");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  await fs.mkdir(AVATAR_DIR, { recursive: true });

  const raw = await fs.readFile(DATA_FILE, "utf8");
  const members = JSON.parse(raw);
  let changed = false;

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const littleName = member.littleSkin || member.littleSkinName;

    let source;
    let key;

    if (littleName) {
      source = `https://littleskin.cn/avatar/player/${encodeURIComponent(littleName)}?png&size=64`;
      key = `little-${safeName(littleName)}.png`;
    } else if (member.uuid) {
      source = `https://minotar.net/helm/${member.uuid}/64.png`;
      key = `uuid-${safeName(member.uuid)}.png`;
    } else {
      source = `https://minotar.net/helm/MHF_Steve/64.png`;
      key = `default-${i}.png`;
    }

    const outputPath = path.join(AVATAR_DIR, key);
    try {
      const buf = await download(source);
      await fs.writeFile(outputPath, buf);
      const relative = path.relative(ROOT, outputPath).split(path.sep).join("/");
      const alreadyManaged = member.avatar && member.avatar.startsWith("assets/avatars/");
      if (!member.avatar || alreadyManaged) {
        if (member.avatar !== relative) {
          member.avatar = relative;
          changed = true;
        }
      }
      console.log(`✅ ${member.name} -> ${relative} (${buf.length} bytes)`);
    } catch (err) {
      console.error(`❌ ${member.name} 下载失败: ${err.message}（${source}）`);
    }
  }

  if (changed) {
    await fs.writeFile(DATA_FILE, JSON.stringify(members, null, 2) + "\n", "utf8");
    console.log("已更新 data/members.json 的 avatar 字段。");
  } else {
    console.log("members.json 无需更新。");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
