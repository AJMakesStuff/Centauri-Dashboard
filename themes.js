/* Add future themes here: a stable ID, label, stylesheet, and optional copy.
   dashboard.css is always the base; theme stylesheets only add overrides. */
(() => {
  const storageKey = 'dashboardTheme';
  const defaultTheme = 'original';
  const originalCopy = {
    title: 'Centauri Carbon Dashboard', heading: 'Centauri Carbon',
    subtitle: 'Local printer dashboard', job: 'Current job',
    temperatures: 'Temperatures', settings: 'Settings', credit: 'Made with love by'
  };
  const themes = {
    original: { label: 'Original', stylesheet: null, copy: originalCopy },
    'harry-potter': {
      label: 'Harry Potter', stylesheet: 'magic.css',
      copy: {
        title: 'The Room of Requirement · Centauri Carbon', heading: 'The Room of Requirement',
        subtitle: 'Centauri Carbon ✦ A little magic. Layer by layer.', job: '✧ Current enchantment',
        temperatures: '♨ Magical elements · temperatures', settings: '⚙ Workshop settings',
        credit: 'Managed with magic by'
      }
    }
  };
  const validTheme = id => Object.hasOwn(themes, id) ? id : defaultTheme;
  let currentTheme = defaultTheme;
  try { currentTheme = validTheme(localStorage.getItem(storageKey)); } catch { /* Use the default if storage is unavailable. */ }
  const stylesheet = document.getElementById('themeStylesheet');
  function applyTheme(id) {
    currentTheme = validTheme(id);
    const theme = themes[currentTheme];
    document.documentElement.dataset.theme = currentTheme;
    if (theme.stylesheet) {
      if (stylesheet.getAttribute('href') !== theme.stylesheet) stylesheet.setAttribute('href', theme.stylesheet);
      stylesheet.disabled = false;
    } else stylesheet.disabled = true;
    const copy = { ...originalCopy, ...theme.copy };
    document.title = copy.title;
    const model = new URLSearchParams(location.search).get('printer');
    for (const node of document.querySelectorAll('[data-theme-text]')) {
      const key = node.dataset.themeText;
      // The two-printer view must keep each printer's identity visible.
      node.textContent = key === 'heading' && ['cc1', 'cc2'].includes(model)
        ? (model === 'cc1' ? 'Centauri Carbon · CC1' : 'Centauri Carbon 2 · CC2') : copy[key];
    }
    const selector = document.getElementById('themeSelector');
    if (selector) selector.value = currentTheme;
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: currentTheme } }));
  }
  // Apply the saved stylesheet before the body is rendered to avoid a theme flash.
  applyTheme(currentTheme);
  document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('themeSelector');
    for (const [id, theme] of Object.entries(themes)) selector.add(new Option(theme.label, id));
    applyTheme(currentTheme);
    selector.addEventListener('change', () => {
      applyTheme(selector.value);
      const hint = document.getElementById('themeHint');
      try {
        localStorage.setItem(storageKey, currentTheme);
        hint.textContent = 'Theme changes apply and save automatically.';
      } catch {
        hint.textContent = 'Theme applied for this page. Browser storage is unavailable, so it could not be saved.';
      }
    });
  });
  // Keep other open tabs and the embedded dual-printer panels in sync.
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) applyTheme(event.newValue);
  });
})();

