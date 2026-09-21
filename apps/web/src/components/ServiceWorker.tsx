'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell service worker. Silent everywhere it is unsupported
 * (e.g. Safari private browsing) — an offline cache is a bonus, never a
 * dependency.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* offline support unavailable — the app still works online */
      });
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
