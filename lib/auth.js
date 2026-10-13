/** Autentikasi: sesi admin & pelanggan (email + kata sandi) dan token akses pembeli. */
const crypto = require('crypto');
const { db } = require('../data/db');

// --- Kata sandi (scrypt) ---
function hashSandi(sandi) {
  const garam = crypto.randomBytes(16).toString('hex');
  const kunci = crypto.scryptSync(sandi, garam, 32).toString('hex');
  return `${garam}:${kunci}`;
}

function cocokSandi(sandi, tersimpan) {
  const [garam, kunci] = String(tersimpan || '').split(':');
  if (!garam || !kunci) return false;
  const uji = crypto.scryptSync(sandi, garam, 32);
  const asli = Buffer.from(kunci, 'hex');
  return uji.length === asli.length && crypto.timingSafeEqual(uji, asli);
}

function emailSah(nilai) {
  const s = String(nilai || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 120 ? s : null;
}

// --- Sesi admin ---
const sesiAdmin = new Map(); // token -> waktu kedaluwarsa (ms)
const MASA_SESI = 8 * 60 * 60 * 1000; // 8 jam

function buatSesiAdmin() {
  const token = crypto.randomBytes(32).toString('hex');
  sesiAdmin.set(token, Date.now() + MASA_SESI);
  return token;
}

function hapusSesiAdmin(token) {
  if (token) sesiAdmin.delete(token);
}

function sahkanSesi(token) {
  if (!token) return false;
  const kedaluwarsa = sesiAdmin.get(token);
  if (!kedaluwarsa) return false;
  if (Date.now() > kedaluwarsa) {
    sesiAdmin.delete(token);
    return false;
  }
  return true;
}

// --- Cookie ---
function bacaCookie(header) {
  const hasil = {};
  if (!header) return hasil;
  for (const pasangan of header.split(';')) {
    const i = pasangan.indexOf('=');
    if (i < 0) continue;
    hasil[pasangan.slice(0, i).trim()] = decodeURIComponent(pasangan.slice(i + 1).trim());
  }
  return hasil;
}

function tokenAdminDariReq(req) {
  return bacaCookie(req.headers.cookie).clora_admin;
}

function wajibAdmin(req, res, next) {
  if (!sahkanSesi(tokenAdminDariReq(req))) {
    return res.status(401).json({ ok: false, pesan: 'Sesi admin tidak valid. Silakan masuk kembali.' });
  }
  next();
}

// --- Batas percobaan masuk (anti tebak sandi) ---
// Kunci dibedakan per ruang (admin / pelanggan) agar tidak saling mengunci.
const percobaanMasuk = new Map(); // "ruang|ip" -> { jumlah, waktuPertama }
function batasMasuk(ip, ruang = 'admin') {
  const kunci = `${ruang}|${ip}`;
  const sekarang = Date.now();
  const data = percobaanMasuk.get(kunci);
  if (!data || sekarang - data.waktuPertama > 15 * 60 * 1000) {
    percobaanMasuk.set(kunci, { jumlah: 1, waktuPertama: sekarang });
    return { boleh: true, sisa: 4 };
  }
  data.jumlah += 1;
  if (data.jumlah > 5) return { boleh: false, sisa: 0 };
  return { boleh: true, sisa: 5 - data.jumlah };
}

// --- Sesi pelanggan (dashboard pelanggan, berbasis akun email) ---
// Token disimpan di DB sehingga pelanggan bisa masuk dari banyak perangkat
// dan berpindah akun tanpa membuang sesi akun lain di perangkat yang sama.
const MASA_SESI_PELANGGAN = 24 * 60 * 60 * 1000; // 24 jam

function buatSesiPelanggan(akunId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO akun_sesi (token, akun_id, kedaluwarsa) VALUES (?, ?, ?)').run(
    token, akunId, Date.now() + MASA_SESI_PELANGGAN
  );
  return token;
}

function hapusSesiPelanggan(token) {
  if (token) db.prepare('DELETE FROM akun_sesi WHERE token = ?').run(token);
}

/** Kembalikan baris akun pemilik sesi ({ ...akun }) atau null bila tidak sah. */
function akunSesiPelanggan(token) {
  if (!token) return null;
  const baris = db
    .prepare(
      `SELECT a.* FROM akun_sesi s JOIN akun a ON a.id = s.akun_id
       WHERE s.token = ? AND s.kedaluwarsa > ?`
    )
    .get(token, Date.now());
  return baris || null;
}

function tokenSesiPelangganDariReq(req) {
  return req.get('x-sesi') || bacaCookie(req.headers.cookie).clora_pelanggan || null;
}

function wajibPelanggan(req, res, next) {
  const akun = akunSesiPelanggan(tokenSesiPelangganDariReq(req));
  if (!akun) {
    return res.status(401).json({ ok: false, pesan: 'Sesi tidak valid. Silakan masuk kembali.' });
  }
  req.akunPelanggan = akun;
  req.waPelanggan = akun.wa || '';
  next();
}

// --- Token pembeli (akses unggahan milik pesanan sendiri) ---
function tokenPembeliSah(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return false;
  const baris = db
    .prepare('SELECT 1 FROM pesanan WHERE token = ? UNION SELECT 1 FROM custom_pesanan WHERE token = ?')
    .get(token, token);
  return Boolean(baris);
}

/** Kunci unggahan: foto produk publik, lainnya hanya admin/token pembeli. */
function wajibAksesUnggahan(namaBerkas) {
  return function (req, res, next) {
    // Foto produk (foto-*) ditampilkan di katalog — boleh diakses semua orang.
    if (String(namaBerkas).startsWith('foto-')) return next();
    if (sahkanSesi(tokenAdminDariReq(req))) return next();
    const token = req.query.t || req.get('x-token');
    if (tokenPembeliSah(token)) {
      const pemilik = db
        .prepare(
          `SELECT 1 FROM pesanan WHERE token = ? AND (bukti_bayar = ?)
           UNION SELECT 1 FROM custom_pesanan WHERE token = ? AND (desain_file = ? OR bukti_bayar = ?)`
        )
        .get(token, namaBerkas, token, namaBerkas, namaBerkas);
      if (pemilik) return next();
    }
    return res.status(403).json({ ok: false, pesan: 'Akses ditolak.' });
  };
}

module.exports = {
  hashSandi,
  cocokSandi,
  emailSah,
  buatSesiAdmin,
  hapusSesiAdmin,
  sahkanSesi,
  bacaCookie,
  tokenAdminDariReq,
  wajibAdmin,
  batasMasuk,
  buatSesiPelanggan,
  hapusSesiPelanggan,
  akunSesiPelanggan,
  tokenSesiPelangganDariReq,
  wajibPelanggan,
  tokenPembeliSah,
  wajibAksesUnggahan,
};
