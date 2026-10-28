import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SALT_BYTES = 16;
const HASH_BYTES = 64;
const HASH_VERSION = "scrypt";
const MAX_TOKEN_BYTES = 1024 * 1024;

/** Generates a cryptographically secure, URL-safe random token. */
export function generateSecureToken(byteLength = 32): string {
 if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_TOKEN_BYTES) {
 throw new RangeError(`byteLength must be an integer between 1 and ${MAX_TOKEN_BYTES}`);
 }
 return randomBytes(byteLength).toString("base64url");
}

/** Hashes a password with a fresh random salt using scrypt. */
export function hashPassword(password: string): string {
 if (typeof password !== "string") {
 throw new TypeError("password must be a string");
 }

 const salt = randomBytes(SALT_BYTES);
 const derivedKey = scryptSync(password, salt, HASH_BYTES);
 return `${HASH_VERSION}$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

/** Verifies a password against a hash produced by hashPassword. */
export function verifyPassword(password: string, storedHash: string): boolean {
 if (typeof password !== "string" || typeof storedHash !== "string") return false;

 const parts = storedHash.split("$");
 if (parts.length !== 3 || parts[0] !== HASH_VERSION) return false;

 const [, saltText, hashText] = parts;
 if (!saltText || !hashText || !/^[A-Za-z0-9_-]+$/.test(saltText) || !/^[A-Za-z0-9_-]+$/.test(hashText)) {
 return false;
 }

 try {
 const salt = Buffer.from(saltText, "base64url");
 const expectedHash = Buffer.from(hashText, "base64url");
 if (salt.length !== SALT_BYTES || expectedHash.length !== HASH_BYTES) return false;

 const actualHash = scryptSync(password, salt, HASH_BYTES);
 return timingSafeEqual(actualHash, expectedHash);
 } catch {
 return false;
 }
}

/** Encodes a UTF-8 string as unpadded Base64 URL-safe text. */
export function base64UrlEncode(value: string): string {
 if (typeof value !== "string") {
 throw new TypeError("value must be a string");
 }
 return Buffer.from(value, "utf8").toString("base64url");
}

/** Decodes unpadded or padded Base64 URL-safe text as UTF-8. */
export function base64UrlDecode(value: string): string {
 if (typeof value !== "string") {
 throw new TypeError("value must be a string");
 }
 if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value) || value.includes("=") && value.length % 4 !== 0) {
 throw new TypeError("value is not valid Base64 URL-safe text");
 }

 const unpadded = value.replace(/=+$/, "");
 if (unpadded.length % 4 === 1) {
 throw new TypeError("value is not valid Base64 URL-safe text");
 }

 const bytes = Buffer.from(unpadded, "base64url");
 // Reject non-canonical encodings and malformed UTF-8 rather than silently accepting them.
 if (bytes.toString("base64url") !== unpadded) {
 throw new TypeError("value is not valid Base64 URL-safe text");
 }
 const decoded = bytes.toString("utf8");
 if (Buffer.from(decoded, "utf8").compare(bytes) !== 0) {
 throw new TypeError("value does not contain valid UTF-8 text");
 }
 return decoded;
}
