/**
 * Rejects if `promiseFn` does not settle within `timeoutMs`. Used by both
 * process entrypoints' shutdown paths (`src/server.ts`,
 * `src/workers/index.ts`) and the queue connection teardown so a hung Redis
 * or Prisma call can never hold a container past its orchestrator grace
 * period (#289, #294, #355). Lives in `shared/` because both processes need
 * it and the worker must never import the API's bootstrap module.
 */
export async function withTimeout<T>(
  promiseFn: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} disconnect timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promiseFn(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
