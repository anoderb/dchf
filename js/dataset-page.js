import { supabase, getPhotos, checkDatasetSync, repairDatasetSync, getPhotoPublicUrl } from './supabase.js';
import { startCamera, stopCamera, switchCamera, captureFrameBlob } from './camera.js';
import { AutoCaptureService, triggerBurst } from './auto-capture.js';
import { VideoRecorderService } from './video-recorder.js';
import { getVideoMetadata, estimateExtraction, extractFrames } from './frame-extractor.js';
import { SmartFilter } from './smart-filter.js';
import { checkQuality } from './quality-check.js';
import { processImage } from './image-processing.js';
import { UploadQueue } from './upload-queue.js';
import { deletePhoto, syncDatasetToHF } from './upload.js';
import { downloadDatasetZip } from './download.js';
import { showConfirm } from './confirm.js';
import { showToast } from './toast.js';
import { HF_REPO } from './config.js';

// Parameter URL
const urlParams = new URLSearchParams(window.location.search);
const datasetId = urlParams.get('id');
const datasetSlug = urlParams.get('slug');
const datasetName = urlParams.get('name') ? decodeURIComponent(urlParams.get('name')) : '';

// State global halaman detail
let datasetPhotos = [];
let activeFacingMode = 'environment';
let cameraStream = null;
let currentActiveTab = 'tab-photo';
let isSelectMode = false;
let selectedPhotoIds = new Set();

// Layanan Stateful
const autoCapture = new AutoCaptureService();
const videoRecorder = new VideoRecorderService();
const smartFilter = new SmartFilter();

// Inisialisasi Upload Queue
const uploadQueue = new UploadQueue({
  concurrency: 2,
  maxRetries: 3,
  retryDelay: 3000,
  onUpdate: (stats) => renderUploadProgress(stats)
});

// DOM Elements
const datasetTitleDisplay = document.getElementById('dataset-title-display');
const datasetSubtitleDisplay = document.getElementById('dataset-subtitle-display');
const thumbnailGrid = document.getElementById('thumbnail-grid');
const galleryCount = document.getElementById('gallery-count');
const backToHomeBtn = document.getElementById('back-to-home-btn');

// Sync Checker Elements
const checkSyncBtn = document.getElementById('check-sync-btn');
const syncStatusPanel = document.getElementById('sync-status-panel');
const syncStatusDetails = document.getElementById('sync-status-details');
const repairSyncBtn = document.getElementById('repair-sync-btn');
const syncHfBtn = document.getElementById('sync-hf-btn');

// Selection Elements
const toggleSelectModeBtn = document.getElementById('toggle-select-mode-btn');
const selectionActions = document.getElementById('selection-actions');
const selectAllBtn = document.getElementById('select-all-btn');
const deleteSelectedBtn = document.getElementById('delete-selected-btn');
const cancelSelectBtn = document.getElementById('cancel-select-btn');

// Mode Tab Buttons
const tabPhotoBtn = document.getElementById('tab-photo');
const tabVideoBtn = document.getElementById('tab-video');
const tabUploadPhotoBtn = document.getElementById('tab-upload-photo');
const tabUploadVideoBtn = document.getElementById('tab-upload-video');
const panels = document.querySelectorAll('.mode-panel');

// Mode 1: Photo Elements
const openCameraBtn = document.getElementById('open-camera-btn');
const cameraOverlay = document.getElementById('camera-overlay');
const closeCameraBtn = document.getElementById('close-camera-btn');
const cameraVideo = document.getElementById('camera-video');
const shutterBtn = document.getElementById('shutter-btn');
const swapCamBtn = document.getElementById('swap-camera-btn');
const autoCaptureInterval = document.getElementById('auto-capture-interval');
const burstCountSelector = document.getElementById('burst-count-selector');
const startAutoBtn = document.getElementById('start-auto-btn');
const triggerBurstBtn = document.getElementById('trigger-burst-btn');
const autoCaptureHud = document.getElementById('auto-capture-hud');
const hudPhotosCount = document.getElementById('hud-photos-count');
const hudTimer = document.getElementById('hud-timer');
const hudStopBtn = document.getElementById('hud-stop-btn');

// Mode 2: Video Elements
const startRecordBtn = document.getElementById('start-record-btn');
const pauseRecordBtn = document.getElementById('pause-record-btn');
const stopRecordBtn = document.getElementById('stop-record-btn');
const recordVideoEl = document.getElementById('recorder-video');
const recordTimer = document.getElementById('record-timer');
const recordSize = document.getElementById('record-size');
const recordResolution = document.getElementById('record-resolution');
const recordFps = document.getElementById('record-fps');
const recordHud = document.getElementById('record-hud');
const postRecordControls = document.getElementById('post-record-controls');
const playbackVideoEl = document.getElementById('playback-video');
const reRecordBtn = document.getElementById('re-record-btn');
const deleteRecordBtn = document.getElementById('delete-record-btn');
const processRecordBtn = document.getElementById('process-record-btn');
const recordExtractFps = document.getElementById('record-extract-fps');
const recordFilterCheck = document.getElementById('record-filter-check');
const recordThresholdRange = document.getElementById('record-threshold-range');
const recordThresholdValue = document.getElementById('record-threshold-value');

// Mode 3: Upload Photo Elements
const dropZonePhoto = document.getElementById('drop-zone-photo');
const fileInputPhoto = document.getElementById('file-input-photo');
const uploadPhotoPreviewSection = document.getElementById('upload-photo-preview-section');
const uploadPhotoPreviewGrid = document.getElementById('upload-photo-preview-grid');
const uploadSelectedPhotosBtn = document.getElementById('upload-selected-photos-btn');
const clearSelectedPhotosBtn = document.getElementById('clear-selected-photos-btn');
const uploadPhotoCount = document.getElementById('upload-photo-count');
let selectedPhotoFiles = [];

