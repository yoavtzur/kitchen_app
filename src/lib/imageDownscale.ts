/**
 * Shrinks a camera photo before it is uploaded for scanning.
 *
 * A phone photo is routinely 3-8MB, and base64 inflates that by a third — past what a
 * serverless function will accept as a request body. Downscaling to a long edge of ~1600px
 * keeps printed recipe text comfortably legible to the model while bringing a typical photo
 * under half a megabyte, which also makes the round trip noticeably faster.
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export type DownscaledImage = {
  /** Base64 payload with the `data:...;base64,` prefix stripped, as the API expects. */
  base64: string;
  mimeType: string;
};

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('read-failed'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Returns the image downscaled to JPEG, or the original bytes unchanged when the browser
 * can't decode it (an unusual format, a canvas that refuses to export). Falling back rather
 * than failing keeps a scan possible even when resizing isn't.
 */
export async function downscaleImage(file: File): Promise<DownscaledImage> {
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no-2d-context');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new Error('encode-failed');

    return { base64: await readAsBase64(blob), mimeType: 'image/jpeg' };
  } catch {
    return { base64: await readAsBase64(file), mimeType: file.type || 'image/jpeg' };
  }
}
