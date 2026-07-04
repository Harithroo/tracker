"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // updateViaCache: "none" makes the browser re-fetch sw.js on every
    // registration check, so a new deploy's worker installs promptly.
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        registration.update().catch(() => {});
      })
      .catch(() => {});
  }, []);

  return null;
}
