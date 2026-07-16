import { supabase, addPhotoRecord, deletePhotoRecord, getPhotos, updateDatasetPhotoCount, getPhotoPublicUrl, getUnsyncedPhotos, updatePhotosToSynced } from './supabase.js';
import { HF_TOKEN, HF_REPO } from './config.js';

// In-memory cache untuk menyimpan index sequence terakhir dari dataset aktif
const lastGeneratedIndexMap = new Map();

/**
 * Menghitung nama file dan nomor urut foto berikutnya untuk penamaan teratur
 * Format: {slug}_{5-char-random-string}_{3-digit-seq}.jpg (Contoh: indomie-goreng_x8y2z_001.jpg)
 */
export async function getNextFileName(datasetId, datasetSlug) {
  try {
    let nextIndex;
    
    // Gunakan cache jika ada, agar menghindari query database berulang dalam satu sesi
    if (lastGeneratedIndexMap.has(datasetId)) {
      nextIndex = lastGeneratedIndexMap.get(datasetId) + 1;
    } else {
      const photos = await getPhotos(datasetId);
      let maxIndex = 0;
      
      if (photos && photos.length > 0) {
        // Regex fleksibel: mencakup format lama {slug}_{seq}.jpg dan format baru {slug}_{random}_{seq}.jpg
        const regex = new RegExp(`${datasetSlug}_(?:[a-z0-9]+_)?(\\d+)\\.jpg$`, 'i');
        
        photos.forEach(photo => {
          const match = photo.file_name.match(regex);
          if (match) {
            const index = parseInt(match[1], 10);
            if (index > maxIndex) {
              maxIndex = index;
            }
          }
        });
      }
      nextIndex = maxIndex + 1;
    }

    // Perbarui cache dengan index yang baru dialokasikan
    lastGeneratedIndexMap.set(datasetId, nextIndex);

    // Hasilkan string acak sepanjang 5 karakter (huruf/angka)
    const randomStr = Math.random().toString(36).substring(2, 7);
    const paddedIndex = String(nextIndex).padStart(3, '0');
    
    return {
      fileName: `${datasetSlug}_${randomStr}_${paddedIndex}.jpg`,
      nextIndex
    };
  } catch (error) {
    console.error('Gagal mendapatkan nomor urut file berikutnya:', error);
    // Fallback menggunakan timestamp jika query gagal
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    return {
      fileName: `${datasetSlug}_err_${Date.now()}_${randomSuffix}.jpg`,
      nextIndex: null
    };
  }
}

/**
 * Mengunggah satu foto terproses dan thumbnail terkait ke Supabase Storage (Buffer Sementara),
 * serta menambahkan catatan metadatanya ke database PostgreSQL.
 */
export async function uploadSinglePhoto({ datasetId, datasetSlug, processedBlob, thumbnail, width, height, fileName }) {
  // Jika fileName belum dispesifikasi, generate otomatis secara urut
  let finalFileName = fileName;
  if (!finalFileName) {
    const fileInfo = await getNextFileName(datasetId, datasetSlug);
    finalFileName = fileInfo.fileName;
  }

  // Path tujuan penyimpanan sementara di Supabase Storage
  const storagePath = `${datasetSlug}/${finalFileName}`;
  const thumbnailPath = `${datasetSlug}/thumbnails/${finalFileName}`;

  // 1. Upload ke Supabase Storage
  const { error: storageError } = await supabase.storage
    .from('dataset-photos')
    .upload(storagePath, processedBlob, {
      contentType: 'image/jpeg',
      upsert: true
    });

  if (storageError) throw storageError;

  // 2. Upload thumbnail ke Supabase Storage
  if (thumbnail) {
    try {
      await supabase.storage
        .from('dataset-photos')
        .upload(thumbnailPath, thumbnail, {
          contentType: 'image/jpeg',
          upsert: true
        });
    } catch (thumbErr) {
      console.warn('Gagal upload thumbnail ke Supabase, melanjutkan.', thumbErr);
    }
  }

  // 3. Simpan metadata foto ke PostgreSQL
  try {
    const dbRecord = await addPhotoRecord({
      datasetId,
      fileName: finalFileName,
      storagePath,
      fileSize: processedBlob.size,
      width,
      height,
      storageProvider: 'supabase' // Penanda berada di Supabase (Buffer)
    });

    // 4. Update photo_count di tabel datasets secara sinkron
    const photos = await getPhotos(datasetId);
    await updateDatasetPhotoCount(datasetId, photos.length);

    // Dapatkan URL Publik
    const publicUrl = getPhotoPublicUrl(dbRecord);
    const thumbnailUrl = getPhotoPublicUrl({ ...dbRecord, storage_path: thumbnailPath });

    return {
      ...dbRecord,
      publicUrl,
      thumbnailUrl
    };
  } catch (dbError) {
    // Rollback file storage jika database insert gagal
    try {
      await supabase.storage.from('dataset-photos').remove([storagePath, thumbnailPath]);
    } catch (rollbackErr) {
      console.error('Gagal rollback file buffer Supabase:', rollbackErr);
    }
    throw dbError;
  }
}

/**
 * Menghapus foto dari Storage (Supabase/HF) dan database PostgreSQL
 */
