/**
 * Parses a .gltf (JSON) off the main thread: decodes the text, runs JSON.parse
 * and decodes embedded base64 buffers (data: URIs) to binary. Posts back the
 * small JSON (embedded buffers removed) and the buffers as transferables, so
 * the page never has to scan the large text itself.
 */
self.onmessage = async (event) => {
  const { id, buffer } = event.data;
  try {
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer)));
    const buffers = [];
    const list = json.buffers || [];
    for (let i = 0; i < list.length; i++) {
      const uri = list[i].uri;
      if (typeof uri !== "string" || !uri.startsWith("data:")) continue;
      // The browser's own data: URL decoding (fast, native).
      const data = await (await fetch(uri)).arrayBuffer();
      delete list[i].uri;
      buffers.push({ index: i, data });
    }
    self.postMessage(
      { id, json, buffers },
      buffers.map((b) => b.data),
    );
  } catch (error) {
    self.postMessage({ id, error: String((error && error.message) || error) });
  }
};
