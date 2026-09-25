"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

/** Must match the inline script in `app/layout.tsx`. */
export const THEME_STORAGE_KEY = "luna-theme";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const getIsDark = () => document.documentElement.classList.contains("dark");

function readSavedTheme(): "dark" | "light" | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : null;
  } catch {
    return null;
  }
}

/** Switch the `dark` class without every colour transition animating at once. */
function applyTheme(dark: boolean) {
  const freeze = document.createElement("style");
  freeze.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(freeze);
  document.documentElement.classList.toggle("dark", dark);
  // Force a style flush before re-enabling transitions.
  void window.getComputedStyle(document.body).color;
  window.setTimeout(() => freeze.remove(), 1);
}

/** Light/dark toggle. Persists the choice; follows the system setting until the user picks one. */
export function ThemeToggle() {
  // Server and hydration render as light; the icons themselves switch with CSS so nothing flashes.
  const isDark = useSyncExternalStore(subscribe, getIsDark, () => false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = (e: MediaQueryListEvent) => {
      if (readSavedTheme() === null) applyTheme(e.matches);
    };
    media.addEventListener("change", onSystemChange);
    return () => media.removeEventListener("change", onSystemChange);
  }, []);

  const toggle = () => {
    const next = !getIsDark();
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this visit.
    }
  };

  return (
    <IconButton
      label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      tooltipSide="bottom"
      onClick={toggle}
      icon={
        <>
          <Moon className="dark:hidden" aria-hidden="true" />
          <Sun className="hidden dark:block" aria-hidden="true" />
        </>
      }
    />
  );
}
