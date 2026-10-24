/**
 * Sets the `dark` class before React mounts so the first paint has the right theme. Loaded from index.html as its
 * own module (CSP forbids inline scripts); keep the key and rules in step with lib/theme.tsx.
 */
try {
  const t = localStorage.getItem('collected.theme');
  const dark = t === 'dark' || ((t === null || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch {
  /* storage blocked: the color-scheme meta keeps the system scheme */
}

export {};
