/**
 * 新版前端的启动入口。
 *
 * 界面来自队友 2026-11-08 的单文件前端，这里按「界面与逻辑分离」拆成 app/app.js
 * 与 app/app.css；仓库里的 C（照片观察）与定位/地图能力通过两个适配器接进去：
 *   window.HomeSafePhotoService     -> src/app/photo-service.ts
 *   window.HomeSafeCommunityService -> src/app/community-service.ts
 *   window.HomeSafeLocationPicker   -> src/app/location-picker.ts
 */
import "./app/app.css";
import "./app/location-picker.css";
import { installCommunityService } from "./app/community-service.ts";
import { installLocationPicker } from "./app/location-picker.ts";
import { installPhotoService } from "./app/photo-service.ts";

installPhotoService();
installCommunityService();
installLocationPicker();

// 先装好服务，再执行界面脚本：app.js 只在启动时读取一次 window.HomeSafePhotoService。
// 用动态 import 而不是静态 import —— 静态 import 会提升到文件顶部，抢在安装之前执行。
void import("./app/app.js");
