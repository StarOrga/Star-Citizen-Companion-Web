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
      const cloned = token
        ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
        : req;
      return next(cloned);
    }),
  );
};
