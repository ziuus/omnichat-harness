import { describe, expect, test } from "bun:test";
import { factorize, fibonacci, isPrime } from "./math-utils";

describe("fibonacci", () => {
 test("returns the zero-based Fibonacci sequence", () => {
 expect([0, 1, 2, 3, 4, 5, 6, 7].map(fibonacci)).toEqual([0, 1, 1, 2, 3, 5, 8, 13]);
 });

 test("supports larger indexes", () => {
 expect(fibonacci(20)).toBe(6765);
 });

 test("rejects negative and non-integer inputs", () => {
 expect(() => fibonacci(-1)).toThrow(RangeError);
 expect(() => fibonacci(2.5)).toThrow(TypeError);
 expect(() => fibonacci(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
 });

 test("rejects results outside the safe integer range", () => {
 expect(() => fibonacci(79)).toThrow(RangeError);
 });
});

describe("isPrime", () => {
 test("handles values below two and small primes", () => {
 for (const n of [-7, 0, 1]) expect(isPrime(n)).toBe(false);
 for (const n of [2, 3, 5, 7, 11, 97]) expect(isPrime(n)).toBe(true);
 });

 test("identifies composite numbers", () => {
 for (const n of [4, 9, 15, 25, 100, 121]) expect(isPrime(n)).toBe(false);
 });

 test("rejects non-integer inputs", () => {
 expect(() => isPrime(2.2)).toThrow(TypeError);
 expect(() => isPrime(Infinity)).toThrow(TypeError);
 });
});

describe("factorize", () => {
 test("returns prime factors in ascending order with multiplicity", () => {
 expect(factorize(2)).toEqual([2]);
 expect(factorize(12)).toEqual([2, 2, 3]);
 expect(factorize(100)).toEqual([2, 2, 5, 5]);
 expect(factorize(97)).toEqual([97]);
 });

 test("handles one and negative integers", () => {
 expect(factorize(1)).toEqual([]);
 expect(factorize(-1)).toEqual([-1]);
 expect(factorize(-12)).toEqual([-1, 2, 2, 3]);
 });

 test("rejects zero and non-integer inputs", () => {
 expect(() => factorize(0)).toThrow(RangeError);
 expect(() => factorize(2.5)).toThrow(TypeError);
 expect(() => factorize(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
 });
});
