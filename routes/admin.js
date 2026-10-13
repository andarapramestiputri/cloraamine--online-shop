/** API admin: masuk, kelola produk, pesanan, custom, ulasan, laporan, ekspor CSV. */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const { db } = require('../data/db');
const pengaturan = require('../data/pengaturan');
const { wajibAdmin, buatSesiAdmin, hapusSesiAdmin, batasMasuk, emailSah } = require('../lib/auth');
const notif = require('../lib/notifikasi');
const { ambilCustom, STATUS_CUSTOM } = require('./custom');
const { teksBersih, bilanganBulat } = require('../lib/validasi');

const r = express.Router();

/** Label status Indonesia untuk isi notifikasi. */
const LABEL_STATUS = {
  menunggu_pembayaran: 'Menunggu Pembayaran',
  menunggu_konfirmasi: 'Menunggu Konfirmasi',
  dikonfirmasi: 'Dikonfirmasi',
  diproses: 'Sedang Diproses',
  dikirim: 'Dikirim',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
  menunggu_desain: 'Menunggu Desain',
  revisi: 'Revisi',
  disetujui: 'Disetujui',
  produksi: 'Produksi',
  siap_kirim: 'Siap Dikirim',
  ditolak: 'Ditolak',
};
const labelStatusId = (s) => LABEL_STATUS[s] || s;

const DIR_UPLOAD = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(DIR_UPLOAD, { recursive: true });

