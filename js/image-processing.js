/**
 * Membaca orientasi EXIF dari blob gambar JPEG secara manual tanpa library tambahan
 */
function getOrientation(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      const view = new DataView(e.target.result);
      if (view.byteLength < 2 || view.getUint16(0, false) !== 0xffd8) {
        return resolve(-2); // Bukan JPEG
      }
      const length = view.byteLength;
      let offset = 2;
      while (offset < length) {
        if (offset + 2 > length) break;
        const marker = view.getUint16(offset, false);
        offset += 2;
        if (marker === 0xffe1) {
          if (offset + 8 > length) break;
          if (view.getUint32(offset + 2, false) !== 0x45786966) {
            return resolve(-1); // Bukan header EXIF
          }
          const little = view.getUint16(offset + 8, false) === 0x4949;
          const tiffOffset = offset + 8;
          let idfOffset = tiffOffset + view.getUint32(tiffOffset + 4, little);
          if (idfOffset + 2 > length) break;
          const tags = view.getUint16(idfOffset, little);
          idfOffset += 2;
          for (let i = 0; i < tags; i++) {
            if (idfOffset + 12 > length) break;
            if (view.getUint16(idfOffset, little) === 0x0112) {
              return resolve(view.getUint16(idfOffset + 8, little));
            }
            idfOffset += 12;
          }
        } else if ((marker & 0xff00) === 0xff00) {
          if (offset + 2 > length) break;
          offset += view.getUint16(offset, false);
        } else {
          break;
        }
      }
      return resolve(-1);
    };
    reader.readAsArrayBuffer(blob.slice(0, 64 * 1024));
  });
}

/**
 * Memuat gambar dari Blob/File ke elemen Image HTML
 */
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Pipeline pemrosesan gambar utama: Resize, Auto-rotate (EXIF), Compress ke JPEG, Strip EXIF, dan generate Thumbnail.
 */
export async function processImage(blob, options = {}) {
  const defaults = {
    maxSize: 1280, // Sisi terpanjang
    quality: 0.85, // JPEG quality
    autoRotate: true,
    thumbnailSize: 200 // Sisi terpanjang thumbnail
  };

  const config = { ...defaults, ...options };
  const originalSize = blob.size;

  // 1. Dapatkan orientasi EXIF jika autoRotate diaktifkan
  let orientation = 1;
  if (config.autoRotate) {
    try {
      orientation = await getOrientation(blob);
    } catch (e) {
      console.warn('Gagal membaca orientasi EXIF, menggunakan orientasi normal.', e);
    }
  }

  // 2. Muat gambar
  const img = await loadImage(blob);
  
  // 3. Proses gambar utama (Resize & Rotate)
  const processedResult = await resizeAndRotateImage(img, orientation, config.maxSize, config.quality);

  // 4. Generate thumbnail
  const thumbnailResult = await resizeAndRotateImage(img, orientation, config.thumbnailSize, 0.7);

  return {
    processed: processedResult.blob,
    thumbnail: thumbnailResult.blob,
    width: processedResult.width,
    height: processedResult.height,
    originalSize,
    processedSize: processedResult.blob.size
  };
}

/**
 * Mengubah ukuran gambar dan menerapkan rotasi berdasarkan EXIF orientation
 */
function resizeAndRotateImage(img, orientation, maxSize, quality) {
  return new Promise((resolve, reject) => {
    try {
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      // Hitung dimensi target berdasarkan aspect ratio
      let targetWidth = width;
      let targetHeight = height;

      if (width > height) {
        if (width > maxSize) {
          targetHeight = Math.round((height * maxSize) / width);
          targetWidth = maxSize;
        }
      } else {
        if (height > maxSize) {
          targetWidth = Math.round((width * maxSize) / height);
          targetHeight = maxSize;
        }
      }

      // Tentukan apakah dimensi perlu dibalik (untuk rotasi 90 / 270 derajat)
      const swapDimensions = orientation >= 5 && orientation <= 8;
      const canvasWidth = swapDimensions ? targetHeight : targetWidth;
      const canvasHeight = swapDimensions ? targetWidth : targetHeight;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d');

      // Terapkan transformasi rotasi
      switch (orientation) {
        case 2: // Flip Horizontal
          ctx.translate(canvasWidth, 0);
          ctx.scale(-1, 1);
          break;
        case 3: // Rotasi 180
          ctx.translate(canvasWidth, canvasHeight);
          ctx.rotate(Math.PI);
          break;
        case 4: // Flip Vertikal
          ctx.translate(0, canvasHeight);
          ctx.scale(1, -1);
          break;
        case 5: // Flip Horiz + Rotasi 90 deg CCW
          ctx.rotate(0.5 * Math.PI);
          ctx.scale(1, -1);
          break;
        case 6: // Rotasi 90 deg CW
          ctx.translate(canvasWidth, 0);
          ctx.rotate(0.5 * Math.PI);
          break;
        case 7: // Flip Horiz + Rotasi 90 deg CW
          ctx.rotate(-0.5 * Math.PI);
          ctx.translate(-canvasWidth, -canvasHeight);
          ctx.scale(-1, 1);
          break;
        case 8: // Rotasi 270 deg CW (90 deg CCW)
          ctx.translate(0, canvasHeight);
          ctx.rotate(-0.5 * Math.PI);
          break;
        default:
          // Orientasi normal (1) atau tidak diketahui (-1 / -2)
          break;
      }

      // Gambar ke canvas dengan dimensi target awal (sebelum pertukaran rotasi)
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      // Konversi ke Blob JPEG (secara otomatis menghapus EXIF metadata karena digambar ulang)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            return reject(new Error('Gagal kompresi canvas ke blob.'));
          }
          resolve({
            blob,
            width: canvasWidth,
            height: canvasHeight
          });
        },
        'image/jpeg',
        quality
      );
    } catch (err) {
      reject(err);
    }
  });
}
