import { ACCESS_PASSWORD } from './config.js';

/**
 * Pelindung akses sederhana (Frontend Password Gate)
 * Mencegah akses publik yang tidak diotorisasi ke dataset collector.
 * @param {Function} onSuccess - Callback yang dipicu jika otentikasi berhasil
 */
export function protectAccess(onSuccess) {
  // Jika password tidak di-set di env (.env), bypass otentikasi
  if (!ACCESS_PASSWORD) {
    if (onSuccess) onSuccess();
    return;
  }

  // Cek apakah sesi auth tersimpan di localStorage
  const authPassed = localStorage.getItem('tokiva_auth_passed');
  if (authPassed === 'true') {
    if (onSuccess) onSuccess();
    return;
  }

  // Hentikan proses render halaman utama dengan menutupi layar secara dinamis
  createAuthOverlay(onSuccess);
}

/**
 * Membuat tampilan overlay input password di layar
 */
function createAuthOverlay(onSuccess) {
  const overlay = document.createElement('div');
  overlay.id = 'auth-gate-overlay';
  overlay.className = 'modal-backdrop open';
  overlay.style.zIndex = '9999'; // Sangat tinggi menutupi segalanya

  overlay.innerHTML = `
    <div class="modal-container" style="max-width: 360px; text-align: center; padding: 32px 24px;">
      <div style="font-size: 40px; margin-bottom: 16px;">🔐</div>
      <h3 style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #fff;">Akses Terbatas</h3>
      <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 24px;">
        Silakan masukkan password akses kasir Tokiva untuk melanjutkan.
      </p>
      
      <form id="auth-gate-form">
        <div class="form-group" style="margin-bottom: 16px;">
          <input type="password" id="auth-password-input" class="form-control" placeholder="Masukkan password..." required style="text-align: center; letter-spacing: 0.1em;" autocomplete="current-password">
          <div id="auth-error-msg" style="color: var(--danger-color); font-size: 12px; font-weight: 500; margin-top: 8px; display: none;">Password salah!</div>
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%; min-height: 44px;">Buka Akses</button>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  // Focus ke input field secara otomatis
  const passwordInput = overlay.querySelector('#auth-password-input');
  passwordInput.focus();

  const form = overlay.querySelector('#auth-gate-form');
  const errorMsg = overlay.querySelector('#auth-error-msg');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const enteredPassword = passwordInput.value.trim();

    if (enteredPassword === ACCESS_PASSWORD) {
      // Simpan status sukses auth ke localStorage
      localStorage.setItem('tokiva_auth_passed', 'true');
      
      // Animasi hilangkan overlay
      overlay.classList.remove('open');
      const onTransitionEnd = () => {
        overlay.remove();
        overlay.removeEventListener('transitionend', onTransitionEnd);
        
        // Picu callback inisialisasi load data asli halaman
        if (onSuccess) onSuccess();
      };
      overlay.addEventListener('transitionend', onTransitionEnd);
    } else {
      // Berikan efek getar visual dan tampilkan error
      errorMsg.style.display = 'block';
      passwordInput.classList.add('shake-input');
      passwordInput.value = '';
      passwordInput.focus();

      setTimeout(() => {
        passwordInput.classList.remove('shake-input');
      }, 500);
    }
  });
}
