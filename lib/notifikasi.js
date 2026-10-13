/** Notifikasi in-app: disimpan di DB, dibaca lewat API notifikasi. */
const { db } = require('../data/db');

const PENERIMA_ADMIN = 'admin';

/** Catat notifikasi. Penerima: 'admin' atau email akun pelanggan. */
function catat(penerima, judul, pesan, tautan = '') {
  if (!penerima || !judul || !pesan) return;
  db.prepare('INSERT INTO notifikasi (penerima, judul, pesan, tautan) VALUES (?, ?, ?, ?)').run(
    String(penerima).toLowerCase(), judul, pesan, tautan
  );
}

function beriTahuAdmin(judul, pesan, tautan = '') {
  catat(PENERIMA_ADMIN, judul, pesan, tautan);
}

/** Beri tahu pemilik pesanan; email diambil dari pesanan atau pencocokan nomor WA. */
function beriTahuPemilik(pesanan, judul, pesan, tautan = '') {
  const email = pesanan && (pesanan.akun_email || cariEmailDariWa(pesanan.wa));
  if (email) catat(email, judul, pesan, tautan);
}

function cariEmailDariWa(wa) {
  if (!wa) return null;
  const akun = db.prepare('SELECT email FROM akun WHERE wa = ? ORDER BY id LIMIT 1').get(wa);
  return akun ? akun.email : null;
}

function daftar(penerima, { batas = 50, hanyaBelumDibaca = false } = {}) {
  const where = hanyaBelumDibaca
    ? 'penerima = ? AND dibaca = 0'
    : 'penerima = ?';
  return db
    .prepare(`SELECT * FROM notifikasi p WHERE ${where} ORDER BY id DESC LIMIT ${Number(batas) || 50}`)
    .all(String(penerima).toLowerCase())
    .map((n) => ({
      id: n.id,
      judul: n.judul,
      pesan: n.pesan,
      tautan: n.tautan,
      dibaca: Boolean(n.dibaca),
      waktu: n.created_at,
    }));
}

function jumlahBelumDibaca(penerima) {
  return db
    .prepare('SELECT COUNT(*) AS c FROM notifikasi WHERE penerima = ? AND dibaca = 0')
    .get(String(penerima).toLowerCase()).c;
}

function tandaiDibaca(penerima, id = null) {
  const p = String(penerima).toLowerCase();
  if (id === null) {
    return db.prepare('UPDATE notifikasi SET dibaca = 1 WHERE penerima = ? AND dibaca = 0').run(p).changes;
  }
  return db.prepare('UPDATE notifikasi SET dibaca = 1 WHERE penerima = ? AND id = ?').run(p, Number(id)).changes;
}

module.exports = {
  PENERIMA_ADMIN,
  catat,
  beriTahuAdmin,
  beriTahuPemilik,
  daftar,
  jumlahBelumDibaca,
  tandaiDibaca,
};
