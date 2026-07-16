/**
 * Modul untuk ekstraksi frame video secara client-side menggunakan HTML5 Video seeking & Canvas API
 */

/**
 * Mendapatkan metadata dasar dari Blob video
 * @param {Blob} videoBlob - Blob file video
 * @returns {Promise<object>} Metadata video: { duration, width, height, approxFps }
 */
export function getVideoMetadata(videoBlob) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    
    const url = URL.createObjectURL(videoBlob);
    
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      
      // Deteksi FPS secara kasar (asumsi standar mobile 30fps jika metadata frameRate tidak tersedia)
      // Browsers tidak mengekspos fps video lewat properti standar, 
      // jadi 30 FPS adalah baseline yang sangat aman untuk estimasi.
      resolve({
        duration: video.duration, // dalam detik
        width: video.videoWidth,
        height: video.videoHeight,
        approxFps: 30
      });
    };

    video.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error('Gagal memuat metadata video. File mungkin rusak atau format tidak didukung.'));
    };

    video.src = url;
  });
}

/**
 * Menghitung estimasi ekstraksi frame sebelum proses dijalankan
 * @param {object} metadata - Hasil getVideoMetadata
 * @param {object} config - Konfigurasi ekstraksi
 * @returns {object} Objek estimasi
 */
export function estimateExtraction(metadata, config) {
  const { duration } = metadata;
  let totalEstimatedFrames = 0;

  if (config.mode === 'fps') {
    // Mode Frame Per Second
    totalEstimatedFrames = Math.max(1, Math.floor(duration * config.value));
  } else {
    // Mode Interval Waktu (detik)
    totalEstimatedFrames = Math.max(1, Math.floor(duration / config.value));
  }

  // Estimasi rata-rata ukuran file foto hasil kompresi (1280px JPG kualitas 85% ~150 KB)
  const averageFrameSizeKB = 150;
  const estimatedStorageBytes = totalEstimatedFrames * averageFrameSizeKB * 1024;
  
  // Estimasi waktu pemrosesan per frame (Resize + Compress + Similarity check ~80ms per frame di HP Android modern)
  const processTimePerFrameMs = 80;
  const estimatedTimeSec = Math.ceil((totalEstimatedFrames * processTimePerFrameMs) / 1000);

  return {
    duration: duration,
    formattedDuration: formatTime(duration),
    resolution: `${metadata.width}x${metadata.height}`,
    approxFps: metadata.approxFps,
    estimatedFrames: totalEstimatedFrames,
    estimatedStorage: formatSize(estimatedStorageBytes),
    estimatedTimeSec: estimatedTimeSec,
    formattedEstimatedTime: formatTime(estimatedTimeSec)
  };
}

/**
 * Mengekstrak frame dari video berdasarkan interval/FPS pilihan
 * @param {Blob} videoBlob - Blob video
 * @param {object} config - Konfigurasi: { mode: 'fps'|'interval', value: number }
 * @param {Function} onFrameExtracted - Callback saat frame berhasil didapatkan: (blob, timestamp) => Promise<void>
 * @param {Function} onProgress - Callback update progress: (currentFrame, totalFrames, percent) => void
 */
export function extractFrames(videoBlob, config, onFrameExtracted, onProgress) {
  return new Promise(async (resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(videoBlob);
    video.src = url;

    try {
      await new Promise((res, rej) => {
        video.onloadedmetadata = res;
        video.onerror = rej;
      });

      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;

      // Hitung interval waktu lompatan dalam detik
      let stepSize = 0.5; // default 2 FPS
      if (config.mode === 'fps') {
        stepSize = 1 / config.value;
      } else {
        stepSize = config.value;
      }

      // Daftar timestamp detik yang akan diambil framenya
      const timestamps = [];
      for (let t = 0; t < duration; t += stepSize) {
        timestamps.push(t);
      }

      // Pastikan setidaknya mengambil frame pertama jika durasi video sangat pendek
      if (timestamps.length === 0) {
        timestamps.push(0);
      }

      const totalFrames = timestamps.length;
      let currentIndex = 0;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      const captureNextFrame = () => {
        if (currentIndex >= totalFrames) {
          URL.revokeObjectURL(url);
          resolve({ totalFramesExtracted: totalFrames });
          return;
        }

        const targetTime = timestamps[currentIndex];
        video.currentTime = targetTime;
      };

      video.onseeked = async () => {
        try {
          // Gambar frame video saat ini ke canvas
          ctx.drawImage(video, 0, 0, width, height);

          // Ambil frame dalam format Blob JPEG resolusi penuh
          const frameBlob = await new Promise((resBlob, rejBlob) => {
            canvas.toBlob(
              (blob) => {
                if (blob) resBlob(blob);
                else rejBlob(new Error('Canvas toBlob return null.'));
              },
              'image/jpeg',
              0.95 // Kualitas kompresi mentah tinggi
            );
          });

          // Panggil callback penanganan frame (image processing, similarity check, upload)
          if (onFrameExtracted) {
            await onFrameExtracted(frameBlob, timestamps[currentIndex], currentIndex + 1);
          }

          currentIndex++;
          const percent = Math.round((currentIndex / totalFrames) * 100);
          
          if (onProgress) {
            onProgress(currentIndex, totalFrames, percent);
          }

          // Lanjutkan ekstraksi frame berikutnya
          captureNextFrame();
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };

      // Mulai ekstraksi frame pertama
      if (onProgress) {
        onProgress(0, totalFrames, 0);
      }
      captureNextFrame();

    } catch (err) {
      URL.revokeObjectURL(url);
      reject(err);
    }
  });
}

/**
 * Format detik ke MM:SS
 */
function formatTime(seconds) {
  if (isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Format bytes ke string ukuran
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
