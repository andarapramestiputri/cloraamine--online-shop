/** API notifikasi in-app (dipakai dasbor admin & pelanggan). */
const express = require('express');
const {
  sahkanSesi, tokenAdminDariReq,
  akunSesiPelanggan, tokenSesiPelangganDariReq,
} = require('../lib/auth');
const notif = require('../lib/notifikasi');

const r = express.Router();

/** Tentukan penerima dari sesi: 'admin', email pelanggan, atau null. */
function penerimaDariReq(req) {
  if (sahkanSesi(tokenAdminDariReq(req))) return notif.PENERIMA_ADMIN;
  const akun = akunSesiPelanggan(tokenSesiPelangganDariReq(req));
  return akun ? akun.email : null;
}

// Daftar notifikasi sesi aktif + jumlah belum dibaca
r.get('/', (req, res) => {
  const penerima = penerimaDariReq(req);
  if (!penerima) {
    return res.status(401).json({ ok: false, pesan: 'Sesi tidak valid. Silakan masuk kembali.' });
  }
  const hanyaBelumDibaca = req.query.hanyaBelum === '1';
  res.json({
    ok: true,
    belumDibaca: notif.jumlahBelumDibaca(penerima),
    daftar: notif.daftar(penerima, { hanyaBelumDibaca }),
  });
});

// Tandai satu notifikasi sudah dibaca
r.post('/:id/baca', (req, res) => {
  const penerima = penerimaDariReq(req);
  if (!penerima) {
    return res.status(401).json({ ok: false, pesan: 'Sesi tidak valid. Silakan masuk kembali.' });
  }
  const berubah = notif.tandaiDibaca(penerima, Number(req.params.id));
  res.json({ ok: berubah > 0, pesan: berubah > 0 ? 'Ditandai sudah dibaca.' : 'Notifikasi tidak ditemukan.' });
});

// Tandai semua sudah dibaca
r.post('/baca-semua', (req, res) => {
  const penerima = penerimaDariReq(req);
  if (!penerima) {
    return res.status(401).json({ ok: false, pesan: 'Sesi tidak valid. Silakan masuk kembali.' });
  }
  const jumlah = notif.tandaiDibaca(penerima);
  res.json({ ok: true, pesan: `${jumlah} notifikasi ditandai sudah dibaca.` });
});

module.exports = r;
