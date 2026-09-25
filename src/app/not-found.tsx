import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="tex-dots flex w-full max-w-md flex-col items-center rounded-card border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
        <span
          className="mb-4 flex size-11 items-center justify-center rounded-card border border-line bg-sunken text-icon-muted"
          aria-hidden="true"
        >
          <Compass className="size-5" />
        </span>
        <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-ink">Page not found</h1>
        <p className="mt-1 max-w-sm text-[13px] leading-5 text-secondary">
          This page doesn’t exist or has moved. Head back home, or jump straight into a studio.
        </p>
        <nav aria-label="Where to next" className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/" className={buttonClassName({ variant: "secondary", size: "sm" })}>
            Back to home
          </Link>
          <Link href="/moon-lamp" className={buttonClassName({ variant: "ghost", size: "sm" })}>
            Moon lamp
          </Link>
          <Link href="/keychain" className={buttonClassName({ variant: "ghost", size: "sm" })}>
            Keychain
          </Link>
        </nav>
      </div>
    </main>
  );
}
