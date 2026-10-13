/** API pesanan custom (stiker & pin button): tarif, unggah desain, status, komentar. */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const { db } = require('../data/db');
const tarif = require('../data/tarif-custom');
const pengaturan = require('../data/pengaturan');
const { teksBersih, nomorWa, bilanganBulat, booleanKotak } = require('../lib/validasi');
const { akunSesiPelanggan, tokenSesiPelangganDariReq } = require('../lib/auth');
const notif = require('../lib/notifikasi');

const r = express.Router();

const DIR_UPLOAD = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(DIR_UPLOAD, { recursive: true });

const simpanDesain = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR_UPLOAD),
    filename: (req, file, cb) => {
      const ekstensi = { 'image/png': '.png', 'image/jpeg': '.jpg', 'application/pdf': '.pdf' }[file.mimetype];
      cb(null, `desain-${crypto.randomBytes(16).toString('hex')}${ekstensi || ''}`);
    },
  }),
  limits: { fileSize: pengaturan.batasUnggahan.desain.maksMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!pengaturan.batasUnggahan.desain.tipe.includes(file.mimetype)) {
      return cb(new Error('Tipe desain harus PNG, JPG, atau PDF.'));
    }
    cb(null, true);
  },
});

const STATUS_CUSTOM = ['menunggu_desain', 'revisi', 'disetujui', 'produksi', 'siap_kirim', 'selesai', 'ditolak'];

/** Hitung harga satuan dan total dari konfigurasi tarif. */
function hitungHarga(tipeCustom, ukuranId, bahanId, bentukId, jumlah) {
  const ukuran = tarif.ukuran.find((u) => u.id === ukuranId);
  if (!ukuran) throw new Error('Ukuran tidak dikenal.');
  const bahan = tarif.bahan.find((b) => b.id === bahanId);
  if (!bahan) throw new Error('Bahan tidak dikenal.');
  const bentuk = tarif.bentuk.find((b) => b.id === bentukId);
  if (!bentuk) throw new Error('Bentuk potongan tidak dikenal.');

  const minimal = tarif.jumlahMinimal[tipeCustom];
  if (jumlah < minimal) throw new Error(`Jumlah minimal ${tipeCustom} adalah ${minimal}.`);
  if (jumlah > 100000) throw new Error('Jumlah maksimal 100.000.');

  const tingkat = tarif.tingkatJumlah.find((t) => jumlah >= t.min && jumlah <= t.maks);
  if (!tingkat) throw new Error('Jumlah di luar tingkat harga yang tersedia.');

  const dasar = ukuran[tipeCustom];
  if (typeof dasar !== 'number') throw new Error('Jenis produk tidak dikenal.');
  const hargaSatuan = Math.round((dasar + bahan.tambahan + bentuk.tambahan) * tingkat.pengali);
  return { hargaSatuan, total: hargaSatuan * jumlah, tingkat: tingkat.nama };
}

// Konfigurasi untuk halaman custom (ukuran, bahan, bentuk, minimal, tingkat harga)
r.get('/konfigurasi', (req, res) => {
  res.json({
    contoh: tarif.contoh,
    catatan: tarif.catatan,
    jenis: tarif.jenis,
    jumlahMinimal: tarif.jumlahMinimal,
    ukuran: tarif.ukuran,
    bahan: tarif.bahan,
    bentuk: tarif.bentuk,
    tingkatJumlah: tarif.tingkatJumlah,
    batasUnggahan: pengaturan.batasUnggahan.desain,
    whatsapp: pengaturan.whatsapp,
  });
});

