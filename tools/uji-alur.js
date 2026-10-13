/* Uji alur utama Cloraamine terhadap server yang berjalan di 127.0.0.1:4173 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:4173';
let gagal = 0;

// Ambil kredensial admin dari .env (persis seperti yang dipakai server)
try {
  const isiEnv = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const kunci of ['ADMIN_PASSWORD', 'ADMIN_EMAIL']) {
    const baris = isiEnv.split(/\r?\n/).find((b) => b.startsWith(kunci + '='));
    if (baris) process.env[kunci] = baris.slice(kunci.length + 1).trim();
  }
} catch { /* .env tidak ada — server memakai default */ }

function ok(nama, kondisi, info = '') {
  if (kondisi) console.log('  OK  ' + nama);
  else { gagal++; console.log('GAGAL ' + nama + ' ' + info); }
}

async function api(jalan, opsi = {}) {
  const res = await fetch(BASE + '/api' + jalan, {
    ...opsi,
    headers: {
      ...(opsi.data && !(opsi.data instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(opsi.headers || {}),
    },
    body: opsi.data && !(opsi.data instanceof FormData) ? JSON.stringify(opsi.data) : opsi.data,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, res };
}

function ambilCookie(res) {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return sc.map((c) => c.split(';')[0]).join('; ');
}

// Kredensial akun uji (email unik agar tidak bentrok dengan run berikutnya)
const stempel = Date.now().toString(36);
const AKUN_A = { email: `uji-a-${stempel}@contoh.test`, sandi: 'SandiUji123', nama: 'Pelanggan A', wa: '081299900011' };
const AKUN_B = { email: `uji-b-${stempel}@contoh.test`, sandi: 'SandiUji456', nama: 'Pelanggan B', wa: '081299900022' };

(async () => {
  // --- 1. Pengaturan & katalog ---
  const peng = await api('/pengaturan');
  ok('GET /pengaturan', peng.status === 200 && peng.data.namaToko === 'Cloraamine');
  const produk = await api('/produk');
  ok('GET /produk (katalog)', produk.status === 200 && Array.isArray(produk.data) && produk.data.length > 0,
    'jumlah=' + (produk.data && produk.data.length));
  const produkBeli = produk.data.find((p) => !p.keHalamanCustom && p.stok > 0 && p.preOrder === false);
  ok('Ada produk siap beli', Boolean(produkBeli));

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  // --- 2. Daftar akun A ---
  const daftarSalah = await api('/akun/daftar', {
    method: 'POST',
    data: { nama: 'X', email: 'bukan-email', sandi: 'pendek' },
  });
  ok('Daftar dengan input tidak valid ditolak', daftarSalah.status === 400);

  const daftar = await api('/akun/daftar', { method: 'POST', data: AKUN_A });
  ok('POST /akun/daftar', daftar.status === 201 && daftar.data.token && daftar.data.akun.email === AKUN_A.email,
    JSON.stringify(daftar.data));
  const tokenA = daftar.data.token;
  const hdrsA = { 'x-sesi': tokenA };

  const daftarUlang = await api('/akun/daftar', { method: 'POST', data: AKUN_A });
  ok('Daftar dengan email terpakai ditolak (409)', daftarUlang.status === 409);

  // --- 3. Masuk ---
  const masukSalah = await api('/akun/masuk', { method: 'POST', data: { email: AKUN_A.email, sandi: 'salah-salah' } });
  ok('Masuk dengan sandi salah ditolak', masukSalah.status === 401);

  const masuk = await api('/akun/masuk', { method: 'POST', data: { email: AKUN_A.email, sandi: AKUN_A.sandi } });
  ok('POST /akun/masuk', masuk.status === 200 && masuk.data.token);
  const tokenA2 = masuk.data.token;
  const hdrsA2 = { 'x-sesi': tokenA2 };

  const sesiA = await api('/akun/sesi', { headers: hdrsA2 });
  ok('GET /akun/sesi', sesiA.status === 200 && sesiA.data.akun.email === AKUN_A.email,
    JSON.stringify(sesiA.data));

  const tanpaSesi = await api('/pelanggan/riwayat');
  ok('GET /pelanggan/riwayat tanpa sesi ditolak', tanpaSesi.status === 401);

  // --- 4. Checkout (dengan sesi akun A) ---
  const checkout = await api('/pesanan', {
    method: 'POST', headers: hdrsA2,
    data: {
      nama: AKUN_A.nama,
      wa: AKUN_A.wa,
      alamat: 'Jalan Uji Coba No. 1, Kota Contoh, Kode Pos 12345',
      ekspedisi: 'jne',
      metodePembayaran: 'transfer',
      catatan: 'Paket uji',
      persetujuanData: true,
      items: [{ produkId: produkBeli.id, varianId: null, jumlah: 1 }],
    },
  });
  ok('POST /pesanan (checkout)', checkout.status === 201 && checkout.data.kode, JSON.stringify(checkout.data));
  const kode = checkout.data.kode;
  const token = checkout.data.token;
  const wa = AKUN_A.wa;

  // --- 5. Pelacakan ---
  const lacak = await api('/pesanan/lacak?kode=' + kode + '&wa=' + wa);
  ok('GET /pesanan/lacak', lacak.status === 200 && lacak.data.kode === kode);

  // --- 6. Unggah bukti bayar ---
  const fd = new FormData();
  fd.append('bukti', new Blob([png], { type: 'image/png' }), 'bukti.png');
  const bukti = await fetch(BASE + '/api/pesanan/' + kode + '/bukti', {
    method: 'POST', headers: { 'x-token': token }, body: fd,
  }).then((r) => r.json());
  ok('POST /pesanan/:kode/bukti', bukti.ok === true, JSON.stringify(bukti));

  // --- 7. Dashboard pelanggan: riwayat & ringkasan ---
  const ringkasan = await api('/pelanggan/ringkasan', { headers: hdrsA2 });
  ok('GET /pelanggan/ringkasan', ringkasan.status === 200 && ringkasan.data.jumlahPesanan >= 1,
    JSON.stringify(ringkasan.data));

  const riwayat = await api('/pelanggan/riwayat', { headers: hdrsA2 });
  const pRiwayat = riwayat.data.pesanan || [];
  ok('GET /pelanggan/riwayat memuat pesanan kita', pRiwayat.some((p) => p.kode === kode));
  const baris = pRiwayat.find((p) => p.kode === kode);
  ok('Riwayat punya item & status', baris && baris.items.length === 1 && baris.status === 'menunggu_konfirmasi',
    baris && baris.status);

  // --- 8. Ulasan bertautan kode pesanan ---
  const ulasan = await api('/ulasan', {
    method: 'POST',
    data: { nama: AKUN_A.nama, rating: 5, komentar: 'Barang sesuai, pelayanan cepat.', kodePesanan: kode },
  });
  ok('POST /ulasan dengan kodePesanan', ulasan.status === 201, JSON.stringify(ulasan.data));

  const ulasanLagi = await api('/ulasan', {
    method: 'POST',
    data: { nama: 'X', rating: 5, komentar: 'Tes terkait kode', kodePesanan: 'CL-TIDAK-ADA' },
  });
  ok('POST /ulasan kode pesanan palsu ditolak', ulasanLagi.status === 400);

  // --- 9. Pesanan custom (dengan sesi akun A) ---
  const konfig = await api('/custom/konfigurasi');
  ok('GET /custom/konfigurasi', konfig.status === 200 && konfig.data.ukuran.length > 0);
  const ukuran = konfig.data.ukuran[0];
  const bahan = konfig.data.bahan[0];
  const bentuk = konfig.data.bentuk[0];
  const tipeCustom = konfig.data.jenis[0].id;
  const jumlah = konfig.data.jumlahMinimal[tipeCustom];

  const fdDesain = new FormData();
  fdDesain.append('desain', new Blob([png], { type: 'image/png' }), 'desain.png');
  fdDesain.append('tipeCustom', tipeCustom);
  fdDesain.append('nama', AKUN_A.nama);
  fdDesain.append('wa', wa);
  fdDesain.append('ukuranId', ukuran.id);
  fdDesain.append('bahanId', bahan.id);
  fdDesain.append('bentukId', bentuk.id);
  fdDesain.append('jumlah', String(jumlah));
  fdDesain.append('persetujuanCipta', 'true');
  const custom = await fetch(BASE + '/api/custom', {
    method: 'POST', headers: { 'x-sesi': tokenA2 }, body: fdDesain,
  }).then((r) => r.json());
  ok('POST /custom (pesanan custom)', custom.ok === true && custom.kode, JSON.stringify(custom));
  const kodeCX = custom.kode;
  const tokenCX = custom.token;

  // Dashboard pelanggan melihat custom
  const riwayat2 = await api('/pelanggan/riwayat', { headers: hdrsA2 });
  ok('Riwayat memuat pesanan custom', (riwayat2.data.custom || []).some((c) => c.kode === kodeCX));

  // Komentar pembeli dari dashboard
  const komentar = await api('/custom/' + kodeCX + '/komentar', {
    method: 'POST', headers: { 'x-token': tokenCX, 'x-sesi': tokenA2 },
    data: { isi: 'Mohon dipercepat ya.' },
  });
  ok('POST /custom/:kode/komentar', komentar.status === 201, JSON.stringify(komentar.data));

  // --- 10. Pindah akun: daftar akun B, verifikasi sesi terpisah ---
  const daftarB = await api('/akun/daftar', { method: 'POST', data: AKUN_B });
  ok('Daftar akun B (pindah akun)', daftarB.status === 201 && daftarB.data.token);
  const tokenB = daftarB.data.token;

  const sesiB = await api('/akun/sesi', { headers: { 'x-sesi': tokenB } });
  ok('Sesi B menunjukkan akun B', sesiB.data.akun.email === AKUN_B.email);

  const sesiATetap = await api('/akun/sesi', { headers: hdrsA2 });
  ok('Sesi A tetap aktif setelah B masuk', sesiATetap.data.akun.email === AKUN_A.email);

  const riwayatB = await api('/pelanggan/riwayat', { headers: { 'x-sesi': tokenB } });
  ok('Riwayat B tidak memuat pesanan A',
    (riwayatB.data.pesanan || []).every((p) => p.kode !== kode) &&
    (riwayatB.data.custom || []).every((c) => c.kode !== kodeCX));

  const validasiToken = await api('/akun/validasi-token', { method: 'POST', data: { token: tokenA2 } });
  ok('POST /akun/validasi-token (token tersimpan sah)',
    validasiToken.status === 200 && validasiToken.data.akun.email === AKUN_A.email);
  const validasiPalsu = await api('/akun/validasi-token', { method: 'POST', data: { token: 'token-palsu-tidak-ada' } });
  ok('validasi-token palsu ditolak', validasiPalsu.status === 401);

  // --- 11. Profil & ganti sandi ---
  const profil = await api('/akun/profil', {
    method: 'PUT', headers: hdrsA2, data: { nama: 'Pelanggan A Baru', wa: AKUN_A.wa },
  });
  ok('PUT /akun/profil', profil.status === 200, JSON.stringify(profil.data));

  const sandiSalah = await api('/akun/sandi', {
    method: 'PUT', headers: hdrsA2, data: { sandiLama: 'keliru-keliru', sandiBaru: 'BaruSandi123' },
  });
  ok('Ganti sandi dengan sandi lama salah ditolak', sandiSalah.status === 400);
  const sandiBaru = await api('/akun/sandi', {
    method: 'PUT', headers: hdrsA2, data: { sandiLama: AKUN_A.sandi, sandiBaru: 'BaruSandi123' },
  });
  ok('PUT /akun/sandi', sandiBaru.status === 200, JSON.stringify(sandiBaru.data));
  const masukSandiBaru = await api('/akun/masuk', {
    method: 'POST', data: { email: AKUN_A.email, sandi: 'BaruSandi123' },
  });
  ok('Masuk dengan sandi baru', masukSandiBaru.status === 200);

  // --- 12. Admin: login email, status, tinjau custom, notifikasi ---
  const adminLoginSalah = await api('/admin/login', {
    method: 'POST', data: { email: 'bukan@admin.test', sandi: process.env.ADMIN_PASSWORD || 'admin-contoh' },
  });
  ok('Login admin dengan email salah ditolak', adminLoginSalah.status === 401);

  const adminLogin = await api('/admin/login', {
    method: 'POST',
    data: {
      email: process.env.ADMIN_EMAIL || 'admin@cloraamine.test',
      sandi: process.env.ADMIN_PASSWORD || 'admin-contoh',
    },
  });
  ok('POST /admin/login (email + sandi)', adminLogin.status === 200, JSON.stringify(adminLogin.data));
  const adminCookie = ambilCookie(adminLogin.res);
  const ah = { Cookie: adminCookie };

  const adminSesi = await api('/admin/sesi', { headers: ah });
  ok('GET /admin/sesi mengembalikan email', adminSesi.status === 200 && Boolean(adminSesi.data.email));

  const daftarPesanan = await api('/admin/pesanan', { headers: ah });
  ok('GET /admin/pesanan', daftarPesanan.status === 200 && daftarPesanan.data.some((p) => p.kode === kode));

  const idPesanan = daftarPesanan.data.find((p) => p.kode === kode).id;
  const ubahStatus = await api('/admin/pesanan/' + idPesanan + '/status', {
    method: 'PUT', headers: ah, data: { status: 'diproses' },
  });
  ok('PUT /admin/pesanan/:id/status', ubahStatus.status === 200, JSON.stringify(ubahStatus.data));

  const cekStatus = await api('/pesanan/lacak?kode=' + kode + '&wa=' + wa);
  ok('Status terlihat pembeli (diproses)', cekStatus.data.status === 'diproses', cekStatus.data.status);

  const daftarCustom = await api('/admin/custom', { headers: ah });
  const cx = daftarCustom.data.find((c) => c.kode === kodeCX);
  ok('GET /admin/custom', daftarCustom.status === 200 && Boolean(cx));
  const tinjau = await api('/admin/custom/' + cx.id + '/tinjau', {
    method: 'POST', headers: ah, data: { aksi: 'setujui', komentar: 'Desain bagus, lanjut produksi.' },
  });
  ok('POST /admin/custom/:id/tinjau (setujui)', tinjau.status === 200, JSON.stringify(tinjau.data));

  // Pembeli setujui produksi dari dashboard
  const acc = await api('/custom/' + kodeCX + '/persetujuan', {
    method: 'POST', headers: { 'x-token': tokenCX, 'x-sesi': tokenA2 },
  });
  ok('POST /custom/:kode/persetujuan (oleh pembeli)', acc.status === 200, JSON.stringify(acc.data));

  const statusCustom = await api('/admin/custom/' + cx.id + '/status', {
    method: 'PUT', headers: ah, data: { status: 'produksi' },
  });
  ok('PUT /admin/custom/:id/status → produksi', statusCustom.status === 200, JSON.stringify(statusCustom.data));

  // Notifikasi
  const notifAdmin = await api('/notifikasi', { headers: ah });
  ok('GET /notifikasi admin (ada isinya)', notifAdmin.status === 200 && notifAdmin.data.daftar.length > 0,
    'jumlah=' + (notifAdmin.data.daftar && notifAdmin.data.daftar.length));
  ok('Notifikasi admin memuat pesanan baru', notifAdmin.data.daftar.some((n) => n.judul.includes(kode)));

  const notifA = await api('/notifikasi', { headers: hdrsA2 });
  ok('GET /notifikasi pelanggan A (ada isinya)', notifA.status === 200 && notifA.data.daftar.length > 0,
    'jumlah=' + (notifA.data.daftar && notifA.data.daftar.length));
  ok('Notifikasi A memuat perubahan status', notifA.data.daftar.some((n) => n.judul.includes('Status')));

  const notifB = await api('/notifikasi', { headers: { 'x-sesi': tokenB } });
  ok('Notifikasi B kosong (tidak bocor)', notifB.status === 200 && notifB.data.daftar.length === 0);

  const bacaSemua = await api('/notifikasi/baca-semua', { method: 'POST', headers: hdrsA2 });
  ok('POST /notifikasi/baca-semua', bacaSemua.status === 200 && bacaSemua.data.ok);
  const notifAKosong = await api('/notifikasi?hanyaBelum=1', { headers: hdrsA2 });
  ok('Notifikasi A habis ditandai dibaca', notifAKosong.data.daftar.length === 0);

  // --- 13. Ringkasan & ulasan admin ---
  const rekap = await api('/admin/rekap', { headers: ah });
  ok('GET /admin/rekap', rekap.status === 200 && rekap.data.totalPesanan >= 2, JSON.stringify(rekap.data));
  const ulasanAdmin = await api('/admin/ulasan', { headers: ah });
  ok('GET /admin/ulasan (ada rata-rata)', ulasanAdmin.status === 200 && ulasanAdmin.data.jumlah >= 1);
  const pelangganAdmin = await api('/admin/pelanggan', { headers: ah });
  ok('GET /admin/pelanggan', pelangganAdmin.status === 200 &&
    pelangganAdmin.data.some((p) => p.wa === wa));

  const csv = await fetch(BASE + '/api/admin/pesanan.csv', { headers: ah });
  const csvTeks = await csv.text();
  ok('GET /admin/pesanan.csv', csv.status === 200 && csvTeks.includes(kode) && csvTeks.includes(kodeCX),
    'status=' + csv.status);

  const qr = await fetch(BASE + '/api/qr?url=' + encodeURIComponent(BASE) + '&size=256');
  ok('GET /api/qr (PNG)', qr.status === 200 && (qr.headers.get('content-type') || '').includes('image'));

  // --- 14. Foto produk publik di katalog ---
  const fotoUnggah = await fetch(BASE + '/api/admin/produk/' + produkBeli.id + '/foto', {
    method: 'POST', headers: ah,
    body: (() => { const f = new FormData(); f.append('foto', new Blob([png], { type: 'image/png' }), 'foto.png'); return f; })(),
  }).then((r) => r.json());
  ok('Admin mengunggah foto produk', fotoUnggah.ok === true, JSON.stringify(fotoUnggah));
  if (fotoUnggah.ok && fotoUnggah.gambar) {
    const pathFoto = fotoUnggah.gambar.find((g) => g.startsWith('/uploads/foto-'));
    if (pathFoto) {
      const fotoPublik = await fetch(BASE + pathFoto);
      ok('Foto produk dapat dilihat semua orang (tanpa sesi)', fotoPublik.status === 200,
        'status=' + fotoPublik.status);
      const produkSetelah = await api('/produk/' + produkBeli.id);
      ok('Foto tampil di detail produk', (produkSetelah.data.gambar || []).includes(pathFoto));
    } else {
      ok('Foto produk tersimpan dengan awalan foto-', false, JSON.stringify(fotoUnggah.gambar));
    }
  }

  // --- 15. Keamanan dasar ---
  const adminTanpaSesi = await api('/admin/pesanan');
  ok('API admin tanpa sesi ditolak', adminTanpaSesi.status === 401);
  const unggahanLiar = await fetch(BASE + '/uploads/bukti-tidak-ada.png');
  ok('Unggahan bukti tanpa token ditolak', unggahanLiar.status === 403 || unggahanLiar.status === 404);
  const notifTanpaSesi = await api('/notifikasi');
  ok('API notifikasi tanpa sesi ditolak', notifTanpaSesi.status === 401);

  // Halaman /admin: tanpa sesi admin diarahkan ke pilihan akun; pelanggan juga ditolak
  const adminHalaman = await fetch(BASE + '/admin', { redirect: 'manual' });
  ok('Halaman /admin tanpa sesi admin diarahkan ke /akun',
    adminHalaman.status === 302 && (adminHalaman.headers.get('location') || '').includes('/akun'),
    'status=' + adminHalaman.status + ' loc=' + adminHalaman.headers.get('location'));
  const adminDgnSesiPelanggan = await fetch(BASE + '/admin', {
    redirect: 'manual', headers: { 'x-sesi': tokenA2 },
  });
  ok('Pelanggan dengan sesi akun tetap ditolak membuka /admin',
    adminDgnSesiPelanggan.status === 302,
    'status=' + adminDgnSesiPelanggan.status);
  const adminDgnCookie = await fetch(BASE + '/admin', { redirect: 'manual', headers: ah });
  ok('Admin dengan sesi dapat membuka /admin', adminDgnCookie.status === 200,
    'status=' + adminDgnCookie.status);
  const apiAdminSesiPelanggan = await api('/admin/pesanan', { headers: hdrsA2 });
  ok('Sesi pelanggan ditolak pada API admin', apiAdminSesiPelanggan.status === 401,
    'status=' + apiAdminSesiPelanggan.status);

  // --- 15b. Alamat tersimpan ---
  const alamatKosong = await api('/akun/alamat', { headers: hdrsA2 });
  ok('GET /akun/alamat', alamatKosong.status === 200 && Array.isArray(alamatKosong.data.alamat));
  const alamatSalah = await api('/akun/alamat', {
    method: 'POST', headers: hdrsA2, data: { penerima: 'X', telepon: 'bukan-nomor', alamat: 'Terlalu pendek' },
  });
  ok('Alamat dengan input tidak valid ditolak', alamatSalah.status === 400);
  const alamatBaru = await api('/akun/alamat', {
    method: 'POST', headers: hdrsA2,
    data: { penerima: AKUN_A.nama, telepon: AKUN_A.wa, alamat: 'Jalan Alamat Utama No. 7, Kota Contoh 12345', utama: true },
  });
  ok('POST /akun/alamat', alamatBaru.status === 201, JSON.stringify(alamatBaru.data));
  const alamatList = await api('/akun/alamat', { headers: hdrsA2 });
  const alamatId = alamatList.data.alamat[0] && alamatList.data.alamat[0].id;
  ok('Alamat tersimpan & menjadi utama', alamatList.data.alamat.length === 1 && alamatList.data.alamat[0].utama);
  if (alamatId) {
    const alamatUbah = await api('/akun/alamat/' + alamatId, {
      method: 'PUT', headers: hdrsA2, data: { penerima: 'Pelanggan A Diubah' },
    });
    ok('PUT /akun/alamat/:id', alamatUbah.status === 200, JSON.stringify(alamatUbah.data));
    const alamatHapus = await api('/akun/alamat/' + alamatId, { method: 'DELETE', headers: hdrsA2 });
    ok('DELETE /akun/alamat/:id', alamatHapus.status === 200, JSON.stringify(alamatHapus.data));
  }
  const alamatLain = await api('/akun/alamat/999999', { method: 'DELETE', headers: hdrsA2 });
  ok('DELETE alamat tidak dikenal ditolak (404)', alamatLain.status === 404);

  // --- 15c. Wishlist ---
  const wishKosong = await api('/akun/wishlist', { headers: hdrsA2 });
  ok('GET /akun/wishlist', wishKosong.status === 200 && Array.isArray(wishKosong.data.wishlist));
  const wishTambah = await api('/akun/wishlist', {
    method: 'POST', headers: hdrsA2, data: { produkId: produkBeli.id },
  });
  ok('POST /akun/wishlist', wishTambah.status === 201, JSON.stringify(wishTambah.data));
  const wishList = await api('/akun/wishlist', { headers: hdrsA2 });
  ok('Wishlist memuat produk yang dipilih', wishList.data.wishlist.some((w) => w.id === produkBeli.id));
  const wishGanda = await api('/akun/wishlist', {
    method: 'POST', headers: hdrsA2, data: { produkId: produkBeli.id },
  });
  ok('Wishlist ganda tidak membuat duplikat', wishGanda.status === 201);
  const wishHitung = await api('/akun/wishlist', { headers: hdrsA2 });
  ok('Jumlah wishlist tetap 1', wishHitung.data.wishlist.filter((w) => w.id === produkBeli.id).length === 1);
  const wishHapus = await api('/akun/wishlist/' + produkBeli.id, { method: 'DELETE', headers: hdrsA2 });
  ok('DELETE /akun/wishlist/:produkId', wishHapus.status === 200, JSON.stringify(wishHapus.data));

  // --- 15d. Ulasan admin: sembunyikan & hapus ---
  const buatUlasan = await api('/ulasan', {
    method: 'POST', data: { nama: 'Uji Sembunyi', rating: 2, komentar: 'Ulasan uji untuk disembunyikan.' },
  });
  ok('Membuat ulasan uji', buatUlasan.status === 201);
  const daftarUlasanAdmin = await api('/admin/ulasan', { headers: ah });
  const ulasanUji = daftarUlasanAdmin.data.daftar.find((u) => u.nama === 'Uji Sembunyi');
  ok('Ulasan uji terlihat admin', Boolean(ulasanUji));
  if (ulasanUji) {
    const sembunyi = await api('/admin/ulasan/' + ulasanUji.id, {
      method: 'PUT', headers: ah, data: { sembunyi: true },
    });
    ok('PUT /admin/ulasan/:id (sembunyikan)', sembunyi.status === 200 && sembunyi.data.sembunyi === true,
      JSON.stringify(sembunyi.data));
    const publik = await api('/ulasan');
    ok('Ulasan tersembunyi tidak tampil di halaman publik',
      !publik.data.some((u) => u.id === ulasanUji.id));
    const tampilLagi = await api('/admin/ulasan/' + ulasanUji.id, {
      method: 'PUT', headers: ah, data: { sembunyi: false },
    });
    ok('PUT /admin/ulasan/:id (tampilkan kembali)', tampilLagi.status === 200 && tampilLagi.data.sembunyi === false);
    const hapusUlasan = await api('/admin/ulasan/' + ulasanUji.id, { method: 'DELETE', headers: ah });
    ok('DELETE /admin/ulasan/:id', hapusUlasan.status === 200, JSON.stringify(hapusUlasan.data));
    const cekHapus = await api('/admin/ulasan', { headers: ah });
    ok('Ulasan hilang setelah dihapus', !cekHapus.data.daftar.some((u) => u.id === ulasanUji.id));
  }

  // --- 15e. Detail pesanan & riwayat pelanggan ---
  const detailPesanan = await api('/admin/pesanan/' + idPesanan, { headers: ah });
  ok('GET /admin/pesanan/:id (detail)', detailPesanan.status === 200 &&
    detailPesanan.data.pesanan.kode === kode && detailPesanan.data.pesanan.items.length === 1,
    JSON.stringify(detailPesanan.data));
  ok('Pesanan checkout tertaut ke akun pelanggan (akun_email)',
    detailPesanan.data.pesanan.akunEmail === AKUN_A.email,
    'akunEmail=' + detailPesanan.data.pesanan.akunEmail);
  const riwayatPelanggan = await api('/admin/pelanggan/' + wa + '/riwayat', { headers: ah });
  ok('GET /admin/pelanggan/:wa/riwayat', riwayatPelanggan.status === 200 &&
    riwayatPelanggan.data.pesanan.some((p) => p.kode === kode) && riwayatPelanggan.data.totalBelanja > 0,
    JSON.stringify({ jumlah: riwayatPelanggan.data.jumlahPesanan, total: riwayatPelanggan.data.totalBelanja }));

  // --- 15f. Data akun admin (email/sandi di .env) ---
  const akunAdmin = await api('/admin/akun', { headers: ah });
  ok('GET /admin/akun', akunAdmin.status === 200 && Boolean(akunAdmin.data.email), JSON.stringify(akunAdmin.data));
  const akunSalah = await api('/admin/akun', {
    method: 'PUT', headers: ah, data: { email: 'ganti@contoh.test', sandiSekarang: 'sandi-salah' },
  });
  ok('Ubah akun admin dengan sandi saat ini salah ditolak', akunSalah.status === 400,
    JSON.stringify(akunSalah.data));
  const akunSama = await api('/admin/akun', {
    method: 'PUT', headers: ah,
    data: { email: akunAdmin.data.email, sandiSekarang: process.env.ADMIN_PASSWORD || 'admin-contoh' },
  });
  ok('PUT /admin/akun (simpan email yang sama)', akunSama.status === 200, JSON.stringify(akunSama.data));
  const emailTetap = await api('/admin/akun', { headers: ah });
  ok('Email admin tidak berubah', emailTetap.data.email === akunAdmin.data.email);

  // --- 15g. Media sosial @cloraamine ---
  const sosial = await api('/pengaturan');
  const ig = (sosial.data.mediaSosial || []).find((m) => m.platform === 'Instagram');
  const tt = (sosial.data.mediaSosial || []).find((m) => m.platform === 'TikTok');
  ok('Instagram tertulis @cloraamine', Boolean(ig) && ig.label === '@cloraamine' && ig.url.includes('cloraamine'),
    JSON.stringify(ig));
  ok('TikTok tertulis @cloraamine', Boolean(tt) && tt.label === '@cloraamine' && tt.url.includes('cloraamine'),
    JSON.stringify(tt));

  // --- 15h. Produk admin: tambah, ubah, varian, hapus ---
  const daftarKategori = await api('/kategori');
  const kategoriPertama = daftarKategori.data[0] && daftarKategori.data[0].id;
  ok('GET /kategori (untuk form produk)', Boolean(kategoriPertama), JSON.stringify(daftarKategori.data));
  const idProdukUji = 'uji-' + Date.now().toString(36);
  const produkBaru = await api('/admin/produk', {
    method: 'POST', headers: ah,
    data: {
      id: idProdukUji, kategori: kategoriPertama, nama: 'Produk Uji Tambah',
      grup: 'Uji', member: '-', harga: 15000, stok: 3, kondisi: 'baru',
      deskripsi: 'Produk uji untuk menguji alur tambah produk admin.',
      preOrder: false, unggulan: false, aktif: true,
    },
  });
  ok('POST /admin/produk (tambah produk)', produkBaru.status === 201 && produkBaru.data.id === idProdukUji,
    JSON.stringify(produkBaru.data));
  const produkGanda = await api('/admin/produk', {
    method: 'POST', headers: ah,
    data: { id: idProdukUji, kategori: kategoriPertama, nama: 'Duplikat', harga: 1000, stok: 1 },
  });
  ok('ID produk ganda ditolak', produkGanda.status === 400, JSON.stringify(produkGanda.data));
  const produkUbah = await api('/admin/produk/' + idProdukUji, {
    method: 'PUT', headers: ah,
    data: {
      id: idProdukUji, kategori: kategoriPertama, nama: 'Produk Uji Diubah',
      grup: 'Uji', member: '-', harga: 17500, stok: 7, kondisi: 'baru',
      deskripsi: 'Deskripsi setelah diubah.', preOrder: false, unggulan: true, aktif: true,
    },
  });
  ok('PUT /admin/produk/:id (ubah produk)', produkUbah.status === 200, JSON.stringify(produkUbah.data));
  const varianBaru = await api('/admin/produk/' + idProdukUji + '/varian', {
    method: 'POST', headers: ah,
    data: { nama: 'Warna', nilai: 'Pink', hargaTambahan: 500, stok: 5 },
  });
  ok('POST /admin/produk/:id/varian', varianBaru.status === 201, JSON.stringify(varianBaru.data));
  const cekProduk = await api('/admin/produk', { headers: ah });
  const barisProduk = cekProduk.data.find((p) => p.id === idProdukUji);
  ok('Produk baru terdaftar dengan nama, harga, stok & varian yang benar',
    Boolean(barisProduk) && barisProduk.nama === 'Produk Uji Diubah' &&
    barisProduk.harga === 17500 && barisProduk.stok === 7 &&
    barisProduk.unggulan === true && barisProduk.varian.length === 1,
    JSON.stringify(barisProduk && { nama: barisProduk.nama, harga: barisProduk.harga, stok: barisProduk.stok, varian: barisProduk.varian.length }));
  const varianId = barisProduk && barisProduk.varian[0] && barisProduk.varian[0].id;
  if (varianId) {
    const hapusVarian = await api('/admin/varian/' + varianId, { method: 'DELETE', headers: ah });
    ok('DELETE /admin/varian/:id', hapusVarian.status === 200, JSON.stringify(hapusVarian.data));
  }
  const hapusProduk = await api('/admin/produk/' + idProdukUji, { method: 'DELETE', headers: ah });
  ok('DELETE /admin/produk/:id', hapusProduk.status === 200, JSON.stringify(hapusProduk.data));
  const cekHapusProduk = await api('/admin/produk', { headers: ah });
  ok('Produk hilang setelah dihapus', !cekHapusProduk.data.some((p) => p.id === idProdukUji));
  const produkPublikHilang = await api('/produk/' + idProdukUji);
  ok('Produk terhapus tidak tampil di katalog', produkPublikHilang.status === 404,
    'status=' + produkPublikHilang.status);

  // --- 15i. Keluar admin (dijalankan terakhir: sesi dipakai uji di atas) ---
  const keluarAdmin = await api('/admin/logout', { method: 'POST', headers: ah });
  ok('POST /admin/logout', keluarAdmin.status === 200 && keluarAdmin.data.ok === true,
    JSON.stringify(keluarAdmin.data));
  const sesiHabis = await api('/admin/pesanan', { headers: ah });
  ok('Sesi admin tidak berlaku setelah keluar', sesiHabis.status === 401,
    'status=' + sesiHabis.status);
  const halamanAdminSetelahKeluar = await fetch(BASE + '/admin', { redirect: 'manual', headers: ah });
  ok('Halaman /admin diarahkan setelah keluar', halamanAdminSetelahKeluar.status === 302,
    'status=' + halamanAdminSetelahKeluar.status);

  // --- 16. Halaman statis ---
  for (const h of ['/', '/katalog', '/produk', '/keranjang', '/checkout', '/lacak', '/custom', '/ulasan', '/akun']) {
    const r = await fetch(BASE + h);
    ok('Halaman ' + h, r.status === 200, 'status=' + r.status);
  }
  const halamanAkunPilihan = await fetch(BASE + '/akun?pilihan=admin');
  ok('Halaman /akun?pilihan=admin', halamanAkunPilihan.status === 200, 'status=' + halamanAkunPilihan.status);

  // --- 17. Keluar ---
  const keluar = await api('/akun/keluar', { method: 'POST', headers: hdrsA2 });
  ok('POST /akun/keluar', keluar.status === 200 && keluar.data.ok);
  const setelahKeluar = await api('/pelanggan/riwayat', { headers: hdrsA2 });
  ok('Sesi tidak berlaku setelah keluar', setelahKeluar.status === 401);
  const sesiBSetelah = await api('/akun/sesi', { headers: { 'x-sesi': tokenB } });
  ok('Keluar A tidak mengeluarkan B', sesiBSetelah.status === 200);

  console.log(gagal === 0 ? '\nSEMUA UJIAN LULUS' : '\n' + gagal + ' UJIAN GAGAL');
  process.exit(gagal === 0 ? 0 : 1);
})().catch((e) => {
  console.error('KESALAHAN UJI:', e);
  process.exit(1);
});
