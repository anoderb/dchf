import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, HF_TOKEN, HF_REPO, HF_REPO_ID } from './config.js';

// Inisialisasi klien Supabase
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Menyelesaikan URL publik foto secara dinamis (Supabase atau Hugging Face)
 * @param {object} photo - Record objek foto dari database
 */
export function getPhotoPublicUrl(photo) {
  if (!photo) return '';
  
  const provider = photo.storage_provider || 'supabase';
  
  if (provider === 'huggingface' && HF_REPO) {
    // Gunakan HF_REPO_ID (tanpa prefix 'datasets/') untuk konstruksi URL
    const hfBaseUrl = `https://huggingface.co/datasets/${HF_REPO_ID}/resolve/main/`;
    const tokenQuery = HF_TOKEN ? `?token=${HF_TOKEN}` : '';
    return `${hfBaseUrl}${photo.storage_path}${tokenQuery}`;
  }
  
  const { data } = supabase.storage
    .from('dataset-photos')
    .getPublicUrl(photo.storage_path);
  return data?.publicUrl;
}


/**
 * Mengambil semua dataset dari database
 */
export async function getDatasets() {
  const { data, error } = await supabase
    .from('datasets_hf')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Membuat dataset baru
 */
export async function createDataset(name) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const { data, error } = await supabase
    .from('datasets_hf')
    .insert([{ name, slug }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Memperbarui nama dan slug dataset
 */
export async function updateDataset(id, name) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const { data, error } = await supabase
    .from('datasets_hf')
    .update({ name, slug, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Menghapus dataset berdasarkan ID
 * Database cascade deletion akan otomatis menghapus catatan foto terkait.
 */
export async function deleteDataset(id) {
  const { error } = await supabase
    .from('datasets_hf')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

/**
 * Mengambil semua foto dari dataset tertentu
 */
export async function getPhotos(datasetId) {
  const { data, error } = await supabase
    .from('photos_hf')
    .select('*')
    .eq('dataset_id', datasetId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Mengambil foto terakhir dari dataset tertentu (untuk thumbnail)
 */
export async function getLatestPhoto(datasetId) {
  const { data, error } = await supabase
    .from('photos_hf')
    .select('*')
    .eq('dataset_id', datasetId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

/**
 * Menyimpan data metadata foto baru ke database
 */
export async function addPhotoRecord({ datasetId, fileName, storagePath, fileSize, width, height, storageProvider = 'supabase' }) {
  const { data, error } = await supabase
    .from('photos_hf')
    .insert([
      {
        dataset_id: datasetId,
        file_name: fileName,
        storage_path: storagePath,
        file_size: fileSize,
        width,
        height,
        storage_provider: storageProvider
      }
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Menghapus data metadata foto berdasarkan ID
 */
export async function deletePhotoRecord(id) {
  const { error } = await supabase
    .from('photos_hf')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

/**
 * Update photo count dataset secara manual jika diperlukan di DB (opsional)
 */
export async function updateDatasetPhotoCount(datasetId, count) {
  const { data, error } = await supabase
    .from('datasets_hf')
    .update({ photo_count: count, updated_at: new Date().toISOString() })
    .eq('id', datasetId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Memeriksa sinkronisasi file di database vs storage Supabase / Hugging Face
 */
export async function checkDatasetSync(datasetId, datasetSlug) {
  // 1. Ambil semua data foto dari database
  const dbPhotos = await getPhotos(datasetId);
  const dbNames = new Set(dbPhotos.map(p => p.file_name));
  
  let mainFiles = []; // { name: string, provider: 'supabase' | 'huggingface', path: string }
  let thumbFiles = []; // { name: string, provider: 'supabase' | 'huggingface', path: string }

  // 2. Ambil daftar file dari Supabase Storage
  try {
    const { data: storageFiles, error: storageErr } = await supabase.storage
      .from('dataset-photos')
      .list(datasetSlug, { limit: 1000 });
      
    if (!storageErr && storageFiles) {
      storageFiles.forEach(f => {
        if (f.metadata && f.name !== 'thumbnails') {
          mainFiles.push({
            name: f.name,
            provider: 'supabase',
            path: `${datasetSlug}/${f.name}`
          });
        }
      });
    }

    const { data: thumbnailFiles, error: thumbErr } = await supabase.storage
      .from('dataset-photos')
      .list(`${datasetSlug}/thumbnails`, { limit: 1000 });
      
    if (!thumbErr && thumbnailFiles) {
      thumbnailFiles.forEach(f => {
        if (f.metadata) {
          thumbFiles.push({
            name: f.name,
            provider: 'supabase',
            path: `${datasetSlug}/thumbnails/${f.name}`
          });
        }
      });
    }
  } catch (e) {
    console.warn('Gagal membaca daftar file dari Supabase Storage:', e);
  }

  // 3. Ambil daftar file dari Hugging Face (jika dikonfigurasi)
  if (HF_REPO) {
    const { listFiles } = await import('@huggingface/hub');
    try {
      const folderPath = `data/${datasetSlug}`;
      for await (const file of listFiles({
        repo: HF_REPO,
        repoType: 'dataset',
        credentials: { accessToken: HF_TOKEN },
        accessToken: HF_TOKEN,
        recursive: true
      })) {
        if (file.path.startsWith(`${folderPath}/`)) {
          const fileName = file.path.split('/').pop();
          if (file.type === 'file' || file.type === undefined) {
            if (file.path.includes('/thumbnails/')) {
              thumbFiles.push({
                name: fileName,
                provider: 'huggingface',
                path: file.path
              });
            } else if (!file.path.endsWith('/')) {
              mainFiles.push({
                name: fileName,
                provider: 'huggingface',
                path: file.path
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('Gagal membaca daftar file dari Hugging Face:', e);
    }
  }

  // 4. Kalkulasi selisih data
  const mainFileNames = new Set(mainFiles.map(f => f.name));
  
  // Record di database yang filenya tidak ada di storage mana pun (Supabase maupun HF)
  const missingInStorage = dbPhotos.filter(p => !mainFileNames.has(p.file_name));
  
  // File di storage utama yang tidak memiliki record di database
  const orphansInStorage = mainFiles
    .filter(f => !dbNames.has(f.name))
    .map(f => ({ path: f.path, provider: f.provider }));
  
  // File di storage thumbnails yang tidak memiliki record di database
  const orphansInThumbnails = thumbFiles
    .filter(f => !dbNames.has(f.name))
    .map(f => ({ path: f.path, provider: f.provider }));

  // Cari record duplikat di database
  const nameGroups = {};
  const duplicateDbRecords = [];
  
  dbPhotos.forEach(p => {
    if (!nameGroups[p.file_name]) {
      nameGroups[p.file_name] = [];
    }
    nameGroups[p.file_name].push(p);
  });
  
  Object.keys(nameGroups).forEach(name => {
    const group = nameGroups[name];
    if (group.length > 1) {
      for (let i = 1; i < group.length; i++) {
        duplicateDbRecords.push(group[i]);
      }
    }
  });

  return {
    dbCount: dbPhotos.length,
    storageCount: mainFiles.length,
    thumbnailCount: thumbFiles.length,
    missingInStorage,
    orphansInStorage,
    orphansInThumbnails,
    duplicateDbRecords,
    isSynced: missingInStorage.length === 0 && orphansInStorage.length === 0 && duplicateDbRecords.length === 0
  };
}

/**
 * Melakukan perbaikan sinkronisasi database dan storage
 */
export async function repairDatasetSync(datasetId, datasetSlug, syncData) {
  // 1. Hapus record database yang tidak ada file fisiknya di storage mana pun
  for (const record of syncData.missingInStorage) {
    await deletePhotoRecord(record.id);
  }
  
  // 2. Hapus record database yang duplikat
  if (syncData.duplicateDbRecords && syncData.duplicateDbRecords.length > 0) {
    for (const record of syncData.duplicateDbRecords) {
      await deletePhotoRecord(record.id);
    }
  }
  
  // 3. Hapus file fisik dan thumbnail dari storage masing-masing yang tidak punya record di database
  const orphans = [...syncData.orphansInStorage, ...syncData.orphansInThumbnails];
  for (const orphan of orphans) {
    if (orphan.provider === 'huggingface' && HF_REPO) {
      const { deleteFile } = await import('@huggingface/hub');
      try {
        await deleteFile({
          repo: HF_REPO,
          repoType: 'dataset',
          credentials: { accessToken: HF_TOKEN },
          accessToken: HF_TOKEN,
          path: orphan.path
        });
      } catch (e) {
        console.warn(`Gagal menghapus orphan ${orphan.path} di Hugging Face:`, e);
      }
    } else {
      // Hapus dari Supabase Storage
      const { error: deleteErr } = await supabase.storage
        .from('dataset-photos')
        .remove([orphan.path]);
      if (deleteErr) {
        console.warn(`Gagal menghapus orphan ${orphan.path} di Supabase Storage:`, deleteErr);
      }
    }
  }
  
  // 4. Update jumlah foto di tabel datasets agar sinkron
  const updatedPhotos = await getPhotos(datasetId);
  await updateDatasetPhotoCount(datasetId, updatedPhotos.length);
  
  return updatedPhotos;
}

/**
 * Mengambil daftar foto yang belum disinkronkan ke Hugging Face (masih di Supabase)
 */
export async function getUnsyncedPhotos(datasetId) {
  const { data, error } = await supabase
    .from('photos_hf')
    .select('*')
    .eq('dataset_id', datasetId)
    .eq('storage_provider', 'supabase');

  if (error) throw error;
  return data;
}

/**
 * Melakukan update massal (upsert) untuk mengubah status sinkronisasi foto ke Hugging Face
 */
export async function updatePhotosToSynced(updates) {
  const { data, error } = await supabase
    .from('photos_hf')
    .upsert(updates)
    .select();

  if (error) throw error;
  return data;
}


