/** API dashboard pelanggan: ringkasan akun dan riwayat pesanan (berbasis akun email). */
const express = require('express');
const { db } = require('../data/db');
const { wajibPelanggan } = require('../lib/auth');

const r = express.Router();

// Semua rute wajib sesi akun
r.use(wajibPelanggan);

r.get('/sesi', (req, res) => {
  const a = req.akunPelanggan;
  res.json({ ok: true, email: a.email, nama: a.nama, wa: a.wa || '' });
});

/**
 * Klausa kepemilikan pesanan: milik akun ini bila pesanan dibuat saat masuk
 * (akun_email terisi) atau nomor WhatsApp pesanan sama dengan nomor terdaftar.
 */
function klausaMilik(alias, wa) {
  return wa
    ? `(${alias}.akun_email = ? OR ${alias}.wa = ?)`
    : `(${alias}.akun_email = ?)`;
}

// Ringkasan akun: jumlah pesanan, total belanja, hal yang menunggu tindakan
r.get('/ringkasan', (req, res) => {
  const akun = req.akunPelanggan;
  const wa = akun.wa || '';
  const arg = wa ? [akun.email, wa] : [akun.email];

  const reg = db
    .prepare(
      `SELECT COUNT(*) AS jumlah,
              COALESCE(SUM(CASE WHEN status <> 'dibatalkan' THEN total ELSE 0 END), 0) AS total,
              SUM(CASE WHEN status IN ('menunggu_pembayaran', 'menunggu_konfirmasi') THEN 1 ELSE 0 END) AS menungguBayar
       FROM pesanan WHERE ${klausaMilik('pesanan', wa)}`
    )
    .get(...arg);
  const cus = db
    .prepare(
      `SELECT COUNT(*) AS jumlah,
              COALESCE(SUM(CASE WHEN status <> 'ditolak' THEN total ELSE 0 END), 0) AS total,
              SUM(CASE WHEN status = 'menunggu_desain' THEN 1 ELSE 0 END) AS menungguDesain,
              SUM(CASE WHEN status = 'revisi' THEN 1 ELSE 0 END) AS perluRevisi,
              SUM(CASE WHEN status = 'disetujui' AND acc_pembeli = 0 THEN 1 ELSE 0 END) AS perluAcc
       FROM custom_pesanan WHERE ${klausaMilik('custom_pesanan', wa)}`
    )
    .get(...arg);
  res.json({
    ok: true,
    email: akun.email,
    jumlahPesanan: reg.jumlah + cus.jumlah,
    jumlahReguler: reg.jumlah,
    jumlahCustom: cus.jumlah,
    totalBelanja: reg.total + cus.total,
    perluTindakan: {
      buktiBayar: reg.menungguBayar || 0,
      desainDitinjau: cus.menungguDesain || 0,
      revisi: cus.perluRevisi || 0,
      persetujuanProduksi: cus.perluAcc || 0,
    },
  });
});

// Riwayat: semua pesanan milik akun ini (reguler + custom)
r.get('/riwayat', (req, res) => {
  const akun = req.akunPelanggan;
  const wa = akun.wa || '';
  const arg = wa ? [akun.email, wa] : [akun.email];

  const pesanan = db
    .prepare(`SELECT * FROM pesanan WHERE ${klausaMilik('pesanan', wa)} ORDER BY rowid DESC`)
    .all(...arg)
    .map((p) => ({
      jenis: 'reguler',
      id: p.id,
      kode: p.kode,
      tipe: p.tipe,
      nama: p.nama,
      ekspedisi: p.ekspedisi,
      metodePembayaran: p.metode_pembayaran,
      subtotal: p.subtotal,
      ongkir: p.ongkir,
      total: p.total,
      status: p.status,
      adaBukti: Boolean(p.bukti_bayar),
      catatan: p.catatan,
      createdAt: p.created_at,
      token: p.token,
      items: db
        .prepare('SELECT nama_produk, varian, harga, jumlah FROM pesanan_item WHERE pesanan_id = ?')
        .all(p.id),
      ulasan: db
        .prepare('SELECT rating, komentar, created_at FROM ulasan WHERE kode_pesanan = ? ORDER BY rowid DESC')
        .all(p.kode),
    }));

  const custom = db
    .prepare(`SELECT * FROM custom_pesanan WHERE ${klausaMilik('custom_pesanan', wa)} ORDER BY rowid DESC`)
    .all(...arg)
    .map((c) => ({
      jenis: 'custom',
      id: c.id,
      kode: c.kode,
      tipeCustom: c.tipe_custom,
      nama: c.nama,
      wa: c.wa,
      ukuranId: c.ukuran_id,
      bahanId: c.bahan_id,
      bentukId: c.bentuk_id,
      jumlah: c.jumlah,
      hargaSatuan: c.harga_satuan,
      total: c.total,
      status: c.status,
      accPembeli: Boolean(c.acc_pembeli),
      metodePembayaran: c.metode_pembayaran,
      adaBukti: Boolean(c.bukti_bayar),
      adaDesain: Boolean(c.desain_file),
      catatan: c.catatan,
      createdAt: c.created_at,
      token: c.token,
      komentar: db
        .prepare('SELECT pengirim, isi, created_at FROM custom_komentar WHERE custom_id = ? ORDER BY id')
        .all(c.id)
        .map((k) => ({ pengirim: k.pengirim, isi: k.isi, waktu: k.created_at })),
    }));

  res.json({ ok: true, email: akun.email, wa, pesanan, custom });
});

module.exports = r;
