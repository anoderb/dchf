import JSZip from 'jszip';
import { supabase, getPhotos, getPhotoPublicUrl } from './supabase.js';
import { HF_REPO } from './config.js';

/**
 * Mengunduh file dari Storage (Supabase/HF) sebagai Blob
 */
async function downloadPhotoBlob(storagePath) {
  if (HF_REPO) {
    const url = getPhotoPublicUrl(storagePath);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Gagal mengunduh file ${storagePath} dari Hugging Face: ${response.status} ${response.statusText}`);
    }
    return await response.blob();
  }

  const { data, error } = await supabase.storage
    .from('dataset-photos')
    .download(storagePath);

  if (error) {
    throw new Error(`Gagal mengunduh file ${storagePath}: ${error.message}`);
  }
  return data;
}


/**
 * Membantu mengunduh file zip ke browser pengguna
 */
function triggerFileDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Mendownload seluruh foto dari suatu dataset tertentu ke dalam satu file ZIP
 * @param {object} dataset - Detail dataset: { id, slug, name }
 * @param {Function} onProgress - Callback update progress download: (current, total, fileName) => void
 */
export async function downloadDatasetZip(dataset, onProgress) {
  const photos = await getPhotos(dataset.id);
  
  if (!photos || photos.length === 0) {
    throw new Error('Dataset ini tidak memiliki foto untuk diunduh.');
  }

  const zip = new JSZip();
  const total = photos.length;
  let downloadedCount = 0;
  
  for (let i = 0; i < total; i++) {
    const photo = photos[i];
    
    try {
      const blob = await downloadPhotoBlob(photo.storage_path);
      zip.file(photo.file_name, blob);
      downloadedCount++;
    } catch (err) {
      console.error(`Gagal mendownload foto ${photo.file_name}, melewati...`, err);
    }

    if (onProgress) {
      onProgress(i + 1, total, photo.file_name);
    }
  }

  if (downloadedCount === 0) {
    throw new Error('Gagal mengunduh semua foto dalam dataset.');
  }

  const zipContent = await zip.generateAsync({ type: 'blob' });
  triggerFileDownload(zipContent, `${dataset.slug}-dataset.zip`);
}

/**
 * Mendownload seluruh foto dari SEMUA dataset ke dalam satu file ZIP terstruktur folder
 * @param {Array<object>} datasets - Daftar semua dataset
 * @param {Function} onProgress - Callback update progress: (current, total, path) => void
 */
export async function downloadAllDatasetsZip(datasets, onProgress) {
  if (!datasets || datasets.length === 0) {
    throw new Error('Tidak ada dataset yang ditemukan.');
  }

  let totalPhotosCount = datasets.reduce((sum, d) => sum + (d.photo_count || 0), 0);
  
  if (totalPhotosCount === 0) {
    throw new Error('Tidak ada foto yang tersedia di seluruh dataset.');
  }

  const zip = new JSZip();
  let processedCount = 0;
  let downloadedCount = 0;

  for (const dataset of datasets) {
    let photos = [];
    try {
      photos = await getPhotos(dataset.id);
    } catch (e) {
      console.warn(`Gagal mengambil data foto untuk dataset ${dataset.slug}`, e);
      continue;
    }

    if (!photos || photos.length === 0) continue;

    // Buat subfolder di ZIP berdasarkan slug dataset
    const folder = zip.folder(dataset.slug);

    for (const photo of photos) {
      processedCount++;
      
      try {
        const blob = await downloadPhotoBlob(photo.storage_path);
        folder.file(photo.file_name, blob);
        downloadedCount++;
      } catch (err) {
        console.error(`Gagal mendownload foto ${photo.file_name} di dataset ${dataset.slug}, melewati...`, err);
      }

      if (onProgress) {
        onProgress(processedCount, totalPhotosCount, `${dataset.slug}/${photo.file_name}`);
      }
    }
  }

  if (downloadedCount === 0) {
    throw new Error('Tidak ada foto yang berhasil diunduh.');
  }

  const zipContent = await zip.generateAsync({ type: 'blob' });
  triggerFileDownload(zipContent, 'all-datasets.zip');
}