// Mode 4: Upload Video Elements
const dropZoneVideo = document.getElementById('drop-zone-video');
const fileInputVideo = document.getElementById('file-input-video');
const videoMetadataSection = document.getElementById('video-metadata-section');
const videoMetaName = document.getElementById('video-meta-name');
const videoMetaSize = document.getElementById('video-meta-size');
const videoMetaDuration = document.getElementById('video-meta-duration');
const videoMetaResolution = document.getElementById('video-meta-resolution');
const videoMetaFps = document.getElementById('video-meta-fps');
const videoMetaEstFrame = document.getElementById('video-meta-est-frame');
const videoExtractMode = document.getElementById('video-extract-mode');
const videoFpsContainer = document.getElementById('video-fps-container');
const videoIntervalContainer = document.getElementById('video-interval-container');
const videoFpsSelect = document.getElementById('video-fps-select');
const videoIntervalSelect = document.getElementById('video-interval-select');
const estOriginalFps = document.getElementById('est-original-fps');
const estFrames = document.getElementById('est-frames');
const estStorage = document.getElementById('est-storage');
const estTime = document.getElementById('est-time');
const startExtractVideoBtn = document.getElementById('start-extract-video-btn');
const cancelExtractVideoBtn = document.getElementById('cancel-extract-video-btn');
const videoFilterCheck = document.getElementById('video-filter-check');
const videoThresholdRange = document.getElementById('video-threshold-range');
const videoThresholdValue = document.getElementById('video-threshold-value');
let selectedVideoFile = null;
let selectedVideoMetadata = null;

// Progress Panel Elements
const progressPanel = document.getElementById('progress-panel');
const progressStatusText = document.getElementById('progress-status-text');
const progressPercentText = document.getElementById('progress-percent-text');
const progressBarInner = document.getElementById('progress-bar-inner');
const stepExtract = document.getElementById('step-extract');
const stepProcess = document.getElementById('step-process');
const stepCompress = document.getElementById('step-compress');
const stepUpload = document.getElementById('step-upload');
const stepVerification = document.getElementById('step-verification');

// Result Summary Elements
const resultSummaryCard = document.getElementById('result-summary-card');
const resExtracted = document.getElementById('res-extracted');
const resSaved = document.getElementById('res-saved');
const resDiscarded = document.getElementById('res-discarded');
const resBeforeSize = document.getElementById('res-before-size');
const resAfterSize = document.getElementById('res-after-size');
const resSavingPercent = document.getElementById('res-saving-percent');
const resOkBtn = document.getElementById('res-ok-btn');
let sessionStats = { extracted: 0, saved: 0, discarded: 0, beforeSize: 0, afterSize: 0 };

// Download & Action buttons
const downloadZipDesktopBtn = document.getElementById('download-zip-desktop-btn');
const downloadZipMobileBtn = document.getElementById('download-zip-mobile-btn');

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */

async function initPage() {
  if (!datasetId || !datasetSlug) {
    showToast('Dataset ID atau Slug tidak valid. Mengalihkan ke Dashboard...', 'error');
    setTimeout(() => window.location.href = '/', 2000);
    return;
  }

  // Sembunyikan tombol sinkronisasi jika HF tidak dikonfigurasi
  if (!HF_REPO && syncHfBtn) {
    syncHfBtn.classList.add('d-none');
  }

  // Tampilkan info dataset di header
  datasetTitleDisplay.textContent = datasetName || datasetSlug;
  datasetSubtitleDisplay.textContent = 'Memuat foto-foto produk...';

  // Muat daftar foto yang ada
  await loadPhotos();
}

async function loadPhotos() {
  try {
    datasetPhotos = await getPhotos(datasetId);
    renderGallery();
  } catch (error) {
    console.error('Error loading photos:', error);
    showToast('Gagal memuat galeri foto dari database.', 'error');
  }
}

import { protectAccess } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
  protectAccess(() => {
    initPage();
    setupEventListeners();
  });
});

// Bersihkan camera stream jika berpindah halaman & cegah penutupan jika ada upload aktif
window.addEventListener('beforeunload', (e) => {
  cleanupCamera();
  
  const stats = uploadQueue.getStats();
  if (stats.pendingCount > 0 || stats.uploadingCount > 0) {
    e.preventDefault();
    e.returnValue = 'Proses upload masih berjalan. Apakah Anda yakin ingin meninggalkan halaman?';
    return e.returnValue;
  }
});

/* ==========================================================================
   EVENT LISTENERS
   ========================================================================== */

function setupEventListeners() {
  // Tab Switching
  tabPhotoBtn.addEventListener('click', () => switchTab('tab-photo'));
  tabVideoBtn.addEventListener('click', () => switchTab('tab-video'));
  tabUploadPhotoBtn.addEventListener('click', () => switchTab('tab-upload-photo'));
  tabUploadVideoBtn.addEventListener('click', () => switchTab('tab-upload-video'));

  // Mode 1: Camera Actions
  openCameraBtn.addEventListener('click', openFullscreenCamera);
  closeCameraBtn.addEventListener('click', closeFullscreenCamera);
  shutterBtn.addEventListener('click', captureSinglePhoto);
  swapCamBtn.addEventListener('click', handleSwapCamera);
  startAutoBtn.addEventListener('click', toggleAutoCapture);
  hudStopBtn.addEventListener('click', toggleAutoCapture);
  triggerBurstBtn.addEventListener('click', handleBurstCapture);

  // Mode 2: Video Recorder Actions
  startRecordBtn.addEventListener('click', handleStartRecord);
  pauseRecordBtn.addEventListener('click', handlePauseRecord);
  stopRecordBtn.addEventListener('click', handleStopRecord);
  reRecordBtn.addEventListener('click', handleReRecord);
  deleteRecordBtn.addEventListener('click', handleDeleteRecord);
  processRecordBtn.addEventListener('click', handleProcessRecordVideo);
  recordThresholdRange.addEventListener('input', (e) => {
    recordThresholdValue.textContent = `${Math.round(e.target.value * 100)}%`;
  });

  // Mode 3: Upload Photo Actions
  setupDragAndDrop(dropZonePhoto, fileInputPhoto, handlePhotoSelection);
  clearSelectedPhotosBtn.addEventListener('click', clearPhotoSelection);
  uploadSelectedPhotosBtn.addEventListener('click', handleUploadSelectedPhotos);

  // Mode 4: Upload Video Actions
  setupDragAndDrop(dropZoneVideo, fileInputVideo, handleVideoSelection);
  videoExtractMode.addEventListener('change', handleVideoExtractModeChange);
  videoFpsSelect.addEventListener('change', updateVideoEstimation);
  videoIntervalSelect.addEventListener('change', updateVideoEstimation);
  startExtractVideoBtn.addEventListener('click', handleExtractVideoFrames);
  cancelExtractVideoBtn.addEventListener('click', clearVideoSelection);
  videoThresholdRange.addEventListener('input', (e) => {
    videoThresholdValue.textContent = `${Math.round(e.target.value * 100)}%`;
  });

  // Download ZIP
  downloadZipDesktopBtn.addEventListener('click', handleDownloadZip);
  downloadZipMobileBtn.addEventListener('click', handleDownloadZip);

  // Result Summary Close
  resOkBtn.addEventListener('click', () => {
    resultSummaryCard.classList.add('d-none');
  });

  // Listener event upload selesai untuk sinkronisasi list secara real-time
  window.addEventListener('photo-uploaded', async (e) => {
    const newRecord = e.detail;
    if (!datasetPhotos.some(p => p.id === newRecord.id)) {
      datasetPhotos.push(newRecord);
      renderGallery();
    }

    // Auto-Sync pemicu otomatis jika jumlah foto lokal (Supabase) >= 10
    const unsyncedCount = datasetPhotos.filter(p => p.storage_provider === 'supabase').length;
    if (unsyncedCount >= 10) {
      console.log(`Pemicu otomatis: ${unsyncedCount} foto lokal terdeteksi. Memulai auto-sync batch ke Hugging Face...`);
      showToast('Pemicu Otomatis: 10 foto lokal terdeteksi, memindahkan ke Hugging Face...', 'info');
      
      try {
        await syncDatasetToHF(datasetId, datasetSlug);
        await loadPhotos();
        showToast('Auto-sync ke Hugging Face selesai!', 'success');
      } catch (err) {
        console.warn('Gagal melakukan auto-sync otomatis:', err);
      }
    }
  });

  // Listener event upload gagal
  window.addEventListener('photo-upload-failed', (e) => {
    const { error, permanent } = e.detail;
    if (permanent) {
      showToast(`Gagal mengunggah foto: ${error}. Silakan klik Coba Lagi.`, 'error');
    } else {
      showToast(`Unggahan gagal, mencoba kembali otomatis...`, 'warning');
    }
  });

  // Listener Sinkronisasi Data
  checkSyncBtn.addEventListener('click', handleCheckSync);
  repairSyncBtn.addEventListener('click', handleRepairSync);
  if (syncHfBtn) {
    syncHfBtn.addEventListener('click', handleSyncHF);
  }

  // Listener Seleksi Foto
  toggleSelectModeBtn.addEventListener('click', enterSelectMode);
  cancelSelectBtn.addEventListener('click', exitSelectMode);
  selectAllBtn.addEventListener('click', handleSelectAll);
  deleteSelectedBtn.addEventListener('click', handleDeleteSelected);
}

