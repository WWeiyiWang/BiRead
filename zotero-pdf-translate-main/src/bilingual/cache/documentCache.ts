import type { DocumentData } from "../types";

export const cacheRoot = () =>
  PathUtils.join(Zotero.DataDirectory.dir, "pdf-translate-bilingual-v1");
export async function readJSON<T>(name: string): Promise<T | undefined> {
  const path = PathUtils.join(cacheRoot(), name + ".json");
  if (!(await IOUtils.exists(path))) return;
  try {
    return (await IOUtils.readJSON(path)) as T;
  } catch (error) {
    Zotero.logError(error as Error);
    return;
  }
}
const writes = new Map<string, Promise<void>>();
export async function writeJSON(name: string, value: unknown) {
  // Serialize writes per path, including readers in separate Zotero windows.
  const snapshot = JSON.parse(JSON.stringify(value));
  const previous = writes.get(name) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await IOUtils.makeDirectory(cacheRoot(), { ignoreExisting: true });
      const path = PathUtils.join(cacheRoot(), name + ".json");
      await IOUtils.writeJSON(path, snapshot, { tmpPath: path + ".tmp" });
    });
  writes.set(name, next);
  try {
    await next;
  } finally {
    if (writes.get(name) === next) writes.delete(name);
  }
}
export async function digest(value: string): Promise<string> {
  const bytes = new _globalThis.TextEncoder().encode(value);
  const hash = await _globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function loadDocument(identity: string, fingerprint: string) {
  const cached = await readJSON<DocumentData>(
    "document-" + (await digest(identity + fingerprint)),
  );
  if (
    cached?.version === 1 &&
    cached.identity === identity &&
    cached.fingerprint === fingerprint &&
    Array.isArray(cached.blocks)
  )
    return cached;
}
export async function saveDocument(document: DocumentData) {
  await writeJSON(
    "document-" + (await digest(document.identity + document.fingerprint)),
    document,
  );
}
