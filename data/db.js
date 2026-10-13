/**
 * Lapisan database SQLite (better-sqlite3) untuk Cloraamine.
 * Berkas database ada di data/cloraamine.db (di-ignori git).
 * Seed dijalankan hanya jika tabel produk masih kosong.
 */
const path = require('path');
const Database = require('better-sqlite3');
const seedProduk = require('./produk');

const DB_PATH = path.join(__dirname, 'cloraamine.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kategori (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      urutan INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS produk (
      id TEXT PRIMARY KEY,
      kategori_id TEXT NOT NULL REFERENCES kategori(id),
      nama TEXT NOT NULL,
      grup TEXT DEFAULT '-',
      member TEXT DEFAULT '-',
      harga INTEGER NOT NULL DEFAULT 0,
      stok INTEGER NOT NULL DEFAULT 0,
      kondisi TEXT NOT NULL DEFAULT 'baru',
      pre_order INTEGER NOT NULL DEFAULT 0,
      estimasi_kedatangan TEXT,
      deskripsi TEXT DEFAULT '',
      gambar TEXT DEFAULT '[]',
      unggulan INTEGER NOT NULL DEFAULT 0,
      ke_halaman_custom INTEGER NOT NULL DEFAULT 0,
      aktif INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS varian (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produk_id TEXT NOT NULL REFERENCES produk(id) ON DELETE CASCADE,
      nama TEXT NOT NULL,
      nilai TEXT NOT NULL,
      harga_tambahan INTEGER NOT NULL DEFAULT 0,
      stok INTEGER
    );

    CREATE TABLE IF NOT EXISTS pesanan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode TEXT NOT NULL UNIQUE,
      tipe TEXT NOT NULL DEFAULT 'reguler',
      nama TEXT NOT NULL,
      wa TEXT NOT NULL,
      alamat TEXT DEFAULT '',
      ekspedisi TEXT DEFAULT '',
      ongkir INTEGER NOT NULL DEFAULT 0,
      metode_pembayaran TEXT NOT NULL,
      bukti_bayar TEXT,
      catatan TEXT DEFAULT '',
      subtotal INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      persetujuan_data INTEGER NOT NULL DEFAULT 0,
      token TEXT,
      status TEXT NOT NULL DEFAULT 'menunggu_pembayaran',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS pesanan_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pesanan_id INTEGER NOT NULL REFERENCES pesanan(id) ON DELETE CASCADE,
      produk_id TEXT,
      varian_id INTEGER,
      nama_produk TEXT NOT NULL,
      varian TEXT DEFAULT '',
      harga INTEGER NOT NULL,
      jumlah INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_pesanan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode TEXT NOT NULL UNIQUE,
      tipe_custom TEXT NOT NULL,
      nama TEXT NOT NULL,
      wa TEXT NOT NULL,
      ukuran_id TEXT NOT NULL,
      bahan_id TEXT NOT NULL,
      bentuk_id TEXT NOT NULL,
      jumlah INTEGER NOT NULL,
      harga_satuan INTEGER NOT NULL,
      total INTEGER NOT NULL,
      desain_file TEXT,
      persetujuan_cipta INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'menunggu_desain',
      metode_pembayaran TEXT DEFAULT '',
      bukti_bayar TEXT,
      catatan TEXT DEFAULT '',
      token TEXT,
      acc_pembeli INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS custom_komentar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      custom_id INTEGER NOT NULL REFERENCES custom_pesanan(id) ON DELETE CASCADE,
      pengirim TEXT NOT NULL,
      isi TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS ulasan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produk_id TEXT REFERENCES produk(id) ON DELETE SET NULL,
      kode_pesanan TEXT,
      nama TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      komentar TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS akun (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      sandi_hash TEXT NOT NULL,
      nama TEXT NOT NULL,
      wa TEXT DEFAULT '',
      dibuat TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS akun_sesi (
      token TEXT PRIMARY KEY,
      akun_id INTEGER NOT NULL REFERENCES akun(id) ON DELETE CASCADE,
      kedaluwarsa INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifikasi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      penerima TEXT NOT NULL,             -- 'admin' | email akun pelanggan
      judul TEXT NOT NULL,
      pesan TEXT NOT NULL,
      tautan TEXT DEFAULT '',
      dibaca INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS akun_alamat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      akun_email TEXT NOT NULL,
      penerima TEXT NOT NULL,
      telepon TEXT DEFAULT '',
      alamat TEXT NOT NULL,
      utama INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS wishlist (
      akun_email TEXT NOT NULL,
      produk_id TEXT NOT NULL REFERENCES produk(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (akun_email, produk_id)
    );
  `);

  // Migrasi ringan: kolom tautan akun pada pesanan (DB lama tanpa kolom ini).
  const kolomAkun = (tabel) =>
    db.prepare(`PRAGMA table_info(${tabel})`).all().some((k) => k.name === 'akun_email');
  if (!kolomAkun('pesanan')) db.exec("ALTER TABLE pesanan ADD COLUMN akun_email TEXT DEFAULT ''");
  if (!kolomAkun('custom_pesanan')) db.exec("ALTER TABLE custom_pesanan ADD COLUMN akun_email TEXT DEFAULT ''");
  // Ulasan disembunyikan admin dari halaman publik (DB lama tanpa kolom ini).
  const kolomSembunyi = db
    .prepare('PRAGMA table_info(ulasan)')
    .all()
    .some((k) => k.name === 'sembunyi');
  if (!kolomSembunyi) db.exec('ALTER TABLE ulasan ADD COLUMN sembunyi INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifikasi_penerima ON notifikasi(penerima, dibaca)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_alamat_akun ON akun_alamat(akun_email)');
}

function seed() {
  const jumlah = db.prepare('SELECT COUNT(*) AS c FROM produk').get().c;
  if (jumlah > 0) return false;

  const insKat = db.prepare(
    'INSERT INTO kategori (id, nama, slug, urutan) VALUES (?, ?, ?, ?)'
  );
  for (const k of seedProduk.kategori) insKat.run(k.id, k.nama, k.slug, k.urutan);

  const insProduk = db.prepare(`
    INSERT INTO produk (id, kategori_id, nama, grup, member, harga, stok, kondisi,
      pre_order, estimasi_kedatangan, deskripsi, gambar, unggulan, ke_halaman_custom)
    VALUES (@id, @kategori, @nama, @grup, @member, @harga, @stok, @kondisi,
      @preOrder, @estimasi, @deskripsi, @gambar, @unggulan, @keCustom)
  `);
  const insVarian = db.prepare(
    'INSERT INTO varian (produk_id, nama, nilai, harga_tambahan, stok) VALUES (?, ?, ?, ?, ?)'
  );

  const transaksi = db.transaction(() => {
    for (const p of seedProduk.produk) {
      insProduk.run({
        id: p.id,
        kategori: p.kategori,
        nama: p.nama,
        grup: p.grup,
        member: p.member,
        harga: p.harga,
        stok: p.stok,
        kondisi: p.kondisi,
        preOrder: p.preOrder ? 1 : 0,
        estimasi: p.estimasiKedatangan,
        deskripsi: p.deskripsi,
        gambar: JSON.stringify(p.gambar),
        unggulan: p.unggulan ? 1 : 0,
        keCustom: p.keHalamanCustom ? 1 : 0,
      });
      for (const v of p.varian || []) {
        insVarian.run(p.id, v.nama, v.nilai, v.hargaTambahan, v.stok ?? null);
      }
    }
  });
  transaksi();
  return true;
}

initSchema();
const disemaikan = seed();

module.exports = { db, DB_PATH, disemaikan };
