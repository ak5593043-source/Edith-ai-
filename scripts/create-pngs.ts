import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([len, body, crc]);
}

function generateJarvisPng(width: number, height: number): Buffer {
  // Render minimal AMOLED JARVIS icon
  // RGBA buffer: (width * 4 + 1) per row for filter byte 0
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(rowSize * height, 0);

  const cx = width / 2;
  const cy = height / 2;
  const rOuter = width * 0.38;
  const rMiddle = width * 0.28;
  const rInner = width * 0.18;
  const rCore = width * 0.08;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Default AMOLED pure black
      let r = 0, g = 0, b = 0, a = 255;

      // Outer border circle
      if (Math.abs(dist - rOuter) <= width * 0.015) {
        r = 38; g = 38; b = 38; // #262626
      }
      // Middle dashed-like circle
      else if (Math.abs(dist - rMiddle) <= width * 0.012) {
        const angle = Math.atan2(dy, dx);
        if (Math.sin(angle * 12) > 0) {
          r = 82; g = 82; b = 91; // #52525B
        }
      }
      // Inner glowing ring
      else if (Math.abs(dist - rInner) <= width * 0.02) {
        r = 255; g = 255; b = 255; // White
      }
      // Core glowing reactor
      else if (dist <= rCore) {
        r = 255; g = 255; b = 255; // Solid White Core
      }
      // Axis markers
      else if (
        (Math.abs(dx) <= width * 0.01 && (Math.abs(dy - cy * 0.7) <= width * 0.04 || Math.abs(dy + cy * 0.7) <= width * 0.04)) ||
        (Math.abs(dy) <= width * 0.01 && (Math.abs(dx - cx * 0.7) <= width * 0.04 || Math.abs(dx + cx * 0.7) <= width * 0.04))
      ) {
        r = 255; g = 255; b = 255;
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = createChunk('IHDR', ihdrData);
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

const publicDir = path.resolve(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const files = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'pwa-maskable-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon.ico', size: 64 },
];

for (const f of files) {
  const buf = generateJarvisPng(f.size, f.size);
  fs.writeFileSync(path.join(publicDir, f.name), buf);
  console.log(`Created ${f.name} (${f.size}x${f.size})`);
}
console.log('Zero-dependency PNG generation complete!');
