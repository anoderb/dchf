import { captureFrameBlob } from './camera.js';

/**
 * Modul untuk menangani Auto Capture dan Burst Mode kamera
 */

export class AutoCaptureService {
  constructor() {
    this.timerId = null;
    this.isActive = false;
    this.startTime = 0;
    this.elapsedTime = 0; // dalam detik
    this.capturedCount = 0;
    this.intervalMs = 1000;
    this.elapsedTimerId = null;
  }

  /**
   * Memulai proses Auto Capture dengan interval tertentu
   * @param {HTMLVideoElement} videoElement - Elemen video preview
   * @param {number} intervalMs - Jeda interval antar capture (ms)
   * @param {Function} onCapture - Callback yang dijalankan setiap kali frame di-capture: (blob) => Promise<any>
   * @param {Function} onTick - Callback untuk update HUD timer berjalan dan statistik: (stats) => void
   */
  start(videoElement, intervalMs, onCapture, onTick) {
    if (this.isActive) return;

    this.isActive = true;
    this.intervalMs = intervalMs;
    this.startTime = Date.now();
    this.capturedCount = 0;
    this.elapsedTime = 0;

    // Timer untuk waktu berjalan (detik)
    this.elapsedTimerId = setInterval(() => {
      this.elapsedTime = Math.floor((Date.now() - this.startTime) / 1000);
      if (onTick) {
        onTick(this.getStats());
      }
    }, 1000);

    const captureLoop = async () => {
      if (!this.isActive) return;

      try {
        const blob = await captureFrameBlob(videoElement);
        this.capturedCount++;
        
        // Kirim blob ke pipeline processing & upload via callback
        if (onCapture) {
          // Jangan await di sini agar capture loop berikutnya berjalan tepat waktu, 
          // tapi serahkan ke queue untuk diunggah secara async.
          onCapture(blob, this.capturedCount);
        }

        if (onTick) {
          onTick(this.getStats());
        }
      } catch (err) {
        console.error('Error saat auto capture frame:', err);
      }

      // Jadwalkan capture berikutnya (menggunakan setTimeout berantai agar tidak tumpang tindih)
      if (this.isActive) {
        this.timerId = setTimeout(captureLoop, this.intervalMs);
      }
    };

    // Jalankan capture pertama secara instan
    captureLoop();
  }

  /**
   * Menghentikan Auto Capture
   */
  stop() {
    this.isActive = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.elapsedTimerId) {
      clearInterval(this.elapsedTimerId);
      this.elapsedTimerId = null;
    }
  }

  /**
   * Mengambil stats HUD saat ini
   */
  getStats() {
    return {
      isActive: this.isActive,
      capturedCount: this.capturedCount,
      elapsedTime: this.elapsedTime, // detik
      formattedTime: this.formatTime(this.elapsedTime)
    };
  }

  /**
   * Format detik ke HH:MM:SS
   */
  formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [
      h > 0 ? String(h).padStart(2, '0') : null,
      String(m).padStart(2, '0'),
      String(s).padStart(2, '0')
    ].filter(Boolean).join(':');
  }
}

/**
 * Menjalankan Burst Mode (jepret berurutan dengan jeda minimal)
 * @param {HTMLVideoElement} videoElement - Preview video kamera
 * @param {number} count - Jumlah foto (3, 5, 10, 20)
 * @param {Function} onCapture - Callback setiap capture berhasil: (blob, index) => void
 * @param {number} delayMs - Delay antar capture dalam milidetik (default 100ms)
 */
export async function triggerBurst(videoElement, count, onCapture, delayMs = 100) {
  for (let i = 0; i < count; i++) {
    try {
      const blob = await captureFrameBlob(videoElement);
      if (onCapture) {
        onCapture(blob, i + 1);
      }
    } catch (err) {
      console.error(`Gagal capture burst ke-${i + 1}:`, err);
    }
    
    // Jeda singkat antar capture
    if (i < count - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
