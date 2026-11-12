// Light / dark / follow-the-system, remembered on this device. Loaded in <head> so a dark choice never flashes white.
(function () {
  var KEY = 'articola.theme', root = document.documentElement;
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function stored() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; } }
  function apply(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
    var isDark = mode === 'dark' || (mode === 'system' && dark && dark.matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#111110' : '#fafaf9');
  }
  window.Theme = {
    get: stored,
    set: function (mode) {
      if (mode !== 'light' && mode !== 'dark') mode = 'system';
      try { if (mode === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch (e) { /* private mode */ }
      apply(mode);
    },
  };
  apply(stored());
  if (dark && dark.addEventListener) dark.addEventListener('change', function () { apply(stored()); });
})();
