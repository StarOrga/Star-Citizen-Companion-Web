import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(`${environment.supabase.url}/functions/`)) {
    return next(req);
  }

  const sb = inject(SupabaseClientProvider);
  return from(sb.client.auth.getSession()).pipe(
    switchMap(({ data }) => {
      const token = data.session?.access_token;
      // Signed-out (#131): send the publishable key as apikey so the
      // functions gateway can attribute the request. No Authorization header
      // — the key is not a JWT (fetch-verse-news runs with verify_jwt=false).
      const cloned = token
        ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
        : req.clone({ setHeaders: { apikey: environment.supabase.publishableKey } });
      return next(cloned);
    }),
  );
};
