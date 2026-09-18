// Decorative effects never send commands to the printer or intercept input.
(() => {
  document.getElementById('magicConnect')?.addEventListener('click', () => {
    document.getElementById('settingsButton').click();
  });
  // Theme headings can wrap or grow with browser zoom. Place the desktop
  // fullscreen badge below the actual header instead of a fixed top offset.
  const shell = document.querySelector('.shell');
  const header = shell.querySelector('header');
  function positionFullscreenBadge() {
    if (document.fullscreenElement !== shell) return;
    const bottom = header.getBoundingClientRect().bottom - shell.getBoundingClientRect().top;
    shell.style.setProperty('--magic-header-bottom', Math.ceil(bottom + 12) + 'px');
  }
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(positionFullscreenBadge).observe(header);
  }
  document.addEventListener('fullscreenchange', positionFullscreenBadge);
  document.addEventListener('themechange', positionFullscreenBadge);
  window.addEventListener('resize', positionFullscreenBadge);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const activeSpells = new Set();
  document.addEventListener('themechange', () => {
    for (const spell of activeSpells) spell.remove();
    activeSpells.clear();
  });
  document.addEventListener('pointerdown', event => {
    if (document.documentElement.dataset.theme !== 'harry-potter' || event.button !== 0 || event.pointerType !== 'mouse' || reducedMotion.matches) return;
    // Bound the amount of decoration, even during rapid clicking.
    if (activeSpells.size >= 8) {
      const oldest = activeSpells.values().next().value;
      oldest.remove();
      activeSpells.delete(oldest);
    }
    const spell = document.createElement('span');
    spell.className = 'wand-spell';
    spell.setAttribute('aria-hidden', 'true');
    spell.style.left = `${event.clientX}px`;
    spell.style.top = `${event.clientY}px`;
    const ring = document.createElement('span');
    ring.className = 'wand-spell-ring';
    spell.append(ring);
    for (let i = 0; i < 12; i++) {
      const spark = document.createElement('span');
      const angle = (i / 12) * Math.PI * 2 + Math.random() * .2;
      const distance = 28 + Math.random() * 48;
      spark.className = 'wand-spell-spark';
      spark.textContent = i % 3 === 0 ? '✦' : '·';
      spark.style.setProperty('--spell-x', `${Math.cos(angle) * distance}px`);
      spark.style.setProperty('--spell-y', `${Math.sin(angle) * distance}px`);
      spark.style.setProperty('--spell-turn', `${Math.random() * 180}deg`);
      spell.append(spark);
    }
    // A manual popover keeps sparks above dialogs and fullscreen content.
    // It does not take focus or close existing dialogs/popovers.
    const host = event.target.closest?.('dialog[open]') || document.fullscreenElement || document.body;
    if (typeof spell.showPopover === 'function') spell.setAttribute('popover', 'manual');
    host.append(spell);
    if (spell.hasAttribute('popover')) spell.showPopover();
    activeSpells.add(spell);
    setTimeout(() => {
      spell.remove();
      activeSpells.delete(spell);
    }, 850);
  }, { capture: true, passive: true });
})();
