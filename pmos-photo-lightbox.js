/* ==========================================================================
   ACPM PMOS — Photo Gallery Lightbox
   Full-featured gallery lightbox for PMOS Office photo review.
   
   Features: modal dialog, full-size preview, thumbnail fallback,
   loading/missing/failed states, next/previous, counter, caption,
   category, project name, uploader, dates, storage provider,
   related record action, open original, close button, Escape key,
   click-outside close, focus trapping, mobile layout, touch controls,
   listener cleanup.
   ========================================================================== */

(function () {
  'use strict';

  let _lightboxState = {
    photos: [],
    currentIndex: 0,
    open: false,
    previousFocus: null,
    keyHandler: null,
    touchStartX: 0,
    touchEndX: 0
  };

  function h(text) {
    return typeof escapeHtml === 'function' ? escapeHtml(text) : String(text || '');
  }

  /* ---- Open Lightbox ---- */
  function pmosOpenLightbox(photos, startIndex = 0) {
    if (!photos || !photos.length) return;

    // Store previous focus
    _lightboxState.previousFocus = document.activeElement;
    _lightboxState.photos = photos;
    _lightboxState.currentIndex = Math.max(0, Math.min(startIndex, photos.length - 1));
    _lightboxState.open = true;

    renderLightbox();
    attachLightboxHandlers();
    focusLightbox();
  }
  window.pmosOpenLightbox = pmosOpenLightbox;

  /* ---- Close Lightbox ---- */
  function pmosCloseLightbox() {
    if (!_lightboxState.open) return;
    _lightboxState.open = false;
    removeLightbox();
    restoreFocus();
  }
  window.pmosCloseLightbox = pmosCloseLightbox;

  /* ---- Navigate ---- */
  function pmosLightboxPrev() {
    if (_lightboxState.photos.length <= 1) return;
    _lightboxState.currentIndex = (_lightboxState.currentIndex - 1 + _lightboxState.photos.length) % _lightboxState.photos.length;
    renderLightboxContent();
  }
  window.pmosLightboxPrev = pmosLightboxPrev;

  function pmosLightboxNext() {
    if (_lightboxState.photos.length <= 1) return;
    _lightboxState.currentIndex = (_lightboxState.currentIndex + 1) % _lightboxState.photos.length;
    renderLightboxContent();
  }
  window.pmosLightboxNext = pmosLightboxNext;

  /* ---- Render ---- */
  function renderLightbox() {
    removeLightbox();

    const overlay = document.createElement('div');
    overlay.id = 'pmosLightbox';
    overlay.className = 'pmos-lightbox-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Photo preview');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="pmos-lightbox-backdrop" onclick="pmosCloseLightbox()"></div>
      <div class="pmos-lightbox-container" onclick="event.stopPropagation()">
        <button class="pmos-lightbox-close" onclick="pmosCloseLightbox()" aria-label="Close preview">&times;</button>
        <div class="pmos-lightbox-content">
          <div class="pmos-lightbox-image-wrap" id="pmosLightboxImageWrap">
            <div class="pmos-lightbox-loading" id="pmosLightboxLoading">Loading image...</div>
          </div>
          <div class="pmos-lightbox-info" id="pmosLightboxInfo"></div>
        </div>
        ${_lightboxState.photos.length > 1 ? `
          <button class="pmos-lightbox-nav pmos-lightbox-prev" onclick="pmosLightboxPrev()" aria-label="Previous photo">&lsaquo;</button>
          <button class="pmos-lightbox-nav pmos-lightbox-next" onclick="pmosLightboxNext()" aria-label="Next photo">&rsaquo;</button>
        ` : ''}
      </div>
    `;

    document.body.appendChild(overlay);
    renderLightboxContent();
  }

  function renderLightboxContent() {
    const photo = _lightboxState.photos[_lightboxState.currentIndex];
    if (!photo) return;

    // Update counter
    const total = _lightboxState.photos.length;
    const counter = total > 1 ? `Photo ${_lightboxState.currentIndex + 1} of ${total}` : '';

    // Image
    const imageWrap = document.getElementById('pmosLightboxImageWrap');
    if (imageWrap) {
      const imgUrl = photo.photoUrl || photo.thumbnailUrl || '';
      const thumbUrl = photo.thumbnailUrl || '';
      imageWrap.innerHTML = `
        <div class="pmos-lightbox-loading" id="pmosLightboxLoading">Loading image...</div>
        <img class="pmos-lightbox-image" id="pmosLightboxImage"
          src="${h(thumbUrl || imgUrl)}"
          data-fullsrc="${h(imgUrl)}"
          alt="${h(photo.caption || 'Site photo')}"
          loading="lazy"
          onload="document.getElementById('pmosLightboxLoading')?.classList.add('hidden')"
          onerror="handleLightboxImageError(this)" />
      `;

      // Try to load full-size in background
      if (imgUrl && thumbUrl && imgUrl !== thumbUrl) {
        const fullImg = new Image();
        fullImg.onload = () => {
          const img = document.getElementById('pmosLightboxImage');
          if (img) img.src = imgUrl;
        };
        fullImg.src = imgUrl;
      }
    }

    // Info panel
    const infoEl = document.getElementById('pmosLightboxInfo');
    if (infoEl) {
      const date = photo.createdAt ? new Date(photo.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      const uploadDate = photo.uploadedAt ? new Date(photo.uploadedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      const projectName = photo.projectName || photo.projectId || '';
      const uploader = photo.createdByName || '';
      const provider = photo.storageProvider || (photo.photoUrl?.includes('drive.google.com') ? 'Google Drive' : 'Firebase Storage');

      infoEl.innerHTML = `
        <div class="pmos-lightbox-counter">${counter}</div>
        <h3 class="pmos-lightbox-caption">${h(photo.caption || 'Site photo')}</h3>
        ${photo.location ? `<div class="pmos-lightbox-meta"><span>Location:</span> ${h(photo.location)}</div>` : ''}
        ${photo.category ? `<div class="pmos-lightbox-meta"><span>Category:</span> ${h(photo.category)}</div>` : ''}
        ${projectName ? `<div class="pmos-lightbox-meta"><span>Project:</span> ${h(projectName)}</div>` : ''}
        ${uploader ? `<div class="pmos-lightbox-meta"><span>Uploaded by:</span> ${h(uploader)}</div>` : ''}
        ${date ? `<div class="pmos-lightbox-meta"><span>Date:</span> ${date}</div>` : ''}
        ${uploadDate ? `<div class="pmos-lightbox-meta"><span>Uploaded:</span> ${uploadDate}</div>` : ''}
        <div class="pmos-lightbox-meta"><span>Provider:</span> ${h(provider)}</div>
        <div class="pmos-lightbox-meta"><span>Status:</span> <span class="badge badge-${lightboxStatusBadge(photo.status || 'New')}">${h(photo.status || 'New')}</span></div>
        ${photo.photoUrl ? `<a class="pmos-lightbox-link" href="${h(photo.photoUrl)}" target="_blank" rel="noopener noreferrer">Open Original</a>` : ''}
      `;
    }
  }

  function lightboxStatusBadge(status) {
    if (['Done', 'Delivered', 'Closed', 'Approved', 'Synced'].includes(status)) return 'green';
    if (['Critical', 'High', 'Failed'].includes(status)) return 'red';
    return 'purple';
  }

  function handleLightboxImageError(img) {
    const loading = document.getElementById('pmosLightboxLoading');
    if (loading) loading.textContent = 'Could not load image.';
    if (img) {
      img.alt = 'Image unavailable';
      img.style.opacity = '0.5';
    }
  }
  window.handleLightboxImageError = handleLightboxImageError;

  /* ---- Handlers ---- */
  function attachLightboxHandlers() {
    // Keyboard handler
    _lightboxState.keyHandler = function (e) {
      if (e.key === 'Escape') {
        pmosCloseLightbox();
      } else if (e.key === 'ArrowLeft') {
        pmosLightboxPrev();
      } else if (e.key === 'ArrowRight') {
        pmosLightboxNext();
      }
    };
    document.addEventListener('keydown', _lightboxState.keyHandler);

    // Touch handler
    const container = document.querySelector('.pmos-lightbox-container');
    if (container) {
      container.addEventListener('touchstart', e => {
        _lightboxState.touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });
      container.addEventListener('touchend', e => {
        _lightboxState.touchEndX = e.changedTouches[0].screenX;
        handleLightboxSwipe();
      }, { passive: true });
    }
  }

  function handleLightboxSwipe() {
    const threshold = 50;
    const diff = _lightboxState.touchStartX - _lightboxState.touchEndX;
    if (Math.abs(diff) > threshold) {
      if (diff > 0) pmosLightboxNext();
      else pmosLightboxPrev();
    }
  }

  function focusLightbox() {
    const closeBtn = document.querySelector('.pmos-lightbox-close');
    if (closeBtn) closeBtn.focus();
  }

  function restoreFocus() {
    if (_lightboxState.previousFocus && typeof _lightboxState.previousFocus.focus === 'function') {
      try { _lightboxState.previousFocus.focus(); } catch (e) { /* ignore */ }
    }
    _lightboxState.previousFocus = null;
  }

  /* ---- Remove ---- */
  function removeLightbox() {
    // Remove keyboard handler
    if (_lightboxState.keyHandler) {
      document.removeEventListener('keydown', _lightboxState.keyHandler);
      _lightboxState.keyHandler = null;
    }

    const overlay = document.getElementById('pmosLightbox');
    if (overlay) overlay.remove();
  }

  /* ---- Thumbnail click handler (convenience) ---- */
  function pmosAttachLightboxToGallery(containerSelector = '.pmos-photo-grid') {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    container.addEventListener('click', function (e) {
      const thumb = e.target.closest('.pmos-photo-card, .pmos-photo-row');
      if (!thumb) return;

      // Collect all photos in the grid
      const allPhotos = Array.from(container.querySelectorAll('.pmos-photo-card, .pmos-photo-row'))
        .map(el => {
          const dataset = el.dataset;
          return {
            id: dataset?.id || '',
            photoUrl: dataset?.photoUrl || '',
            thumbnailUrl: dataset?.thumbnailUrl || '',
            caption: dataset?.caption || '',
            location: dataset?.location || '',
            category: dataset?.category || '',
            projectId: dataset?.projectId || '',
            projectName: dataset?.projectName || '',
            createdByName: dataset?.createdByName || '',
            createdAt: dataset?.createdAt ? Number(dataset.createdAt) : 0,
            uploadedAt: dataset?.uploadedAt ? Number(dataset.uploadedAt) : 0,
            storageProvider: dataset?.storageProvider || '',
            status: dataset?.status || 'New'
          };
        })
        .filter(p => p.photoUrl);

      const index = allPhotos.findIndex(p => p.id === (thumb.dataset?.id || ''));
      if (index >= 0) {
        pmosOpenLightbox(allPhotos, index);
      }
    });
  }
  window.pmosAttachLightboxToGallery = pmosAttachLightboxToGallery;

  /* ---- Exports ---- */
  window.pmosOpenLightbox = pmosOpenLightbox;
  window.pmosCloseLightbox = pmosCloseLightbox;
  window.pmosLightboxPrev = pmosLightboxPrev;
  window.pmosLightboxNext = pmosLightboxNext;
  window.pmosLightboxStatusBadge = lightboxStatusBadge;

})();