function setupDragAndDrop(dropZone, fileInput, handler) {
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handler(e.target.files);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handler(e.dataTransfer.files);
    }
  });
}

/* ==========================================================================
   TAB SWITCHING & CAMERA CLEANUP
   ========================================================================== */

function switchTab(tabId) {
  if (currentActiveTab === tabId) return;

  // Hentikan aktivitas media aktif di tab sebelumnya
  cleanupActiveMedia();

  currentActiveTab = tabId;

  // Update tab visual
  const tabs = [tabPhotoBtn, tabVideoBtn, tabUploadPhotoBtn, tabUploadVideoBtn];
  tabs.forEach(tab => {
    if (tab.id === tabId) tab.classList.add('active');
    else tab.classList.remove('active');
  });

  // Tampilkan panel yang sesuai
  panels.forEach(panel => {
    if (panel.id === `${tabId}-panel`) panel.classList.add('active');
    else panel.classList.remove('active');
  });

  // Inisialisasi otomatis kamera preview jika pindah ke Tab Video Recorder
  if (tabId === 'tab-video') {
    initVideoRecorderCamera();
  }
}

function cleanupActiveMedia() {
  cleanupCamera();
  autoCapture.stop();
  autoCaptureHud.classList.add('d-none');
  videoRecorder.cancel();
  recordHud.classList.add('d-none');
  postRecordControls.classList.add('d-none');
  playbackVideoEl.classList.add('d-none');
  playbackVideoEl.src = '';
  startRecordBtn.classList.remove('d-none');
  stopRecordBtn.classList.add('d-none');
  pauseRecordBtn.classList.add('d-none');
}

function cleanupCamera() {
  if (cameraStream) {
    stopCamera(cameraVideo);
    stopCamera(recordVideoEl);
    cameraStream = null;
  }
}

/* ==========================================================================
   MODE 1: AMBIL FOTO (CAMERA ACTIONS)
   ========================================================================== */

async function openFullscreenCamera() {
  cameraOverlay.classList.remove('d-none');
  document.body.style.overflow = 'hidden'; // Kunci scroll halaman belakang
  
  try {
    cameraStream = await startCamera(cameraVideo, activeFacingMode);
    showToast('Kamera aktif.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Gagal membuka kamera: ' + err.message, 'error');
    closeFullscreenCamera();
  }
}

function closeFullscreenCamera() {
  autoCapture.stop();
  autoCaptureHud.classList.add('d-none');
  cleanupCamera();
  cameraOverlay.classList.add('d-none');
  document.body.style.overflow = '';
  startAutoBtn.textContent = 'Auto Capture';
  startAutoBtn.classList.remove('btn-danger');
}

async function handleSwapCamera() {
  try {
    const res = await switchCamera(cameraVideo, activeFacingMode);
    cameraStream = res.stream;
    activeFacingMode = res.facingMode;
  } catch (err) {
    showToast('Gagal mengganti kamera.', 'error');
  }
}

// Pipeline upload tunggal (dipakai oleh camera capture, upload gallery, video frames)
async function pipelineProcessAndQueue(imageBlob, fileName = null, force = false) {
  try {
    // 1. Image Processing: Resize (1280px), Compress (85%), Auto-rotate, Remove EXIF, Thumbnail
    updateStepIndicator('process', 'running');
    const processed = await processImage(imageBlob, {
      maxSize: 1280,
      quality: 0.85
    });
    updateStepIndicator('process', 'done');

    // 2. Quality Check: Sharpness, Brightness, Noise
    updateStepIndicator('compress', 'running');
    const qc = await checkQuality(processed.processed);
    updateStepIndicator('compress', 'done');

    if (!qc.passed && !force) {
      console.warn('Frame kualitas buruk, di-skip. Isu:', qc.issues.join(', '));
      sessionStats.discarded++;
      return false; // Skip frame kualitas buruk
    }

    if (!qc.passed && force) {
      console.info('Frame kualitas buruk tetapi dipaksa tetap disimpan (manual action). Isu:', qc.issues.join(', '));
    }

    // 3. Masukkan ke Antrean Upload
    updateStepIndicator('upload', 'running');
    uploadQueue.add({
      datasetId,
      datasetSlug,
      blob: processed.processed,
      thumbnail: processed.thumbnail,
      width: processed.width,
      height: processed.height,
      fileName: fileName
    });
    
    sessionStats.saved++;
    sessionStats.beforeSize += imageBlob.size;
    sessionStats.afterSize += processed.processed.size;
    return true;
  } catch (err) {
    console.error('Gagal memproses gambar dalam pipeline:', err);
    return false;
  }
}

