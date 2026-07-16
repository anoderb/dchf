/**
 * Analisis kualitas gambar menggunakan HTML5 Canvas ImageData
 */

/**
 * Konversi ImageData ke Grayscale (Luminance)
 */
function getGrayscaleData(imageData) {
  const data = imageData.data;
  const len = data.length;
  const grayscale = new Uint8Array(len / 4);
  for (let i = 0, j = 0; i < len; i += 4, j++) {
    // Rumus luminansi standar: Y = 0.299R + 0.587G + 0.114B
    grayscale[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return grayscale;
}

/**
 * Deteksi Blur menggunakan Laplacian Variance (Metode Sobel/Laplacian)
 * Varians yang rendah berarti gambar buram (blur) karena tidak banyak tepi tajam.
 */
function checkBlur(grayscale, width, height) {
  // Kernel Laplacian 3x3 sederhana
  // [ 0,  1,  0]
  // [ 1, -4,  1]
  // [ 0,  1,  0]
  let sum = 0;
  let sumSq = 0;
  const count = (width - 2) * (height - 2);

  if (count <= 0) return 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      const val = 
        grayscale[idx - width] + // Atas
        grayscale[idx - 1] +     // Kiri
        grayscale[idx + 1] +     // Kanan
        grayscale[idx + width] - // Bawah
        4 * grayscale[idx];      // Tengah

      sum += val;
      sumSq += val * val;
    }
  }

  const mean = sum / count;
  const variance = (sumSq / count) - (mean * mean);
  return variance;
}

/**
 * Deteksi kecerahan rata-rata (Brightness)
 * Skala 0 (gelap gulita) hingga 255 (putih total)
 */
function checkBrightness(grayscale) {
  let sum = 0;
  for (let i = 0; i < grayscale.length; i++) {
    sum += grayscale[i];
  }
  return sum / grayscale.length;
}

/**
 * Deteksi noise sederhana dengan mengukur deviasi standar dari perbedaan piksel horizontal
 */
function checkNoise(grayscale, width, height) {
  let diffSum = 0;
  let diffSumSq = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = y * width + x;
      const diff = Math.abs(grayscale[idx] - grayscale[idx + 1]);
      diffSum += diff;
      diffSumSq += diff * diff;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = diffSum / count;
  const variance = (diffSumSq / count) - (mean * mean);
  return Math.sqrt(variance); // Standar deviasi perbedaan
}

/**
 * Konversi Blob ke HTML Image untuk digambar ke canvas analisis
 */
function blobToImage(blob) {
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
 * Fungsi utama pemeriksaan kualitas gambar
 */
export async function checkQuality(blob, options = {}) {
  const defaults = {
    minWidth: 480,
    minHeight: 480,
    blurThreshold: 5,        // Varians Laplacian di bawah ini dianggap blur
    darkThreshold: 45,       // Kecerahan rata-rata di bawah ini dianggap terlalu gelap
    brightThreshold: 225,    // Kecerahan rata-rata di atas ini dianggap terlalu terang
    noiseThreshold: 35,      // Deviasi perbedaan di atas ini dianggap terlalu banyak noise
    analysisSize: 160        // Downsample ke dimensi ini untuk performa cepat di HP
  };

  const config = { ...defaults, ...options };
  const issues = [];

  try {
    const img = await blobToImage(blob);
    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;

    // 1. Periksa Resolusi Minimum
    if (originalWidth < config.minWidth || originalHeight < config.minHeight) {
      issues.push('small');
    }

    // Buat canvas analisis berukuran kecil untuk performa optimal
    // Pertahankan rasio aspek untuk downsampling
    let targetWidth = config.analysisSize;
    let targetHeight = Math.round((originalHeight * config.analysisSize) / originalWidth);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    
    // Periksa apakah frame kosong/rusak
    if (!imageData || imageData.data.length === 0) {
      return {
        passed: false,
        issues: ['corrupt'],
        scores: { sharpness: 0, brightness: 0, noise: 0, resolution: { width: originalWidth, height: originalHeight } }
      };
    }

    const grayscale = getGrayscaleData(imageData);
    const brightness = checkBrightness(grayscale);
    const blurScore = checkBlur(grayscale, targetWidth, targetHeight);
    const noiseScore = checkNoise(grayscale, targetWidth, targetHeight);

    // 2. Periksa Kecerahan (Gelap / Terang)
    if (brightness < config.darkThreshold) {
      issues.push('dark');
    } else if (brightness > config.brightThreshold) {
      issues.push('bright');
    }

    // 3. Periksa Blur
    if (blurScore < config.blurThreshold) {
      issues.push('blur');
    }

    // 4. Periksa Noise
    if (noiseScore > config.noiseThreshold) {
      issues.push('noise');
    }

    return {
      passed: issues.length === 0,
      issues,
      scores: {
        sharpness: Math.round(blurScore * 10) / 10,
        brightness: Math.round(brightness * 10) / 10,
        noise: Math.round(noiseScore * 10) / 10,
        resolution: { width: originalWidth, height: originalHeight }
      }
    };
  } catch (err) {
    console.error('Error analyzing image quality:', err);
    return {
      passed: false,
      issues: ['corrupt'],
      scores: { sharpness: 0, brightness: 0, noise: 0, resolution: { width: 0, height: 0 } }
    };
  }
}
