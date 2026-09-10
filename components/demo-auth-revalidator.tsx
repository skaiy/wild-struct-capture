"use client";

import { useEffect } from "react";

const LOCKED_PAGE = "/demo-locked.html";

export function DemoAuthRevalidator() {
  useEffect(() => {
    let active = true;

    const revalidate = async () => {
      try {
        const response = await fetch("/api/demo-auth-check", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (active && response.status === 401) {
          window.location.replace(LOCKED_PAGE);
        }
      } catch {
        // A transient offline error should not turn an already-open local demo into a lockout.
      }
    };

    void revalidate();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void revalidate();
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      active = false;
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
