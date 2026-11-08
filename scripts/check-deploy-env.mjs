/**
 * 发布前检查：gh-pages 的构建必须带高德 Key，否则线上地图会直接不可用。
 *
 * 用法：npm run build:deploy
 * 只读本机的 .env.local / 环境变量，不打印完整 Key，不写任何文件。
 */
import { existsSync, readFileSync } from "node:fs";

const files = [".env.local", ".env.production.local", ".env.production", ".env"];

function parse(file) {
  const result = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^["']|["']$/gu, "").trim();
  }
  return result;
}

let env = {};
for (const file of files) {
  if (!existsSync(file)) continue;
  // 越靠前的文件优先级越高（.env.local 覆盖 .env）。
  env = { ...parse(file), ...env };
}

const key = (process.env.VITE_AMAP_KEY || env.VITE_AMAP_KEY || "").trim();
const security = (process.env.VITE_AMAP_SECURITY || env.VITE_AMAP_SECURITY || "").trim();

if (!key) {
  console.error(
    [
      "✖ 发布构建被拦下：没有找到 VITE_AMAP_KEY。",
      "",
      "gh-pages 的构建会把 Key 注入到 JS 里；缺了它，线上地图会提示「尚未配置高德地图 Key」。",
      "",
      "请在本机项目根目录放一个 .env.local（已被 .gitignore 忽略）：",
      "  VITE_AMAP_KEY=你的Key",
      "  VITE_AMAP_SECURITY=你的安全密钥",
      "",
      "只做本地开发/预览可以用 `npm run build`；发布到 gh-pages 请用 `npm run build:deploy`。",
    ].join("\n"),
  );
  process.exit(1);
}

if (!security) {
  console.warn("⚠ 没有找到 VITE_AMAP_SECURITY：2021-12-02 之后申请的 Key 必须带安全密钥，否则地图可能报 INVALID_USER_KEY。");
}

console.log(`✓ 高德 Key 已配置（末四位 ${key.slice(-4)}）；可以构建发布产物。`);
