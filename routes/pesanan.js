/** API pesanan reguler: checkout, pelacakan, unggah bukti bayar, ulasan. */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const { db } = require('../data/db');
const pengaturan = require('../data/pengaturan');
const { teksBersih, nomorWa, bilanganBulat, booleanKotak } = require('../lib/validasi');
const { akunSesiPelanggan, tokenSesiPelangganDariReq } = require('../lib/auth');
const notif = require('../lib/notifikasi');

const r = express.Router();

const DIR_UPLOAD = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(DIR_UPLOAD, { recursive: true });

// Penyimpanan unggahan: nama acak, tipe & ukuran dibatasi
const simpanBukti = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR_UPLOAD),
    filename: (req, file, cb) => {
      const ekstensi = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
      cb(null, `bukti-${crypto.randomBytes(16).toString('hex')}${ekstensi || ''}`);
    },
  }),
  limits: { fileSize: pengaturan.batasUnggahan.buktiBayar.maksMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!pengaturan.batasUnggahan.buktiBayar.tipe.includes(file.mimetype)) {
      return cb(new Error('Tipe berkas bukti bayar harus JPG, PNG, atau WEBP.'));
    }
    cb(null, true);
  },
});

// Buang berkas unggahan yang tersimpan saat permintaan akhirnya ditolak.
function buangBerkas(file) {
  if (file && file.path) fs.unlink(file.path, () => {});
}

