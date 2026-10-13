/** Generator QR Code PNG menuju URL toko. */
const express = require('express');
const QRCode = require('qrcode');

const r = express.Router();

/**
 * GET /api/qr?url=https://contoh.toko&size=512
 * Mengembalikan PNG. URL dibatasi skema http/https.
 */
r.get('/qr', async (req, res) => {
  try {
    const url = String(req.query.url || '').trim();
    if (!/^https?:\/\/.+/i.test(url) || url.length > 300) {
      return res.status(400).json({ ok: false, pesan: 'URL tidak valid. Harus diawali http:// atau https://' });
    }
    const size = Math.min(Math.max(Number(req.query.size) || 512, 128), 1024);
    const png = await QRCode.toBuffer(url, {
      type: 'png',
      width: size,
      margin: 2,
      color: { dark: '#4A2E1E', light: '#FFFFFF' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

module.exports = r;