async function captureSinglePhoto() {
  shutterBtn.disabled = true;
  
  // Efek flash visual shutter
  cameraVideo.style.opacity = '0.3';
  setTimeout(() => cameraVideo.style.opacity = '1', 80);

  try {
    const rawBlob = await captureFrameBlob(cameraVideo);
    showToast('Memproses foto...', 'info');
    
    resetStepIndicators();
    updateStepIndicator('extract', 'done'); // Frame berhasil diambil

    await pipelineProcessAndQueue(rawBlob, null, true);
    showToast('Foto ditambahkan ke antrean upload.', 'success');
  } catch (err) {
    showToast('Gagal jepret foto: ' + err.message, 'error');
  } finally {
    shutterBtn.disabled = false;
  }
}

function toggleAutoCapture() {
  if (autoCapture.isActive) {
    autoCapture.stop();
    autoCaptureHud.classList.add('d-none');
    startAutoBtn.textContent = 'Auto Capture';
    startAutoBtn.classList.remove('btn-danger');
    showToast('Auto Capture dihentikan.', 'warning');
  } else {
    const intervalMs = Number(autoCaptureInterval.value);
    autoCaptureHud.classList.remove('d-none');
    startAutoBtn.textContent = 'Stop Auto';
    startAutoBtn.classList.add('btn-danger');
    showToast('Auto Capture dimulai.', 'success');

    autoCapture.start(
      cameraVideo,
      intervalMs,
      async (blob) => {
        resetStepIndicators();
        updateStepIndicator('extract', 'done');
        await pipelineProcessAndQueue(blob);
      },
      (stats) => {
        hudPhotosCount.textContent = `${stats.capturedCount} Foto`;
        hudTimer.textContent = stats.formattedTime;
      }
    );
  }
}

async function handleBurstCapture() {
  triggerBurstBtn.disabled = true;
  const count = Number(burstCountSelector.value);
  showToast(`Memulai Burst Mode: ${count} foto...`, 'info');

  try {
    await triggerBurst(cameraVideo, count, async (blob, index) => {
      // Efek shutter flash kecil
      cameraVideo.style.opacity = '0.4';
      setTimeout(() => cameraVideo.style.opacity = '1', 50);
      
      resetStepIndicators();
      updateStepIndicator('extract', 'done');
      await pipelineProcessAndQueue(blob, null, true);
      showToast(`Burst ${index}/${count} berhasil dijepret.`, 'info');
    });
    showToast('Burst selesai. Memproses sisa upload...', 'success');
  } catch (err) {
    showToast('Gagal Burst Capture.', 'error');
  } finally {
    triggerBurstBtn.disabled = false;
  }
}

/* ==========================================================================
   MODE 2: REKAM VIDEO (DIRECT MEDIARECORDER)
   ========================================================================== */

let recordedVideoBlob = null;

async function initVideoRecorderCamera() {
  try {
    cameraStream = await startCamera(recordVideoEl, activeFacingMode);
    recordResolution.textContent = `${recordVideoEl.videoWidth}x${recordVideoEl.videoHeight}`;
  } catch (err) {
    showToast('Kamera perekam gagal diaktifkan.', 'error');
  }
}

function handleStartRecord() {
  if (!cameraStream) {
    showToast('Kamera belum aktif.', 'warning');
    return;
  }
  
  recordedVideoBlob = null;
  videoRecorder.start(cameraStream, (stats) => {
    recordTimer.textContent = stats.formattedTime;
    recordSize.textContent = stats.formattedSize;
    recordResolution.textContent = stats.resolution;
    recordFps.textContent = `${stats.fps} FPS`;
  });

  recordHud.classList.remove('d-none');
  postRecordControls.classList.add('d-none');
  playbackVideoEl.classList.add('d-none');
  recordVideoEl.classList.remove('d-none');

  startRecordBtn.classList.add('d-none');
  stopRecordBtn.classList.remove('d-none');
  pauseRecordBtn.classList.remove('d-none');
  pauseRecordBtn.textContent = 'Pause';
}

function handlePauseRecord() {
  if (videoRecorder.state === 'recording') {
    videoRecorder.pause();
    pauseRecordBtn.textContent = 'Resume';
    showToast('Perekaman dijeda.', 'info');
  } else if (videoRecorder.state === 'paused') {
    videoRecorder.resume();
    pauseRecordBtn.textContent = 'Pause';
    showToast('Perekaman dilanjutkan.', 'success');
  }
}

async function handleStopRecord() {
  try {
    recordedVideoBlob = await videoRecorder.stop();
    showToast('Perekaman selesai.', 'success');
    
    // Tampilkan preview video player
    playbackVideoEl.src = URL.createObjectURL(recordedVideoBlob);
    playbackVideoEl.classList.remove('d-none');
    recordVideoEl.classList.add('d-none');
    
    recordHud.classList.add('d-none');
    stopRecordBtn.classList.add('d-none');
    pauseRecordBtn.classList.add('d-none');
    postRecordControls.classList.remove('d-none');
  } catch (err) {
    showToast('Gagal menghentikan perekaman.', 'error');
  }
}

function handleReRecord() {
  handleDeleteRecord();
  handleStartRecord();
}

function handleDeleteRecord() {
  if (playbackVideoEl.src) {
    URL.revokeObjectURL(playbackVideoEl.src);
    playbackVideoEl.src = '';
  }
  recordedVideoBlob = null;
  playbackVideoEl.classList.add('d-none');
  recordVideoEl.classList.remove('d-none');
  postRecordControls.classList.add('d-none');
  startRecordBtn.classList.remove('d-none');
}

async function handleProcessRecordVideo() {
  if (!recordedVideoBlob) return;

  const extractFps = Number(recordExtractFps.value);
  const useFilter = recordFilterCheck.checked;
  const threshold = Number(recordThresholdRange.value);

  showToast('Memulai ekstraksi frame video...', 'info');
  
  // Set configuration untuk ekstraksi
  const config = {
    mode: 'fps',
    value: extractFps
  };

  await executeVideoFrameExtraction(recordedVideoBlob, config, useFilter, threshold);
  handleDeleteRecord(); // Bersihkan rekaman video setelah di-proses
}

/* ==========================================================================
   MODE 3: UPLOAD FOTO (GALLERY BATCH)
   ========================================================================== */

