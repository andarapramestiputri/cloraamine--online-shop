/**
 * Pengaturan umum toko Cloraamine.
 *
 * PENTING: Seluruh nilai bersifat CONTOH dan hanya untuk keperluan pengembangan.
 * Ganti dengan data sebenarnya sebelum dipakai produksi.
 * Tanda `contoh: true` menandai nilai yang belum diganti.
 */
module.exports = {
  namaToko: 'Cloraamine',
  slogan: 'Photocard, album, dan merchandise K-pop pilihan untuk kolektor.',
  deskripsiToko:
    'Cloraamine menyediakan photocard, album K-pop, merchandise, stiker custom, dan pin button custom.',

  // Nomor WhatsApp penjual — DATA CONTOH, ganti dengan nomor asli melalui .env
  whatsapp: process.env.WA_PENJUAL || '081234567890',
  whatsappLabel: 'CONTOH',

  // Rekening transfer — DATA CONTOH, ganti melalui .env
  rekening: [
    {
      bank: 'BRI',
      nomor: '1234567890',
      atasNama: 'Cloraamine',
      contoh: true,
    },
  ],

  // QRIS statis — payload DATA CONTOH. Ganti melalui .env (QRIS_PAYLOAD)
  qrisPayload: process.env.QRIS_PAYLOAD || 'CONTOH-QRIS-PAYLOAD-SILAKAN-GANTI-MELALUI-ENV',
  qrisGambar: '/img/qris-contoh.png',

  // Ongkos kirim — RATES CONTOH, ganti melalui file ini atau .env
  ekspedisi: [
    { id: 'jne', nama: 'JNE REG', ongkir: 12000, contoh: true },
    { id: 'jnt', nama: 'J&T REG', ongkir: 11000, contoh: true },
    { id: 'sicepat', nama: 'SiCepat REG', ongkir: 10000, contoh: true },
    { id: 'ambil', nama: 'Ambil di tempat', ongkir: 0, contoh: true },
  ],

  // Tautan media sosial resmi toko — SEMUA akun ditulis di file konfigurasi ini saja.
  // Satukan tautan TikTok & Instagram menjadi handle @cloraamine.
  mediaSosial: [
    {
      platform: 'Instagram',
      handle: '@cloraamine',
      url: 'https://www.instagram.com/cloraamine',
      label: '@cloraamine',
      contoh: false,
    },
    {
      platform: 'TikTok',
      handle: '@cloraamine',
      url: 'https://www.tiktok.com/@cloraamine',
      label: '@cloraamine',
      contoh: false,
    },
    { platform: 'Shopee', url: 'https://shopee.co.id/', label: 'CONTOH', contoh: true },
  ],

  // Batas unggahan (dipakai server)
  batasUnggahan: {
    buktiBayar: { maksMB: 5, tipe: ['image/jpeg', 'image/png', 'image/webp'] },
    desain: { maksMB: 10, tipe: ['image/png', 'image/jpeg', 'application/pdf'] },
  },
};
