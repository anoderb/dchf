/**
 * Modul antrean upload file (Upload Queue) dengan dukungan offline support, paralel upload, dan retry otomatis.
 */
export class UploadQueue {
  /**
   * @param {object} options - Konfigurasi queue: { concurrency, maxRetries, retryDelay, onUpdate }
   */
  constructor(options = {}) {
    this.concurrency = options.concurrency || 2; // Maksimal upload paralel
    this.maxRetries = options.maxRetries || 3;   // Maksimal percobaan ulang jika gagal
    this.retryDelay = options.retryDelay || 3000; // Delay retry (ms)
    this.onUpdate = options.onUpdate || null;     // Callback berkala update status UI

    this.queue = [];         // Item yang menunggu di-upload: { id, datasetId, datasetSlug, blob, thumbnail, width, height, attempts }
    this.activeUploads = 0;  // Jumlah upload yang sedang berjalan secara paralel
    this.isPaused = false;
    this.completedCount = 0;
    this.failedCount = 0;
    this.totalSubmitted = 0;
    this.isOnline = navigator.onLine;

    this.setupNetworkListeners();
  }

  /**
   * Setup pemantauan status koneksi internet browser
   */
  setupNetworkListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.isPaused = false;
      this.triggerUpdate();
      console.log('Koneksi internet kembali aktif. Melanjutkan antrean upload...');
      this.processQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.isPaused = true;
      this.triggerUpdate();
      console.warn('Koneksi internet terputus. Menghentikan sementara antrean upload...');
    });
  }

  /**
   * Menambahkan satu item upload ke dalam antrean
   * @param {object} item - { datasetId, datasetSlug, blob, thumbnail, width, height, fileName }
   */
  add(item) {
    const queueItem = {
      id: `up-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      attempts: 0,
      status: 'pending', // 'pending', 'processing', 'uploading', 'success', 'failed'
      ...item
    };

    this.queue.push(queueItem);
    this.totalSubmitted++;
    this.triggerUpdate();
    this.processQueue();
    return queueItem.id;
  }

  /**
   * Menambahkan banyak item sekaligus (misalnya hasil ekstraksi frame video)
   */
  addBatch(items) {
    const ids = [];
    items.forEach((item) => {
      ids.push(this.add(item));
    });
    return ids;
  }

  /**
   * Memproses antrean secara paralel sesuai limit concurrency
   */
  async processQueue() {
    // Berhenti jika dijeda, offline, atau jumlah upload aktif sudah mencapai batas maksimal paralel
    if (this.isPaused || !this.isOnline || this.activeUploads >= this.concurrency) {
      return;
    }

    // Cari item pertama yang berstatus pending atau failed (untuk di-retry)
    const nextItem = this.queue.find(item => item.status === 'pending' || item.status === 'failed-retry');

    if (!nextItem) {
      return;
    }

    // Ubah status item menjadi aktif
    nextItem.status = 'uploading';
    this.activeUploads++;
    this.triggerUpdate();

    // Jalankan upload secara asinkron
    this.uploadItem(nextItem);

    // Coba jalankan slot proses berikutnya jika masih ada slot paralel tersedia
    this.processQueue();
  }

  /**
   * Mengunggah satu item
   */
  async uploadItem(item) {
    try {
      // Import handler upload dinamis untuk menghindari circular dependencies
      const { uploadSinglePhoto } = await import('./upload.js');

      // Jalankan proses upload Supabase
      const result = await uploadSinglePhoto({
        datasetId: item.datasetId,
        datasetSlug: item.datasetSlug,
        processedBlob: item.blob,
        thumbnail: item.thumbnail,
        width: item.width,
        height: item.height,
        fileName: item.fileName
      });

      // Sukses
      item.status = 'success';
      this.completedCount++;
      
      // Hapus dari antrean setelah sukses
      this.queue = this.queue.filter(q => q.id !== item.id);
      
      // Memicu event callback di halaman jika ada photo baru ditambahkan
      const event = new CustomEvent('photo-uploaded', { detail: result });
      window.dispatchEvent(event);

    } catch (error) {
      console.error(`Gagal mengunggah item ${item.id}:`, error);
      item.attempts++;

      if (item.attempts < this.maxRetries && this.isOnline) {
        // Jadwalkan retry otomatis jika kuota retry belum habis dan internet masih ada
        item.status = 'failed-retry';
        
        const event = new CustomEvent('photo-upload-failed', { 
          detail: { id: item.id, error: error.message || error, permanent: false } 
        });
        window.dispatchEvent(event);

        setTimeout(() => {
          this.processQueue();
        }, this.retryDelay);
      } else {
        // Gagal permanen atau internet mati
        item.status = 'failed';
        this.failedCount++;
        
        const event = new CustomEvent('photo-upload-failed', { 
          detail: { id: item.id, error: error.message || error, permanent: true } 
        });
        window.dispatchEvent(event);
        // Tetap simpan di queue agar bisa di-retry secara manual atau otomatis nanti
      }
    } finally {
      this.activeUploads--;
      this.triggerUpdate();
      
      // Lanjutkan memproses sisa antrean
      this.processQueue();
    }
  }

  /**
   * Mencoba kembali mengunggah semua item yang gagal
   */
  retryAllFailed() {
    this.queue.forEach((item) => {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.attempts = 0;
      }
    });
    this.failedCount = 0;
    this.triggerUpdate();
    this.processQueue();
  }

  /**
   * Membersihkan seluruh antrean
   */
  clear() {
    this.queue = [];
    this.activeUploads = 0;
    this.completedCount = 0;
    this.failedCount = 0;
    this.totalSubmitted = 0;
    this.triggerUpdate();
  }

  /**
   * Memicu update callback statistik ke interface UI
   */
  triggerUpdate() {
    if (this.onUpdate) {
      this.onUpdate(this.getStats());
    }
  }

  /**
   * Mendapatkan statistik status antrean saat ini
   */
  getStats() {
    const pendingCount = this.queue.filter(q => q.status === 'pending' || q.status === 'failed-retry').length;
    const uploadingCount = this.activeUploads;
    
    return {
      isOnline: this.isOnline,
      isPaused: this.isPaused,
      pendingCount,
      uploadingCount,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
      totalCount: this.totalSubmitted,
      progressPercent: this.totalSubmitted > 0 ? Math.round((this.completedCount / this.totalSubmitted) * 100) : 0
    };
  }
}