function handlePhotoSelection(files) {
  // Hanya simpan file image
  Array.from(files).forEach((file) => {
    if (file.type.startsWith('image/')) {
      selectedPhotoFiles.push(file);
    }
  });

  renderPhotoPreviews();
}

function renderPhotoPreviews() {
  uploadPhotoPreviewGrid.innerHTML = '';
  
  if (selectedPhotoFiles.length === 0) {
    uploadPhotoPreviewSection.classList.add('d-none');
    return;
  }

  uploadPhotoPreviewSection.classList.remove('d-none');
  uploadPhotoCount.textContent = `${selectedPhotoFiles.length} Foto Terpilih`;

  selectedPhotoFiles.forEach((file, index) => {
    const card = document.createElement('div');
    card.className = 'preview-thumb-card';
    
    const img = document.createElement('img');
    const url = URL.createObjectURL(file);
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'thumb-remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedPhotoFiles.splice(index, 1);
      renderPhotoPreviews();
    });

    card.appendChild(img);
    card.appendChild(removeBtn);
    uploadPhotoPreviewGrid.appendChild(card);
  });
}

function clearPhotoSelection() {
  selectedPhotoFiles = [];
  renderPhotoPreviews();
  fileInputPhoto.value = '';
}

async function handleUploadSelectedPhotos() {
  if (selectedPhotoFiles.length === 0) return;

  const total = selectedPhotoFiles.length;
  showToast(`Memulai proses upload ${total} foto...`, 'info');
  
  resetSessionStats();
  initProgressPanel(total);

  updateStepIndicator('extract', 'running');
  for (let i = 0; i < total; i++) {
    const file = selectedPhotoFiles[i];
    updateStepIndicator('extract', 'done'); // File sudah ada / diekstrak
    
    // Kirim langsung ke pipeline
    await pipelineProcessAndQueue(file, file.name, true);
    
    updateProgressPercent(i + 1, total);
  }

  showToast('Selesai memproses semua foto.', 'success');
  clearPhotoSelection();
  completeProgressPanel();
}

/* ==========================================================================
   MODE 4: UPLOAD VIDEO & FRAME EXTRACTION PIPELINE
   ========================================================================== */

async function handleVideoSelection(files) {
  const file = files[0];
  if (!file || !file.type.startsWith('video/')) {
    showToast('Silakan pilih file video yang valid.', 'warning');
    return;
  }

  selectedVideoFile = file;
  showToast('Membaca metadata video...', 'info');

  try {
    selectedVideoMetadata = await getVideoMetadata(file);
    
    // Tampilkan panel info metadata
    videoMetaName.textContent = file.name;
    videoMetaSize.textContent = formatSize(file.size);
    videoMetaDuration.textContent = formatTime(selectedVideoMetadata.duration);
    videoMetaResolution.textContent = `${selectedVideoMetadata.width}x${selectedVideoMetadata.height}`;
    videoMetaFps.textContent = `${selectedVideoMetadata.approxFps} FPS`;
    
    videoMetadataSection.classList.remove('d-none');
    dropZoneVideo.classList.add('d-none');
    
    // Trigger update estimasi awal
    updateVideoEstimation();
  } catch (err) {
    showToast(err.message, 'error');
    clearVideoSelection();
  }
}

function clearVideoSelection() {
  selectedVideoFile = null;
  selectedVideoMetadata = null;
  videoMetadataSection.classList.add('d-none');
  dropZoneVideo.classList.remove('d-none');
  fileInputVideo.value = '';
}

function handleVideoExtractModeChange(e) {
  if (e.target.value === 'fps') {
    videoFpsContainer.classList.remove('d-none');
    videoIntervalContainer.classList.add('d-none');
  } else {
    videoFpsContainer.add('d-none');
    videoIntervalContainer.classList.remove('d-none');
    // error fallback
    videoFpsContainer.classList.add('d-none');
  }
  updateVideoEstimation();
}

function updateVideoEstimation() {
  if (!selectedVideoMetadata) return;

  const mode = videoExtractMode.value;
  const val = mode === 'fps' ? Number(videoFpsSelect.value) : Number(videoIntervalSelect.value);

  const estimation = estimateExtraction(selectedVideoMetadata, {
    mode,
    value: val
  });

  estOriginalFps.textContent = `${estimation.approxFps} FPS`;
  estFrames.textContent = `${estimation.estimatedFrames} Frame`;
  estStorage.textContent = `~${estimation.estimatedStorage}`;
  estTime.textContent = `~${estimation.formattedEstimatedTime}`;
}

async function handleExtractVideoFrames() {
  if (!selectedVideoFile || !selectedVideoMetadata) return;

  const mode = videoExtractMode.value;
  const val = mode === 'fps' ? Number(videoFpsSelect.value) : Number(videoIntervalSelect.value);
  const useFilter = videoFilterCheck.checked;
  const threshold = Number(videoThresholdRange.value);

  const config = { mode, value: val };
  
  await executeVideoFrameExtraction(selectedVideoFile, config, useFilter, threshold);
  clearVideoSelection();
}

/**
 * Ekstraksi Frame Video Bersama (dipakai oleh Mode Video Recorder & Mode Upload Video)
 */
async function executeVideoFrameExtraction(videoBlob, config, useFilter, threshold) {
  resetSessionStats();
  
  // Set threshold filter
  smartFilter.setThreshold(threshold);
  smartFilter.reset();

  try {
    const metadata = await getVideoMetadata(videoBlob);
    const estimation = estimateExtraction(metadata, config);
    
    initProgressPanel(estimation.estimatedFrames);
    updateStepIndicator('extract', 'running');

    // Naming pattern untuk frame hasil ekstraksi
    const videoBaseName = videoBlob.name 
      ? videoBlob.name.replace(/\.[^/.]+$/, "") 
      : `video_${Date.now()}`;

    // Ekstrak frame berurutan
    await extractFrames(
      videoBlob,
      config,
      async (frameBlob, timestamp, frameIndex) => {
        sessionStats.extracted++;
        updateStepIndicator('extract', 'done');

        // Smart Similarity Filter
        if (useFilter) {
          const keep = await smartFilter.shouldKeepFrame(frameBlob);
          if (!keep) {
            console.log(`Frame pada ${timestamp.toFixed(2)}s mirip dengan sebelumnya, di-skip.`);
            sessionStats.discarded++;
            return;
          }
        }

        const paddedIdx = String(frameIndex).padStart(4, '0');
        const frameFileName = `${datasetSlug}_${videoBaseName}_f${paddedIdx}.jpg`;
        
        // Kirim ke image processing & upload queue
        await pipelineProcessAndQueue(frameBlob, frameFileName);
      },
      (current, total, percent) => {
        updateProgressPercent(current, total);
      }
    );

    showToast('Ekstraksi frame video selesai.', 'success');
    completeProgressPanel();

  } catch (err) {
    console.error(err);
    showToast('Gagal memproses video: ' + err.message, 'error');
    progressPanel.classList.add('d-none');
  }
}

