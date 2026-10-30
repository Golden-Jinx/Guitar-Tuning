/** Keep reference playback in a user gesture on both pointer and keyboard input. */
export function bindStringInteraction(button, { select, play }, now = () => performance.now()) {
  let active = null;
  let previousTap = null;
  let suppressUntil = 0;
  const listeners = [];
  const listen = (type, handler) => {
    button.addEventListener(type, handler);
    listeners.push([type, handler]);
  };
  const suppress = event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const cancel = () => { active = null; previousTap = null; };

  listen('pointerdown', event => {
    if (event.pointerType === 'mouse') {
      // A real mouse gesture may immediately follow touch on a hybrid device.
      cancel();
      suppressUntil = 0;
      return;
    }
    if (!['touch', 'pen'].includes(event.pointerType)) return;
    suppressUntil = now() + 1000;
    if (event.isPrimary === false || active) { cancel(); return; }
    active = { id: event.pointerId, x: event.clientX, y: event.clientY, at: now(), moved: false };
    // Capture does not cancel normal scrolling; pointercancel handles browser pans.
    try { button.setPointerCapture(event.pointerId); } catch { /* Optional on older browsers. */ }
  });
  listen('pointermove', event => {
    if (active?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 12) active.moved = true;
  });
  listen('pointerup', event => {
    if (active?.id !== event.pointerId) return;
    const pointer = active;
    active = null;
    const at = now();
    suppressUntil = at + 700;
    if (pointer.moved || at - pointer.at > 500
      || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12) {
      previousTap = null;
      return;
    }
    const doubleTap = previousTap && at - previousTap.at >= 0 && at - previousTap.at <= 350
      && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) <= 24;
    previousTap = doubleTap ? null : { at, x: event.clientX, y: event.clientY };
    event.preventDefault();
    // Selecting stops existing playback, so it must happen before starting a tone.
    select();
    if (doubleTap) play();
  });
  listen('pointercancel', event => {
    if (active?.id === event.pointerId) { suppressUntil = now() + 700; cancel(); }
  });
  listen('lostpointercapture', event => {
    if (active?.id === event.pointerId) cancel();
  });
  listen('click', event => {
    // Keyboard and assistive-technology clicks have detail 0 and remain usable.
    if (event.detail !== 0 && now() < suppressUntil) { suppress(event); return; }
    select();
  });
  listen('dblclick', event => {
    if (now() < suppressUntil) { suppress(event); return; }
    play();
  });
  listen('keydown', event => {
    if (event.key !== 'Enter' || !event.shiftKey) return;
    event.preventDefault();
    cancel();
    select();
    play();
  });
  return () => {
    cancel();
    for (const [type, handler] of listeners) button.removeEventListener(type, handler);
  };
}
