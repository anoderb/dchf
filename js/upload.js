import { supabase, addPhotoRecord, deletePhotoRecord, getPhotos, updateDatasetPhotoCount, getPhotoPublicUrl } from './supabase.js';
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
 * Mengunggah satu foto terproses dan thumbnail terkait ke Storage (Supabase/HF),
 * serta menambahkan catatan metadatanya ke database PostgreSQL.
 */
export async function uploadSinglePhoto({ datasetId, datasetSlug, processedBlob, thumbnail, width, height, fileName }) {
  // Jika fileName belum dispesifikasi, generate otomatis secara urut
  let finalFileName = fileName;
  if (!finalFileName) {
    const fileInfo = await getNextFileName(datasetId, datasetSlug);
    finalFileName = fileInfo.fileName;
  }

  // Path tujuan penyimpanan
  const storagePath = HF_REPO 
    ? `data/${datasetSlug}/${finalFileName}` 
    : `${datasetSlug}/${finalFileName}`;
  const thumbnailPath = HF_REPO 
    ? `data/${datasetSlug}/thumbnails/${finalFileName}` 
    : `${datasetSlug}/thumbnails/${finalFileName}`;

  if (HF_REPO) {
    // 1. Upload ke Hugging Face Dataset
    const { uploadFile } = await import('@huggingface/hub');
    try {
      await uploadFile({
        repo: HF_REPO,
        repoType: 'dataset',
        credentials: { accessToken: HF_TOKEN },
        accessToken: HF_TOKEN,
        file: {
          path: storagePath,
          content: processedBlob
        }
      });

      if (thumbnail) {
        try {
          await uploadFile({
            repo: HF_REPO,
            repoType: 'dataset',
            credentials: { accessToken: HF_TOKEN },
            accessToken: HF_TOKEN,
            file: {
              path: thumbnailPath,
              content: thumbnail
            }
          });
        } catch (thumbErr) {
          console.warn('Gagal upload thumbnail ke Hugging Face, melanjutkan...', thumbErr);
        }
      }
    } catch (hfError) {
      throw new Error(`Gagal mengunggah ke Hugging Face: ${hfError.message}`);
    }
  } else {
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
  }

  // 3. Simpan metadata foto ke PostgreSQL
  try {
    const dbRecord = await addPhotoRecord({
      datasetId,
      fileName: finalFileName,
      storagePath,
      fileSize: processedBlob.size,
      width,
      height
    });

    // 4. Update photo_count di tabel datasets secara sinkron
    const photos = await getPhotos(datasetId);
    await updateDatasetPhotoCount(datasetId, photos.length);

    // Dapatkan URL Publik
    const publicUrl = getPhotoPublicUrl(storagePath);
    const thumbnailUrl = getPhotoPublicUrl(thumbnailPath);

    return {
      ...dbRecord,
      publicUrl,
      thumbnailUrl
    };
  } catch (dbError) {
    // Rollback file storage jika database insert gagal
    if (HF_REPO) {
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
      } catch (err) {
        console.warn('Gagal melakukan rollback file di Hugging Face:', err);
      }
    } else {
      await supabase.storage.from('dataset-photos').remove([storagePath, thumbnailPath]);
    }
    throw dbError;
  }
}

/**
 * Menghapus foto dari Storage (Supabase/HF) dan database PostgreSQL
 */
export async function deletePhoto(photoId, storagePath) {
  // Dapatkan detail record foto terlebih dahulu untuk mengetahui dataset_id
  let datasetId = null;
  try {
    const { data } = await supabase
      .from('photos_hf')
      .select('dataset_id')
      .eq('id', photoId)
      .single();
    if (data) {
      datasetId = data.dataset_id;
    }
  } catch (e) {
    console.warn('Gagal mendapatkan dataset_id dari photo record.', e);
  }

  // 1. Hapus catatan di database
  await deletePhotoRecord(photoId);

  // 2. Hapus file fisik dan thumbnail dari Storage
  const thumbnailPath = storagePath.replace(/([^/]+)$/, 'thumbnails/$1');
  
  if (HF_REPO) {
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
    const { error: storageError } = await supabase.storage
      .from('dataset-photos')
      .remove([storagePath, thumbnailPath]);

    if (storageError) {
      console.error(`Gagal menghapus file storage: ${storagePath}`, storageError);
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

