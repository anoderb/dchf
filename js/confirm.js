/**
 * Reusable Custom Confirm Dialog using HTML modal backdrop
 */
export function showConfirm({ title, message, confirmText = 'Hapus', cancelText = 'Batal', isDanger = true }) {
  return new Promise((resolve) => {
    // 1. Buat elemen modal secara dinamis agar bisa digunakan di mana saja
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    
    const iconColor = isDanger ? 'var(--danger-color)' : 'var(--accent-color)';
    const btnClass = isDanger ? 'btn-danger' : 'btn-primary';
    
    backdrop.innerHTML = `
      <div class="modal-container" style="max-width: 400px; text-align: center;">
        <div class="modal-confirm-icon" style="margin: 0 auto 16px auto; background: ${isDanger ? 'rgba(239, 68, 68, 0.1)' : 'rgba(99, 102, 241, 0.1)'}; color: ${iconColor};">
          ${isDanger 
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
          }
        </div>
        <h3 class="modal-title" style="margin-bottom: 12px; font-size: 19px; width: 100%; text-align: center;">${title}</h3>
        <div class="modal-body" style="margin-bottom: 24px; text-align: center; color: var(--text-secondary);">${message}</div>
        <div class="modal-actions" style="justify-content: center; width: 100%; gap: 12px; margin-top: 0;">
          <button id="confirm-cancel-btn" class="btn btn-secondary" style="flex: 1; min-height: 44px;">${cancelText}</button>
          <button id="confirm-ok-btn" class="btn ${btnClass}" style="flex: 1; min-height: 44px;">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    
    // Pemicu animasi open modal
    setTimeout(() => {
      backdrop.classList.add('open');
    }, 10);

    const cleanup = (result) => {
      backdrop.classList.remove('open');
      const onAnimationEnd = () => {
        backdrop.remove();
        backdrop.removeEventListener('transitionend', onAnimationEnd);
        resolve(result);
      };
      backdrop.addEventListener('transitionend', onAnimationEnd);
    };

    backdrop.querySelector('#confirm-cancel-btn').addEventListener('click', () => cleanup(false));
    backdrop.querySelector('#confirm-ok-btn').addEventListener('click', () => cleanup(true));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup(false);
    });
  });
}
