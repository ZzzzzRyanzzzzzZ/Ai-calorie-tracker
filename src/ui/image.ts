/**
 * Preparing a camera photo for the assistant.
 *
 * Phone cameras produce 3-12 MB images. Sending one raw wastes the person's
 * API quota and their mobile data for no benefit: a plate of food is just as
 * identifiable at 1024 px. So every photo is drawn through a canvas, scaled
 * down and re-encoded as JPEG before it goes anywhere.
 */

export interface PreparedImage {
  mimeType: string;
  /** Base64 payload with no data: prefix, ready for the API. */
  data: string;
  /** A data URL for showing it in the conversation. */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export const MAX_EDGE = 1024;
export const QUALITY = 0.82;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    image.src = url;
  });
}

/** Longest edge capped at `maxEdge`, aspect ratio kept, never scaled up. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function prepareImage(file: Blob, maxEdge = MAX_EDGE): Promise<PreparedImage> {
  const image = await loadImage(file);
  const size = fitWithin(image.naturalWidth, image.naturalHeight, maxEdge);

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser would not give the app a canvas to resize the photo with.');
  context.drawImage(image, 0, 0, size.width, size.height);

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return {
    mimeType: 'image/jpeg',
    data,
    dataUrl,
    width: size.width,
    height: size.height,
    // Base64 carries three bytes in every four characters.
    bytes: Math.round((data.length * 3) / 4),
  };
}
