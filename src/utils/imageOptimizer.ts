export interface OptimizedImageResult {
  name: string;
  type: string;
  size: number;
  base64Data: string;
  width?: number;
  height?: number;
}

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.84;

/**
 * Optimizes an uploaded image file directly inside the browser so even large
 * multi-megabyte mobile camera photos attach in <100ms cleanly.
 */
export async function optimizeImageFile(file: File): Promise<OptimizedImageResult> {
  const lowerName = file.name.toLowerCase();
  const ext = lowerName.split('.').pop() || '';
  const isSvg = file.type === 'image/svg+xml' || ext === 'svg';

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read image "${file.name}"`));
    reader.readAsDataURL(file);
  });

  // SVGs or already tiny images (< 180 KB) don't need canvas re-encoding
  if (isSvg || file.size <= 180 * 1024 || typeof document === 'undefined') {
    const mime =
      file.type && file.type.startsWith('image/')
        ? file.type
        : `image/${ext === 'svg' ? 'svg+xml' : ext === 'png' ? 'png' : 'jpeg'}`;
    return {
      name: file.name,
      type: mime,
      size: file.size,
      base64Data: rawDataUrl,
    };
  }

  return new Promise<OptimizedImageResult>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve({
            name: file.name,
            type: file.type || 'image/jpeg',
            size: file.size,
            base64Data: rawDataUrl,
          });
          return;
        }

        // White matte only if converting non-transparent or use JPEG for fast compact uploads
        ctx.drawImage(img, 0, 0, width, height);

        const isPng = file.type === 'image/png' || ext === 'png';
        const outputMime = isPng && width * height <= 900 * 900 ? 'image/png' : 'image/jpeg';
        const compressedDataUrl = canvas.toDataURL(
          outputMime,
          outputMime === 'image/jpeg' ? JPEG_QUALITY : undefined
        );

        const finalDataUrl =
          compressedDataUrl.length < rawDataUrl.length ? compressedDataUrl : rawDataUrl;
        const finalMime = finalDataUrl === compressedDataUrl ? outputMime : (file.type || 'image/jpeg');
        const approxBytes = Math.round((finalDataUrl.length - finalDataUrl.indexOf(',') - 1) * 0.75);

        resolve({
          name: file.name,
          type: finalMime,
          size: Math.max(1024, approxBytes),
          base64Data: finalDataUrl,
          width,
          height,
        });
      } catch {
        resolve({
          name: file.name,
          type: file.type || 'image/jpeg',
          size: file.size,
          base64Data: rawDataUrl,
        });
      }
    };

    img.onerror = () => {
      resolve({
        name: file.name,
        type: file.type || 'image/jpeg',
        size: file.size,
        base64Data: rawDataUrl,
      });
    };

    img.src = rawDataUrl;
  });
}

export function isImageFile(file: { name: string; type: string }): boolean {
  if (file.type && file.type.startsWith('image/')) return true;
  const ext = file.name.toLowerCase().split('.').pop() || '';
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'svg', 'heic', 'avif'].includes(ext);
}