// Simulasi harga (tanpa menyimpan)
r.post('/simulasi', (req, res) => {
  try {
    const b = req.body || {};
    const tipe = teksBersih(b.tipeCustom, { label: 'Jenis produk' });
    const jumlah = bilanganBulat(b.jumlah, { min: 1, maks: 100000, label: 'Jumlah' });
    const hasil = hitungHarga(tipe, String(b.ukuranId || ''), String(b.bahanId || ''), String(b.bentukId || ''), jumlah);
    res.json({ ok: true, ...hasil });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

function buatKodeCustom() {
  const ymd =
    String(new Date().getFullYear()).slice(2) +
    String(new Date().getMonth() + 1).padStart(2, '0') +
    String(new Date().getDate()).padStart(2, '0');
  let kode;
  do {
    kode = `CX${ymd}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  } while (db.prepare('SELECT 1 FROM custom_pesanan WHERE kode = ?').get(kode));
  return kode;
}

// Buang berkas desain yang tersimpan saat permintaan akhirnya ditolak.
function buangBerkas(file) {
  if (file && file.path) fs.unlink(file.path, () => {});
}

// Buat pesanan custom + unggah desain (multipart)
r.post('/', (req, res) => {
  simpanDesain.single('desain')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, pesan: err.message });
    try {
      const b = req.body || {};
      const tipe = teksBersih(b.tipeCustom, { label: 'Jenis produk' });
      if (!tarif.jenis.some((j) => j.id === tipe)) throw new Error('Jenis produk tidak dikenal.');
      const nama = teksBersih(b.nama, { min: 3, maks: 80, label: 'Nama pemesan' });
      const wa = nomorWa(b.wa);
      const ukuranId = teksBersih(b.ukuranId, { label: 'Ukuran' });
      const bahanId = teksBersih(b.bahanId, { label: 'Bahan' });
      const bentukId = teksBersih(b.bentukId, { label: 'Bentuk potongan' });
      const jumlah = bilanganBulat(b.jumlah, { min: 1, maks: 100000, label: 'Jumlah' });
      const catatan = teksBersih(b.catatan || '', { maks: 300, wajib: false, label: 'Catatan' });
      const metode = teksBersih(b.metodePembayaran || '', { wajib: false, label: 'Metode pembayaran' });
      if (metode && !['transfer', 'qris'].includes(metode)) throw new Error('Metode pembayaran tidak dikenal.');
      if (!booleanKotak(b.persetujuanCipta)) {
        throw new Error('Pernyataan bahwa desain bukan karya pihak lain tanpa izin wajib dicentang.');
      }
      if (!req.file) throw new Error('Berkas desain (PNG/JPG/PDF) wajib diunggah.');

      const { hargaSatuan, total } = hitungHarga(tipe, ukuranId, bahanId, bentukId, jumlah);
      const kode = buatKodeCustom();
      const token = crypto.randomBytes(24).toString('hex');
      const akun = akunSesiPelanggan(tokenSesiPelangganDariReq(req));

      db.prepare(
        `INSERT INTO custom_pesanan (kode, tipe_custom, nama, wa, ukuran_id, bahan_id, bentuk_id,
           jumlah, harga_satuan, total, desain_file, persetujuan_cipta, status, metode_pembayaran, catatan, token, akun_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'menunggu_desain', ?, ?, ?, ?)`
      ).run(kode, tipe, nama, wa, ukuranId, bahanId, bentukId, jumlah, hargaSatuan, total, req.file.filename, metode, catatan, token, akun ? akun.email : '');

      notif.beriTahuAdmin(
        'Pesanan custom baru ' + kode,
        `${nama} memesan ${tipe} (${jumlah} pcs) senilai ${'Rp' + total.toLocaleString('id-ID')}. Desain menunggu tinjauan.`,
        '/admin'
      );

      res.status(201).json({
        ok: true,
        kode,
        token,
        hargaSatuan,
        total,
        pesan: 'Pesanan custom tersimpan. Desain akan ditinjau admin.',
      });
    } catch (e) {
      buangBerkas(req.file);
      res.status(400).json({ ok: false, pesan: e.message });
    }
  });
});

function ambilCustom(req, res) {
  const kode = String(req.params.kode || '');
  const body = req.body || {};
  const wa = String(req.query.wa || body.wa || '').replace(/[\s-]/g, '');
  const token = req.get('x-token') || req.query.token || body.token;
  const baris = db.prepare('SELECT * FROM custom_pesanan WHERE kode = ?').get(kode);
  if (!baris) {
    res.status(404).json({ ok: false, pesan: 'Pesanan custom tidak ditemukan.' });
    return null;
  }
  // Pemilik: token cocok DAN (WA cocok ATAU sesi akun cocok dengan pesanan)
  const akun = akunSesiPelanggan(tokenSesiPelangganDariReq(req));
  const milikAkun = Boolean(akun && baris.akun_email && baris.akun_email === akun.email);
  const milikWa = Boolean(wa && baris.wa === wa);
  if (baris.token !== token || (!milikWa && !milikAkun)) {
    res.status(403).json({ ok: false, pesan: 'Kode, nomor WhatsApp, atau token tidak cocok.' });
    return null;
  }
  return baris;
}

// Lacak pesanan custom
r.get('/:kode', (req, res) => {
  const baris = ambilCustom(req, res);
  if (!baris) return;
  const komentar = db
    .prepare('SELECT pengirim, isi, created_at FROM custom_komentar WHERE custom_id = ? ORDER BY id')
    .all(baris.id);
  res.json({
    ok: true,
    kode: baris.kode,
    tipeCustom: baris.tipe_custom,
    nama: baris.nama,
    ukuranId: baris.ukuran_id,
    bahanId: baris.bahan_id,
    bentukId: baris.bentuk_id,
    jumlah: baris.jumlah,
    hargaSatuan: baris.harga_satuan,
    total: baris.total,
    status: baris.status,
    accPembeli: Boolean(baris.acc_pembeli),
    adaDesain: Boolean(baris.desain_file),
    createdAt: baris.created_at,
    komentar: komentar.map((k) => ({ pengirim: k.pengirim, isi: k.isi, waktu: k.created_at })),
    token: baris.token,
    wa: baris.wa,
  });
});

// Komentar pembeli (misalnya menanggapi revisi)
r.post('/:kode/komentar', (req, res) => {
  const baris = ambilCustom(req, res);
  if (!baris) return;
  try {
    const isi = teksBersih(req.body.isi, { min: 2, maks: 500, label: 'Komentar' });
    db.prepare('INSERT INTO custom_komentar (custom_id, pengirim, isi) VALUES (?, ?, ?)').run(
      baris.id, 'pembeli', isi
    );
    notif.beriTahuAdmin(
      'Komentar pembeli ' + baris.kode,
      `${baris.nama} menanggapi tinjauan desain: "${isi.slice(0, 100)}"`,
      '/admin'
    );
    res.status(201).json({ ok: true, pesan: 'Komentar terkirim.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

// Persetujuan pembeli sebelum produksi (dari status disetujui admin)
r.post('/:kode/persetujuan', (req, res) => {
  const baris = ambilCustom(req, res);
  if (!baris) return;
  if (baris.status !== 'disetujui') {
    return res.status(400).json({ ok: false, pesan: 'Persetujuan hanya bisa diberikan setelah admin menyetujui desain.' });
  }
  if (baris.acc_pembeli) {
    return res.status(400).json({ ok: false, pesan: 'Persetujuan sudah pernah diberikan.' });
  }
  db.prepare('UPDATE custom_pesanan SET acc_pembeli = 1 WHERE id = ?').run(baris.id);
  notif.beriTahuAdmin(
    'Persetujuan produksi ' + baris.kode,
    `${baris.nama} menyetujui desain untuk produksi. Pesanan siap dikerjakan.`,
    '/admin'
  );
  res.json({ ok: true, pesan: 'Persetujuan tercatat. Pesanan diteruskan ke produksi.' });
});

// Unggah desain ulang setelah diminta revisi
r.post('/:kode/revisi', (req, res) => {
  simpanDesain.single('desain')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, pesan: err.message });
    const baris = ambilCustom(req, res);
    if (!baris) return;
    if (baris.status !== 'revisi') {
      return res.status(400).json({ ok: false, pesan: 'Unggah revisi hanya tersedia saat status revisi.' });
    }
    if (!req.file) return res.status(400).json({ ok: false, pesan: 'Berkas desain wajib diunggah.' });
    db.prepare("UPDATE custom_pesanan SET desain_file = ?, status = 'menunggu_desain' WHERE id = ?").run(
      req.file.filename,
      baris.id
    );
    notif.beriTahuAdmin(
      'Desain revisi ' + baris.kode,
      `${baris.nama} mengunggah desain revisi. Silakan tinjau ulang.`,
      '/admin'
    );
    res.json({ ok: true, pesan: 'Desain revisi terunggah dan dikirim untuk ditinjau.' });
  });
});

module.exports = { router: r, ambilCustom, STATUS_CUSTOM, hitungHarga };
