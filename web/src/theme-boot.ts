/**
 * Sets the `dark` class and the accent before React mounts so the first paint has the right theme. Loaded from
 * index.html as its own module (CSP forbids inline scripts); keep the keys and rules in step with lib/theme.tsx.
 */
try {
  const t = localStorage.getItem('collected.theme');
  const dark = t === 'dark' || ((t === null || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  const a = localStorage.getItem('collected.accent');
  document.documentElement.dataset.accent = a === 'red' || a === 'forest' || a === 'royal' ? a : 'blue';
} catch {
  /* storage blocked: the color-scheme meta keeps the system scheme, the stylesheet defaults to blue */
}

export {};
