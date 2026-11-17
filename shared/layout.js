// Desktop vs. mobile layout switch. build-site.js inlines this into the <head> of every game.
// Desktop = a mouse/trackpad (hover + fine pointer) and a big enough window. Touch devices stay mobile.
// Sets <html class="gn-desktop"> or "gn-mobile", plus --gn-k: how much a game's virtual screen
// (window.GN_FIT = {w, h, max}) is scaled up to fill the window. Re-checks on resize.
// Override for testing: ?layout=desktop | ?layout=mobile (remembered) | ?layout=auto (back to normal).
(function () {
  var root = document.documentElement, fit = window.GN_FIT || null, force = null;
  try {
    var q = new URLSearchParams(location.search).get('layout');
    if (q === 'auto') localStorage.removeItem('gn.layout');
    else if (q === 'desktop' || q === 'mobile') localStorage.setItem('gn.layout', q);
    force = localStorage.getItem('gn.layout');
  } catch (e) {}
  var mouse = window.matchMedia ? matchMedia('(hover: hover) and (pointer: fine)') : { matches: false };
  var L = window.GNLayout = {
    desktop: false, k: 1,
    vw: function () { return innerWidth / L.k; },   // virtual viewport, in the game's own px
    vh: function () { return innerHeight / L.k; },
  };
  function apply() {
    var w = innerWidth, h = innerHeight;
    var desk = force === 'desktop' ? true : force === 'mobile' ? false : (mouse.matches && w >= 900 && h >= 560);
    var k = 1;
    if (desk && fit) k = Math.max(1, Math.round(Math.min(w / fit.w, h / fit.h, fit.max || 1.75) * 100) / 100);
    var changed = desk !== L.desktop || k !== L.k;
    L.desktop = desk; L.k = k;
    root.classList.toggle('gn-desktop', desk);
    root.classList.toggle('gn-mobile', !desk);
    root.style.setProperty('--gn-k', k);
    if (changed) window.dispatchEvent(new CustomEvent('gn-layout', { detail: L }));
  }
  apply();
  window.addEventListener('resize', apply);
  if (mouse.addEventListener) mouse.addEventListener('change', apply);
})();
