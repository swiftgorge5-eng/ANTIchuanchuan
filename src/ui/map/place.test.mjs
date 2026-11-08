/**
 * 逆地理编码与住宅 POI 交叉验证的纯函数测试：不联网、不需要 Key、不依赖 DOM。
 * 样例结构参照高德 JS API 2.0 的真实返回（用金纺苑实测数据构造）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanName,
  hasUsablePlace,
  isResidentialPoi,
  looksResidential,
  placeFromRegeocode,
  resolvePlace,
  sameCommunity,
} from "./reverse.ts";

const jinfang = {
  formattedAddress: "上海市普陀区真如镇街道聚豪超市金纺苑",
  addressComponent: { province: "上海市", city: "上海市", district: "普陀区", township: "真如镇街道", adcode: "310107" },
  aois: [{ name: "金纺苑", type: "120302" }],
  pois: [{ name: "金纺苑", distance: "20", type: "120302" }],
};

const mall = {
  formattedAddress: "上海市普陀区真如镇街道曹杨路1888号上海复悦荟",
  addressComponent: { province: "上海市", city: "上海市", district: "普陀区", township: "真如镇街道" },
  aois: [{ name: "上海复悦荟" }],
  pois: [{ name: "上海复悦荟", distance: "31" }],
};

test("AOI 与住宅 POI 一致时认定为小区，并带出距离", () => {
  const place = resolvePlace(jinfang, [{ name: "金纺苑", distance: 20 }]);
  assert.ok(place);
  assert.equal(place.precision, "area");
  assert.equal(place.communityName, "金纺苑");
  assert.equal(place.distance, 20);
  assert.equal(place.city, "上海市");
  assert.equal(place.district, "普陀区");
});

test("AOI 是商场时被挡掉，退到附近住宅并标注距离", () => {
  const place = resolvePlace(mall, [
    { name: "上海星光耀广场2期", distance: 136, type: "商务住宅;商务住宅相关;商务住宅相关" },
    { name: "高尚领域(公寓住宅)", distance: 174, type: "商务住宅;住宅区;住宅小区" },
    { name: "金纺苑", distance: 186, type: "商务住宅;住宅区;住宅小区" },
  ]);
  assert.ok(place);
  assert.equal(place.precision, "nearby");
  assert.equal(place.communityName, "高尚领域");
  assert.equal(place.distance, 174);
});

test("类型或名字像商业设施、门牌号的 POI 不作为住宅候选", () => {
  assert.equal(isResidentialPoi({ name: "上海星光耀广场2期", distance: 100, type: "商务住宅;商务住宅相关" }), false);
  assert.equal(isResidentialPoi({ name: "潮州路536号", distance: 100, type: "商务住宅;住宅区;住宅小区" }), false);
  assert.equal(isResidentialPoi({ name: "浮屿·私会PartyK Club", distance: 100, type: "商务住宅;住宅区;住宅小区" }), false);
  assert.equal(isResidentialPoi({ name: "高尚青旅", distance: 100, type: "商务住宅;住宅区;住宅小区" }), false);
  assert.equal(isResidentialPoi({ name: "金纺苑", distance: 20, type: "商务住宅;住宅区;住宅小区" }), true);
  assert.equal(isResidentialPoi({ name: "曹杨花苑南区", distance: 30, type: "商务住宅;住宅区;住宅区" }), true);
});

test("AOI 是商场且附近没有住宅时不猜，只给门牌", () => {
  const place = resolvePlace(mall, []);
  assert.ok(place);
  assert.equal(place.precision, "address");
  assert.equal(place.communityName, "");
});

test("附近住宅超过 200 米就不采用", () => {
  const place = resolvePlace({ ...mall, aois: [] }, [{ name: "金纺苑", distance: 260 }]);
  assert.ok(place);
  assert.equal(place.precision, "address");
  assert.equal(place.communityName, "");
});

test("AOI 缺失但有近距离住宅 POI 时可以兜底", () => {
  const place = resolvePlace({ ...jinfang, aois: [] }, [{ name: "金纺苑", distance: 65 }]);
  assert.ok(place);
  assert.equal(place.precision, "nearby");
  assert.equal(place.communityName, "金纺苑");
  assert.equal(place.distance, 65);
});

test("只有逆地理编码自带兴趣点、没有距离时仍作弱提示", () => {
  const place = placeFromRegeocode({ ...jinfang, aois: [] });
  assert.ok(place);
  assert.equal(place.precision, "nearby");
  assert.equal(place.communityName, "金纺苑");
  assert.equal(place.distance, null);
});

test("名称相似度：同一小区的不同写法算同一个，相近但不同的不算", () => {
  assert.equal(sameCommunity("金纺苑", "金纺苑小区"), true);
  assert.equal(sameCommunity("金纺苑(东南门)", "金纺苑"), true);
  assert.equal(sameCommunity("曹杨雅苑", "曹杨家园"), false);
  assert.equal(sameCommunity("上海复悦荟", "金纺苑"), false);
  assert.equal(sameCommunity("", "金纺苑"), false);
});

test("住宅名称启发式：商场、写字楼不算住宅", () => {
  assert.equal(looksResidential("金纺苑小区"), true);
  assert.equal(looksResidential("恒力锦沧花园"), true);
  assert.equal(looksResidential("上海复悦荟"), false);
  assert.equal(looksResidential("中国铁路上海局集团"), false);
});

test("括号里的出入口后缀会被去掉", () => {
  assert.equal(cleanName("金纺苑(东南门)"), "金纺苑");
  assert.equal(cleanName("金纺苑（南门）"), "金纺苑");
  assert.equal(cleanName("  金纺苑  小区 "), "金纺苑 小区");
});

test("尖括号与控制字符被清掉，避免下游输入校验失败", () => {
  const stripped = cleanName("<b>金纺苑</b>");
  assert.ok(!stripped.includes("<") && !stripped.includes(">"));
  assert.ok(stripped.includes("金纺苑"));
  assert.equal(cleanName("金纺\n苑"), "金纺 苑");
  assert.equal(cleanName(undefined), "");
  assert.equal(cleanName(123), "");
});

test("超长地名被截断到 120 字", () => {
  assert.equal(cleanName("金".repeat(400)).length, 120);
});

test("空输入不会伪造地点", () => {
  assert.equal(placeFromRegeocode(null), null);
  assert.equal(placeFromRegeocode({}), null);
  assert.equal(hasUsablePlace(null), false);
  assert.equal(hasUsablePlace(placeFromRegeocode({ addressComponent: { district: "普陀区" } })), true);
});

test("直辖市缺 city 时退回 province", () => {
  const place = placeFromRegeocode({
    addressComponent: { province: "上海市", district: "徐汇区" },
    aois: [{ name: "某小区" }],
  });
  assert.equal(place?.city, "上海市");
  assert.equal(place?.precision, "area");
});