const simpanFoto = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR_UPLOAD),
    filename: (req, file, cb) => {
      const ekstensi = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
      cb(null, `foto-${crypto.randomBytes(16).toString('hex')}${ekstensi || ''}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Tipe foto harus JPG, PNG, atau WEBP.'));
    }
    cb(null, true);
  },
});

// --- Masuk / keluar ---
r.post('/login', (req, res) => {
  const batas = batasMasuk(req.ip);
  if (!batas.boleh) {
    return res.status(429).json({ ok: false, pesan: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
  }
  const email = emailSah(req.body && req.body.email);
  const sandi = String((req.body && req.body.sandi) || '');
  const emailBenar = emailSah(process.env.ADMIN_EMAIL) || 'admin@cloraamine.test';
  const sandiBenar = process.env.ADMIN_PASSWORD || 'admin-contoh';
  const emailCocok =
    email && email.length === emailBenar.length &&
    crypto.timingSafeEqual(Buffer.from(email), Buffer.from(emailBenar));
  const sandiCocok =
    sandi.length === sandiBenar.length &&
    crypto.timingSafeEqual(Buffer.from(sandi), Buffer.from(sandiBenar));
  if (!emailCocok || !sandiCocok) {
    return res.status(401).json({ ok: false, pesan: 'Email atau kata sandi salah.' });
  }
  const token = buatSesiAdmin();
  res.setHeader(
    'Set-Cookie',
    `clora_admin=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${8 * 60 * 60}`
  );
  res.json({ ok: true, pesan: 'Berhasil masuk.' });
});

r.post('/logout', (req, res) => {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('clora_admin='));
  hapusSesiAdmin(cookie ? cookie.split('=')[1] : null);
  res.setHeader('Set-Cookie', 'clora_admin=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true, pesan: 'Berhasil keluar.' });
});

r.get('/sesi', wajibAdmin, (req, res) =>
  res.json({ ok: true, email: emailSah(process.env.ADMIN_EMAIL) || 'admin@cloraamine.test' })
);

// Semua rute di bawah wajib sesi admin
r.use(wajibAdmin);

// --- Produk ---
r.get('/produk', (req, res) => {
  const rows = db.prepare('SELECT * FROM produk ORDER BY kategori_id, nama').all();
  res.json(
    rows.map((p) => ({
      id: p.id,
      kategori: p.kategori_id,
      nama: p.nama,
      grup: p.grup,
      member: p.member,
      harga: p.harga,
      stok: p.stok,
      kondisi: p.kondisi,
      preOrder: Boolean(p.pre_order),
      estimasiKedatangan: p.estimasi_kedatangan,
      deskripsi: p.deskripsi,
      gambar: JSON.parse(p.gambar || '[]'),
      unggulan: Boolean(p.unggulan),
      keHalamanCustom: Boolean(p.ke_halaman_custom),
      aktif: Boolean(p.aktif),
      varian: db.prepare('SELECT * FROM varian WHERE produk_id = ?').all(p.id),
    }))
  );
});

function simpanProdukDariBody(b, idLama) {
  const kategori = teksBersih(b.kategori, { label: 'Kategori' });
  if (!db.prepare('SELECT 1 FROM kategori WHERE id = ?').get(kategori)) throw new Error('Kategori tidak dikenal.');
  const data = {
    id: idLama || teksBersih(b.id, { min: 3, maks: 40, label: 'ID produk' }).toLowerCase().replace(/[^a-z0-9-]/g, ''),
    kategori,
    nama: teksBersih(b.nama, { min: 3, maks: 120, label: 'Nama produk' }),
    grup: teksBersih(b.grup || '-', { maks: 60, wajib: false, label: 'Grup' }) || '-',
    member: teksBersih(b.member || '-', { maks: 60, wajib: false, label: 'Member' }) || '-',
    harga: bilanganBulat(b.harga, { min: 0, maks: 100000000, label: 'Harga' }),
    stok: bilanganBulat(b.stok, { min: 0, maks: 1000000, label: 'Stok' }),
    kondisi: ['baru', 'bekas'].includes(b.kondisi) ? b.kondisi : 'baru',
    preOrder: b.preOrder === true || b.preOrder === 'true' || b.preOrder === '1' ? 1 : 0,
    estimasi: b.estimasiKedatangan ? teksBersih(b.estimasiKedatangan, { maks: 120, label: 'Estimasi kedatangan' }) : null,
    deskripsi: teksBersih(b.deskripsi || '', { maks: 2000, wajib: false, label: 'Deskripsi' }),
    unggulan: b.unggulan === true || b.unggulan === 'true' || b.unggulan === '1' ? 1 : 0,
    keCustom: b.keHalamanCustom === true || b.keHalamanCustom === 'true' || b.keHalamanCustom === '1' ? 1 : 0,
    aktif: b.aktif === false || b.aktif === 'false' || b.aktif === '0' ? 0 : 1,
    gambar: Array.isArray(b.gambar) ? b.gambar.filter((g) => typeof g === 'string' && g.startsWith('/img/')) : [],
  };
  return data;
}

r.post('/produk', (req, res) => {
  try {
    const d = simpanProdukDariBody(req.body || {});
    if (db.prepare('SELECT 1 FROM produk WHERE id = ?').get(d.id)) throw new Error('ID produk sudah dipakai.');
    db.prepare(
      `INSERT INTO produk (id, kategori_id, nama, grup, member, harga, stok, kondisi, pre_order,
        estimasi_kedatangan, deskripsi, gambar, unggulan, ke_halaman_custom, aktif)
       VALUES (@id, @kategori, @nama, @grup, @member, @harga, @stok, @kondisi, @preOrder,
        @estimasi, @deskripsi, @gambar, @unggulan, @keCustom, @aktif)`
    ).run({ ...d, gambar: JSON.stringify(d.gambar) });
    res.status(201).json({ ok: true, id: d.id, pesan: 'Produk ditambahkan.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

r.put('/produk/:id', (req, res) => {
  try {
    const lama = db.prepare('SELECT * FROM produk WHERE id = ?').get(req.params.id);
    if (!lama) return res.status(404).json({ ok: false, pesan: 'Produk tidak ditemukan.' });
    const d = simpanProdukDariBody(req.body || {}, lama.id);
    db.prepare(
      `UPDATE produk SET kategori_id=@kategori, nama=@nama, grup=@grup, member=@member, harga=@harga,
        stok=@stok, kondisi=@kondisi, pre_order=@preOrder, estimasi_kedatangan=@estimasi,
        deskripsi=@deskripsi, gambar=@gambar, unggulan=@unggulan, ke_halaman_custom=@keCustom, aktif=@aktif
       WHERE id=@id`
    ).run({ ...d, gambar: JSON.stringify(d.gambar) });
    res.json({ ok: true, pesan: 'Produk diperbarui.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

r.delete('/produk/:id', (req, res) => {
  const dipakai = db.prepare('SELECT 1 FROM pesanan_item WHERE produk_id = ? LIMIT 1').get(req.params.id);
  if (dipakai) {
    db.prepare('UPDATE produk SET aktif = 0 WHERE id = ?').run(req.params.id);
    return res.json({ ok: true, pesan: 'Produk memiliki riwayat pesanan, sehingga dinonaktifkan (bukan dihapus).' });
  }
  db.prepare('DELETE FROM varian WHERE produk_id = ?').run(req.params.id);
  db.prepare('DELETE FROM produk WHERE id = ?').run(req.params.id);
  res.json({ ok: true, pesan: 'Produk dihapus.' });
});

// Unggah foto produk (dipakai saat tambah/ubah produk)
r.post('/produk/:id/foto', (req, res) => {
  simpanFoto.single('foto')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, pesan: err.message });
    try {
      const p = db.prepare('SELECT * FROM produk WHERE id = ?').get(req.params.id);
      if (!p) return res.status(404).json({ ok: false, pesan: 'Produk tidak ditemukan.' });
      if (!req.file) return res.status(400).json({ ok: false, pesan: 'Berkas foto wajib diunggah.' });
      const gambar = JSON.parse(p.gambar || '[]');
      gambar.push('/uploads/' + req.file.filename);
      db.prepare('UPDATE produk SET gambar = ? WHERE id = ?').run(JSON.stringify(gambar), p.id);
      res.status(201).json({ ok: true, gambar, pesan: 'Foto terunggah.' });
    } catch (e) {
      res.status(400).json({ ok: false, pesan: e.message });
    }
  });
});

// Varian
r.post('/produk/:id/varian', (req, res) => {
  try {
    const p = db.prepare('SELECT 1 FROM produk WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ ok: false, pesan: 'Produk tidak ditemukan.' });
    const nama = teksBersih(req.body.nama, { min: 2, maks: 40, label: 'Nama varian' });
    const nilai = teksBersih(req.body.nilai, { min: 1, maks: 60, label: 'Nilai varian' });
    const tambahan = bilanganBulat(req.body.hargaTambahan || 0, { min: 0, maks: 10000000, label: 'Harga tambahan' });
    const kosong = req.body.stok === undefined || req.body.stok === null || req.body.stok === '';
    const stok = kosong ? null : bilanganBulat(req.body.stok, { min: 0, maks: 1000000, label: 'Stok varian' });
    db.prepare('INSERT INTO varian (produk_id, nama, nilai, harga_tambahan, stok) VALUES (?, ?, ?, ?, ?)').run(
      req.params.id, nama, nilai, tambahan, stok
    );
    res.status(201).json({ ok: true, pesan: 'Varian ditambahkan.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

r.delete('/varian/:id', (req, res) => {
  db.prepare('DELETE FROM varian WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, pesan: 'Varian dihapus.' });
});

// --- Kategori ---
r.get('/kategori', (req, res) => {
  const rows = db
    .prepare(
      `SELECT k.*, (SELECT COUNT(*) FROM produk p WHERE p.kategori_id = k.id) AS jumlahProduk
       FROM kategori k ORDER BY k.urutan, k.nama`
    )
    .all();
  res.json(
    rows.map((k) => ({ id: k.id, nama: k.nama, slug: k.slug, urutan: k.urutan, jumlahProduk: k.jumlahProduk }))
  );
});

function slugDariTeks(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

r.post('/kategori', (req, res) => {
  try {
    const nama = teksBersih(req.body.nama, { min: 2, maks: 60, label: 'Nama kategori' });
    const urutan = bilanganBulat(req.body.urutan || 0, { min: 0, maks: 999, label: 'Urutan' });
    const slug = slugDariTeks(nama);
    if (!slug) throw new Error('Nama kategori tidak mengandung huruf atau angka.');
    if (db.prepare('SELECT 1 FROM kategori WHERE slug = ?').get(slug)) {
      throw new Error('Kategori dengan nama serupa sudah ada.');
    }
    let id = slug;
    let nomor = 2;
    while (db.prepare('SELECT 1 FROM kategori WHERE id = ?').get(id)) id = `${slug}-${nomor++}`;
    db.prepare('INSERT INTO kategori (id, nama, slug, urutan) VALUES (?, ?, ?, ?)').run(id, nama, slug, urutan);
    res.status(201).json({ ok: true, id, pesan: 'Kategori ditambahkan.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

r.put('/kategori/:id', (req, res) => {
  try {
    const lama = db.prepare('SELECT * FROM kategori WHERE id = ?').get(req.params.id);
    if (!lama) return res.status(404).json({ ok: false, pesan: 'Kategori tidak ditemukan.' });
    const nama = teksBersih(req.body.nama, { min: 2, maks: 60, label: 'Nama kategori' });
    const urutan = bilanganBulat(req.body.urutan || 0, { min: 0, maks: 999, label: 'Urutan' });
    db.prepare('UPDATE kategori SET nama = ?, urutan = ? WHERE id = ?').run(nama, urutan, lama.id);
    res.json({ ok: true, pesan: 'Kategori diperbarui.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

r.delete('/kategori/:id', (req, res) => {
  const lama = db.prepare('SELECT * FROM kategori WHERE id = ?').get(req.params.id);
  if (!lama) return res.status(404).json({ ok: false, pesan: 'Kategori tidak ditemukan.' });
  const jumlah = db.prepare('SELECT COUNT(*) AS n FROM produk WHERE kategori_id = ?').get(lama.id).n;
  if (jumlah > 0) {
    return res
      .status(400)
      .json({ ok: false, pesan: `Kategori masih berisi ${jumlah} produk. Pindahkan atau hapus produk tersebut terlebih dahulu.` });
  }
  db.prepare('DELETE FROM kategori WHERE id = ?').run(lama.id);
  res.json({ ok: true, pesan: 'Kategori dihapus.' });
});

// --- Pesanan (reguler & preorder) ---
const STATUS_PESANAN = ['menunggu_pembayaran', 'menunggu_konfirmasi', 'dikonfirmasi', 'diproses', 'dikirim', 'selesai', 'dibatalkan'];

r.get('/pesanan', (req, res) => {
  const { tipe = '', status = '' } = req.query;
  const where = [];
  const params = [];
  if (tipe) { where.push('tipe = ?'); params.push(tipe); }
  if (status) { where.push('status = ?'); params.push(status); }
  const sql = `SELECT * FROM pesanan ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY rowid DESC`;
  const rows = db.prepare(sql).all(...params);
  res.json(
    rows.map((p) => ({
      id: p.id,
      kode: p.kode,
      tipe: p.tipe,
      nama: p.nama,
      wa: p.wa,
      alamat: p.alamat,
      ekspedisi: p.ekspedisi,
      ongkir: p.ongkir,
      metodePembayaran: p.metode_pembayaran,
      adaBukti: Boolean(p.bukti_bayar),
      catatan: p.catatan,
      subtotal: p.subtotal,
      total: p.total,
      status: p.status,
      createdAt: p.created_at,
      bukti: p.bukti_bayar || '',
      items: db
        .prepare('SELECT nama_produk, varian, harga, jumlah FROM pesanan_item WHERE pesanan_id = ?')
        .all(p.id),
    }))
  );
});

// Detail pesanan (untuk panel detail & bukti bayar)
r.get('/pesanan/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM pesanan WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ ok: false, pesan: 'Pesanan tidak ditemukan.' });
  const items = db
    .prepare('SELECT produk_id, varian, nama_produk, harga, jumlah FROM pesanan_item WHERE pesanan_id = ?')
    .all(p.id);
  res.json({
    ok: true,
    pesanan: {
      id: p.id,
      kode: p.kode,
      tipe: p.tipe,
      nama: p.nama,
      wa: p.wa,
      alamat: p.alamat,
      ekspedisi: p.ekspedisi,
      ongkir: p.ongkir,
      metodePembayaran: p.metode_pembayaran,
      bukti: p.bukti_bayar || '',
      catatan: p.catatan,
      subtotal: p.subtotal,
      total: p.total,
      status: p.status,
      akunEmail: p.akun_email || '',
      createdAt: p.created_at,
      items: items.map((i) => ({
        produkId: i.produk_id, varian: i.varian, nama: i.nama_produk,
        harga: i.harga, jumlah: i.jumlah,
      })),
    },
  });
});

r.put('/pesanan/:id/status', (req, res) => {
  const status = teksBersih(req.body.status, { label: 'Status' });
  if (!STATUS_PESANAN.includes(status)) return res.status(400).json({ ok: false, pesan: 'Status tidak dikenal.' });
  const lama = db.prepare('SELECT * FROM pesanan WHERE id = ?').get(Number(req.params.id));
  if (!lama) return res.status(404).json({ ok: false, pesan: 'Pesanan tidak ditemukan.' });
  db.prepare('UPDATE pesanan SET status = ? WHERE id = ?').run(status, lama.id);
  notif.beriTahuPemilik(
    lama,
    'Status pesanan diperbarui',
    `Pesanan ${lama.kode} kini berstatus ${labelStatusId(status)}.`,
    '/akun'
  );
  res.json({ ok: true, pesan: 'Status pesanan diperbarui.' });
});

// --- Pesanan custom ---
r.get('/custom', (req, res) => {
  const { status = '' } = req.query;
  const rows = status
    ? db.prepare('SELECT * FROM custom_pesanan WHERE status = ? ORDER BY rowid DESC').all(status)
    : db.prepare('SELECT * FROM custom_pesanan ORDER BY rowid DESC').all();
  res.json(
    rows.map((c) => ({
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
      desainFile: c.desain_file,
      status: c.status,
      accPembeli: Boolean(c.acc_pembeli),
      metodePembayaran: c.metode_pembayaran,
      catatan: c.catatan,
      createdAt: c.created_at,
      komentar: db
        .prepare('SELECT pengirim, isi, created_at FROM custom_komentar WHERE custom_id = ? ORDER BY id')
        .all(c.id)
        .map((k) => ({ pengirim: k.pengirim, isi: k.isi, waktu: k.created_at })),
    }))
  );
});

// Tinjau desain: komentar + aksi (minta revisi / setujui / tolak)
r.post('/custom/:id/tinjau', (req, res) => {
  const hasil = ambilCustomAdmin(req, res);
  if (!hasil) return;
  const { baris } = hasil;
  try {
    const aksi = teksBersih(req.body.aksi, { label: 'Aksi' });
    const isi = teksBersih(req.body.komentar || '', { maks: 500, wajib: false, label: 'Komentar' });
    if (!['revisi', 'setujui', 'tolak'].includes(aksi)) throw new Error('Aksi tidak dikenal.');
    if (aksi !== 'tolak' && !isi) throw new Error('Komentar wajib diisi untuk aksi ini.');

    const statusBaru = { revisi: 'revisi', setujui: 'disetujui', tolak: 'ditolak' }[aksi];
    if (aksi === 'setujui' && baris.acc_pembeli) throw new Error('Pesanan ini sudah melewati persetujuan produksi.');

    db.transaction(() => {
      if (isi) {
        db.prepare('INSERT INTO custom_komentar (custom_id, pengirim, isi) VALUES (?, ?, ?)').run(
          baris.id, 'admin', isi
        );
      }
      db.prepare('UPDATE custom_pesanan SET status = ?, acc_pembeli = 0 WHERE id = ?').run(statusBaru, baris.id);
    })();

    const pesanAksi = { revisi: 'Revisi diminta.', setujui: 'Desain disetujui, menunggu persetujuan pembeli.', tolak: 'Desain ditolak.' }[aksi];
    notif.beriTahuPemilik(
      baris,
      'Tinjauan desain: ' + { revisi: 'revisi diminta', setujui: 'disetujui', tolak: 'ditolak' }[aksi],
      `Pesanan custom ${baris.kode}: ${pesanAksi}${isi ? ' Komentar admin: "' + isi + '"' : ''}`,
      '/akun'
    );
    res.json({ ok: true, status: statusBaru, pesan: pesanAksi });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

// Ubah status custom (dengan aturan alur)
r.put('/custom/:id/status', (req, res) => {
  const hasil = ambilCustomAdmin(req, res);
  if (!hasil) return;
  const { baris } = hasil;
  try {
    const status = teksBersih(req.body.status, { label: 'Status' });
    if (!STATUS_CUSTOM.includes(status)) throw new Error('Status tidak dikenal.');
    const kini = baris.status;
    const boleh =
      (kini === 'disetujui' && status === 'produksi' && baris.acc_pembeli) ||
      (kini === 'produksi' && status === 'siap_kirim') ||
      (kini === 'siap_kirim' && status === 'selesai') ||
      (kini === 'selesai' && status === 'selesai');
    if (!boleh) {
      throw new Error(
        'Perubahan status tidak sesuai alur (disetujui → produksi setelah persetujuan pembeli → siap kirim → selesai).'
      );
    }
    db.prepare('UPDATE custom_pesanan SET status = ? WHERE id = ?').run(status, baris.id);
    notif.beriTahuPemilik(
      baris,
      'Status pesanan custom diperbarui',
      `Pesanan custom ${baris.kode} kini berstatus ${labelStatusId(status)}.`,
      '/akun'
    );
    res.json({ ok: true, pesan: 'Status pesanan custom diperbarui.' });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

function ambilCustomAdmin(req, res) {
  const baris = db.prepare('SELECT * FROM custom_pesanan WHERE id = ?').get(Number(req.params.id));
  if (!baris) {
    res.status(404).json({ ok: false, pesan: 'Pesanan custom tidak ditemukan.' });
    return null;
  }
  return { baris };
}

// --- Ulasan & pelanggan ---
r.get('/ulasan', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.*, p.nama AS nama_produk FROM ulasan u
       LEFT JOIN produk p ON p.id = u.produk_id
       ORDER BY u.rowid DESC LIMIT 200`
    )
    .all();
  // Rata-rata & jumlah hanya menghitung ulasan yang tampil di publik
  const ringkas = db.prepare('SELECT COUNT(*) AS jumlah, AVG(rating) AS rata FROM ulasan WHERE sembunyi = 0').get();
  res.json({
    rata: ringkas.rata ? Math.round(ringkas.rata * 10) / 10 : null,
    jumlah: ringkas.jumlah,
    daftar: rows.map((u) => ({
      id: u.id,
      produkId: u.produk_id,
      namaProduk: u.nama_produk,
      nama: u.nama,
      rating: u.rating,
      komentar: u.komentar,
      sembunyi: Boolean(u.sembunyi),
      createdAt: u.created_at,
    })),
  });
});

