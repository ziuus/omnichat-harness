function assertInteger(value: number, name: string): void {
 if (!Number.isSafeInteger(value)) {
 throw new TypeError(`${name} must be a safe integer`);
 }
}

/** Returns the zero-based Fibonacci number at index n. */
export function fibonacci(n: number): number {
 assertInteger(n, "n");
 if (n < 0) throw new RangeError("n must be non-negative");

 let previous = 0;
 let current = 1;

 for (let i = 0; i < n; i++) {
 const next = previous + current;
 if (!Number.isSafeInteger(next) && i < n - 1) {
 throw new RangeError("Fibonacci result exceeds the safe integer range");
 }
 previous = current;
 current = next;
 }

 if (!Number.isSafeInteger(previous)) {
 throw new RangeError("Fibonacci result exceeds the safe integer range");
 }
 return previous;
}

/** Returns true when n is a prime integer. */
export function isPrime(n: number): boolean {
 assertInteger(n, "n");
 if (n < 2) return false;
 if (n === 2) return true;
 if (n % 2 === 0) return false;

 for (let divisor = 3; divisor <= n / divisor; divisor += 2) {
 if (n % divisor === 0) return false;
 }
 return true;
}

/** Returns the prime factors of n in ascending order, with multiplicity. */
export function factorize(n: number): number[] {
 assertInteger(n, "n");
 if (n === 0) throw new RangeError("0 has no finite prime factorization");
 if (n === 1) return [];
 if (n === -1) return [-1];

 const factors: number[] = [];
 let remainder = n;
 if (remainder < 0) {
 factors.push(-1);
 remainder = -remainder;
 }

 while (remainder % 2 === 0) {
 factors.push(2);
 remainder /= 2;
 }

 for (let divisor = 3; divisor <= remainder / divisor; divisor += 2) {
 while (remainder % divisor === 0) {
 factors.push(divisor);
 remainder /= divisor;
 }
 }

 if (remainder > 1) factors.push(remainder);
 return factors;
}
