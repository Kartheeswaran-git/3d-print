"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, Moon, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/moon-lamp", label: "Moon lamp", icon: Moon },
  { href: "/keychain", label: "Keychain", icon: KeyRound },
  { href: "/photo-panel", label: "Photo panel", icon: Square },
] as const;

/** 56px app bar: brand, studio tabs, on-device badge and theme toggle. */
export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 h-14 shrink-0 border-b border-line bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:inline-flex focus:h-8 focus:items-center focus:rounded-control focus:border focus:border-line focus:bg-surface focus:px-3 focus:text-[13px] focus:font-medium focus:text-ink focus:shadow-e2"
      >
        Skip to content
      </a>
      <div className="flex h-full items-center gap-3 px-4 sm:gap-4 lg:px-5">
        <Link href="/" aria-label="Luna Litho home" className="flex shrink-0 items-center gap-2 rounded-control">
          <span className="flex size-7 items-center justify-center rounded-control bg-brand-tint text-brand" aria-hidden="true">
            <Moon className="size-4" />
          </span>
          <span className="hidden text-[15px] font-semibold tracking-[-0.01em] text-ink sm:inline">Luna Litho</span>
        </Link>

        <span className="hidden h-5 w-px bg-line sm:block" aria-hidden="true" />

        <nav aria-label="Studios" className="min-w-0">
          <ul className="flex h-9 items-center gap-0.5 rounded-control border border-line bg-sunken p-0.5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href} className="h-full">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-full items-center gap-1.5 whitespace-nowrap rounded-chip px-2.5 text-[13px] font-medium transition-colors duration-[120ms] sm:px-3",
                      active ? "bg-surface text-ink shadow-e1" : "text-secondary hover:text-body",
                    )}
                  >
                    <Icon className={cn("size-3.5 shrink-0", active ? "text-brand" : "text-muted")} aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <StatusBadge tone="success" className="hidden md:inline-flex">
            Processed on this device
          </StatusBadge>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
