/** API publik: katalog produk, kategori, filter, detail. */
const express = require('express');
const { db } = require('../data/db');
const pengaturan = require('../data/pengaturan');

const r = express.Router();

function rapikanProduk(baris) {
  return {
    id: baris.id,
    kategori: baris.kategori_id,
    nama: baris.nama,
    grup: baris.grup,
    member: baris.member,
    harga: baris.harga,
    stok: baris.stok,
    kondisi: baris.kondisi,
    preOrder: Boolean(baris.pre_order),
    estimasiKedatangan: baris.estimasi_kedatangan,
    deskripsi: baris.deskripsi,
    gambar: JSON.parse(baris.gambar || '[]'),
    unggulan: Boolean(baris.unggulan),
    keHalamanCustom: Boolean(baris.ke_halaman_custom),
    aktif: Boolean(baris.aktif),
  };
}

// Daftar kategori
r.get('/kategori', (req, res) => {
  const rows = db.prepare('SELECT * FROM kategori ORDER BY urutan, nama').all();
  res.json(rows.map((k) => ({ id: k.id, nama: k.nama, slug: k.slug })));
});

// Filter opsi: grup & member (distinct)
r.get('/filter-opsi', (req, res) => {
  const grup = db
    .prepare('SELECT DISTINCT grup FROM produk WHERE aktif = 1 AND grup <> ? ORDER BY grup')
    .all('-').map((x) => x.grup);
  const member = db
    .prepare('SELECT DISTINCT member FROM produk WHERE aktif = 1 AND member <> ? ORDER BY member')
    .all('-').map((x) => x.member);
  res.json({ grup, member, ekspedisi: pengaturan.ekspedisi });
});

// Katalog dengan pencarian & filter
r.get('/produk', (req, res) => {
  const {
    q = '',
    kategori = '',
    grup = '',
    member = '',
    hargaMin = '',
    hargaMaks = '',
    stok = '',
    urut = 'urut',
    preOrder = '',
    unggulan = '',
  } = req.query;

  // Semua kolom produk diberi awalan p. agar tidak ambigu dengan tabel kategori.
  const where = ['p.aktif = 1'];
  const params = [];

  if (q.trim()) {
    where.push('(p.nama LIKE ? OR p.deskripsi LIKE ? OR p.grup LIKE ? OR p.member LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }
  if (kategori) {
    where.push('p.kategori_id = ?');
    params.push(kategori);
  }
  if (grup) {
    where.push('p.grup = ?');
    params.push(grup);
  }
  if (member) {
    where.push('p.member = ?');
    params.push(member);
  }
  if (hargaMin !== '' && !Number.isNaN(Number(hargaMin))) {
    where.push('p.harga >= ?');
    params.push(Number(hargaMin));
  }
  if (hargaMaks !== '' && !Number.isNaN(Number(hargaMaks))) {
    where.push('p.harga <= ?');
    params.push(Number(hargaMaks));
  }
  if (stok === 'ada') where.push('p.stok > 0');
  if (stok === 'habis') where.push('p.stok = 0');
  if (preOrder === '1') where.push('p.pre_order = 1');
  if (unggulan === '1') where.push('p.unggulan = 1');

  let urutan = 'k.urutan ASC, p.nama ASC';
  if (urut === 'harga_asc') urutan = 'p.harga ASC';
  else if (urut === 'harga_desc') urutan = 'p.harga DESC';
  else if (urut === 'baru') urutan = 'p.rowid DESC';

  const sql = `
    SELECT p.*
    FROM produk p
    JOIN kategori k ON k.id = p.kategori_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${urutan}
  `;
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(rapikanProduk));
});

// Detail produk
r.get('/produk/:id', (req, res) => {
  const baris = db.prepare('SELECT * FROM produk WHERE id = ?').get(req.params.id);
  if (!baris) return res.status(404).json({ ok: false, pesan: 'Produk tidak ditemukan.' });
  const varian = db
    .prepare('SELECT id, nama, nilai, harga_tambahan, stok FROM varian WHERE produk_id = ? ORDER BY nama, nilai')
    .all(baris.id);
  const rating = db
    .prepare('SELECT COUNT(*) AS jumlah, AVG(rating) AS rata FROM ulasan WHERE produk_id = ? AND sembunyi = 0')
    .get(baris.id);
  const hasil = rapikanProduk(baris);
  hasil.varian = varian;
  hasil.rating = {
    jumlah: rating.jumlah,
    rata: rating.rata ? Math.round(rating.rata * 10) / 10 : null,
  };
  res.json(hasil);
});

// Pengaturan toko (slogan, WA, ekspedisi, media sosial) untuk halaman publik
r.get('/pengaturan', (req, res) => {
  res.json({
    namaToko: pengaturan.namaToko,
    slogan: pengaturan.slogan,
    deskripsiToko: pengaturan.deskripsiToko,
    whatsapp: pengaturan.whatsapp,
    whatsappLabel: pengaturan.whatsappLabel,
    rekening: pengaturan.rekening,
    qrisPayload: pengaturan.qrisPayload,
    qrisGambar: pengaturan.qrisGambar,
    ekspedisi: pengaturan.ekspedisi,
    mediaSosial: pengaturan.mediaSosial,
  });
});

module.exports = r;