/* ==========================================================================
   PROGRESS PANEL CONTROLS
   ========================================================================== */

function initProgressPanel(totalItems) {
  resetStepIndicators();
  progressBarInner.style.width = '0%';
  progressPercentText.textContent = '0%';
  progressStatusText.textContent = `Menyiapkan proses untuk ${totalItems} item...`;
  progressPanel.classList.remove('d-none');
  resultSummaryCard.classList.add('d-none');
}

function updateProgressPercent(current, total) {
  const pct = Math.round((current / total) * 100);
  progressBarInner.style.width = `${pct}%`;
  progressPercentText.textContent = `${pct}%`;
  progressStatusText.textContent = `Memproses: ${current} dari ${total} item...`;
}

function updateStepIndicator(stepId, state) {
  const element = document.getElementById(`step-${stepId}`);
  if (!element) return;

  if (state === 'running') {
    element.className = 'progress-step-item active';
  } else if (state === 'done') {
    element.className = 'progress-step-item done';
  } else {
    element.className = 'progress-step-item';
  }
}

function resetStepIndicators() {
  const steps = ['extract', 'process', 'compress', 'upload', 'verification'];
  steps.forEach(step => updateStepIndicator(step, 'idle'));
}

function completeProgressPanel() {
  progressStatusText.textContent = 'Pemrosesan lokal selesai. Upload sedang berjalan di background queue...';
  progressBarInner.style.width = '100%';
  progressPercentText.textContent = '100%';
  
  // Berikan status verifikasi sukses
  updateStepIndicator('verification', 'done');

  setTimeout(() => {
    progressPanel.classList.add('d-none');
    renderResultSummary();
  }, 3000);
}

/* ==========================================================================
   UPLOAD RESULT SUMMARY CARD
   ========================================================================== */

function resetSessionStats() {
  sessionStats = { extracted: 0, saved: 0, discarded: 0, beforeSize: 0, afterSize: 0 };
}

function renderResultSummary() {
  resExtracted.textContent = sessionStats.extracted;
  resSaved.textContent = sessionStats.saved;
  resDiscarded.textContent = sessionStats.discarded;
  
  resBeforeSize.textContent = formatSize(sessionStats.beforeSize);
  resAfterSize.textContent = formatSize(sessionStats.afterSize);

  // Hitung penghematan penyimpanan (%)
  if (sessionStats.beforeSize > 0) {
    const percent = Math.round(((sessionStats.beforeSize - sessionStats.afterSize) / sessionStats.beforeSize) * 100);
    resSavingPercent.textContent = `${percent}% Lebih Hemat`;
  } else {
    resSavingPercent.textContent = '0% Hemat';
  }

  resultSummaryCard.classList.remove('d-none');
}

/* ==========================================================================
   UPLOAD QUEUE PROGRESS DISPLAY (HUD)
   ========================================================================== */

function renderUploadProgress(stats) {
  // Jika sedang aktif upload antrean, kita update subtitle halaman
  if (stats.uploadingCount > 0 || stats.pendingCount > 0) {
    let failText = '';
    if (stats.failedCount > 0) {
      failText = `, <span style="color:var(--danger-color)">${stats.failedCount} gagal</span>`;
    }
    datasetSubtitleDisplay.innerHTML = `
      <span class="loading-spinner" style="display:inline-block; margin-right:4px;">⏳</span> 
      Mengunggah: ${stats.completedCount}/${stats.totalCount} foto (${stats.progressPercent}%)${failText}
    `;
    
    // Tampilkan notifikasi offline jika terputus
    if (!stats.isOnline) {
      datasetSubtitleDisplay.innerHTML = `<span style="color:var(--danger-color)">⚠️ Offline.</span> Upload ditunda ke antrean.`;
    }
  } else if (stats.failedCount > 0) {
    datasetSubtitleDisplay.innerHTML = `
      <span style="color:var(--danger-color)">⚠️ ${stats.failedCount} foto gagal diunggah.</span> 
      <button id="retry-failed-btn" style="background:var(--warning-color); color:#fff; border:none; padding:4px 10px; border-radius:6px; cursor:pointer; margin-left:8px; font-family:var(--font-main); font-size:12px; font-weight:500;">Coba Lagi</button>
    `;
    
    // Pasang listener secara dinamis
    const btn = document.getElementById('retry-failed-btn');
    if (btn) {
      btn.onclick = () => {
        showToast('Mencoba kembali mengunggah file yang gagal...', 'info');
        uploadQueue.retryAllFailed();
      };
    }
  } else {
    // Kembalikan ke format info normal jika antrean kosong dan tidak ada yang gagal
    const totalPhotos = datasetPhotos.length;
    const totalBytes = datasetPhotos.reduce((sum, p) => sum + (p.file_size || 0), 0);
    const totalKB = (totalBytes / 1024).toFixed(0);
    datasetSubtitleDisplay.textContent = `Penyimpanan: ~${totalKB} KB | Jumlah: ${totalPhotos} foto`;
  }
}

/* ==========================================================================
   RENDERING PHOTO GALLERY
   ========================================================================== */

