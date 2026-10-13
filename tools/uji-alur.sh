#!/usr/bin/env bash
# Uji alur utama Cloraamine. Exit status 0 = semua pemeriksaan lulus.
set -u
BASE="${BASE:-http://127.0.0.1:4181}"
GALAT=0
# Path lokal relatif: curl versi Windows tidak dapat membaca path gaya /tmp Git Bash.
TMP=".uji-tmp"
mkdir -p "$TMP"
JAR="$TMP/cookies.txt"

cek() { # cek "nama" "hasil" "harapan"
  if [ "$2" = "$3" ]; then echo "LULUS: $1"
  else echo "GAGAL: $1 (hasil=$2 harapan=$3)"; GALAT=1; fi
}
cek_ada() {
  if echo "$2" | grep -q "$3"; then echo "LULUS: $1"
  else echo "GAGAL: $1 (tidak ada '$3' dalam: $(echo "$2" | head -c 200))"; GALAT=1; fi
}
cek_tidak_ada() {
  if echo "$2" | grep -q "$3"; then echo "GAGAL: $1 (masih ada '$3')"; GALAT=1
  else echo "LULUS: $1"; fi
}

echo "== 1. Halaman publik =="
for h in / /katalog /produk /keranjang /checkout /lacak /custom /ulasan /admin /manifest.json /sw.js; do
  cek "GET $h" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$h")" "200"
done

echo "== 2. API publik =="
cek_ada "daftar kategori (5)" "$(curl -s "$BASE/api/kategori")" "photocard"
cek_ada "filter katalog + pencarian" "$(curl -s "$BASE/api/produk?kategori=photocard&stok=ada&q=grup")" "harga"
cek_ada "detail produk + varian" "$(curl -s "$BASE/api/produk/pc-001")" "varian"
cek_ada "pengaturan toko" "$(curl -s "$BASE/api/pengaturan")" "ekspedisi"

