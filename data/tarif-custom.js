/**
 * Konfigurasi harga pesanan custom (stiker & pin button).
 * SELURUH ANGKA DI FILE INI ADALAH DATA CONTOH — ganti dengan tarif toko sebenarnya.
 *
 * Rumus harga:
 *   total = (harga dasar ukuran + tambahan bahan + tambahan bentuk)
 *           × pengali tingkat jumlah × jumlah
 */
module.exports = {
  contoh: true,
  catatan: 'Data tarif CONTOH. Ubah sesuai tarif toko melalui file ini.',

  // Jumlah minimal pemesanan per jenis produk
  jumlahMinimal: {
    stiker: 50,
    pin: 30,
  },

  jenis: [
    { id: 'stiker', nama: 'Stiker Custom' },
    { id: 'pin', nama: 'Pin Button Custom' },
  ],

  // Harga dasar per lembar/barang menurut ukuran (rupiah) — DATA CONTOH
  ukuran: [
    { id: 's4', nama: '4 cm × 4 cm', stiker: 700, pin: 3500 },
    { id: 's5', nama: '5 cm × 5 cm', stiker: 900, pin: 4000 },
    { id: 's6', nama: '6 cm × 6 cm', stiker: 1100, pin: 4500 },
    { id: 's7', nama: '7 cm × 7 cm', stiker: 1400, pin: 5500 },
    { id: 's8', nama: '8 cm × 8 cm', stiker: 1700, pin: 6500 },
  ],

  // Tambahan harga per bahan (rupiah) — DATA CONTOH
  bahan: [
    { id: 'vinyl', nama: 'Vinyl', tambahan: 0 },
    { id: 'holo', nama: 'Holografis', tambahan: 300 },
    { id: 'glossy', nama: 'Glossy', tambahan: 200 },
    { id: 'matte', nama: 'Matte', tambahan: 250 },
  ],

  // Tambahan harga per bentuk potongan (rupiah) — DATA CONTOH
  bentuk: [
    { id: 'persegi', nama: 'Persegi', tambahan: 0 },
    { id: 'bulat', nama: 'Bulat', tambahan: 150 },
    { id: 'diecut', nama: 'Custom (die-cut)', tambahan: 400 },
  ],

  // Tingkat harga menurut jumlah (pengali) — DATA CONTOH
  tingkatJumlah: [
    { min: 1, maks: 99, pengali: 1.0, nama: 'Satuan' },
    { min: 100, maks: 249, pengali: 0.9, nama: '100–249' },
    { min: 250, maks: 499, pengali: 0.8, nama: '250–499' },
    { min: 500, maks: 999999, pengali: 0.7, nama: '500 ke atas' },
  ],
};
