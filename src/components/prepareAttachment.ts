import { ATTACHMENT_MAX_BYTES, IMAGE_MAX_EDGE, scaledSize } from '@/domain/attachments';

/** Formate, die sich verlustfrei genug als JPEG neu kodieren lassen. GIFs verlören ihre Animation. */
const RESIZABLE = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Handyfotos (3–8 MB, 4000 px) auf eine Größe bringen, die auf dem Handy noch scharf ist
 * und das Kontingent nicht in ein paar Bildern verbraucht. Alles andere bleibt, wie es ist;
 * ob es zu groß ist, entscheidet danach `checkAttachment`.
 */
export async function prepareAttachment(file: File): Promise<{ name: string; type: string; data: ArrayBuffer }> {
  const original = { name: file.name, type: file.type, data: await file.arrayBuffer() };
  if (!RESIZABLE.includes(file.type)) return original;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return original;
  }

  const target = scaledSize(bitmap.width, bitmap.height, IMAGE_MAX_EDGE);
  // Klein genug und unter der Grenze: nicht anfassen – Screenshots bleiben scharf.
  if (target === null && file.size <= ATTACHMENT_MAX_BYTES) {
    bitmap.close();
    return original;
  }

  const { width, height } = target ?? { width: bitmap.width, height: bitmap.height };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    bitmap.close();
    return original;
  }
  // JPEG kennt keine Transparenz; ohne Hintergrund würde sie schwarz.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (blob === null || blob.size >= file.size) return original;
  return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data: await blob.arrayBuffer() };
}
