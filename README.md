# Skor Bulutangkis — Service-Over System (PWA)

Aplikasi penghitung skor bulutangkis **sistem lama (service-over / side-out scoring)** berbasis HTML, CSS, dan JavaScript (ES Modules) tanpa framework dan tanpa build step. Dapat diinstal di HP Android dan berjalan 100% **offline**.

## Cara Menjalankan di Lokal
1. **Menggunakan Python**:
   `python -m http.server 8080`
   Lalu buka `http://localhost:8080`.
2. **Menggunakan Node.js**:
   `npx serve .`
3. **Menjalankan Pengujian Unit**:
   `node --test engine.test.js`

## Membuat Ikon PNG
1. Jalankan server lokal (`python -m http.server 8080`).
2. Buka `http://localhost:8080/generate-icons.html`.
3. Klik **Buat & Unduh Semua PNG** lalu simpan `icon-192.png`, `icon-512.png`, dan `maskable-512.png` ke dalam folder `icons/`.

## Cara Deploy Gratis ke GitHub Pages (Langkah demi Langkah)
1. Buat repositori baru di GitHub (misalnya `skor-bulutangkis`).
2. Unggah seluruh file proyek ke branch `main`.
3. Buka tab **Settings** → **Pages**.
4. Pada **Build and deployment** → **Source**, pilih **Deploy from a branch**.
5. Pilih branch `main` dan folder `/ (root)`, lalu klik **Save**.
6. Tunggu 1–2 menit hingga tautan `https://<username>.github.io/skor-bulutangkis/` aktif.

## Cara Instal di HP Android
1. Buka tautan GitHub Pages aplikasi menggunakan **Google Chrome** di Android.
2. Ketuk banner **"Instal aplikasi"** jika muncul, atau ketuk **Menu Chrome (⋮)** → **Instal aplikasi** / **Tambahkan ke layar utama**.
3. Aplikasi kini dapat dibuka penuh layar dan digunakan tanpa koneksi internet.

## Asumsi Aturan yang Ditandai `VERIFIKASI`
- **Setting Game 11 Poin (Tunggal Putri)**: Default `9-9 -> Set 3` dan `10-10 -> Set 2` (dapat diubah di Pengaturan).
- **Tukar Sisi Lapangan Game Penentuan (Game ke-3)**: Notifikasi muncul saat skor tertinggi mencapai `8` (game 15) atau `6` (game 11).