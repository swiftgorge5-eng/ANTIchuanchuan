import { defineConfig } from "vite";

// 界面是队友的单文件前端拆分出来的 vanilla 模块，不再需要 React 插件。
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
