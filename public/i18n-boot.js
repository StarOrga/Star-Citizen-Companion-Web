// Starts the UI language table while the app bundle is still downloading, so the
// first translated paint no longer waits for the bundle before its text is even
// requested. Mirrors the signed-out steps of resolveLocale() (locale-resolution.ts).
// A wrong guess only costs one unused fetch: AppTranslateLoader then loads the
// language it really needs. External file because the CSP forbids inline scripts.
(function () {
  function normalize(raw) {
    var primary = String(raw || '').trim().toLowerCase().split(/[-_]/)[0];
    return primary === 'de' || primary === 'en' ? primary : null;
  }

  function resolve() {
    var language = null;
    try {
      language = normalize(localStorage.getItem('sc.lang'));
    } catch (e) {
      // storage blocked: the browser signals below still apply
    }
    var tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (var i = 0; !language && i < tags.length; i++) language = normalize(tags[i]);
    return language || 'en';
  }

  try {
    var lang = resolve();
    window.__scI18nBoot = {
      lang: lang,
      table: fetch('i18n/' + lang + '.json')
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .catch(function () {
          return null;
        }),
    };
  } catch (e) {
    // no fetch: the loader requests the table itself
  }
})();
