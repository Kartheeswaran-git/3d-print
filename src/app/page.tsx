import Link from "next/link";
import { ArrowRight, KeyRound, Moon, Square, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/status-badge";

interface Tool {
  id: string;
  href: string;
  title: string;
  body: string;
  chips: string[];
  cta: string;
  icon: LucideIcon;
  tile: string;
}

const TOOLS: Tool[] = [
  {
    id: "moon-lamp",
    href: "/moon-lamp",
    title: "Moon lamp",
    body: "Wrap a photo around a printable moon globe, or make a flat crescent, heart or custom-shaped lithophane that glows when lit from behind.",
    chips: ["Sphere & flat shapes", "STL export", "Backlight preview"],
    cta: "Open moon lamp studio",
    icon: Moon,
    tile: "bg-cat-product-tint text-cat-product",
  },
  {
    id: "keychain",
    href: "/keychain",
    title: "Name keychain",
    body: "Type a name, pick a font and download a two-colour keychain ready for multi-material or filament-swap printing.",
    chips: ["5 fonts", "Multi-colour AMF", "STL export"],
    cta: "Open keychain studio",
    icon: KeyRound,
    tile: "bg-cat-plan-tint text-cat-plan",
  },
  {
    id: "photo-panel",
    href: "/photo-panel",
    title: "Photo panel",
    body: "Create a standard flat rectangular lithophane from your photo, ready to hang or stand in a lightbox.",
    chips: ["Rectangle shape", "STL export", "Backlight preview"],
    cta: "Open photo panel studio",
    icon: Square,
    tile: "bg-cat-code-tint text-cat-code",
  },
];

const STEPS = [
  {
    title: "Add a photo or a name",
    body: "Drop in a JPG, PNG or WebP for a lamp, or type the name you want on a keychain.",
  },
  {
    title: "Shape it with live 3D preview",
    body: "Pick a form, tune the relief and see the lit result update as you adjust.",
  },
  {
    title: "Download and print",
    body: "Export a checked, watertight STL or a multi-colour AMF and open it in your slicer.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <main id="main" className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-12 sm:px-6">
        <header>
          <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-ink">What would you like to make?</h1>
          <p className="mt-1.5 max-w-[80ch] text-[14px] leading-[1.5] text-secondary">
            Design printable lamps and keychains from your own photos and names. Everything is processed on this device — nothing
            is uploaded.
          </p>
        </header>

        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {TOOLS.map((tool) => (
            <li key={tool.id} className="flex min-w-0">
              <Link
                href={tool.href}
                aria-labelledby={`${tool.id}-title`}
                aria-describedby={`${tool.id}-body`}
                className="group flex w-full min-w-0 flex-col rounded-card border border-line bg-surface p-5 transition-colors duration-[120ms] hover:border-line-strong"
              >
                <span className={cn("flex size-10 items-center justify-center rounded-control", tool.tile)} aria-hidden="true">
                  <tool.icon className="size-5" />
                </span>
                <h2 id={`${tool.id}-title`} className="mt-4 text-[15px] font-semibold leading-6 text-ink">
                  {tool.title}
                </h2>
                <p id={`${tool.id}-body`} className="mt-1 max-w-[60ch] text-[14px] leading-[1.5] text-body">
                  {tool.body}
                </p>
                <span className="mt-4 flex flex-wrap gap-1.5">
                  {tool.chips.map((chip) => (
                    <Badge key={chip}>{chip}</Badge>
                  ))}
                </span>
                <span className="mt-auto flex items-center gap-1.5 pt-5 text-[13px] font-medium text-brand">
                  {tool.cta}
                  <ArrowRight
                    className="size-3.5 transition-transform duration-[120ms] group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <section aria-labelledby="how-it-works" className="mt-10">
          <h2 id="how-it-works" className="text-[15px] font-semibold leading-6 text-ink">
            How it works
          </h2>
          <ol className="mt-3 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="min-w-0 rounded-card border border-line bg-surface p-4">
                <span
                  className="inline-flex size-6 items-center justify-center rounded-chip border border-line bg-sunken font-mono text-[12px] font-medium text-secondary"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <h3 className="mt-3 text-[14px] font-semibold leading-5 text-ink">{step.title}</h3>
                <p className="mt-1 text-[13px] leading-5 text-secondary">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-line">
        <p className="mx-auto w-full max-w-[1120px] px-4 py-5 text-[13px] text-secondary sm:px-6">
          © 2026 Luna Litho · Made for small wonders
        </p>
      </footer>
    </div>
  );
}