export async function deletePhoto(photoId, storagePath) {
  // Dapatkan detail record foto terlebih dahulu untuk mengetahui dataset_id dan storage_provider
  let datasetId = null;
  let storageProvider = 'supabase';
  try {
    const { data } = await supabase
      .from('photos_hf')
      .select('dataset_id, storage_provider')
      .eq('id', photoId)
      .single();
    if (data) {
      datasetId = data.dataset_id;
      storageProvider = data.storage_provider || 'supabase';
    }
  } catch (e) {
    console.warn('Gagal mendapatkan record foto untuk deletePhoto.', e);
  }

  // 1. Hapus catatan di database
  await deletePhotoRecord(photoId);

  // 2. Hapus file fisik dan thumbnail dari Storage yang sesuai
  const thumbnailPath = storagePath.replace(/([^/]+)$/, 'thumbnails/$1');
  
  if (storageProvider === 'huggingface' && HF_REPO) {
    const { deleteFile } = await import('@huggingface/hub');
    try {
      await deleteFile({
        repo: HF_REPO,
        repoType: 'dataset',
        credentials: { accessToken: HF_TOKEN },
        accessToken: HF_TOKEN,
        path: storagePath
      });
      await deleteFile({
        repo: HF_REPO,
        repoType: 'dataset',
        credentials: { accessToken: HF_TOKEN },
        accessToken: HF_TOKEN,
        path: thumbnailPath
      });
    } catch (e) {
      console.error(`Gagal menghapus file dari Hugging Face: ${storagePath}`, e);
    }
  } else {
    // Hapus dari Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('dataset-photos')
      .remove([storagePath, thumbnailPath]);

    if (storageError) {
      console.error(`Gagal menghapus file storage Supabase: ${storagePath}`, storageError);
    }
  }

  // 3. Update jumlah foto di tabel datasets agar tersinkronisasi
  if (datasetId) {
    try {
      const photos = await getPhotos(datasetId);
      await updateDatasetPhotoCount(datasetId, photos.length);
    } catch (e) {
      console.warn('Gagal sinkronisasi photo_count setelah hapus foto.', e);
    }
  }

  return true;
}

/**
 * Mensinkronisasi semua foto yang ada di Supabase buffer ke Hugging Face dalam satu commit
 * @param {string} datasetId - ID dataset
 * @param {string} datasetSlug - Slug dataset
 * @param {Function} onProgress - Callback progress: (current, total, statusText) => void
 */
export async function syncDatasetToHF(datasetId, datasetSlug, onProgress) {
  if (!HF_REPO) {
    throw new Error('Konfigurasi Hugging Face (VITE_HF_REPO) tidak ditemukan.');
  }

  // 1. Ambil foto yang belum tersinkronisasi
  const unsyncedPhotos = await getUnsyncedPhotos(datasetId);
  if (!unsyncedPhotos || unsyncedPhotos.length === 0) {
    return { syncedCount: 0 };
  }

  const filesToCommit = [];
  const dbUpdates = [];
  const supabasePathsToDelete = [];
  const total = unsyncedPhotos.length;

  // 2. Download blob foto buffer dari Supabase Storage secara paralel/sekuensial
  for (let i = 0; i < total; i++) {
    const photo = unsyncedPhotos[i];
    if (onProgress) {
      onProgress(i, total, `Mengunduh berkas buffer Supabase: ${photo.file_name} (${i + 1}/${total})`);
    }

    try {
      // Download gambar utama
      const { data: mainBlob, error: mainErr } = await supabase.storage
        .from('dataset-photos')
        .download(photo.storage_path);
      
      if (mainErr) throw mainErr;

      // Download thumbnail
      const thumbPath = photo.storage_path.replace(/([^/]+)$/, 'thumbnails/$1');
      const { data: thumbBlob } = await supabase.storage
        .from('dataset-photos')
        .download(thumbPath);

      // Definisikan target path di Hugging Face
      const targetPath = `data/${datasetSlug}/${photo.file_name}`;
      const targetThumbPath = `data/${datasetSlug}/thumbnails/${photo.file_name}`;

      filesToCommit.push({
        path: targetPath,
        content: mainBlob
      });

      if (thumbBlob) {
        filesToCommit.push({
          path: targetThumbPath,
          content: thumbBlob
        });
      }

      dbUpdates.push({
        ...photo,
        storage_provider: 'huggingface',
        storage_path: targetPath
      });

      supabasePathsToDelete.push(photo.storage_path, thumbPath);
    } catch (err) {
      console.error(`Gagal memproses file ${photo.file_name} untuk sinkronisasi:`, err);
    }
  }

  if (filesToCommit.length === 0) {
    throw new Error('Tidak ada file buffer yang berhasil diunduh untuk disinkronkan.');
  }

  // 3. Kirim komit batch tunggal ke Hugging Face
  if (onProgress) {
    onProgress(total, total, `Mengirimkan komit batch ke Hugging Face...`);
  }

  const { uploadFiles } = await import('@huggingface/hub');
  await uploadFiles({
    repo: HF_REPO,
    credentials: { accessToken: HF_TOKEN },
    accessToken: HF_TOKEN,
    files: filesToCommit,
    commitTitle: `Sinkronisasi batch dataset ${datasetSlug} (${dbUpdates.length} foto)`
  });

  // 4. Update status record di Supabase DB ke Hugging Face
  if (onProgress) {
    onProgress(total, total, `Memperbarui status database...`);
  }
  await updatePhotosToSynced(dbUpdates);

  // 5. Hapus file buffer di Supabase Storage
  if (onProgress) {
    onProgress(total, total, `Membersihkan file buffer Supabase...`);
  }
  try {
    await supabase.storage
      .from('dataset-photos')
      .remove(supabasePathsToDelete);
  } catch (cleanErr) {
    console.warn('Gagal membersihkan file buffer di Supabase Storage:', cleanErr);
  }

  return { syncedCount: dbUpdates.length };
}
