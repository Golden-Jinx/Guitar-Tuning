/** Pointer and keyboard sorting for the tuning library. The caller owns ordering. */
export function setupTuningReorder(list, { onMove, onKeyboardMove } = {}) {
  const doc = list.ownerDocument;
  const view = doc.defaultView;
  let session = null;
  let frame = 0;
  let suppressClickUntil = 0;

  const rows = () => [...list.querySelectorAll('.preset-item[data-tuning-id]')]
    .filter(row => row.getClientRects().length && row.getBoundingClientRect().height > 0);

  function clearTarget(current) {
    current.target?.classList.remove('drop-before', 'drop-after');
    current.target = null;
    current.placement = null;
  }

  function insideList(x, y) {
    const rect = list.getBoundingClientRect();
    if (x < Math.max(0, rect.left) || x > Math.min(view.innerWidth, rect.right)
      || y < Math.max(0, rect.top) || y > Math.min(view.innerHeight, rect.bottom)) return false;
    const hit = doc.elementFromPoint(x, y);
    return !!hit && (hit === list || list.contains(hit));
  }

  function updateTarget() {
    const current = session;
    if (!current?.dragging) return;
    clearTarget(current);
    if (!insideList(current.x, current.y)) return;
    const rect = list.getBoundingClientRect();
    const top = Math.max(0, rect.top);
    const bottom = Math.min(view.innerHeight, rect.bottom);
    const all = rows();
    const candidates = all.filter(row => {
      const bounds = row.getBoundingClientRect();
      return row !== current.source && bounds.bottom > top && bounds.top < bottom;
    });
    if (!candidates.length) return;
    let target = candidates.find(row => {
      const bounds = row.getBoundingClientRect();
      return current.y < bounds.top + bounds.height / 2;
    });
    const placement = target ? 'before' : 'after';
    target ||= candidates[candidates.length - 1];
    const sourceIndex = all.indexOf(current.source);
    const targetIndex = all.indexOf(target);
    // Leaving a row in its current visible slot must not disturb hidden matches.
    if ((placement === 'before' && targetIndex === sourceIndex + 1)
      || (placement === 'after' && targetIndex === sourceIndex - 1)) return;
    current.target = target;
    current.placement = placement;
    target.classList.add(`drop-${placement}`);
  }

  function edgeSpeed(y, top, bottom) {
    if (bottom <= top) return 0;
    const edge = Math.min(44, (bottom - top) / 3);
    if (y < top + edge) return -Math.ceil(2 + 12 * Math.min(1, (top + edge - y) / edge));
    if (y > bottom - edge) return Math.ceil(2 + 12 * Math.min(1, (y - bottom + edge) / edge));
    return 0;
  }

  function scrollFrame() {
    frame = 0;
    const current = session;
    if (!current?.dragging) return;
    const rect = list.getBoundingClientRect();
    if (current.x >= rect.left && current.x <= rect.right
      && current.y >= Math.max(0, rect.top) - 24
      && current.y <= Math.min(view.innerHeight, rect.bottom) + 24) {
      const top = Math.max(0, rect.top);
      const bottom = Math.min(view.innerHeight, rect.bottom);
      const speed = edgeSpeed(current.y, top, bottom);
      const overflow = view.getComputedStyle(list).overflowY;
      const ownScroller = /auto|scroll|overlay/.test(overflow) && list.scrollHeight > list.clientHeight + 1;
      if (speed) {
        const canScroll = speed < 0 ? list.scrollTop > 0
          : list.scrollTop + list.clientHeight < list.scrollHeight - 1;
        if (ownScroller && canScroll) list.scrollTop += speed;
        else if (!ownScroller) view.scrollBy(0, speed);
        else {
          const windowSpeed = edgeSpeed(current.y, 0, view.innerHeight);
          if (windowSpeed) view.scrollBy(0, windowSpeed);
        }
      }
    }
    updateTarget();
    frame = view.requestAnimationFrame(scrollFrame);
  }

  function finish(commit = false) {
    const current = session;
    if (!current) return;
    const targetId = current.target?.dataset.tuningId;
    const placement = current.placement;
    const valid = commit && current.dragging && targetId && insideList(current.x, current.y);
    // Rendering in onMove may invoke cancel() again.
    session = null;
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    clearTarget(current);
    current.source.classList.remove('dragging');
    doc.body.classList.remove('sorting');
    if (current.dragging) suppressClickUntil = Date.now() + 600;
    try {
      if (list.hasPointerCapture(current.pointerId)) list.releasePointerCapture(current.pointerId);
    } catch { /* The browser may already have released a cancelled pointer. */ }
    if (valid) onMove?.(current.sourceId, targetId, placement);
  }

  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest?.('[data-reorder-handle]');
    if (!handle || !list.contains(handle) || session || event.isPrimary === false
      || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const source = handle.closest('.preset-item[data-tuning-id]');
    if (!source || !list.contains(source)) return;
    event.preventDefault();
    event.stopPropagation();
    handle.focus({ preventScroll: true });
    session = {
      source, sourceId: source.dataset.tuningId, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      dragging: false, target: null, placement: null,
    };
    try { list.setPointerCapture(event.pointerId); } catch { /* Document listeners remain a fallback. */ }
  }, { passive: false });

  doc.addEventListener('pointermove', event => {
    const current = session;
    if (!current || event.pointerId !== current.pointerId) return;
    current.x = event.clientX;
    current.y = event.clientY;
    event.preventDefault();
    event.stopPropagation();
    if (!current.dragging && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
      current.dragging = true;
      current.source.classList.add('dragging');
      doc.body.classList.add('sorting');
      frame = view.requestAnimationFrame(scrollFrame);
    }
    updateTarget();
  }, { capture: true, passive: false });

  doc.addEventListener('pointerup', event => {
    if (!session || event.pointerId !== session.pointerId) return;
    session.x = event.clientX;
    session.y = event.clientY;
    event.preventDefault();
    event.stopPropagation();
    updateTarget();
    finish(true);
  }, { capture: true, passive: false });

  doc.addEventListener('pointercancel', event => {
    if (event.pointerId === session?.pointerId) finish();
  }, true);
  list.addEventListener('lostpointercapture', event => {
    if (event.pointerId === session?.pointerId) finish();
  });
  view.addEventListener('blur', () => finish());

  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && session) {
      event.preventDefault();
      event.stopPropagation();
      finish();
    }
  }, true);
  list.addEventListener('keydown', event => {
    const handle = event.target.closest?.('[data-reorder-handle]');
    if (!handle || !list.contains(handle)
      || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const source = handle.closest('.preset-item[data-tuning-id]');
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    finish();
    onKeyboardMove?.(source.dataset.tuningId, event.key);
  });

  list.addEventListener('click', event => {
    if (event.target.closest?.('[data-reorder-handle]')
      || (event.detail > 0 && Date.now() < suppressClickUntil)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = 0;
    }
  }, true);

  return { cancel: () => finish() };
}