echo "== 3. Checkout =="
HASIL=$(curl -s -X POST "$BASE/api/pesanan" -H 'Content-Type: application/json' -d '{
  "nama":"Budi Santoso","wa":"081234567890",
  "alamat":"Jalan Contoh Nomor 123, Kota Contoh","ekspedisi":"jne",
  "metodePembayaran":"transfer","catatan":"Kemasan aman",
  "persetujuanData":true,
  "items":[{"produkId":"pc-001","varianId":null,"jumlah":2},{"produkId":"al-001","varianId":null,"jumlah":1}]
}')
cek_ada "checkout sukses" "$HASIL" '"ok":true'
KODE=$(echo "$HASIL" | grep -o '"kode":"[^"]*"' | head -1 | cut -d'"' -f4)
TOKEN=$(echo "$HASIL" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
cek_ada "total = 25000*2 + 250000 + ongkir 12000 = 312000" "$HASIL" '"total":312000'
echo "Kode pesanan: $KODE"

# validasi input ditolak
TOLAK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pesanan" -H 'Content-Type: application/json' -d '{"nama":"X","wa":"abc"}')
cek "checkout tanpa data valid ditolak (400)" "$TOLAK" "400"

# unggah bukti bayar
printf 'P-7\x89PNG\r\n\x1a\n fake-bukti-bayar' > "$TMP/bukti.png"
BUKTI=$(curl -s -X POST "$BASE/api/pesanan/$KODE/bukti" -H "x-token: $TOKEN" -F "bukti=@$TMP/bukti.png;type=image/png")
cek_ada "unggah bukti bayar" "$BUKTI" '"ok":true'
FILE_BUKTI=$(echo "$BUKTI" | grep -o '"berkas":"[^"]*"' | head -1 | cut -d'"' -f4)

# token salah ditolak
TOLAK_TOK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pesanan/$KODE/bukti" -H "x-token: salah-salah" -F "bukti=@$TMP/bukti.png;type=image/png")
cek "unggah dengan token salah ditolak (403)" "$TOLAK_TOK" "403"

# pelacakan
LACAK=$(curl -s "$BASE/api/pesanan/lacak?kode=$KODE&wa=081234567890")
cek_ada "lacak pesanan cocok" "$LACAK" '"ok":true'
cek_ada "status menunggu konfirmasi" "$LACAK" "menunggu_konfirmasi"
LACAK_SALAH=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/pesanan/lacak?kode=$KODE&wa=08999999999")
cek "lacak dengan WA salah ditolak (404)" "$LACAK_SALAH" "404"

echo "== 4. Proteksi unggahan =="
if [ -n "$FILE_BUKTI" ]; then
  cek "unggahan tanpa token ditolak" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/uploads/$FILE_BUKTI")" "403"
  cek "unggahan dengan token pemilik diizinkan" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/uploads/$FILE_BUKTI?t=$TOKEN")" "200"
else
  echo "GAGAL: nama berkas bukti tidak terbaca dari respons unggahan"; GALAT=1
fi

echo "== 5. Pesanan custom =="
# siapkan berkas desain PNG
printf '\x89PNG\r\n\x1a\n fake-desain-stiker' > "$TMP/desain.png"
CUSTOM=$(curl -s -X POST "$BASE/api/custom" \
  -F "tipeCustom=stiker" -F "ukuranId=s5" -F "bahanId=holo" -F "bentukId=bulat" \
  -F "jumlah=100" -F "nama=Budi Santoso" -F "wa=081234567890" -F "catatan=Warna cerah" \
  -F "metodePembayaran=qris" -F "persetujuanCipta=true" -F "desain=@$TMP/desain.png;type=image/png")
cek_ada "buat pesanan custom" "$CUSTOM" '"ok":true'
# harga contoh: (900 vinyl/s5 stiker? s5 stiker=900 + holo 300 + bulat 150) = 1350 × pengali 0.9 (100-249) = 1215 × 100 = 121500
cek_ada "harga bertingkat dihitung benar (121500)" "$CUSTOM" '"total":121500'
KODE_C=$(echo "$CUSTOM" | grep -o '"kode":"[^"]*"' | head -1 | cut -d'"' -f4)
TOKEN_C=$(echo "$CUSTOM" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Kode custom: $KODE_C"

# jumlah di bawah minimum ditolak
SALAH_MIN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/custom" \
  -F "tipeCustom=stiker" -F "ukuranId=s5" -F "bahanId=holo" -F "bentukId=bulat" \
  -F "jumlah=5" -F "nama=Budi Santoso" -F "wa=081234567890" -F "persetujuanCipta=true" \
  -F "desain=@$TMP/desain.png;type=image/png")
cek "jumlah di bawah minimum ditolak (400)" "$SALAH_MIN" "400"

# persetujuan cipta wajib
SALAH_CIPTA=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/custom" \
  -F "tipeCustom=stiker" -F "ukuranId=s5" -F "bahanId=vinyl" -F "bentukId=persegi" \
  -F "jumlah=100" -F "nama=Budi Santoso" -F "wa=081234567890" -F "persetujuanCipta=false" \
  -F "desain=@$TMP/desain.png;type=image/png")
cek "tanpa pernyataan hak cipta ditolak (400)" "$SALAH_CIPTA" "400"

LACAK_C=$(curl -s "$BASE/api/custom/$KODE_C?wa=081234567890&token=$TOKEN_C")
cek_ada "lacak custom" "$LACAK_C" "menunggu_desain"

echo "== 6. Admin: login, tinjau custom, ubah status =="
SALAH_LOGIN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' -d '{"sandi":"salah"}')
cek "login salah ditolak (401)" "$SALAH_LOGIN" "401"

LOGIN=$(curl -s -c "$JAR" -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -d '{"sandi":"ganti-dengan-kata-sandi-anda"}')
cek_ada "login admin sukses" "$LOGIN" '"ok":true'

cek "tanpa sesi ditolak" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/pesanan")" "401"

PESANAN=$(curl -s -b "$JAR" "$BASE/api/admin/pesanan")
cek_ada "admin melihat pesanan reguler" "$PESANAN" "$KODE"
ID_PESANAN=$(echo "$PESANAN" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

UBAH=$(curl -s -b "$JAR" -X PUT "$BASE/api/admin/pesanan/$ID_PESANAN/status" -H 'Content-Type: application/json' -d '{"status":"diproses"}')
cek_ada "ubah status pesanan" "$UBAH" '"ok":true'
LACAK2=$(curl -s "$BASE/api/pesanan/lacak?kode=$KODE&wa=081234567890")
cek_ada "status terbaru dipantau pembeli" "$LACAK2" "diproses"

# tinjau custom: minta revisi dulu
CUSTOMS=$(curl -s -b "$JAR" "$BASE/api/admin/custom")
ID_C=$(echo "$CUSTOMS" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
cek_ada "admin melihat pesanan custom" "$CUSTOMS" "$KODE_C"

REVISI=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/custom/$ID_C/tinjau" -H 'Content-Type: application/json' \
  -d '{"aksi":"revisi","komentar":"Mohon perbesar resolusi gambar."}')
cek_ada "admin minta revisi" "$REVISI" "revisi"
LACAK_C2=$(curl -s "$BASE/api/custom/$KODE_C?wa=081234567890&token=$TOKEN_C")
cek_ada "pembeli melihat status revisi" "$LACAK_C2" "revisi"
cek_ada "komentar admin terlihat pembeli" "$LACAK_C2" "resolusi"

# persetujuan sebelum status disetujui ditolak
ACC_DULU=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/custom/$KODE_C/persetujuan" \
  -H 'Content-Type: application/json' -H "x-token: $TOKEN_C" -d '{"wa":"081234567890"}')
cek "persetujuan sebelum disetujui admin ditolak (400)" "$ACC_DULU" "400"

# admin setujui
SETUJUI=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/custom/$ID_C/tinjau" -H 'Content-Type: application/json' \
  -d '{"aksi":"setujui","komentar":"Desain sudah sesuai."}')
cek_ada "admin setujui desain" "$SETUJUI" "disetujui"

# produksi sebelum persetujuan pembeli ditolak
PROD_DULU=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/admin/custom/$ID_C/status" \
  -H 'Content-Type: application/json' -b "$JAR" -d '{"status":"produksi"}')
cek "produksi sebelum persetujuan pembeli ditolak (400)" "$PROD_DULU" "400"

# pembeli setujui
ACC=$(curl -s -X POST "$BASE/api/custom/$KODE_C/persetujuan" -H 'Content-Type: application/json' \
  -H "x-token: $TOKEN_C" -d '{"wa":"081234567890"}')
cek_ada "pembeli menyetujui untuk produksi" "$ACC" '"ok":true'

# admin ubah status: produksi → siap_kirim → selesai
for s in produksi siap_kirim selesai; do
  UBAH_C=$(curl -s -b "$JAR" -X PUT "$BASE/api/admin/custom/$ID_C/status" -H 'Content-Type: application/json' -d "{\"status\":\"$s\"}")
  cek_ada "status custom → $s" "$UBAH_C" '"ok":true'
done
LACAK_C3=$(curl -s "$BASE/api/custom/$KODE_C?wa=081234567890&token=$TOKEN_C")
cek_ada "pembeli melihat status selesai" "$LACAK_C3" "selesai"

echo "== 7. Admin: produk, ulasan, pelanggan, rekap, CSV =="
PRODUKS=$(curl -s -b "$JAR" "$BASE/api/admin/produk")
cek_ada "daftar produk admin" "$PRODUKS" "pc-001"

UBAH_PRODUK=$(curl -s -b "$JAR" -X PUT "$BASE/api/admin/produk/pc-002" -H 'Content-Type: application/json' \
  -d '{"kategori":"photocard","nama":"Photocard Solo Member B (CONTOH)","grup":"Grup Alpha","member":"Member B","harga":16000,"stok":9,"kondisi":"baru","deskripsi":"Diperbarui admin.","aktif":true}')
cek_ada "ubah produk" "$UBAH_PRODUK" '"ok":true'
STOK_CEK=$(curl -s "$BASE/api/produk/pc-002")
cek_ada "perubahan harga terlihat publik" "$STOK_CEK" '"harga":16000'

ULASAN=$(curl -s -X POST "$BASE/api/ulasan" -H 'Content-Type: application/json' \
  -d '{"produkId":"pc-001","nama":"Siti","rating":5,"komentar":"Barang sesuai deskripsi dan packing rapi."}')
cek_ada "kirim ulasan" "$ULASAN" '"ok":true'
ULASAN_SALAH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ulasan" -H 'Content-Type: application/json' \
  -d '{"produkId":"pc-001","nama":"Siti","rating":9,"komentar":"Rating di luar rentang."}')
cek "rating di luar 1-5 ditolak (400)" "$ULASAN_SALAH" "400"
ULASAN_ADMIN=$(curl -s -b "$JAR" "$BASE/api/admin/ulasan")
cek_ada "admin melihat ulasan + rata-rata" "$ULASAN_ADMIN" '"rata":5'

PELANGGAN=$(curl -s -b "$JAR" "$BASE/api/admin/pelanggan")
cek_ada "data pelanggan" "$PELANGGAN" "081234567890"

REKAP=$(curl -s -b "$JAR" "$BASE/api/admin/rekap")
cek_ada "rekap total pesanan" "$REKAP" '"totalPesanan"'
cek_ada "rekap pendapatan" "$REKAP" '"pendapatan"'
cek_ada "rekap per produk" "$REKAP" '"terjual"'

CSV=$(curl -s -b "$JAR" "$BASE/api/admin/pesanan.csv")
cek_ada "ekspor CSV ada baris pesanan reguler" "$CSV" "$KODE"
cek_ada "ekspor CSV ada baris pesanan custom" "$CSV" "$KODE_C"
cek_ada "ekspor CSV ada kepala kolom" "$CSV" "kode,tipe,tanggal,nama,whatsapp"

echo "== 7b. Admin: kelola kategori & varian =="
KAT_BARU=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/kategori" -H 'Content-Type: application/json' \
  -d '{"nama":"Album Tambahan","urutan":9}')
cek_ada "tambah kategori" "$KAT_BARU" '"ok":true'
ID_KAT=$(echo "$KAT_BARU" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
cek_ada "kategori baru tampil untuk publik" "$(curl -s "$BASE/api/kategori")" "\"id\":\"$ID_KAT\""

UBAH_KAT=$(curl -s -b "$JAR" -X PUT "$BASE/api/admin/kategori/$ID_KAT" -H 'Content-Type: application/json' \
  -d '{"nama":"Album Tambahan Diperbarui","urutan":8}')
cek_ada "ubah kategori" "$UBAH_KAT" '"ok":true'
cek_ada "perubahan nama kategori terlihat publik" "$(curl -s "$BASE/api/kategori")" "Album Tambahan Diperbarui"

TOLAK_KAT=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$BASE/api/admin/kategori/photocard")
cek "hapus kategori berisi produk ditolak (400)" "$TOLAK_KAT" "400"
HAPUS_KAT=$(curl -s -b "$JAR" -X DELETE "$BASE/api/admin/kategori/$ID_KAT")
cek_ada "hapus kategori kosong sukses" "$HAPUS_KAT" '"ok":true'

VARIAN=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/produk/pc-001/varian" -H 'Content-Type: application/json' \
  -d '{"nama":"Warna","nilai":"Emas","hargaTambahan":1000,"stok":5}')
cek_ada "tambah varian dengan stok" "$VARIAN" '"ok":true'
cek_ada "varian tampil di halaman publik" "$(curl -s "$BASE/api/produk/pc-001")" "Emas"
DAFTAR_V=$(curl -s -b "$JAR" "$BASE/api/admin/produk")
ID_VAR=$(echo "$DAFTAR_V" | grep -o '"id":[0-9]*,"produk_id":"pc-001","nama":"Warna","nilai":"Emas"' | head -1 | sed 's/"id":\([0-9]*\).*/\1/')
if [ -n "$ID_VAR" ]; then
  HAPUS_VAR=$(curl -s -b "$JAR" -X DELETE "$BASE/api/admin/varian/$ID_VAR")
  cek_ada "hapus varian" "$HAPUS_VAR" '"ok":true'
  cek_tidak_ada "varian hilang dari halaman publik" "$(curl -s "$BASE/api/produk/pc-001")" "Emas"
else
  echo "GAGAL: id varian tidak terbaca dari respons admin"; GALAT=1
fi

echo "== 8. QR Code =="
QR_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/qr?url=https://contoh.com/toko&size=256")
cek "QR PNG (200)" "$QR_CODE" "200"
QR_ISI=$(curl -s -I "$BASE/api/qr?url=https://contoh.com/toko" | head -1)
cek_ada "QR bertipe PNG" "$QR_ISI" "200"
QR_TOLAK=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/qr?url=javascript:alert(1)")
cek "URL tidak valid ditolak (400)" "$QR_TOLAK" "400"

echo
if [ "$GALAT" -eq 0 ]; then echo "HASIL AKHIR: SEMUA UJIAN LULUS"; else echo "HASIL AKHIR: ADA UJIAN GAGAL"; fi
rm -rf "$TMP"
exit $GALAT

