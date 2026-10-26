import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { BetaService } from '../beta.service';

/**
 * Route variants behind the `shell` beta (implement.md §0): a route entry with
 * `canMatch: [shellBetaOn]` only exists with the beta on, the entry after it
 * keeps today's behaviour for everyone else.
 */
export const shellBetaOn: CanMatchFn = () => inject(BetaService).isEnabled('shell')();
