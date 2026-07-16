/**
 * Modul untuk merekam video langsung menggunakan MediaRecorder API
 */
export class VideoRecorderService {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.startTime = 0;
    this.elapsedTime = 0; // Detik
    this.timerId = null;
    this.recordedSize = 0; // Bytes
    this.state = 'inactive'; // 'inactive', 'recording', 'paused'
    this.stream = null;
  }

  /**
   * Mulai merekam video dari stream kamera aktif
   * @param {MediaStream} stream - Stream kamera
   * @param {Function} onUpdate - Callback berkala saat merekam untuk data ukuran & waktu: (stats) => void
   */
  start(stream, onUpdate) {
    if (this.state !== 'inactive') return;

    this.stream = stream;
    this.recordedChunks = [];
    this.recordedSize = 0;
    this.elapsedTime = 0;
    this.startTime = Date.now();

    // Pilih mime type video terbaik yang didukung browser
    const options = this.getSupportedMimeType();
    
    try {
      this.mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
      console.warn('Gagal inisialisasi MediaRecorder dengan codec pilihan, menggunakan default browser.', e);
      this.mediaRecorder = new MediaRecorder(stream);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
        this.recordedSize += event.data.size;
        if (onUpdate) onUpdate(this.getStats());
      }
    };

    // Mulai rekam dengan time slice 500ms agar ondataavailable dipicu berkala
    this.mediaRecorder.start(500);
    this.state = 'recording';

    // Timer berjalan
    this.timerId = setInterval(() => {
      if (this.state === 'recording') {
        this.elapsedTime = Math.floor((Date.now() - this.startTime) / 1000);
        if (onUpdate) onUpdate(this.getStats());
      }
    }, 1000);

    if (onUpdate) onUpdate(this.getStats());
  }

  /**
   * Pause perekaman video
   */
  pause() {
    if (this.state !== 'recording') return;
    this.mediaRecorder.pause();
    this.state = 'paused';
  }

  /**
   * Resume perekaman video
   */
  resume() {
    if (this.state !== 'paused') return;
    // Sesuaikan startTime agar jeda waktu pause tidak dihitung
    const pausedDuration = Date.now() - (this.startTime + this.elapsedTime * 1000);
    this.startTime += pausedDuration;
    this.mediaRecorder.resume();
    this.state = 'recording';
  }

  /**
   * Menghentikan perekaman dan mengembalikan Blob video terkompilasi
   * @returns {Promise<Blob>} Blob video hasil rekaman
   */
  stop() {
    return new Promise((resolve, reject) => {
      if (this.state === 'inactive' || !this.mediaRecorder) {
        return reject(new Error('Perekam tidak aktif.'));
      }

      this.mediaRecorder.onstop = () => {
        clearInterval(this.timerId);
        this.timerId = null;
        this.state = 'inactive';

        // Gabungkan seluruh data chunk ke dalam satu Blob video
        const blob = new Blob(this.recordedChunks, {
          type: this.recordedChunks[0]?.type || 'video/webm'
        });
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Batalkan perekaman aktif saat ini (hapus data)
   */
  cancel() {
    if (this.mediaRecorder && this.state !== 'inactive') {
      // Hapus event onstop agar tidak me-resolve promise
      this.mediaRecorder.onstop = null;
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        // Abaikan error jika sudah stop
      }
    }
    clearInterval(this.timerId);
    this.timerId = null;
    this.recordedChunks = [];
    this.recordedSize = 0;
    this.state = 'inactive';
  }

  /**
   * Mendapatkan statistik perekaman saat ini
   */
  getStats() {
    const videoSettings = this.getVideoTrackSettings();
    return {
      state: this.state,
      elapsedTime: this.elapsedTime,
      formattedTime: this.formatTime(this.elapsedTime),
      fileSize: this.recordedSize,
      formattedSize: this.formatSize(this.recordedSize),
      resolution: videoSettings ? `${videoSettings.width}x${videoSettings.height}` : 'Unknown',
      fps: videoSettings?.frameRate ? Math.round(videoSettings.frameRate) : 30
    };
  }

  /**
   * Helper mendapatkan konfigurasi/settings video feed
   */
  getVideoTrackSettings() {
    if (this.stream) {
      const videoTrack = this.stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.getSettings === 'function') {
        return videoTrack.getSettings();
      }
    }
    return null;
  }

  /**
   * Helper mendeteksi mime type video terbaik yang disupport browser
   */
  getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=h264',
      'video/mp4'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return { mimeType: type };
      }
    }
    return {};
  }

  /**
   * Format detik ke MM:SS
   */
  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Format bytes ke ukuran baca manusia (KB/MB)
   */
  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
