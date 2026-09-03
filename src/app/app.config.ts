import { ApplicationConfig, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { REMOVE_STYLES_ON_COMPONENT_DESTROY } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    provideAnimationsAsync(),
    // Keep a component's <style> in the document once it has been added, instead
    // of reference-counting it away when the last instance of that component is
    // destroyed (Angular's default since v16).
    //
    // Why: the admin feedback board rendered its reply composer completely
    // UNSTYLED after a reply was sent (admin feedback 18e96ad3, with a
    // screenshot: native 20-column textarea, native buttons, no card frame —
    // i.e. the sc-feedback-composer styles were not in effect while a live
    // instance was on screen, whereas every global and every sibling-component
    // style still applied). Sending runs a full board refresh, which destroys
    // and recreates every composer in the list, and the collapse/expand
    // animation defers part of that teardown (BaseAnimationRenderer.destroy
    // hands delegate.destroy() to afterFlushAnimationsDone + queueMicrotask,
    // while the matching addStyles is synchronous) — so add and remove race
    // across the swap. Turning removal off makes the whole class of race
    // impossible; the cost is a handful of <style> elements that stay in <head>
    // for the session, which is what Angular did before v16 anyway.
    { provide: REMOVE_STYLES_ON_COMPONENT_DESTROY, useValue: false },
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideTranslateService({
      fallbackLang: 'en',
    }),
    provideTranslateHttpLoader({ prefix: 'i18n/', suffix: '.json' }),
  ],
};
