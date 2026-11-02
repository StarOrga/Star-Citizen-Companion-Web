// Karma config for `ng test` (angular.json → test.options.karmaConfig).
//
// Angular's built-in defaults plus patient socket timeouts. On the Linux CI
// runner headless Chrome renders WebGL in software, and a spec that builds a
// 3D scene can hold the main thread for 10–15 s. With the defaults (5 s ping,
// 2 s reconnect) Karma then dropped the browser as DISCONNECTED mid-suite
// at a different spec on every run, while no spec failed (2026-11-01/02).
module.exports = function (config) {
  config.set({
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    client: {
      jasmine: {},
      clearContext: false,
    },
    jasmineHtmlReporter: { suppressAll: true },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/sc-companion'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    restartOnFileChange: true,
    pingTimeout: 60000,
    browserDisconnectTimeout: 60000,
    browserNoActivityTimeout: 120000,
    captureTimeout: 120000,
  });
};
