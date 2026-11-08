/**
 * C 模块对外入口。只暴露观察器与只读常量，不导出测试辅助文件。
 */
export { createPhotoObserver } from "./observer.ts";
export type { PhotoObserver, PhotoObserverOptions } from "./observer.ts";
export { PROVIDERS, isPhotoProvider } from "./providers.ts";
export type { PhotoProvider } from "./providers.ts";
export { OBSERVATION_CATEGORIES, CATEGORY_LABELS } from "./prompt.ts";
