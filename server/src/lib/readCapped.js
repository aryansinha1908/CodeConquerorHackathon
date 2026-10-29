// Reads a fetch Response's body up to `max` bytes: → a Buffer, or null when it is empty or longer
// (the rest isn't downloaded: the stream is cancelled). Content-Length isn't trusted to be there.
// A body that breaks off rejects, as the stream does.
export async function readCapped(res, max) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length && bytes.length <= max ? bytes : null;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return size ? Buffer.concat(chunks) : null;
}

/** Drops a body nobody will read, so the connection is freed. */
export const discardBody = (res) => res?.body?.cancel?.().catch(() => {});
