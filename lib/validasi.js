/** Validasi input sisi server (teks, nomor WA, angka, enumerasi). */

function teksBersih(nilai, { min = 0, maks = 255, wajib = true, label = 'nilai' } = {}) {
  const s = (nilai ?? '').toString().trim().replace(/\s+/g, ' ');
  if (!s) {
    if (wajib) throw new Error(`${label} wajib diisi.`);
    return '';
  }
  if (s.length < min) throw new Error(`${label} minimal ${min} karakter.`);
  if (s.length > maks) throw new Error(`${label} maksimal ${maks} karakter.`);
  if (/[<>]/.test(s)) throw new Error(`${label} mengandung karakter yang tidak diizinkan.`);
  return s;
}

function nomorWa(nilai) {
  const s = (nilai ?? '').toString().replace(/[\s-]/g, '');
  if (!/^(08\d{8,11}|\+628\d{8,11})$/.test(s)) {
    throw new Error('Nomor WhatsApp tidak valid (contoh: 081234567890).');
  }
  return s;
}

function bilanganBulat(nilai, { min = 0, maks = 1000000000, wajib = true, label = 'nilai' } = {}) {
  if (nilai === '' || nilai === null || nilai === undefined) {
    if (wajib) throw new Error(`${label} wajib diisi.`);
    return 0;
  }
  const n = Number(nilai);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${label} harus bilangan bulat.`);
  if (n < min || n > maks) throw new Error(`${label} di luar rentang ${min}–${maks}.`);
  return n;
}

function pilihan(nilai, daftar, label) {
  if (!daftar.includes(nilai)) throw new Error(`${label} tidak dikenal.`);
  return nilai;
}

function booleanKotak(nilai) {
  return nilai === true || nilai === 'true' || nilai === '1' || nilai === 1;
}

module.exports = { teksBersih, nomorWa, bilanganBulat, pilihan, booleanKotak };
