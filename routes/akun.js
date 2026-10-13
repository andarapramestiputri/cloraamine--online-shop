/** API akun pelanggan: daftar, masuk, keluar, sesi, profil, ganti kata sandi. */
const express = require('express');
const { db } = require('../data/db');
const {
  hashSandi, cocokSandi, emailSah,
  batasMasuk, buatSesiPelanggan, hapusSesiPelanggan,
  wajibPelanggan, tokenSesiPelangganDariReq,
} = require('../lib/auth');
const { teksBersih, nomorWa } = require('../lib/validasi');

const r = express.Router();

function ringkasAkun(a) {
  return { email: a.email, nama: a.nama, wa: a.wa || '' };
}

const aturanSandi =
  'Kata sandi minimal 8 karakter dan mengandung huruf serta angka.';

function validasiSandi(sandi) {
  const s = String(sandi || '');
  if (s.length < 8 || s.length > 72) throw new Error(aturanSandi);
  if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) throw new Error(aturanSandi);
  return s;
}

// --- Daftar (email apa pun yang sudah dimiliki pelanggan dipakai apa adanya) ---
r.post('/daftar', (req, res) => {
  const batas = batasMasuk(req.ip, 'akun-daftar');
  if (!batas.boleh) {
    return res.status(429).json({ ok: false, pesan: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
  }
  try {
    const b = req.body || {};
    const email = emailSah(b.email);
    if (!email) throw new Error('Alamat email tidak valid.');
    const sandi = validasiSandi(b.sandi);
    const nama = teksBersih(b.nama, { min: 3, maks: 60, label: 'Nama' });
    const wa = b.wa ? nomorWa(b.wa) : '';
    if (db.prepare('SELECT 1 FROM akun WHERE email = ?').get(email)) {
      return res.status(409).json({
        ok: false,
        pesan: 'Email ini sudah terdaftar. Silakan masuk atau gunakan akun lain.',
      });
    }
    const info = db
      .prepare('INSERT INTO akun (email, sandi_hash, nama, wa) VALUES (?, ?, ?, ?)')
      .run(email, hashSandi(sandi), nama, wa);
    const token = buatSesiPelanggan(info.lastInsertRowid);
    res.status(201).json({ ok: true, token, akun: { email, nama, wa }, pesan: 'Akun berhasil dibuat. Anda sudah masuk.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

// --- Masuk ---
r.post('/masuk', (req, res) => {
  const batas = batasMasuk(req.ip, 'akun-masuk');
  if (!batas.boleh) {
    return res.status(429).json({ ok: false, pesan: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
  }
  try {
    const email = emailSah(req.body && req.body.email);
    const sandi = String((req.body && req.body.sandi) || '');
    if (!email || !sandi) throw new Error('Email dan kata sandi wajib diisi.');
    const akun = db.prepare('SELECT * FROM akun WHERE email = ?').get(email);
    if (!akun || !cocokSandi(sandi, akun.sandi_hash)) {
      return res.status(401).json({ ok: false, pesan: 'Email atau kata sandi salah.' });
    }
    const token = buatSesiPelanggan(akun.id);
    res.json({ ok: true, token, akun: ringkasAkun(akun), pesan: 'Berhasil masuk.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

// --- Keluar (hanya sesi yang dikirim) ---
r.post('/keluar', (req, res) => {
  hapusSesiPelanggan(tokenSesiPelangganDariReq(req));
  res.json({ ok: true, pesan: 'Berhasil keluar.' });
});

// --- Validasi token tersimpan (untuk pindah akun dari layar masuk) ---
// Token dikirim klien; server hanya memvalidasi kepemilikan tiap token.
// Sengaja diletakkan SEBELUM wajib sesi: layar masuk belum punya sesi aktif.
r.post('/validasi-token', (req, res) => {
  const token = String((req.body && req.body.token) || '');
  const akun = db
    .prepare(
      `SELECT a.* FROM akun_sesi s JOIN akun a ON a.id = s.akun_id
       WHERE s.token = ? AND s.kedaluwarsa > ?`
    )
    .get(token, Date.now());
  if (!akun) return res.status(401).json({ ok: false });
  res.json({ ok: true, akun: ringkasAkun(akun) });
});

// Semua rute di bawah wajib sesi akun
r.use(wajibPelanggan);

r.get('/sesi', (req, res) => res.json({ ok: true, akun: ringkasAkun(req.akunPelanggan) }));

// --- Perbarui profil ---
r.put('/profil', (req, res) => {
  try {
    const b = req.body || {};
    const akun = req.akunPelanggan;
    const nama = b.nama !== undefined ? teksBersih(b.nama, { min: 3, maks: 60, label: 'Nama' }) : akun.nama;
    const wa = b.wa !== undefined ? (b.wa ? nomorWa(b.wa) : '') : akun.wa;
    db.prepare('UPDATE akun SET nama = ?, wa = ? WHERE id = ?').run(nama, wa, akun.id);
    res.json({ ok: true, akun: { email: akun.email, nama, wa }, pesan: 'Profil diperbarui.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

// --- Ganti kata sandi ---
r.put('/sandi', (req, res) => {
  try {
    const b = req.body || {};
    const akun = req.akunPelanggan;
    if (!cocokSandi(String(b.sandiLama || ''), akun.sandi_hash)) {
      return res.status(400).json({ ok: false, pesan: 'Kata sandi lama salah.' });
    }
    const sandiBaru = validasiSandi(b.sandiBaru);
    if (sandiBaru === String(b.sandiLama || '')) {
      return res.status(400).json({ ok: false, pesan: 'Kata sandi baru berbeda dari kata sandi lama.' });
    }
    db.prepare('UPDATE akun SET sandi_hash = ? WHERE id = ?').run(hashSandi(sandiBaru), akun.id);
    res.json({ ok: true, pesan: 'Kata sandi berhasil diganti.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

// --- Alamat tersimpan ---
r.get('/alamat', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM akun_alamat WHERE akun_email = ? ORDER BY utama DESC, rowid DESC')
    .all(req.akunPelanggan.email);
  res.json({
    ok: true,
    alamat: rows.map((a) => ({
      id: a.id, penerima: a.penerima, telepon: a.telepon, alamat: a.alamat,
      utama: Boolean(a.utama), createdAt: a.created_at,
    })),
  });
});

r.post('/alamat', (req, res) => {
  try {
    const b = req.body || {};
    const email = req.akunPelanggan.email;
    const penerima = teksBersih(b.penerima, { min: 3, maks: 60, label: 'Nama penerima' });
    const telepon = b.telepon ? nomorWa(b.telepon) : '';
    const alamat = teksBersih(b.alamat, { min: 10, maks: 300, label: 'Alamat' });
    const utama = b.utama === true || b.utama === 'true' ? 1 : 0;
    const jumlah = db.prepare('SELECT COUNT(*) AS c FROM akun_alamat WHERE akun_email = ?').get(email).c;
    if (jumlah >= 20) throw new Error('Maksimal 20 alamat tersimpan.');
    const simpan = db.transaction(() => {
      if (utama) db.prepare('UPDATE akun_alamat SET utama = 0 WHERE akun_email = ?').run(email);
      else if (jumlah === 0) {
        // Alamat pertama otomatis menjadi alamat utama
        db.prepare('INSERT INTO akun_alamat (akun_email, penerima, telepon, alamat, utama) VALUES (?, ?, ?, ?, 1)')
          .run(email, penerima, telepon, alamat);
        return;
      }
      db.prepare('INSERT INTO akun_alamat (akun_email, penerima, telepon, alamat, utama) VALUES (?, ?, ?, ?, ?)')
        .run(email, penerima, telepon, alamat, utama);
    });
    simpan();
    res.status(201).json({ ok: true, pesan: 'Alamat tersimpan.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

r.put('/alamat/:id', (req, res) => {
  try {
    const b = req.body || {};
    const lama = db
      .prepare('SELECT * FROM akun_alamat WHERE id = ? AND akun_email = ?')
      .get(Number(req.params.id), req.akunPelanggan.email);
    if (!lama) return res.status(404).json({ ok: false, pesan: 'Alamat tidak ditemukan.' });
    const penerima = b.penerima !== undefined ? teksBersih(b.penerima, { min: 3, maks: 60, label: 'Nama penerima' }) : lama.penerima;
    const telepon = b.telepon !== undefined ? (b.telepon ? nomorWa(b.telepon) : '') : lama.telepon;
    const alamat = b.alamat !== undefined ? teksBersih(b.alamat, { min: 10, maks: 300, label: 'Alamat' }) : lama.alamat;
    const utama = b.utama !== undefined ? (b.utama === true || b.utama === 'true' ? 1 : 0) : lama.utama;
    const simpan = db.transaction(() => {
      if (utama) db.prepare('UPDATE akun_alamat SET utama = 0 WHERE akun_email = ?').run(req.akunPelanggan.email);
      db.prepare('UPDATE akun_alamat SET penerima = ?, telepon = ?, alamat = ?, utama = ? WHERE id = ?')
        .run(penerima, telepon, alamat, utama, lama.id);
    });
    simpan();
    res.json({ ok: true, pesan: 'Alamat diperbarui.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

r.delete('/alamat/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM akun_alamat WHERE id = ? AND akun_email = ?')
    .run(Number(req.params.id), req.akunPelanggan.email);
  if (!info.changes) return res.status(404).json({ ok: false, pesan: 'Alamat tidak ditemukan.' });
  // Bila alamat utama terhapus, jadikan alamat pertama sebagai utama
  const adaUtama = db
    .prepare('SELECT 1 FROM akun_alamat WHERE akun_email = ? AND utama = 1')
    .get(req.akunPelanggan.email);
  if (!adaUtama) {
    const pertama = db
      .prepare('SELECT id FROM akun_alamat WHERE akun_email = ? ORDER BY rowid LIMIT 1')
      .get(req.akunPelanggan.email);
    if (pertama) db.prepare('UPDATE akun_alamat SET utama = 1 WHERE id = ?').run(pertama.id);
  }
  res.json({ ok: true, pesan: 'Alamat dihapus.' });
});

// --- Wishlist ---
r.get('/wishlist', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.nama, p.harga, p.stok, p.gambar, p.kategori_id, p.pre_order, p.aktif
       FROM wishlist w JOIN produk p ON p.id = w.produk_id
       WHERE w.akun_email = ? ORDER BY w.rowid DESC`
    )
    .all(req.akunPelanggan.email);
  res.json({
    ok: true,
    wishlist: rows.map((p) => ({
      id: p.id, nama: p.nama, harga: p.harga, stok: p.stok, kategori: p.kategori_id,
      preOrder: Boolean(p.pre_order), aktif: Boolean(p.aktif),
      gambar: JSON.parse(p.gambar || '[]'),
    })),
  });
});

r.post('/wishlist', (req, res) => {
  try {
    const produkId = String((req.body && req.body.produkId) || '');
    const produk = db.prepare('SELECT 1 FROM produk WHERE id = ?').get(produkId);
    if (!produk) throw new Error('Produk tidak ditemukan.');
    db.prepare('INSERT OR IGNORE INTO wishlist (akun_email, produk_id) VALUES (?, ?)')
      .run(req.akunPelanggan.email, produkId);
    res.status(201).json({ ok: true, pesan: 'Produk ditambahkan ke wishlist.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

r.delete('/wishlist/:produkId', (req, res) => {
  db.prepare('DELETE FROM wishlist WHERE akun_email = ? AND produk_id = ?')
    .run(req.akunPelanggan.email, String(req.params.produkId));
  res.json({ ok: true, pesan: 'Produk dihapus dari wishlist.' });
});

module.exports = r;