function renderGallery() {
  const totalPhotos = datasetPhotos.length;
  galleryCount.textContent = `${totalPhotos} Foto`;
  
  const totalBytes = datasetPhotos.reduce((sum, p) => sum + (p.file_size || 0), 0);
  const totalKB = (totalBytes / 1024).toFixed(0);
  datasetSubtitleDisplay.textContent = `Penyimpanan: ~${totalKB} KB | Jumlah: ${totalPhotos} foto`;

  if (totalPhotos === 0) {
    thumbnailGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 0;">
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <h3>Belum Ada Foto</h3>
        <p>Silakan ambil foto atau ekstrak dari video menggunakan tab menu di atas.</p>
      </div>
    `;
    if (isSelectMode) exitSelectMode();
    return;
  }

  thumbnailGrid.innerHTML = '';
  datasetPhotos.forEach((photo) => {
    const card = document.createElement('div');
    const isSelected = selectedPhotoIds.has(photo.id);
    card.className = `thumbnail-card ${isSelectMode ? 'selectable' : ''} ${isSelected ? 'selected' : ''}`;
    card.setAttribute('data-id', photo.id);

    // Ambil path thumbnail yang seragam (thumbnails/filename)
    const thumbnailPath = photo.storage_path.replace(/([^/]+)$/, 'thumbnails/$1');
    const thumbUrl = getPhotoPublicUrl({ ...photo, storage_path: thumbnailPath });

    // Ambil path foto utama sebagai fallback jika thumbnail gagal dimuat
    const mainUrl = getPhotoPublicUrl(photo);
      
    const sizeKB = photo.file_size ? `${(photo.file_size / 1024).toFixed(0)}KB` : '';
    const provider = photo.storage_provider || 'supabase';
    const providerBadge = provider === 'huggingface'
      ? '<span class="provider-badge hf" style="position: absolute; top: 8px; left: 8px; background: rgba(16, 185, 129, 0.95); color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; z-index: 5;">HF</span>'
      : '<span class="provider-badge supabase" style="position: absolute; top: 8px; left: 8px; background: rgba(245, 158, 11, 0.95); color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; z-index: 5;">Local</span>';

    card.innerHTML = `
      ${providerBadge}
      <img src="${thumbUrl}" alt="${photo.file_name}" loading="lazy" onerror="this.onerror=null; this.src='${mainUrl}';">
      <div class="select-indicator"></div>
      <button class="photo-delete-btn" title="Hapus foto" aria-label="Hapus foto">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
      <div class="thumbnail-info-overlay">
        <div class="thumbnail-filename">${escapeHTML(photo.file_name)}</div>
        <span class="thumbnail-status-badge success">
          ${sizeKB}
        </span>
      </div>
    `;

    // Click handler pada card untuk select mode
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (isSelectMode) {
        togglePhotoSelection(photo.id);
      }
    });

    // Aksi hapus foto tunggal dengan modal custom confirm
    card.querySelector('.photo-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeletePhoto(photo.id, photo.storage_path);
    });

    thumbnailGrid.appendChild(card);
  });
}

async function handleDeletePhoto(photoId, storagePath) {
  const confirmed = await showConfirm({
    title: 'Hapus Foto',
    message: 'Apakah Anda yakin ingin menghapus foto produk ini dari dataset?',
    confirmText: 'Hapus',
    isDanger: true
  });

  if (!confirmed) return;

  const card = document.querySelector(`.thumbnail-card[data-id="${photoId}"]`);
  if (card) {
    card.style.opacity = '0.3';
  }

  try {
    await deletePhoto(photoId, storagePath);
    
    // Refresh local list & gallery
    datasetPhotos = datasetPhotos.filter((p) => p.id !== photoId);
    renderGallery();
    showToast('Foto berhasil dihapus.', 'success');
  } catch (err) {
    showToast('Gagal menghapus foto: ' + err.message, 'error');
    if (card) card.style.opacity = '1';
  }
}

/* ==========================================================================
   ZIP DOWNLOAD ACTION
   ========================================================================== */

async function handleDownloadZip() {
  if (datasetPhotos.length === 0) {
    showToast('Dataset kosong. Tidak ada foto untuk diunduh.', 'warning');
    return;
  }

  const dataset = { id: datasetId, slug: datasetSlug, name: datasetName };
  const toast = showToast(`Menyiapkan ZIP untuk ${dataset.name || dataset.slug}...`, 'info');

  try {
    await downloadDatasetZip(dataset, (current, total, filename) => {
      toast.update(`Mengunduh foto: ${current}/${total} (${filename})`);
    });
    toast.update('File ZIP berhasil dibuat dan diunduh!', 'success');
  } catch (error) {
    toast.update(`Gagal membuat ZIP: ${error.message}`, 'error');
  }
}

/* ==========================================================================
   HELPERS & FORMATTERS
   ========================================================================== */

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ==========================================================================
   FITUR SINKRONISASI DATABASE & STORAGE
   ========================================================================== */

let lastSyncData = null;

async function handleCheckSync() {
  checkSyncBtn.disabled = true;
  checkSyncBtn.innerHTML = '⏳ Memeriksa...';
  syncStatusPanel.classList.remove('d-none');
  syncStatusDetails.innerHTML = 'Menghubungkan ke database dan storage Supabase...';
  repairSyncBtn.classList.add('d-none');

  try {
    const syncData = await checkDatasetSync(datasetId, datasetSlug);
    lastSyncData = syncData;

    if (syncData.isSynced) {
      syncStatusDetails.innerHTML = `
        <span style="color: var(--success-color); font-weight: 600;">✔️ Sinkron</span><br>
        Database: ${syncData.dbCount} record | Storage: ${syncData.storageCount} file (${syncData.thumbnailCount} thumbnail).
      `;
    } else {
      let issues = [];
      if (syncData.missingInStorage.length > 0) {
        issues.push(`${syncData.missingInStorage.length} record DB kehilangan file`);
      }
      if (syncData.orphansInStorage.length > 0) {
        issues.push(`${syncData.orphansInStorage.length} file di Storage tidak terdaftar di DB`);
      }
      if (syncData.duplicateDbRecords && syncData.duplicateDbRecords.length > 0) {
        issues.push(`${syncData.duplicateDbRecords.length} record DB duplikat (akan dibersihkan)`);
      }
      
      syncStatusDetails.innerHTML = `
        <span style="color: var(--danger-color); font-weight: 600;">⚠️ Ada perbedaan data!</span> (${issues.join(', ')})<br>
        Database: ${syncData.dbCount} record | Storage: ${syncData.storageCount} file.
      `;
      repairSyncBtn.classList.remove('d-none');
    }
  } catch (err) {
    console.error(err);
    syncStatusDetails.innerHTML = `<span style="color: var(--danger-color)">Gagal memeriksa sinkronisasi: ${err.message}</span>`;
  } finally {
    checkSyncBtn.disabled = false;
    checkSyncBtn.innerHTML = '🔄 Cek Sinkronisasi';
  }
}

async function handleRepairSync() {
  if (!lastSyncData) return;
  
  repairSyncBtn.disabled = true;
  repairSyncBtn.innerHTML = '⏳ Menyelaraskan...';
  showToast('Memulai sinkronisasi paksa...', 'info');

  try {
    const updatedPhotos = await repairDatasetSync(datasetId, datasetSlug, lastSyncData);
    datasetPhotos = updatedPhotos;
    renderGallery();
    
    showToast('Sinkronisasi selesai! Semua data kini selaras.', 'success');
    
    syncStatusDetails.innerHTML = `
      <span style="color: var(--success-color); font-weight: 600;">✔️ Sukses Disinkronkan</span><br>
      Semua record dan file fisik sekarang selaras (${updatedPhotos.length} foto).
    `;
    repairSyncBtn.classList.add('d-none');
    
    setTimeout(() => {
      syncStatusPanel.classList.add('d-none');
    }, 4000);
  } catch (err) {
    console.error(err);
    showToast(`Gagal menyelaraskan data: ${err.message}`, 'error');
    repairSyncBtn.disabled = false;
    repairSyncBtn.innerHTML = 'Sinkronkan Sekarang';
  }
}

async function handleSyncHF() {
  if (syncHfBtn.disabled) return;

  // Cek apakah ada foto yang butuh disinkronisasi
  const unsyncedPhotos = datasetPhotos.filter(p => p.storage_provider === 'supabase');
  if (unsyncedPhotos.length === 0) {
    showToast('Semua foto sudah tersinkronisasi di Hugging Face.', 'info');
    return;
  }

  const confirmed = await showConfirm({
    title: 'Sinkronisasi Hugging Face',
    message: `Apakah Anda yakin ingin memindahkan seluruh (${unsyncedPhotos.length}) foto di Supabase Storage ke repositori Hugging Face dalam satu komit batch?<br><br>Tindakan ini akan mengosongkan penyimpanan Supabase Anda secara aman.`,
    confirmText: 'Mulai Sinkronisasi',
    isDanger: false
  });

  if (!confirmed) return;

  syncHfBtn.disabled = true;
  syncHfBtn.innerHTML = '⏳ Sinkronisasi...';

  // Tampilkan progress panel
  initProgressPanel(unsyncedPhotos.length);
  updateProgressPercent(0, unsyncedPhotos.length);
  updateStepIndicator('extract', 'running');
  updateStepIndicator('process', 'running');
  updateStepIndicator('compress', 'running');
  updateStepIndicator('upload', 'running');

  try {
    const result = await syncDatasetToHF(datasetId, datasetSlug, (current, total, statusText) => {
      updateProgressPercent(current, total);
      progressStatusText.textContent = statusText;
    });

    updateStepIndicator('verification', 'done');
    completeProgressPanel();

    if (result.syncedCount > 0) {
      showToast(`🎉 Sukses mensinkronkan ${result.syncedCount} foto ke Hugging Face!`, 'success');
      // Reload daftar foto
      await loadPhotos();
    } else {
      showToast('Semua foto sudah tersinkronisasi di Hugging Face.', 'info');
    }
  } catch (err) {
    console.error(err);
    showToast(`Gagal sinkronisasi ke HF: ${err.message}`, 'error');
  } finally {
    progressPanel.classList.add('d-none');
    syncHfBtn.disabled = false;
    syncHfBtn.innerHTML = '☁️ Sinkronkan ke HF';
  }
}


/* ==========================================================================
   FITUR SELEKSI MULTIPEL & HAPUS MASSAL (BULK DELETE)
   ========================================================================== */

function enterSelectMode() {
  isSelectMode = true;
  selectedPhotoIds.clear();
  
  // Update tampilan tombol
  selectionActions.classList.remove('d-none');
  selectionActions.style.display = 'flex';
  toggleSelectModeBtn.classList.add('d-none');
  checkSyncBtn.classList.add('d-none');
  
  updateSelectionUI();
  renderGallery();
}

function exitSelectMode() {
  isSelectMode = false;
  selectedPhotoIds.clear();
  
  // Kembalikan tampilan tombol
  selectionActions.classList.add('d-none');
  selectionActions.style.display = 'none';
  toggleSelectModeBtn.classList.remove('d-none');
  checkSyncBtn.classList.remove('d-none');
  
  renderGallery();
}

function togglePhotoSelection(photoId) {
  if (selectedPhotoIds.has(photoId)) {
    selectedPhotoIds.delete(photoId);
  } else {
    selectedPhotoIds.add(photoId);
  }
  
  // Update UI card secara instan tanpa re-render penuh demi performa
  const card = document.querySelector(`.thumbnail-card[data-id="${photoId}"]`);
  if (card) {
    card.classList.toggle('selected');
  }
  
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = selectedPhotoIds.size;
  deleteSelectedBtn.textContent = `🗑️ Hapus Terpilih (${count})`;
  deleteSelectedBtn.disabled = count === 0;
  
  // Ubah teks Pilih Semua menjadi Batal Pilih Semua jika semua sudah terpiih
  if (count === datasetPhotos.length && datasetPhotos.length > 0) {
    selectAllBtn.textContent = '☑️ Batal Pilih Semua';
  } else {
    selectAllBtn.textContent = '☑️ Pilih Semua';
  }
}

function handleSelectAll() {
  if (selectedPhotoIds.size === datasetPhotos.length) {
    // Jika semua sudah terpilih, hapus semua pilihan
    selectedPhotoIds.clear();
  } else {
    // Pilih semua foto
    datasetPhotos.forEach(photo => selectedPhotoIds.add(photo.id));
  }
  
  updateSelectionUI();
  renderGallery();
}

async function handleDeleteSelected() {
  if (selectedPhotoIds.size === 0) return;
  
  const totalToDelete = selectedPhotoIds.size;
  const confirmed = await showConfirm({
    title: 'Hapus Foto Massal',
    message: `Apakah Anda yakin ingin menghapus ${totalToDelete} foto terpilih dari dataset secara permanen?`,
    confirmText: 'Hapus Semua',
    isDanger: true
  });
  
  if (!confirmed) return;
  
  // Set tombol loading
  deleteSelectedBtn.disabled = true;
  deleteSelectedBtn.innerHTML = '⏳ Menghapus...';
  
  const toast = showToast(`Menghapus ${totalToDelete} foto...`, 'info');
  
  const idsToDelete = Array.from(selectedPhotoIds);
  let successCount = 0;
  
  for (const photoId of idsToDelete) {
    const photo = datasetPhotos.find(p => p.id === photoId);
    if (photo) {
      const card = document.querySelector(`.thumbnail-card[data-id="${photoId}"]`);
      if (card) card.style.opacity = '0.3';
      
      try {
        await deletePhoto(photoId, photo.storage_path);
        successCount++;
        datasetPhotos = datasetPhotos.filter(p => p.id !== photoId);
      } catch (err) {
        console.error(`Gagal menghapus foto ${photo.file_name}:`, err);
        if (card) card.style.opacity = '1';
      }
    }
  }
  
  toast.update(`Berhasil menghapus ${successCount} dari ${totalToDelete} foto.`, 'success');
  
  exitSelectMode();
}
