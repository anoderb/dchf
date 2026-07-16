import { getDatasets, createDataset, updateDataset, deleteDataset, getLatestPhoto, supabase, getPhotoPublicUrl } from './supabase.js';
import { downloadDatasetZip, downloadAllDatasetsZip } from './download.js';
import { showConfirm } from './confirm.js';
import { showToast } from './toast.js';
import { HF_REPO, HF_TOKEN } from './config.js';

// State global halaman utama
let allDatasets = [];
let filteredDatasets = [];

// DOM Elements
const datasetGrid = document.getElementById('dataset-grid');
const searchInput = document.getElementById('search-input');
const datasetSummary = document.getElementById('dataset-summary');

// Buttons
const addDatasetDesktopBtn = document.getElementById('add-dataset-desktop-btn');
const downloadAllBtn = document.getElementById('download-all-btn');
const downloadAllMobileBtn = document.getElementById('download-all-mobile-header');

// Bottom Nav
const navHome = document.getElementById('nav-home');
const navAddDataset = document.getElementById('nav-add-dataset');

// Modal Elements
const datasetModal = document.getElementById('dataset-modal');
const modalTitle = document.getElementById('modal-title');
const datasetForm = document.getElementById('dataset-form');
const datasetIdInput = document.getElementById('dataset-id-input');
const datasetNameInput = document.getElementById('dataset-name-input');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');

/* ==========================================================================
   INITIALIZATION & DATA LOADING
   ========================================================================== */

async function loadData() {
  renderLoadingState();
  try {
    const datasets = await getDatasets();
    
    // Tambahkan link ke thumbnail terakhir untuk tiap dataset secara async paralel
    allDatasets = await Promise.all(
      datasets.map(async (dataset) => {
        try {
          const latestPhoto = await getLatestPhoto(dataset.id);
          let thumbnailUrl = null;
          if (latestPhoto) {
            // Ambil public url dari storage
            thumbnailUrl = getPhotoPublicUrl(latestPhoto.storage_path);
          }
          return { ...dataset, thumbnailUrl };
        } catch (e) {
          console.warn(`Gagal mengambil thumbnail untuk dataset ${dataset.name}:`, e);
          return { ...dataset, thumbnailUrl: null };
        }
      })
    );

    filteredDatasets = [...allDatasets];
    renderDatasets();
  } catch (error) {
    console.error('Error fetching datasets:', error);
    renderErrorState(error.message);
    showToast('Gagal memuat dataset dari database.', 'error');
  }
}

import { protectAccess } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
  protectAccess(() => {
    loadData();
    setupEventListeners();
  });
});

/* ==========================================================================
   RENDERING FUNCTIONS
   ========================================================================== */

function renderLoadingState() {
  datasetGrid.innerHTML = `
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="loading-spinner"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
      <h3>Memuat dataset...</h3>
      <p>Sedang menghubungkan ke Supabase database.</p>
    </div>
  `;
}

function renderErrorState(message) {
  datasetGrid.innerHTML = `
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--danger-color);"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <h3>Gagal Memuat Data</h3>
      <p>${message}</p>
      <button id="retry-load-btn" class="btn btn-primary btn-sm mt-4">Coba Lagi</button>
    </div>
  `;
  document.getElementById('retry-load-btn')?.addEventListener('click', loadData);
}

