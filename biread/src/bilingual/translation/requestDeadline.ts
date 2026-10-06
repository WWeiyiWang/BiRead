// The underlying provider owns its transport. A late response is discarded by
// the caller; this deadline does not claim to abort a provider's network request.
export async function requestDeadline<T>(
  request: Promise<T>,
  error: () => Error,
  milliseconds = 90000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(error()), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
