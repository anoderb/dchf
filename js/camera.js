/**
 * Modul akses Kamera Perangkat menggunakan HTML5 MediaDevices API
 */

/**
 * Mengakses aliran kamera perangkat dengan resolusi terbaik yang tersedia
 * @param {HTMLVideoElement} videoElement - Elemen video untuk menampilkan preview
 * @param {'environment'|'user'} facingMode - 'environment' (kamera belakang) atau 'user' (kamera depan)
 * @returns {Promise<MediaStream>} Aliran stream kamera
 */
export async function startCamera(videoElement, facingMode = 'environment') {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera API tidak didukung di browser ini. Pastikan Anda menggunakan koneksi HTTPS/localhost.');
  }

  // Bersihkan stream aktif sebelumnya jika ada
  stopCamera(videoElement);

  // Minta resolusi sangat tinggi (4K/FullHD ideal), browser akan memilih resolusi terbaik yang didukung kamera
  const constraints = {
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 3840 },
      height: { ideal: 2160 }
    },
    audio: false
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;
    
    // Pastikan video diputar
    await new Promise((resolve) => {
      videoElement.onloadedmetadata = () => {
        videoElement.play().then(resolve);
      };
    });

    // Mirroring transform secara visual jika kamera depan (user)
    const activeFacingMode = getActiveFacingMode(stream) || facingMode;
    if (activeFacingMode === 'user') {
      videoElement.style.transform = 'scaleX(-1)';
    } else {
      videoElement.style.transform = 'scaleX(1)';
    }

    return stream;
  } catch (error) {
    // Jika kamera belakang gagal/tidak tersedia, coba fallback ke kamera depan atau device default
    if (facingMode === 'environment') {
      console.warn('Gagal mengakses kamera belakang. Mencoba fallback ke kamera default...');
      const fallbackConstraints = { video: true, audio: false };
      const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      videoElement.srcObject = stream;
      await videoElement.play();
      return stream;
    }
    throw error;
  }
}

/**
 * Menghentikan semua trek media dari elemen kamera
 */
export function stopCamera(videoElement) {
  if (videoElement && videoElement.srcObject) {
    const stream = videoElement.srcObject;
    const tracks = stream.getTracks();
    tracks.forEach((track) => track.stop());
    videoElement.srcObject = null;
  }
}

/**
 * Beralih kamera (depan/belakang)
 */
export async function switchCamera(videoElement, currentFacingMode) {
  const nextFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  const stream = await startCamera(videoElement, nextFacingMode);
  return {
    stream,
    facingMode: nextFacingMode
  };
}

/**
 * Mengambil tangkapan frame saat ini dari preview kamera ke dalam bentuk Canvas/Blob JPEG mentah
 * Resolusi canvas disesuaikan dengan resolusi asli video feed dari kamera.
 */
export function captureFrameBlob(videoElement) {
  return new Promise((resolve, reject) => {
    try {
      const videoWidth = videoElement.videoWidth;
      const videoHeight = videoElement.videoHeight;

      if (!videoWidth || !videoHeight) {
        return reject(new Error('Kamera tidak aktif atau frame preview belum siap.'));
      }

      const canvas = document.createElement('canvas');
      canvas.width = videoWidth;
      canvas.height = videoHeight;
      const ctx = canvas.getContext('2d');

      // Terapkan transformasi mirroring jika video element di-mirror secara visual
      const isMirrored = videoElement.style.transform.includes('scaleX(-1)');
      if (isMirrored) {
        ctx.translate(videoWidth, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(videoElement, 0, 0, videoWidth, videoHeight);

      // Konversi ke Blob JPEG dengan kualitas maksimum untuk diproses oleh pipeline image-processing
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            return reject(new Error('Gagal mengekstrak frame video ke blob.'));
          }
          resolve(blob);
        },
        'image/jpeg',
        0.98 // Kualitas maksimal untuk raw capture feed
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Helper untuk mendeteksi facingMode yang sedang aktif dari stream track settings
 */
function getActiveFacingMode(stream) {
  try {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && typeof videoTrack.getSettings === 'function') {
      const settings = videoTrack.getSettings();
      return settings.facingMode;
    }
  } catch (e) {
    // Abaikan jika tidak didukung browser
  }
  return null;
}