function renderDatasets() {
  // Update badge jumlah dataset
  datasetSummary.querySelector('span').textContent = allDatasets.length;

  if (filteredDatasets.length === 0) {
    datasetGrid.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
        <h3>Tidak Ada Dataset</h3>
        <p>${allDatasets.length === 0 ? 'Belum ada produk terdaftar. Silakan buat dataset pertama Anda!' : 'Hasil pencarian tidak cocok.'}</p>
        ${allDatasets.length === 0 ? '<button id="empty-state-add-btn" class="btn btn-primary btn-sm mt-4">Buat Dataset Baru</button>' : ''}
      </div>
    `;
    
    document.getElementById('empty-state-add-btn')?.addEventListener('click', openCreateModal);
    return;
  }

  datasetGrid.innerHTML = '';
  filteredDatasets.forEach(dataset => {
    const card = document.createElement('div');
    card.className = 'glass-card dataset-card';
    card.setAttribute('data-id', dataset.id);
    
    // Format timestamp
    const updateDate = new Date(dataset.updated_at).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

    // Markup thumbnail: render gambar jika ada, atau default icon kamera
    const thumbnailMarkup = dataset.thumbnailUrl
      ? `<img src="${dataset.thumbnailUrl}" alt="${dataset.name}" loading="lazy">`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

    card.innerHTML = `
      <div class="dataset-card-thumbnail">
        ${thumbnailMarkup}
      </div>
      <div class="dataset-info-header">
        <div class="dataset-name">${escapeHTML(dataset.name)}</div>
        <div class="photo-badge">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span>${dataset.photo_count}</span>
        </div>
      </div>
      <div class="dataset-meta">
        <span>Slug: <code>${dataset.slug}</code></span>
        <span>Diperbarui: ${updateDate}</span>
      </div>
      <div class="dataset-actions">
        <!-- Download ZIP -->
        <button class="btn btn-secondary btn-icon btn-sm action-download" title="Unduh ZIP" aria-label="Unduh ZIP">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <!-- Edit Name -->
        <button class="btn btn-secondary btn-icon btn-sm action-edit" title="Edit nama" aria-label="Edit nama">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
        <!-- Delete Dataset -->
        <button class="btn btn-danger btn-icon btn-sm action-delete" title="Hapus dataset" aria-label="Hapus dataset">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      </div>
    `;

    // Klik kartu untuk navigasi ke halaman kamera detail
    card.addEventListener('click', (e) => {
      // Abaikan jika user mengklik tombol aksi
      if (e.target.closest('.dataset-actions')) return;
      
      const targetUrl = `/dataset.html?id=${dataset.id}&slug=${dataset.slug}&name=${encodeURIComponent(dataset.name)}`;
      window.location.href = targetUrl;
    });

    // Binding Aksi Tombol
    card.querySelector('.action-download').addEventListener('click', (e) => {
      e.stopPropagation();
      handleDownloadZip(dataset);
    });

    card.querySelector('.action-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(dataset);
    });

    card.querySelector('.action-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteDataset(dataset);
    });

    datasetGrid.appendChild(card);
  });
}

/* ==========================================================================
   EVENT LISTENERS
   ========================================================================== */

function setupEventListeners() {
  // Search filter
  searchInput.addEventListener('input', handleSearch);

  // Trigger modals
  addDatasetDesktopBtn.addEventListener('click', openCreateModal);
  navAddDataset.addEventListener('click', openCreateModal);
  
  // Close modals
  modalCloseBtn.addEventListener('click', closeModal);
  modalCancelBtn.addEventListener('click', closeModal);
  datasetModal.addEventListener('click', (e) => {
    if (e.target === datasetModal) closeModal();
  });

  // Form submit
  datasetForm.addEventListener('submit', handleFormSubmit);

  // Mass downloads
  downloadAllBtn.addEventListener('click', handleDownloadAllZip);
  downloadAllMobileBtn.addEventListener('click', handleDownloadAllZip);

  // Refresh data ketika navigasi bottom nav Home di-klik
  navHome.addEventListener('click', () => {
    navHome.classList.add('active');
    navAddDataset.classList.remove('active');
    loadData();
  });
}

/* ==========================================================================
   ACTION HANDLERS
   ========================================================================== */

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  filteredDatasets = allDatasets.filter(dataset => 
    dataset.name.toLowerCase().includes(query) || 
    dataset.slug.toLowerCase().includes(query)
  );
  renderDatasets();
}

// Modal: Open Create
function openCreateModal() {
  navHome.classList.remove('active');
  navAddDataset.classList.add('active');

  modalTitle.textContent = 'Tambah Dataset';
  datasetIdInput.value = '';
  datasetNameInput.value = '';
  datasetModal.classList.add('open');
  datasetNameInput.focus();
}

// Modal: Open Edit
function openEditModal(dataset) {
  modalTitle.textContent = 'Edit Nama Dataset';
  datasetIdInput.value = dataset.id;
  datasetNameInput.value = dataset.name;
  datasetModal.classList.add('open');
  datasetNameInput.focus();
}

// Modal: Close
function closeModal() {
  datasetModal.classList.remove('open');
  datasetForm.reset();
  navHome.classList.add('active');
  navAddDataset.classList.remove('active');
}

// Form Submit (Create or Update)
async function handleFormSubmit(e) {
  e.preventDefault();
  const id = datasetIdInput.value;
  const name = datasetNameInput.value.trim();
  
  if (!name) return;

  const submitBtn = document.getElementById('modal-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Menyimpan...';

  try {
    if (id) {
      // Update Mode
      await updateDataset(id, name);
      showToast('Nama dataset berhasil diperbarui.', 'success');
    } else {
      // Create Mode
      await createDataset(name);
      showToast('Dataset baru berhasil dibuat.', 'success');
    }
    closeModal();
    await loadData();
  } catch (error) {
    console.error('Error saving dataset:', error);
    showToast(`Gagal menyimpan dataset: ${error.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan';
  }
}

// Delete Dataset with custom glassmorphism modal confirm
async function handleDeleteDataset(dataset) {
  const confirmed = await showConfirm({
    title: 'Hapus Dataset',
    message: `Apakah Anda yakin ingin menghapus dataset "${dataset.name}"?<br><br>Tindakan ini akan menghapus dataset dan seluruh (${dataset.photo_count}) foto di dalamnya secara permanen dari Storage dan Database.`,
    confirmText: 'Hapus Permanen',
    isDanger: true
  });

  if (!confirmed) return;

  const toast = showToast('Menghapus file storage...', 'info');

  try {
    // 1. Bersihkan file storage dan thumbnails terlebih dahulu
    if (HF_REPO) {
      const { listFiles, deleteFile } = await import('@huggingface/hub');
      try {
        const folderPath = `data/${dataset.slug}`;
        const filesToDelete = [];
        for await (const file of listFiles({
          repo: HF_REPO,
          repoType: 'dataset',
          credentials: { accessToken: HF_TOKEN },
          accessToken: HF_TOKEN,
          recursive: true
        })) {
          if (file.path.startsWith(`${folderPath}/`) && (file.type === 'file' || file.type === undefined)) {
            if (!file.path.endsWith('/')) {
              filesToDelete.push(file.path);
            }
          }
        }
        
        for (const filePath of filesToDelete) {
          await deleteFile({
            repo: HF_REPO,
            repoType: 'dataset',
            credentials: { accessToken: HF_TOKEN },
            accessToken: HF_TOKEN,
            path: filePath
          });
        }
      } catch (e) {
        console.warn('Gagal menghapus file dataset dari Hugging Face:', e);
      }
    } else {
      const { data: fileList, error: listError } = await supabase.storage
        .from('dataset-photos')
        .list(dataset.slug);

      if (!listError && fileList && fileList.length > 0) {
        const pathsToDelete = [];
        fileList.forEach(file => {
          pathsToDelete.push(`${dataset.slug}/${file.name}`);
        });
        
        // Hapus file thumbnails jika ada
        const { data: thumbList } = await supabase.storage
          .from('dataset-photos')
          .list(`${dataset.slug}/thumbnails`);
        
        if (thumbList && thumbList.length > 0) {
          thumbList.forEach(thumb => {
            pathsToDelete.push(`${dataset.slug}/thumbnails/${thumb.name}`);
          });
        }

        if (pathsToDelete.length > 0) {
          await supabase.storage.from('dataset-photos').remove(pathsToDelete);
        }
      }
    }

    // 2. Hapus baris di PostgreSQL (Cascade delete akan otomatis menghapus di tabel photos)
    await deleteDataset(dataset.id);
    
    toast.update('Dataset dan seluruh foto berhasil dihapus.', 'success');
    await loadData();
  } catch (error) {
    console.error('Error deleting dataset:', error);
    toast.update(`Gagal menghapus dataset: ${error.message}`, 'error');
  }
}

// Download single dataset ZIP
async function handleDownloadZip(dataset) {
  if (dataset.photo_count === 0) {
    showToast('Dataset kosong. Tidak ada foto untuk diunduh.', 'warning');
    return;
  }

  const toast = showToast(`Menyiapkan download untuk ${dataset.name}...`, 'info');

  try {
    await downloadDatasetZip(dataset, (current, total, filename) => {
      toast.update(`Mengunduh foto: ${current}/${total} (${filename})`);
    });
    toast.update('File ZIP berhasil dibuat dan diunduh!', 'success');
  } catch (error) {
    console.error('Error downloading ZIP:', error);
    toast.update(`Gagal membuat ZIP: ${error.message}`, 'error');
  }
}

// Download all datasets in nested ZIP
async function handleDownloadAllZip() {
  const totalPhotos = allDatasets.reduce((sum, d) => sum + (d.photo_count || 0), 0);
  if (totalPhotos === 0) {
    showToast('Belum ada foto di seluruh dataset untuk diunduh.', 'warning');
    return;
  }

  const toast = showToast('Mempersiapkan unduhan seluruh dataset...', 'info');

  try {
    await downloadAllDatasetsZip(allDatasets, (current, total, path) => {
      toast.update(`Mengunduh file: ${current}/${total}<br><span style="font-size:11px;color:var(--text-secondary)">${path}</span>`);
    });
    toast.update('Ekspor seluruh dataset ZIP selesai!', 'success');
  } catch (error) {
    console.error('Error downloading all ZIP:', error);
    toast.update(`Gagal mengunduh semua dataset: ${error.message}`, 'error');
  }
}

/* ==========================================================================
   HELPERS
   ========================================================================== */

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
