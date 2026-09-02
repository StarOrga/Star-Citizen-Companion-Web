import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { captureAuthLinkType } from './app/auth/auth-link';

// Read the auth-mail link type off the URL BEFORE anything can create a
// Supabase client: `detectSessionInUrl` strips the fragment it consumes, and
// with it the only sign that this visit started from an invite mail (see
// auth-link.ts).
captureAuthLinkType();

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
