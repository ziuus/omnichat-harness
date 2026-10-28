import { describe, expect, test } from "bun:test";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
  test("starts empty and reports size", () => {
    const cache = new LRUCache<string, number>(2);
    expect(cache.size()).toBe(0);
    expect(cache.get("missing")).toBeUndefined();
  });

  test("sets and retrieves values", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("one", 1);
    cache.set("two", 2);
    expect(cache.get("one")).toBe(1);
    expect(cache.get("two")).toBe(2);
    expect(cache.size()).toBe(2);
  });

  test("evicts the least recently used entry when capacity is exceeded", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size()).toBe(2);
  });

  test("a successful get refreshes recency", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  test("updating a key changes its value and refreshes recency without growing size", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);
    expect(cache.size()).toBe(2);
    expect(cache.get("a")).toBe(10);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
  });

  test("delete removes an entry and reports whether it existed", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  test("deleting one entry preserves the remaining recency order", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.delete("a")).toBe(true);
    cache.set("c", 3);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size()).toBe(2);
  });

  test("clear removes all entries and allows reuse", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    cache.set("c", 3);
    expect(cache.get("c")).toBe(3);
    expect(cache.size()).toBe(1);
  });

  test("supports falsey values including zero, false, empty string, and null", () => {
    const cache = new LRUCache<string, unknown>(4);
    cache.set("zero", 0);
    cache.set("false", false);
    cache.set("empty", "");
    cache.set("null", null);
    expect(cache.get("zero")).toBe(0);
    expect(cache.get("false")).toBe(false);
    expect(cache.get("empty")).toBe("");
    expect(cache.get("null")).toBeNull();
    expect(cache.size()).toBe(4);
  });

  test("supports undefined values without confusing them with absent map nodes", () => {
    const cache = new LRUCache<string, number | undefined>(2);
    cache.set("undefined", undefined);
    cache.set("other", 2);
    expect(cache.get("undefined")).toBeUndefined();
    cache.set("third", 3);
    expect(cache.get("other")).toBeUndefined();
    expect(cache.size()).toBe(2);
  });

  test("supports object keys by identity", () => {
    const cache = new LRUCache<object, string>(2);
    const first = {};
    const second = {};
    cache.set(first, "first");
    cache.set(second, "second");
    expect(cache.get(first)).toBe("first");
    expect(cache.get({})).toBeUndefined();
  });

  test("supports a capacity of one", () => {
    const cache = new LRUCache<number, string>(1);
    cache.set(1, "one");
    cache.set(2, "two");
    expect(cache.size()).toBe(1);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe("two");
    cache.set(2, "TWO");
    expect(cache.size()).toBe(1);
    expect(cache.get(2)).toBe("TWO");
  });

  test("rejects zero, negative, fractional, infinite, and unsafe capacities", () => {
    for (const capacity of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new LRUCache<string, number>(capacity)).toThrow(RangeError);
    }
  });

  test("can repeatedly evict, delete, and refill without corrupting list links", () => {
    const cache = new LRUCache<number, number>(3);
    for (let i = 0; i < 20; i++) {
      cache.set(i, i * 10);
      expect(cache.size()).toBeLessThanOrEqual(3);
    }
    expect(cache.get(19)).toBe(190);
    expect(cache.get(18)).toBe(180);
    expect(cache.delete(17)).toBe(true);
    cache.set(20, 200);
    cache.set(21, 210);
    expect(cache.size()).toBe(3);
    expect(cache.get(19)).toBeUndefined();
    expect(cache.get(18)).toBe(180);
    expect(cache.get(20)).toBe(200);
    expect(cache.get(21)).toBe(210);
  });
});
