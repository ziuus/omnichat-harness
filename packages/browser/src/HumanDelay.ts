// packages/browser/src/HumanDelay.ts
// Realistic timing utilities — makes browser interactions look human

const MIN_DELAY = parseInt(process.env['BROWSER_MIN_DELAY_MS'] ?? '400');
const MAX_DELAY = parseInt(process.env['BROWSER_MAX_DELAY_MS'] ?? '1800');

/**
 * Wait a random amount of time within a range.
 * Defaults to the configured min/max from environment.
 */
export async function humanDelay(
  minMs = MIN_DELAY,
  maxMs = MAX_DELAY,
): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  await sleep(delay);
}

/**
 * Short pause — between key presses, after clicks.
 */
export async function microDelay(): Promise<void> {
  await sleep(50 + Math.random() * 150);
}

/**
 * Medium pause — after navigation, before reading content.
 */
export async function readDelay(): Promise<void> {
  await sleep(300 + Math.random() * 700);
}

/**
 * Long pause — after submitting a form, waiting for AI response.
 */
export async function thinkDelay(): Promise<void> {
  await sleep(800 + Math.random() * 1200);
}

/**
 * Type text character by character with human-like timing.
 * Much more convincing than page.fill() which sets value instantly.
 */
export async function humanType(
  element: { pressSequentially: (text: string, options?: { delay?: number }) => Promise<void> },
  text: string,
): Promise<void> {
  // Use fast, natural typing speed
  const delay = text.length > 80 ? 2 + Math.random() * 4 : 12 + Math.random() * 15;
  await element.pressSequentially(text, { delay });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 2000,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.warn(`[Retry] Attempt ${attempt} failed:`, err);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