// Sembunyikan/tampilkan ulasan di halaman publik
r.put('/ulasan/:id', (req, res) => {
  const lama = db.prepare('SELECT * FROM ulasan WHERE id = ?').get(Number(req.params.id));
  if (!lama) return res.status(404).json({ ok: false, pesan: 'Ulasan tidak ditemukan.' });
  const sembunyi = req.body && (req.body.sembunyi === true || req.body.sembunyi === 'true') ? 1 : 0;
  db.prepare('UPDATE ulasan SET sembunyi = ? WHERE id = ?').run(sembunyi, lama.id);
  res.json({
    ok: true,
    sembunyi: Boolean(sembunyi),
    pesan: sembunyi ? 'Ulasan disembunyikan dari halaman publik.' : 'Ulasan ditampilkan kembali.',
  });
});

r.delete('/ulasan/:id', (req, res) => {
  const info = db.prepare('DELETE FROM ulasan WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ ok: false, pesan: 'Ulasan tidak ditemukan.' });
  res.json({ ok: true, pesan: 'Ulasan dihapus.' });
});

r.get('/pelanggan', (req, res) => {
  const reguler = db
    .prepare('SELECT wa, nama, COUNT(*) AS jumlah, SUM(total) AS total FROM pesanan GROUP BY wa')
    .all();
  const custom = db
    .prepare('SELECT wa, nama, COUNT(*) AS jumlah, SUM(total) AS total FROM custom_pesanan GROUP BY wa')
    .all();
  const peta = new Map();
  for (const p of [...reguler, ...custom]) {
    const lama = peta.get(p.wa) || { wa: p.wa, nama: p.nama, jumlahPesanan: 0, totalBelanja: 0 };
    if (!lama.nama || lama.nama === '-') lama.nama = p.nama;
    lama.jumlahPesanan += p.jumlah;
    lama.totalBelanja += p.total;
    peta.set(p.wa, lama);
  }
  res.json([...peta.values()].sort((a, b) => b.jumlahPesanan - a.jumlahPesanan));
});

// Riwayat satu pelanggan (berdasarkan nomor WhatsApp)
r.get('/pelanggan/:wa/riwayat', (req, res) => {
  const wa = String(req.params.wa).replace(/[\s-]/g, '');
  const reguler = db
    .prepare('SELECT * FROM pesanan WHERE wa = ? ORDER BY rowid DESC')
    .all(wa)
    .map((p) => ({
      jenis: 'reguler', kode: p.kode, tipe: p.tipe, nama: p.nama, status: p.status,
      total: p.total, metodePembayaran: p.metode_pembayaran, createdAt: p.created_at,
      items: db
        .prepare('SELECT nama_produk, varian, harga, jumlah FROM pesanan_item WHERE pesanan_id = ?')
        .all(p.id),
    }));
  const custom = db
    .prepare('SELECT * FROM custom_pesanan WHERE wa = ? ORDER BY rowid DESC')
    .all(wa)
    .map((c) => ({
      jenis: 'custom', kode: c.kode, tipeCustom: c.tipe_custom, nama: c.nama, status: c.status,
      total: c.total, jumlah: c.jumlah, createdAt: c.created_at,
    }));
  const ringkas = db
    .prepare(
      `SELECT COUNT(*) AS jumlah,
              COALESCE(SUM(CASE WHEN status <> 'dibatalkan' THEN total ELSE 0 END), 0) AS total
       FROM pesanan WHERE wa = ?`
    )
    .get(wa);
  const ringkasCustom = db
    .prepare(
      `SELECT COUNT(*) AS jumlah,
              COALESCE(SUM(CASE WHEN status <> 'ditolak' THEN total ELSE 0 END), 0) AS total
       FROM custom_pesanan WHERE wa = ?`
    )
    .get(wa);
  res.json({
    ok: true,
    wa,
    jumlahPesanan: reguler.length + custom.length,
    totalBelanja: ringkas.total + ringkasCustom.total,
    pesanan: reguler,
    custom,
  });
});

// --- Akun admin: lihat & ubah data (email/sandi disimpan di .env) ---
const ENV_PATH = path.join(__dirname, '..', '.env');

function tulisEnv(kunci, nilai) {
  let isi = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  // Nilai yang mengandung spasi/#/tanda kutip dibungkus kutip agar aman dibaca dotenv
  const aman = /^[A-Za-z0-9@._:+/-]+$/.test(nilai) ? nilai : `"${nilai.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const baris = `${kunci}=${aman}`;
  const pola = new RegExp(`^${kunci}=.*$`, 'm');
  if (pola.test(isi)) isi = isi.replace(pola, baris);
  else isi = isi.trimEnd() + (isi.trim() ? '\n' : '') + baris + '\n';
  fs.writeFileSync(ENV_PATH, isi, 'utf8');
  process.env[kunci] = nilai;
}

r.get('/akun', (req, res) =>
  res.json({
    ok: true,
    email: emailSah(process.env.ADMIN_EMAIL) || 'admin@cloraamine.test',
  })
);

r.put('/akun', (req, res) => {
  try {
    const b = req.body || {};
    const sandiSekarang = String(b.sandiSekarang || '');
    const sandiBenar = process.env.ADMIN_PASSWORD || 'admin-contoh';
    if (sandiSekarang !== sandiBenar) {
      return res.status(400).json({ ok: false, pesan: 'Kata sandi saat ini salah.' });
    }
    const emailBaru = b.email !== undefined ? emailSah(b.email) : null;
    if (b.email !== undefined && !emailBaru) throw new Error('Alamat email tidak valid.');
    let sandiBaru = null;
    if (b.sandiBaru !== undefined && b.sandiBaru !== '') {
      const s = String(b.sandiBaru);
      if (s.length < 8 || s.length > 72 || !/[a-zA-Z]/.test(s) || !/\d/.test(s)) {
        throw new Error('Kata sandi baru minimal 8 karakter dan mengandung huruf serta angka.');
      }
      if (s === sandiSekarang) throw new Error('Kata sandi baru berbeda dari kata sandi saat ini.');
      sandiBaru = s;
    }
    if (!emailBaru && !sandiBaru) throw new Error('Tidak ada perubahan yang disimpan.');
    if (emailBaru) tulisEnv('ADMIN_EMAIL', emailBaru);
    if (sandiBaru) tulisEnv('ADMIN_PASSWORD', sandiBaru);
    res.json({
      ok: true,
      email: emailSah(process.env.ADMIN_EMAIL) || 'admin@cloraamine.test',
      pesan: 'Data akun admin diperbarui. Gunakan data baru untuk masuk berikutnya.',
    });
  } catch (e) {
    res.status(400).json({ ok: false, pesan: e.message });
  }
});

// --- Rekap penjualan ---
r.get('/rekap', (req, res) => {
  const totalPesanan = db.prepare('SELECT COUNT(*) AS c FROM pesanan').get().c;
  const totalCustom = db.prepare('SELECT COUNT(*) AS c FROM custom_pesanan').get().c;
  const pendapatanReguler = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS s FROM pesanan WHERE status NOT IN ('dibatalkan')")
    .get().s;
  const pendapatanCustom = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS s FROM custom_pesanan WHERE status <> 'ditolak'")
    .get().s;
  const perProduk = db
    .prepare(
      `SELECT i.nama_produk AS nama, SUM(i.jumlah) AS terjual, SUM(i.harga * i.jumlah) AS pendapatan
       FROM pesanan_item i JOIN pesanan p ON p.id = i.pesanan_id
       WHERE p.status NOT IN ('dibatalkan')
       GROUP BY i.nama_produk ORDER BY terjual DESC`
    )
    .all();
  const perCustom = db
    .prepare(
      `SELECT tipe_custom AS nama, SUM(jumlah) AS terjual, SUM(total) AS pendapatan
       FROM custom_pesanan WHERE status <> 'ditolak'
       GROUP BY tipe_custom ORDER BY terjual DESC`
    )
    .all();
  const perStatusPesanan = db
    .prepare('SELECT status, COUNT(*) AS jumlah FROM pesanan GROUP BY status')
    .all();
  const perStatusCustom = db
    .prepare('SELECT status, COUNT(*) AS jumlah FROM custom_pesanan GROUP BY status')
    .all();
  res.json({
    totalPesanan: totalPesanan + totalCustom,
    totalPesananReguler: totalPesanan,
    totalPesananCustom: totalCustom,
    pendapatan: pendapatanReguler + pendapatanCustom,
    pendapatanReguler,
    pendapatanCustom,
    perProduk: [...perProduk, ...perCustom].sort((a, b) => b.terjual - a.terjual),
    perStatusPesanan,
    perStatusCustom,
  });
});

// --- Ekspor CSV ---
r.get('/pesanan.csv', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM pesanan ORDER BY rowid DESC')
    .all();
  const custom = db.prepare('SELECT * FROM custom_pesanan ORDER BY rowid DESC').all();
  const kepala = [
    'kode', 'tipe', 'tanggal', 'nama', 'whatsapp', 'produk', 'jumlah_total',
    'subtotal', 'ongkir', 'total', 'metode_pembayaran', 'ekspedisi', 'status', 'catatan',
  ];
  const esc = (v) => {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const baris = [];
  for (const p of rows) {
    const items = db.prepare('SELECT nama_produk, varian, jumlah FROM pesanan_item WHERE pesanan_id = ?').all(p.id);
    const daftar = items.map((i) => `${i.nama_produk}${i.varian ? ' (' + i.varian + ')' : ''} x${i.jumlah}`).join('; ');
    const jumlahAll = items.reduce((a, i) => a + i.jumlah, 0);
    baris.push([
      p.kode, p.tipe, p.created_at, p.nama, p.wa, daftar, jumlahAll,
      p.subtotal, p.ongkir, p.total, p.metode_pembayaran, p.ekspedisi, p.status, p.catatan,
    ].map(esc).join(','));
  }
  for (const c of custom) {
    baris.push([
      c.kode, `custom-${c.tipe_custom}`, c.created_at, c.nama, c.wa,
      `${c.tipe_custom} ukuran ${c.ukuran_id} bahan ${c.bahan_id} bentuk ${c.bentuk_id}`,
      c.jumlah, c.total, 0, c.total, c.metode_pembayaran || '-', '-', c.status, c.catatan || '',
    ].map(esc).join(','));
  }
  const isi = [kepala.join(','), ...baris].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pesanan-cloraamine.csv"');
  res.send('\uFEFF' + isi);
});

module.exports = r;
