# Web Dataset Collector — Prototype Kasir Tokiva

Aplikasi web statis (*mobile-first*) untuk mengumpulkan dataset foto produk secara langsung lewat kamera handphone.

## Fitur Utama

- **CRUD Dataset**: Membuat, memperbarui, dan menghapus kategori produk.
- **Kamera Interaktif**: Dukungan penangkapan gambar langsung dari kamera belakang/depan handphone lengkap dengan panduan grid pemotretan.
- **Kompresi Otomatis**: Foto dikompresi di sisi klien (maksimal lebar/tinggi 800px, kualitas JPEG 70%) untuk menghemat bandwidth dan penyimpanan Supabase (~100-200KB per foto).
- **Penamaan Otomatis**: Foto otomatis dinamai dengan format `{slug-produk}_{nomor-urut}.jpg` (misal: `indomie-goreng_001.jpg`).
- **Instan Preview**: Foto langsung tampil di galeri dengan status "Uploading" menggunakan Blob lokal selagi proses unggah berjalan di latar belakang.
- **Ekspor ZIP**: Unduh semua foto dari satu dataset atau unduh seluruh dataset sekaligus (dalam format folder terstruktur) dalam bentuk file ZIP menggunakan JSZip.

---

## Panduan Instalasi & Penggunaan

### 1. Prasyarat
Pastikan Anda sudah menginstal [Node.js](https://nodejs.org/) di komputer Anda.

### 2. Setup Supabase
1. Buat proyek baru di [Supabase Console](https://supabase.com/).
2. Masuk ke menu **SQL Editor** proyek Anda, buat query baru, lalu salin dan jalankan skrip berikut:

```sql
-- Buat tabel datasets
CREATE TABLE datasets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  photo_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Buat tabel photos
CREATE TABLE photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger untuk memperbarui photo_count secara otomatis
CREATE OR REPLACE FUNCTION increment_photo_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE datasets
  SET photo_count = photo_count + 1, updated_at = NOW()
  WHERE id = NEW.dataset_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_photo_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE datasets
  SET photo_count = GREATEST(0, photo_count - 1), updated_at = NOW()
  WHERE id = OLD.dataset_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_photo_inserted
AFTER INSERT ON photos
FOR EACH ROW
EXECUTE FUNCTION increment_photo_count();

CREATE TRIGGER tr_photo_deleted
AFTER DELETE ON photos
FOR EACH ROW
EXECUTE FUNCTION decrement_photo_count();

-- Buat bucket penyimpanan 'dataset-photos' (Bisa juga dibuat manual di Dashboard Storage)
INSERT INTO storage.buckets (id, name, public)
VALUES ('dataset-photos', 'dataset-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Kebijakan Akses Storage (RLS Policies)
CREATE POLICY "Allow public read" ON storage.objects FOR SELECT USING (bucket_id = 'dataset-photos');
CREATE POLICY "Allow public insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'dataset-photos');
CREATE POLICY "Allow public delete" ON storage.objects FOR DELETE USING (bucket_id = 'dataset-photos');
```

### 3. Setup Konfigurasi Lingkungan (`.env`)
Salin file `.env.example` menjadi `.env` di direktori utama proyek:
```bash
cp .env.example .env
```
Buka file `.env` dan ganti nilai berikut dengan kredensial dari proyek Supabase Anda (bisa ditemukan di **Project Settings > API**):
```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx...
```

### 4. Instalasi Dependensi & Menjalankan Aplikasi
Buka terminal di folder proyek ini lalu jalankan:

```bash
# Menginstal dependensi (Vite, Supabase-js, JSZip)
npm install

# Menjalankan server pengembangan lokal
npm run dev
```

Server pengembangan akan aktif (secara default di `http://localhost:5173`). Terminal juga akan menunjukkan IP jaringan lokal Anda (misalnya `http://192.168.1.10:5173`).

---

## Cara Pengetesan Langsung di Handphone (Mobile)

Browser membatasi hak akses kamera (`getUserMedia`) hanya untuk koneksi yang aman (**HTTPS**), kecuali untuk alamat khusus `localhost`.

Untuk menguji langsung di handphone:
1. **Menggunakan Local Network IP (Koneksi WiFi Sama)**:
   - Hubungkan PC/laptop dan handphone Anda ke jaringan WiFi yang sama.
   - Buka alamat IP lokal PC Anda yang tertera di terminal (contoh: `http://192.168.1.10:5173`) di browser handphone.
   - *Catatan*: Beberapa browser mobile (seperti Chrome untuk Android) mungkin memblokir akses kamera karena bukan HTTPS murni. Jika ini terjadi, gunakan opsi tunneling di bawah.

2. **Menggunakan Tunneling HTTPS (Rekomendasi)**:
   Gunakan alat seperti `ngrok` atau `localtunnel` untuk membuat terowongan HTTPS publik gratis ke port lokal Anda (`5173`):
   ```bash
   # Jalankan server lokal terlebih dahulu
   npm run dev
   
   # Di jendela terminal baru, buat tunnel dengan localtunnel (memerlukan Node.js)
   npx localtunnel --port 5173
   ```
   Buka URL HTTPS yang diberikan oleh localtunnel pada handphone Anda. Kamera belakang akan aktif secara otomatis.

---

## Build Produksi

Untuk memaketkan aplikasi menjadi file HTML statis siap sebar/hosting (di Vercel, Netlify, atau Cloudflare Pages):
```bash
npm run build
```
Hasil pemaketan akan berada di folder `dist/` dan siap diunggah ke server web statis pilihan Anda.
