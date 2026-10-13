/** Utilitas bersama halaman Cloraamine. */
const Clora = {
  async api(jalan, opsi = {}) {
    const bentukData = opsi.data instanceof FormData;
    const kepala = { ...(opsi.headers || {}) };
    if (!bentukData && opsi.data && !kepala['Content-Type']) kepala['Content-Type'] = 'application/json';
    // Sesi pelanggan ikut dikirim otomatis (kecuali dimatikan halaman).
    if (!opsi.tanpaSesi && !kepala['x-sesi']) {
      const sesi = Clora.sesi.aktif();
      if (sesi) kepala['x-sesi'] = sesi;
    }
    const res = await fetch('/api' + jalan, {
      ...opsi,
      headers: kepala,
      body: bentukData ? opsi.data : opsi.data ? JSON.stringify(opsi.data) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.pesan || 'Terjadi kesalahan.');
    return data;
  },

  // --- Sesi pelanggan (banyak akun di satu perangkat → bisa pindah akun) ---
  // localStorage.clora_sesi = { aktif: email, daftar: [{ email, nama, wa, token }] }
  sesi: {
    baca() {
      try { return JSON.parse(localStorage.getItem('clora_sesi') || '{"daftar":[]}'); }
      catch { return { daftar: [] }; }
    },
    tulis(data) {
      localStorage.setItem('clora_sesi', JSON.stringify(data));
    },
    aktif() {
      const d = this.baca();
      const a = d.daftar.find((x) => x.email === d.aktif);
      return a ? a.token : null;
    },
    akunAktif() {
      const d = this.baca();
      return d.daftar.find((x) => x.email === d.aktif) || null;
    },
    daftar() {
      return this.baca().daftar;
    },
    /** Simpan/perbarui akun & jadikan aktif. */
    masuk(akun, token) {
      const d = this.baca();
      d.daftar = d.daftar.filter((x) => x.email !== akun.email);
      d.daftar.push({ email: akun.email, nama: akun.nama, wa: akun.wa || '', token });
      d.aktif = akun.email;
      this.tulis(d);
    },
    /** Pindah ke akun tersimpan (atau token baru bila diberikan). */
    pindah(email, tokenBaru) {
      const d = this.baca();
      const a = d.daftar.find((x) => x.email === email);
      if (!a) return false;
      if (tokenBaru) a.token = tokenBaru;
      d.aktif = email;
      this.tulis(d);
      return true;
    },
    /** Keluar dari akun aktif (hapus token), sisakan akun lain. */
    keluar() {
      const d = this.baca();
      d.daftar = d.daftar.filter((x) => x.email !== d.aktif);
      d.aktif = d.daftar.length ? d.daftar[0].email : null;
      this.tulis(d);
    },
    /** Hapus akun dari daftar tersimpan tanpa memakainya. */
    lupakan(email) {
      const d = this.baca();
      d.daftar = d.daftar.filter((x) => x.email !== email);
      if (d.aktif === email) d.aktif = d.daftar.length ? d.daftar[0].email : null;
      this.tulis(d);
    },
  },

  rupiah(n) {
    return 'Rp' + Number(n || 0).toLocaleString('id-ID');
  },

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  },

  // --- Keranjang (localStorage) ---
  keranjang: {
    ambil() {
      try { return JSON.parse(localStorage.getItem('clora_keranjang') || '[]'); }
      catch { return []; }
    },
    simpan(daftar) {
      localStorage.setItem('clora_keranjang', JSON.stringify(daftar));
      Clora.perbaruiLencanaKeranjang();
    },
    jumlah() {
      return Clora.keranjang.ambil().reduce((a, i) => a + i.jumlah, 0);
    },
    tambah(baris) {
      const daftar = Clora.keranjang.ambil();
      const ada = daftar.find((i) => i.produkId === baris.produkId && i.varianId === baris.varianId);
      if (ada) ada.jumlah += baris.jumlah;
      else daftar.push(baris);
      Clora.keranjang.simpan(daftar);
    },
    hapus(index) {
      const daftar = Clora.keranjang.ambil();
      daftar.splice(index, 1);
      Clora.keranjang.simpan(daftar);
    },
    ubahJumlah(index, jumlah) {
      const daftar = Clora.keranjang.ambil();
      if (!daftar[index]) return;
      daftar[index].jumlah = Math.max(1, Math.min(99, jumlah));
      Clora.keranjang.simpan(daftar);
    },
    kosongkan() {
      localStorage.removeItem('clora_keranjang');
      Clora.perbaruiLencanaKeranjang();
    },
  },

  perbaruiLencanaKeranjang() {
    document.querySelectorAll('.jumlah-keranjang').forEach((el) => {
      el.textContent = Clora.keranjang.jumlah();
    });
  },

  // --- Status pesanan (label Indonesia formal) ---
  labelStatus(status) {
    const peta = {
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
    return peta[status] || status;
  },

  daftarStatusPesanan: ['menunggu_pembayaran', 'menunggu_konfirmasi', 'dikonfirmasi', 'diproses', 'dikirim', 'selesai', 'dibatalkan'],
  daftarStatusCustom: ['menunggu_desain', 'revisi', 'disetujui', 'produksi', 'siap_kirim', 'selesai', 'ditolak'],

  // --- Sambungan WhatsApp penjual ---
  async tautanWa() {
    const p = await Clora.api('/pengaturan');
    return 'https://wa.me/' + p.whatsapp.replace(/\D/g, '');
  },

  muatHeaderFooter() {
    Clora.perbaruiLencanaKeranjang();
  },

  // --- Notifikasi in-app (lonceng) ---
  notifikasi: {
    /** Pasang lonceng pada elemen wadah; polling ringan setiap 30 detik. */
    pasang(wadah) {
      if (!wadah) return;
      wadah.classList.add('lonceng-bungkus');
      wadah.innerHTML =
        '<button class="lonceng" type="button" aria-label="Notifikasi">🔔' +
        '<span class="lonceng-lencana kelas-kirim">0</span></button>' +
        '<div class="lonceng-panel kelas-kirim" id="lonceng-panel"></div>';
      const tombol = wadah.querySelector('.lonceng');
      const panel = wadah.querySelector('.lonceng-panel');
      let terakhir = -1;

      const muat = async () => {
        try {
          const d = await Clora.api('/notifikasi');
          const lencana = wadah.querySelector('.lonceng-lencana');
          lencana.textContent = d.belumDibaca > 99 ? '99+' : d.belumDibaca;
          lencana.classList.toggle('kelas-kirim', d.belumDibaca === 0);
          // Pemberitahuan browser bila ada yang baru dan izin sudah diberikan
          if (terakhir >= 0 && d.belumDibaca > terakhir && 'Notification' in window && Notification.permission === 'granted') {
            const baru = d.daftar.find((n) => !n.dibaca);
            if (baru) new Notification('Cloraamine — ' + baru.judul, { body: baru.pesan });
          }
          terakhir = d.belumDibaca;
          panel.dataset.muat = '1';
          panel._daftar = d.daftar;
          if (!panel.classList.contains('kelas-kirim')) render(d.daftar);
        } catch { /* belum masuk — abaikan */ }
      };

      const render = (daftar) => {
        panel.innerHTML = daftar.length
          ? daftar.map((n) =>
              `<button class="lonceng-item${n.dibaca ? '' : ' baru'}" type="button" data-id="${n.id}" data-tautan="${Clora.esc(n.tautan)}">
                 <strong>${Clora.esc(n.judul)}</strong>
                 <span>${Clora.esc(n.pesan)}</span>
                 <small>${Clora.esc(n.waktu)}</small>
               </button>`).join('')
          : '<p class="kecil abu util-mb-0">Tidak ada notifikasi.</p>';
      };

      tombol.addEventListener('click', async () => {
        const buka = panel.classList.contains('kelas-kirim');
        panel.classList.toggle('kelas-kirim', !buka);
        if (buka) {
          await muat();
          render(panel._daftar || []);
          // Tandai semua sudah dibaca setelah dibuka
          try { await Clora.api('/notifikasi/baca-semua', { method: 'POST' }); } catch { /* abaikan */ }
          setTimeout(muat, 400);
        }
      });

      panel.addEventListener('click', (ev) => {
        const item = ev.target.closest('.lonceng-item');
        if (!item) return;
        const tautan = item.dataset.tautan;
        if (tautan) location.href = tautan;
      });

      document.addEventListener('click', (ev) => {
        if (!wadah.contains(ev.target)) panel.classList.add('kelas-kirim');
      });

      muat();
      setInterval(muat, 30000);
      // Minta izin notifikasi browser (hanya bila pengguna mengklik lonceng pertama kali)
      tombol.addEventListener('click', () => {
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {});
        }
      }, { once: true });
    },
  },
};

document.addEventListener('DOMContentLoaded', () => Clora.perbaruiLencanaKeranjang());

// PWA: daftarkan service worker (kecuali pada halaman admin)
if ('serviceWorker' in navigator && !location.pathname.startsWith('/admin')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* pendaftaran service worker gagal — abaikan */
    });
  });
}