function buatKodePesanan() {
  const tanggal = new Date();
  const ymd =
    tanggal.getFullYear().toString().slice(2) +
    String(tanggal.getMonth() + 1).padStart(2, '0') +
    String(tanggal.getDate()).padStart(2, '0');
  let kode;
  do {
    kode = `CL${ymd}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  } while (db.prepare('SELECT 1 FROM pesanan WHERE kode = ?').get(kode));
  return kode;
}

// Checkout
r.post('/pesanan', (req, res) => {
  try {
    const b = req.body || {};
    const nama = teksBersih(b.nama, { min: 3, maks: 80, label: 'Nama pemesan' });
    const wa = nomorWa(b.wa);
    const alamat = teksBersih(b.alamat, { min: 10, maks: 300, label: 'Alamat' });
    const ekspedisiId = teksBersih(b.ekspedisi, { label: 'Ekspedisi' });
    const metode = teksBersih(b.metodePembayaran, { label: 'Metode pembayaran' });
    const catatan = teksBersih(b.catatan || '', { maks: 300, wajib: false, label: 'Catatan' });
    if (!booleanKotak(b.persetujuanData)) {
      throw new Error('Persetujuan penggunaan data wajib dicentang.');
    }
    if (!['transfer', 'qris'].includes(metode)) {
      throw new Error('Metode pembayaran tidak dikenal.');
    }
    const ekspedisi = pengaturan.ekspedisi.find((e) => e.id === ekspedisiId);
    if (!ekspedisi) throw new Error('Ekspedisi tidak dikenal.');

    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length === 0) throw new Error('Keranjang kosong.');
    if (items.length > 30) throw new Error('Jumlah baris pesanan maksimal 30.');

    const getProduk = db.prepare('SELECT * FROM produk WHERE id = ? AND aktif = 1');
    const getVarian = db.prepare('SELECT * FROM varian WHERE id = ? AND produk_id = ?');
    const baris = [];
    let subtotal = 0;

    for (const it of items) {
      const produk = getProduk.get(String(it.produkId || ''));
      if (!produk) throw new Error('Ada produk di keranjang yang tidak tersedia.');
      if (produk.ke_halaman_custom) throw new Error(`"${produk.nama}" dipesan melalui halaman Pesanan Custom.`);
      const jumlah = bilanganBulat(it.jumlah, { min: 1, maks: 99, label: `Jumlah ${produk.nama}` });
      let harga = produk.harga;
      let namaVarian = '';
      if (it.varianId) {
        const v = getVarian.get(Number(it.varianId), produk.id);
        if (!v) throw new Error(`Varian untuk ${produk.nama} tidak ditemukan.`);
        harga += v.harga_tambahan || 0;
        namaVarian = `${v.nama}: ${v.nilai}`;
        if (v.stok !== null && v.stok < jumlah) throw new Error(`Stok varian ${produk.nama} (${v.nilai}) tidak mencukupi.`);
      }
      if (produk.pre_order === 0 && produk.stok < jumlah) {
        throw new Error(`Stok ${produk.nama} tidak mencukupi.`);
      }
      subtotal += harga * jumlah;
      baris.push({ produkId: produk.id, varianId: it.varianId ? Number(it.varianId) : null, nama: produk.nama, varian: namaVarian, harga, jumlah, stokDikurangi: produk.pre_order === 0 });
    }

    const total = subtotal + ekspedisi.ongkir;
    const kode = buatKodePesanan();
    const token = crypto.randomBytes(24).toString('hex');
    // Jika pembeli sedang masuk, pesanan ditautkan ke akunnya.
    const akun = akunSesiPelanggan(tokenSesiPelangganDariReq(req));
    const akunEmail = akun ? akun.email : '';

    const simpan = db.transaction(() => {
      const ins = db
        .prepare(
          `INSERT INTO pesanan (kode, tipe, nama, wa, alamat, ekspedisi, ongkir, metode_pembayaran,
             catatan, subtotal, total, persetujuan_data, token, status, akun_email)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'menunggu_pembayaran', ?)`
        );
      const tipe = baris.some((x) => getProduk.get(x.produkId).pre_order) ? 'preorder' : 'reguler';
      const info = ins.run(
        kode, tipe, nama, wa, alamat, ekspedisiId, ekspedisi.ongkir, metode,
        catatan, subtotal, total, token, akunEmail
      );
      const pesananId = info.lastInsertRowid;
      const insItem = db.prepare(
        `INSERT INTO pesanan_item (pesanan_id, produk_id, varian_id, nama_produk, varian, harga, jumlah)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const kurangiStok = db.prepare('UPDATE produk SET stok = stok - ? WHERE id = ?');
      const kurangiVarian = db.prepare('UPDATE varian SET stok = stok - ? WHERE id = ? AND stok IS NOT NULL');
      for (const x of baris) {
        insItem.run(pesananId, x.produkId, x.varianId, x.nama, x.varian, x.harga, x.jumlah);
        if (x.stokDikurangi) kurangiStok.run(x.jumlah, x.produkId);
        if (x.varianId) kurangiVarian.run(x.jumlah, x.varianId);
      }
      return pesananId;
    });
    simpan();

    notif.beriTahuAdmin(
      'Pesanan baru ' + kode,
      `${nama} memesan ${baris.reduce((a, x) => a + x.jumlah, 0)} item senilai ${'Rp' + total.toLocaleString('id-ID')}.`,
      '/admin'
    );

    res.status(201).json({
      ok: true,
      kode,
      token,
      subtotal,
      ongkir: ekspedisi.ongkir,
      total,
      metodePembayaran: metode,
      rekening: pengaturan.rekening,
      qrisGambar: pengaturan.qrisGambar,
      pesan: 'Pesanan tersimpan. Silakan unggah bukti pembayaran.',
    });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

// Unggah bukti bayar (token milik pesanan)
r.post('/pesanan/:kode/bukti', (req, res) => {
  simpanBukti.single('bukti')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, pesan: err.message });
    try {
      const pesanan = db.prepare('SELECT * FROM pesanan WHERE kode = ?').get(req.params.kode);
      if (!pesanan) {
        buangBerkas(req.file);
        return res.status(404).json({ ok: false, pesan: 'Pesanan tidak ditemukan.' });
      }
      const token = req.get('x-token') || req.body.token;
      if (token !== pesanan.token) {
        buangBerkas(req.file);
        return res.status(403).json({ ok: false, pesan: 'Token tidak cocok.' });
      }
      if (!req.file) return res.status(400).json({ ok: false, pesan: 'Berkas bukti bayar wajib diunggah.' });
      db.prepare('UPDATE pesanan SET bukti_bayar = ?, status = ? WHERE id = ?').run(
        req.file.filename,
        pesanan.status === 'menunggu_pembayaran' ? 'menunggu_konfirmasi' : pesanan.status,
        pesanan.id
      );
      notif.beriTahuAdmin(
        'Bukti bayar ' + pesanan.kode,
        `${pesanan.nama} mengunggah bukti pembayaran. Silakan konfirmasi.`,
        '/admin'
      );
      res.json({ ok: true, berkas: req.file.filename, pesan: 'Bukti pembayaran terunggah.' });
    } catch (e) {
      buangBerkas(req.file);
      res.status(400).json({ ok: false, pesan: e.message });
    }
  });
});

