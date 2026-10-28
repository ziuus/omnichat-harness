import { describe, expect, test } from "bun:test";
import {
 base64UrlDecode,
 base64UrlEncode,
 generateSecureToken,
 hashPassword,
 verifyPassword,
} from "./crypto-utils";

describe("generateSecureToken", () => {
 test("generates URL-safe tokens with the requested byte length", () => {
 expect(generateSecureToken()).toMatch(/^[A-Za-z0-9_-]+$/);
 expect(generateSecureToken(16)).toHaveLength(22);
 expect(generateSecureToken(1)).toHaveLength(2);
 });

 test("generates distinct tokens", () => {
 expect(generateSecureToken()).not.toBe(generateSecureToken());
 });

 test("rejects invalid lengths", () => {
 for (const length of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
 expect(() => generateSecureToken(length)).toThrow(RangeError);
 }
 });
});

describe("hashPassword and verifyPassword", () => {
 test("hashes and verifies a password", () => {
 const hash = hashPassword("correct horse battery staple");
 expect(hash).toMatch(/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
 expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
 expect(verifyPassword("incorrect password", hash)).toBe(false);
 });

 test("uses a fresh salt for each hash", () => {
 const first = hashPassword("same password");
 const second = hashPassword("same password");
 expect(first).not.toBe(second);
 expect(verifyPassword("same password", first)).toBe(true);
 expect(verifyPassword("same password", second)).toBe(true);
 });

 test("supports empty passwords", () => {
 const hash = hashPassword("");
 expect(verifyPassword("", hash)).toBe(true);
 expect(verifyPassword("not empty", hash)).toBe(false);
 });

 test("rejects malformed or unsupported hashes without throwing", () => {
 for (const hash of ["", "plain text", "other$salt$hash", "scrypt$a$b", "scrypt$$", "scrypt$%%%$%%%", "scrypt$a$b$c"]) {
 expect(verifyPassword("password", hash)).toBe(false);
 }
 expect(verifyPassword("password", null as unknown as string)).toBe(false);
 });

 test("rejects non-string passwords when hashing", () => {
 expect(() => hashPassword(null as unknown as string)).toThrow(TypeError);
 });
});

describe("Base64 URL-safe encoding", () => {
 test("round-trips ASCII, Unicode, and empty strings", () => {
 for (const value of ["", "hello world", "token+/=", "こんにちは 🌍", "café", "line one\nline two"]) {
 expect(base64UrlDecode(base64UrlEncode(value))).toBe(value);
 }
 });

 test("uses URL-safe characters and omits padding", () => {
 const encoded = base64UrlEncode("subjects? a+b/c=");
 expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
 expect(encoded).not.toContain("+");
 expect(encoded).not.toContain("/");
 expect(encoded).not.toContain("=");
 });

 test("accepts valid padded Base64 URL-safe input", () => {
 expect(base64UrlDecode("aGVsbG8=" )).toBe("hello");
 });

 test("rejects malformed input and invalid UTF-8", () => {
 for (const value of ["a", "ab+c", "ab/c", "a===", "a=b", "_w"]) {
 expect(() => base64UrlDecode(value)).toThrow(TypeError);
 }
 });

 test("rejects non-string inputs", () => {
 expect(() => base64UrlEncode(null as unknown as string)).toThrow(TypeError);
 expect(() => base64UrlDecode(null as unknown as string)).toThrow(TypeError);
 });
});
