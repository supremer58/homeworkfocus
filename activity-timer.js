// Tracks "actively working" time on a task and stays idle otherwise.
// Active = actually typing (keystrokes), OR an <audio>/<video> element is
// playing. Mouse movement/scrolling/touch alone does not count as active.
// Pauses immediately on idle timeout OR when the tab loses focus/visibility.
function createActivityTimer({
  idleTimeoutMs = 5000,
  onTick = () => {},
  onStateChange = () => {},
} = {}) {
  let activeMs = 0;
  let isActive = false;
  let lastInputAt = 0;
  let tabVisible = document.visibilityState === 'visible' || document.hasFocus();
  let playingMedia = new Set();
  let tickHandle = null;
  let lastTickAt = Date.now();
  let teacherPaused = false;

  function setActive(next) {
    if (next !== isActive) {
      isActive = next;
      onStateChange(isActive);
    }
  }

  function recomputeActive() {
    if (teacherPaused) { setActive(false); return; }
    const now = Date.now();
    const recentInput = now - lastInputAt < idleTimeoutMs;
    const mediaPlaying = playingMedia.size > 0;
    const focused = tabVisible || document.hasFocus();
    setActive(focused && (recentInput || mediaPlaying));
  }

  function markInput() {
    lastInputAt = Date.now();
    recomputeActive();
  }

  const TICK_MS = 250;
  function tick() {
    const now = Date.now();
    const deltaMs = now - lastTickAt;
    lastTickAt = now;
    recomputeActive();
    if (isActive) {
      activeMs += deltaMs;
      onTick(activeMs);
    }
  }

  const inputEvents = ['keydown', 'input'];
  inputEvents.forEach((evt) => window.addEventListener(evt, markInput, { passive: true }));

  document.addEventListener('visibilitychange', () => {
    tabVisible = document.visibilityState === 'visible';
    if (!tabVisible) playingMedia.forEach((el) => el.pause());
    recomputeActive();
  });
  window.addEventListener('blur', () => { tabVisible = false; recomputeActive(); });
  window.addEventListener('focus', () => { tabVisible = document.visibilityState === 'visible'; recomputeActive(); });

  function watchMedia(el) {
    el.addEventListener('play', () => { playingMedia.add(el); recomputeActive(); });
    el.addEventListener('pause', () => { playingMedia.delete(el); recomputeActive(); });
    el.addEventListener('ended', () => { playingMedia.delete(el); recomputeActive(); });
  }

  tickHandle = setInterval(tick, TICK_MS);

  return {
    watchMedia,
    getActiveMs: () => activeMs,
    getIsActive: () => isActive,
    setActiveMs: (ms) => { activeMs = ms; },
    setTeacherPaused: (paused) => { teacherPaused = paused; recomputeActive(); },
    isTeacherPaused: () => teacherPaused,
    destroy() {
      clearInterval(tickHandle);
      inputEvents.forEach((evt) => window.removeEventListener(evt, markInput));
    },
  };
}
