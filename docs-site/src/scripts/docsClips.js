// Docs clips (marked data-docs-autoplay by scripts/sync-features.mjs): muted loops that play only
// while they are in view, so a page with several clips loads and runs only the visible ones.
// Under prefers-reduced-motion they stay still on their poster and keep their controls.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const clips = [...document.querySelectorAll('video[data-docs-autoplay]')];
const inView = new Set();

// The loop of a compare slider lies under the slider: instead of its controls, docsCompare.js shows a
// play button while the video is marked data-docs-manual.
function setManual(video, manual) {
  if (video.classList.contains('docs-compare-video')) video.toggleAttribute('data-docs-manual', manual);
  else video.controls = manual;
}

function update(video) {
  setManual(video, reducedMotion.matches);
  if (inView.has(video) && !reducedMotion.matches) {
    video.muted = true;
    // A blocked autoplay keeps the controls, so the clip can still be started by hand.
    video.play().catch(() => setManual(video, true));
  } else if (!video.paused) {
    video.pause();
  }
}

if (clips.length) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) inView.add(entry.target);
      else inView.delete(entry.target);
      update(entry.target);
    }
  }, { rootMargin: '200px 0px' });
  for (const video of clips) {
    setManual(video, reducedMotion.matches);
    observer.observe(video);
  }
  reducedMotion.addEventListener('change', () => clips.forEach(update));
}
