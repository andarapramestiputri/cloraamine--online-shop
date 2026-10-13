/**
 * Membuat ikon PNG PWA (192, 512, maskable) dan gambar QRIS contoh.
 * Hanya memakai modul bawaan Node (zlib) — tanpa dependensi eksternal.
 * Jalankan: node tools/generate-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const QRCode = require('qrcode');

const DIR = path.join(__dirname, '..', 'public', 'img');
fs.mkdirSync(DIR, { recursive: true });

// --- Penulis PNG minimal (RGB, tanpa alpha) ---
function tulisPng(lebar, tinggi, piksel) {
  const raw = Buffer.alloc((lebar * 3 + 1) * tinggi);
  for (let y = 0; y < tinggi; y++) {
    raw[y * (lebar * 3 + 1)] = 0; // filter None
    for (let x = 0; x < lebar; x++) {
      const i = (y * lebar + x) * 3;
      const o = y * (lebar * 3 + 1) + 1 + x * 3;
      raw[o] = piksel[i];
      raw[o + 1] = piksel[i + 1];
      raw[o + 2] = piksel[i + 2];
    }
  }
  const chunk = (tipe, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const isi = Buffer.concat([Buffer.from(tipe, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(isi));
    return Buffer.concat([len, isi, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lebar, 0);
  ihdr.writeUInt32BE(tinggi, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const tabelCrc = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = tabelCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// --- Gambar huruf "C" sederhana (cincin dengan celah) ---
function gambarIkon(ukuran, { maskable = false } = {}) {
  const buf = Buffer.alloc(ukuran * ukuran * 3);
  const PINK = [217, 79, 138];
  const PUTIH = [255, 255, 255];
  const c = ukuran / 2;
  const rLuar = ukuran * (maskable ? 0.28 : 0.36);
  const rTebal = ukuran * (maskable ? 0.09 : 0.11);
  for (let y = 0; y < ukuran; y++) {
    for (let x = 0; x < ukuran; x++) {
      const i = (y * ukuran + x) * 3;
      let warna = PINK;
      if (maskable) {
        // latar penuh untuk maskable
        const dx = x - c, dy = y - c;
        const jarak = Math.sqrt(dx * dx + dy * dy);
        const sudut = Math.atan2(dy, dx);
        if (jarak < rLuar + rTebal && jarak > rLuar - rTebal && !(Math.abs(sudut) < 0.6)) warna = PUTIH;
      } else {
        // bentuk membulat (squircle) pink di latar krem muda
        const dx = Math.abs(x - c) / (ukuran * 0.46);
        const dy = Math.abs(y - c) / (ukuran * 0.46);
        const sudut = Math.atan2(y - c, x - c);
        const jarak = Math.sqrt((x - c) ** 2 + (y - c) ** 2);
        const dalamKotak = Math.pow(dx, 4) + Math.pow(dy, 4) <= 1;
        if (dalamKotak) {
          warna = PINK;
          if (jarak < rLuar + rTebal && jarak > rLuar - rTebal && !(Math.abs(sudut) < 0.6)) warna = PUTIH;
        } else {
          warna = [253, 246, 238]; // krem
        }
      }
      buf[i] = warna[0];
      buf[i + 1] = warna[1];
      buf[i + 2] = warna[2];
    }
  }
  return tulisPng(ukuran, ukuran, buf);
}

fs.writeFileSync(path.join(DIR, 'ikon-192.png'), gambarIkon(192));
fs.writeFileSync(path.join(DIR, 'ikon-512.png'), gambarIkon(512));
fs.writeFileSync(path.join(DIR, 'ikon-masking.png'), gambarIkon(512, { maskable: true }));
console.log('Ikon PWA dibuat.');

// --- Gambar QRIS contoh (dari payload konfigurasi) ---
const pengaturan = require('../data/pengaturan');
QRCode.toFile(path.join(DIR, 'qris-contoh.png'), pengaturan.qrisPayload, {
  type: 'png',
  width: 360,
  margin: 2,
  color: { dark: '#33200f', light: '#ffffff' },
})
  .then(() => console.log('Gambar QRIS contoh dibuat.'))
  .catch((e) => {
    console.error('QRIS gagal:', e.message);
    process.exitCode = 1;
  });
