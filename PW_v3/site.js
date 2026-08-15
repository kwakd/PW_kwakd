/* site.js — runs on every page
   Dark mode flash prevention is handled inline in <head> (see each HTML file).
   This script handles: toggle button label + logo easter egg.
*/

(async () => {
  const root = (() => {
    const depth = location.pathname.split('/').filter(Boolean).length - 1;
    return depth > 0 ? '../'.repeat(depth) : './';
  })();

  /* ── Load settings.json ── */
  let settings = { darkMode: false, logoImages: ['img/testCharA.png'] };
  try {
    const r = await fetch(root + 'settings.json');
    if (r.ok) settings = await r.json();
  } catch (_) {}

  /* ── Dark mode toggle button label ── */
  const btn = document.getElementById('dm-btn');
  const updateLabel = () => {
    if (!btn) return;
    btn.textContent = document.body.classList.contains('dark') ? '[light-mode]' : '[dark-mode]';
  };
  updateLabel();

  if (btn) {
    btn.addEventListener('click', () => {
      const now = document.body.classList.toggle('dark');
      localStorage.setItem('kwakd-dark', now);
      updateLabel();
    });
  }

  /* ── Logo 5-click easter egg ── */
  const logo = document.getElementById('nav-logo');
  if (logo && settings.logoImages.length > 1) {
    let hits = 0, cur = 0;
    logo.addEventListener('click', () => {
      if (++hits < 5) return;
      hits = 0;
      let next;
      do { next = Math.floor(Math.random() * settings.logoImages.length); }
      while (next === cur && settings.logoImages.length > 1);
      cur = next;
      logo.src = root + settings.logoImages[next];
    });
  }
})();
