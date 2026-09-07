// Binds the codex number formatter to the app's resolved locale.
// -----------------------------------------------------------------------------
// `codex-format.ts` groups thousands itself and must not depend on Angular DI —
// it is imported from plain domain modules and from bare-TestBed specs. This
// file is the one place that pushes the resolved locale into it, so the ship
// page renders "1.636,88" for a German UI and "1,636.88" for an English one
// without a single call site passing a locale down (feedback dbdb2ffe).
//
// `LocaleService` is the single source of truth for the UI language (the shell
// mirrors it into ngx-translate, never the other way round), so reading
// `intlLocale()` here is reading the same decision the translations follow.

import {
  EnvironmentProviders,
  Injectable,
  effect,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import { LocaleService } from '../core/locale/locale.service';
import { setNumberLocale } from './codex-format';

@Injectable({ providedIn: 'root' })
export class CodexNumberLocaleService {
  private readonly locale = inject(LocaleService);

  constructor() {
    // The LANGUAGE, not `intlLocale()`. The resolved locale carries the user's
    // REGION too, and region is what decides a group separator in CLDR: a
    // German UI with region AT formats 1636.88 as "1 636,88" (a narrow no-break
    // space), which is correct Austrian and is not what was asked for. The ask
    // is language-shaped — "German format unless I set English" (dbdb2ffe) —
    // so the language alone drives it and every German UI reads "1.636,88".
    effect(() => setNumberLocale(this.locale.language()));
  }
}

/**
 * Construct the binding at bootstrap. It has to be eager: nothing INJECTS the
 * service, and a lazily created one would leave every figure in English until
 * whichever page happened to ask for it first.
 */
export function provideCodexNumberLocale(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      inject(CodexNumberLocaleService);
    }),
  ]);
}
