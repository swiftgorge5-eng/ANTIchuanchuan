/**
 * 定位采样与合并的纯函数测试：不需要浏览器、不读取真实位置。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bestAccuracy,
  collectPosition,
  combineSamples,
  distanceMeters,
} from "./geolocate.ts";

test("单个样本原样返回", () => {
  const merged = combineSamples([{ lng: 121.4, lat: 31.2, accuracy: 42.4 }]);
  assert.ok(merged);
  assert.equal(merged.lng, 121.4);
  assert.equal(merged.accuracy, 42);
});

test("空输入与非法样本返回 null", () => {
  assert.equal(combineSamples([]), null);
  assert.equal(combineSamples([{ lng: Number.NaN, lat: 1, accuracy: 10 }]), null);
  assert.equal(combineSamples([{ lng: 1, lat: 1, accuracy: 0 }]), null);
  assert.equal(bestAccuracy([]), null);
});

test("多个相近样本做加权平均，精度取最优值", () => {
  const merged = combineSamples([
    { lng: 121.4, lat: 31.2, accuracy: 20 },
    { lng: 121.4002, lat: 31.2002, accuracy: 25 },
  ]);
  assert.ok(merged);
  // 权重 1/acc² 更大的一方更靠近 20 米那个点
  assert.ok(merged.lng > 121.4 && merged.lng < 121.4002);
  assert.equal(merged.accuracy, 20);
});

test("精度明显更差的离群点会被剔除", () => {
  const merged = combineSamples([
    { lng: 121.4, lat: 31.2, accuracy: 15 },
    { lng: 121.4001, lat: 31.2001, accuracy: 18 },
    { lng: 121.5, lat: 31.3, accuracy: 900 },
  ]);
  assert.ok(merged);
  // 离群点被丢弃后，结果必须贴近前两个点
  assert.ok(Math.abs(merged.lng - 121.4) < 0.001);
  assert.ok(Math.abs(merged.lat - 31.2) < 0.001);
});

test("样本互相矛盾时精度按实际离散度放大", () => {
  const merged = combineSamples([
    { lng: 121.4, lat: 31.2, accuracy: 10 },
    { lng: 121.401, lat: 31.2, accuracy: 12 },
  ]);
  assert.ok(merged);
  // 两点相距约 111 米，质心到各点约 55 米，精度应被撑到 55 左右而不是 10。
  assert.ok(merged.accuracy >= 50 && merged.accuracy <= 60, `实际 ${merged.accuracy}`);
});

test("bestAccuracy 取最小值并取整", () => {
  assert.equal(bestAccuracy([{ lng: 0, lat: 0, accuracy: 33.6 }, { lng: 0, lat: 0, accuracy: 51 }]), 34);
});

test("球面距离量级正确（约 111 米 / 0.001 度纬度）", () => {
  const d = distanceMeters(121.4, 31.2, 121.4, 31.201);
  assert.ok(d > 100 && d < 120, `实际 ${d}`);
});

test("collectPosition 用 watchPosition 采样并清掉监听", async () => {
  let cleared = 0;
  const samplesSeen = [];
  const fake = {
    watchPosition(success) {
      success({ coords: { longitude: 121.4, latitude: 31.2, accuracy: 40 } });
      success({ coords: { longitude: 121.4001, latitude: 31.2001, accuracy: 30 } });
      return 7;
    },
    clearWatch(id) {
      assert.equal(id, 7);
      cleared += 1;
    },
  };
  const result = await collectPosition(
    { maxSamples: 2, maxWaitMs: 50, onProgress: (rows) => samplesSeen.push(rows.length) },
    undefined,
    fake,
  );
  assert.equal(result.samples.length, 2);
  assert.equal(cleared, 1);
  assert.deepEqual(samplesSeen, [1, 2]);
});

test("collectPosition 超时后用已采到的样本返回", async () => {
  const fake = {
    watchPosition() {
      return 1;
    },
    clearWatch() {},
  };
  const result = await collectPosition({ maxSamples: 3, maxWaitMs: 40 }, undefined, fake);
  assert.equal(result.samples.length, 0);
});

test("collectPosition 把浏览器错误码带回来", async () => {
  const fake = {
    watchPosition(_success, error) {
      error({ code: 1 });
      return 2;
    },
    clearWatch() {},
  };
  const result = await collectPosition({ maxWaitMs: 50 }, undefined, fake);
  assert.equal(result.samples.length, 0);
  assert.equal(result.errorCode, 1);
});
