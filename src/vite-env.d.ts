/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional CORS proxy URL template. Must contain the token {url}, which is
   * replaced with the URL-encoded target. See src/utils/corsProxy.ts.
   */
  readonly VITE_CORS_PROXY_URL?: string;
}