// Pelacakan pesanan: kode + nomor WhatsApp
r.get('/pesanan/lacak', (req, res) => {
  try {
    const kode = teksBersih(req.query.kode, { label: 'Kode pesanan' });
    const wa = nomorWa(req.query.wa);
    const pesanan = db.prepare('SELECT * FROM pesanan WHERE kode = ? AND wa = ?').get(kode, wa);
    if (!pesanan) return res.status(404).json({ ok: false, pesan: 'Pesanan tidak ditemukan. Periksa kode dan nomor WhatsApp.' });
    const items = db.prepare('SELECT * FROM pesanan_item WHERE pesanan_id = ?').all(pesanan.id);
    res.json({
      ok: true,
      kode: pesanan.kode,
      tipe: pesanan.tipe,
      nama: pesanan.nama,
      status: pesanan.status,
      ekspedisi: pesanan.ekspedisi,
      metodePembayaran: pesanan.metode_pembayaran,
      subtotal: pesanan.subtotal,
      ongkir: pesanan.ongkir,
      total: pesanan.total,
      adaBukti: Boolean(pesanan.bukti_bayar),
      catatan: pesanan.catatan,
      createdAt: pesanan.created_at,
      items: items.map((i) => ({ nama: i.nama_produk, varian: i.varian, harga: i.harga, jumlah: i.jumlah })),
      token: pesanan.token,
    });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

// Ulasan: buat & daftar per produk
r.post('/ulasan', (req, res) => {
  try {
    const b = req.body || {};
    const nama = teksBersih(b.nama, { min: 3, maks: 60, label: 'Nama' });
    const komentar = teksBersih(b.komentar, { min: 5, maks: 500, label: 'Komentar' });
    const rating = bilanganBulat(b.rating, { min: 1, maks: 5, label: 'Rating' });
    const produkId = b.produkId ? String(b.produkId) : null;
    if (produkId && !db.prepare('SELECT 1 FROM produk WHERE id = ?').get(produkId)) {
      throw new Error('Produk tidak ditemukan.');
    }
    const kodePesanan = b.kodePesanan
      ? teksBersih(b.kodePesanan, { min: 4, maks: 30, label: 'Kode pesanan' })
      : null;
    if (kodePesanan && !db.prepare('SELECT 1 FROM pesanan WHERE kode = ?').get(kodePesanan)) {
      throw new Error('Kode pesanan tidak ditemukan.');
    }
    db.prepare('INSERT INTO ulasan (produk_id, kode_pesanan, nama, rating, komentar) VALUES (?, ?, ?, ?, ?)').run(
      produkId, kodePesanan, nama, rating, komentar
    );
    notif.beriTahuAdmin(
      'Ulasan baru (' + rating + '★)',
      `${nama} memberi ulasan: "${komentar.slice(0, 80)}"`,
      '/admin'
    );
    res.status(201).json({ ok: true, pesan: 'Ulasan tersimpan. Terima kasih.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

r.get('/ulasan', (req, res) => {
  const produkId = req.query.produk;
  // Ulasan yang disembunyikan admin tidak tampil di halaman publik.
  const rows = produkId
    ? db.prepare('SELECT * FROM ulasan WHERE produk_id = ? AND sembunyi = 0 ORDER BY rowid DESC LIMIT 50').all(produkId)
    : db.prepare('SELECT * FROM ulasan WHERE sembunyi = 0 ORDER BY rowid DESC LIMIT 50').all();
  res.json(rows);
});

module.exports = r;
