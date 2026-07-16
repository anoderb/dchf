-- Jalankan skrip ini di SQL Editor Supabase Anda untuk mendukung Buffered Hybrid Storage

-- 1. Tambahkan kolom storage_provider untuk melacak lokasi file fisik (Supabase vs Hugging Face)
ALTER TABLE photos_hf 
ADD COLUMN IF NOT EXISTS storage_provider TEXT DEFAULT 'supabase';

-- 2. Buat indeks untuk kolom storage_provider agar mempercepat pencarian data sinkronisasi
CREATE INDEX IF NOT EXISTS idx_photos_hf_storage_provider ON photos_hf(storage_provider);
