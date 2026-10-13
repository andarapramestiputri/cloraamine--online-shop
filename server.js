/**
 * Server Cloraamine — Express + SQLite.
 * Menyajikan halaman statis (public/), API, dan unggahan (berproteksi).
 */
require("dotenv").config();
const express = require("express");
const path = require("path");

require("./data/db"); // inisialisasi skema + seed

const app = express();
const PORT = Number(process.env.PORT) || 4173;
const DIR_PUBLIC = path.join(__dirname, "public");
const DIR_UPLOAD = path.join(__dirname, "uploads");

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// Keamanan dasar
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

// API
// Jalankan static untuk produk SEBELUM middleware proteksi
app.use("/uploads/produk", express.static("uploads/produk"));
app.use("/api", require("./routes/produk"));
app.use("/api", require("./routes/pesanan"));
app.use("/api/custom", require("./routes/custom").router);
app.use("/api/akun", require("./routes/akun"));
app.use("/api/pelanggan", require("./routes/pelanggan"));
app.use("/api/notifikasi", require("./routes/notifikasi"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api", require("./routes/qr"));
app.use("/uploads/produk", express.static("uploads/produk"));

// Unggahan: hanya admin atau pemilik pesanan (token) yang boleh mengakses.
// Proteksi dipasang sebelum static sehingga setiap berkas diperiksa.
const { wajibAksesUnggahan } = require("./lib/auth");
app.use("/uploads/:berkas", (req, res, next) =>
  wajibAksesUnggahan(req.params.berkas)(req, res, next),
);
app.use("/uploads", express.static(DIR_UPLOAD));

// Halaman publik
app.use(express.static(DIR_PUBLIC));

// Rute halaman
app.get("/", (req, res) => res.sendFile(path.join(DIR_PUBLIC, "index.html")));
app.get("/katalog", (req, res) =>
  res.sendFile(path.join(DIR_PUBLIC, "katalog.html")),
);
app.get("/produk", (req, res) =>
  res.sendFile(path.join(DIR_PUBLIC, "produk.html")),
);
app.get("/keranjang", (req, res) =>
  res.sendFile(path.join(DIR_PUBLIC, "keranjang.html")),
);
app.get("/checkout", (req, res) =>
  res.sendFile(path.join(DIR_PUBLIC, "checkout.html")),
);
app.get("/lacak", (req, res) =>
  res.sendFile(path.join(DIR_PUBLIC, "lacak.html")),
);
app.get("/akun", (req, res) =>
  res.sendFile(path.join(DIR_PUBLIC, "akun.html")),
);
app.get("/custom", (req, res) =>
  res.sendFile(path.join(DIR_PUBLIC, "custom.html")),
);
app.get("/ulasan", (req, res) =>
  res.sendFile(path.join(DIR_PUBLIC, "ulasan.html")),
);
app.get("/admin", (req, res) => {
  // Halaman dasbor admin hanya untuk sesi admin; lainnya diarahkan ke pilihan akun.
  const { sahkanSesi, tokenAdminDariReq } = require("./lib/auth");
  if (sahkanSesi(tokenAdminDariReq(req))) {
    return res.sendFile(path.join(DIR_PUBLIC, "admin.html"));
  }
  res.redirect("/akun?pilihan=admin");
});

// 404
app.use((req, res) => {
  res.status(404).type("text/plain").send("404 — Halaman tidak ditemukan.");
});

// Penangan kesalahan
app.use((err, req, res, next) => {
  void next;
  console.error("[KESALAHAN]", err.message);
  if (res.headersSent) return;
  const kode = err.status && err.status < 500 ? err.status : 500;
  res
    .status(kode)
    .json({
      ok: false,
      pesan:
        kode === 404
          ? "Berkas tidak ditemukan."
          : "Terjadi kesalahan pada server.",
    });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Cloraamine berjalan di http://127.0.0.1:${PORT}`);
  });
}

module.exports = app;
