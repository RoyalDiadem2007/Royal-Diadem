/// <reference types="vite/client" />

/* eslint-disable @typescript-eslint/consistent-type-definitions --
   Vite's env typing works by declaration merging with the global
   ImportMetaEnv interface; type aliases cannot merge. */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
/* eslint-enable @typescript-eslint/consistent-type-definitions */
