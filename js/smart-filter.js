/**
 * Smart Frame Filter - Membandingkan kemiripan antar frame
 * Digunakan untuk menyaring frame video yang terlalu mirip / statis agar menghemat penyimpanan.
 */
export class SmartFilter {
  /**
   * @param {number} threshold - Nilai batas perbedaan (0.0 hingga 1.0). Default 0.12 (12% perbedaan)
   * @param {number} analysisSize - Dimensi analisis downsampled (default 32px untuk performa cepat)
   */
  constructor(threshold = 0.12, analysisSize = 32) {
    this.threshold = threshold;
    this.analysisSize = analysisSize;
    this.previousFrameData = null; // Uint8ClampedArray hasil getImageData
  }

  /**
   * Set nilai threshold baru
   */
  setThreshold(val) {
    this.threshold = Number(val);
  }

  /**
   * Reset filter state (untuk memproses video/stream baru)
   */
  reset() {
    this.previousFrameData = null;
  }

  /**
   * Membantu memuat gambar/blob ke elemen Image
   */
  loadImage(blob) {
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
   * Mendapatkan array data piksel downsampled dari Blob gambar atau Canvas
   * @param {Blob|HTMLCanvasElement|HTMLVideoElement} source
   */
  async getAnalysisData(source) {
    const canvas = document.createElement('canvas');
    canvas.width = this.analysisSize;
    canvas.height = this.analysisSize;
    const ctx = canvas.getContext('2d');

    if (source instanceof Blob) {
      const img = await this.loadImage(source);
      ctx.drawImage(img, 0, 0, this.analysisSize, this.analysisSize);
    } else {
      // Untuk HTMLVideoElement atau HTMLCanvasElement
      ctx.drawImage(source, 0, 0, this.analysisSize, this.analysisSize);
    }

    const imgData = ctx.getImageData(0, 0, this.analysisSize, this.analysisSize);
    return imgData.data;
  }

  /**
   * Mengevaluasi apakah frame harus disimpan (true) atau dibuang karena terlalu mirip (false)
   * @param {Blob|HTMLCanvasElement|HTMLVideoElement} source - Frame saat ini
   * @returns {Promise<boolean>} True jika frame berbeda signifikan (simpan), False jika terlalu mirip (buang)
   */
  async shouldKeepFrame(source) {
    try {
      const currentData = await this.getAnalysisData(source);

      // Jika ini frame pertama, simpan saja
      if (!this.previousFrameData) {
        this.previousFrameData = currentData;
        return true;
      }

      // Bandingkan data piksel saat ini dengan sebelumnya
      const difference = this.calculateDifference(currentData, this.previousFrameData);

      // Jika perbedaan melebihi threshold, maka frame ini dianggap berbeda (keep)
      if (difference >= this.threshold) {
        this.previousFrameData = currentData; // Update referensi dengan frame baru
        return true;
      }

      // Terlalu mirip (skip)
      return false;
    } catch (err) {
      console.error('Error in smart filter analysis:', err);
      return true; // Fallback jika gagal analisis, tetap simpan agar tidak kehilangan data
    }
  }

  /**
   * Menghitung Mean Absolute Error (MAE) ternormalisasi dari dua data piksel RGBA
   */
  calculateDifference(data1, data2) {
    let diffSum = 0;
    const len = data1.length;

    // Bandingkan channel RGB (abaikan Alpha channel di indeks i+3)
    let pixelsCount = 0;
    for (let i = 0; i < len; i += 4) {
      const rDiff = Math.abs(data1[i] - data2[i]);
      const gDiff = Math.abs(data1[i + 1] - data2[i + 1]);
      const bDiff = Math.abs(data1[i + 2] - data2[i + 2]);

      // Gabungkan perbedaan warna (rata-rata selisih ternormalisasi)
      diffSum += (rDiff + gDiff + bDiff) / 3;
      pixelsCount++;
    }

    // Normalisasi selisih ke skala 0.0 - 1.0 (255 max difference)
    return diffSum / pixelsCount / 255;
  }
}
