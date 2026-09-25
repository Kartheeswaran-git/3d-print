import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TopBar } from "@/components/shell/top-bar";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Luna Litho Studio",
    template: "%s · Luna Litho Studio",
  },
  description:
    "Turn photos into printable moon-lamp lithophanes and design custom name keychains — processed entirely in your browser.",
  applicationName: "Luna Litho Studio",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1015" },
  ],
};

/** Applies the saved or system theme before first paint to avoid a flash. */
const themeScript = `(function(){try{var t=localStorage.getItem('luna-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="tex-grain min-h-dvh">
        <Providers>
          {/* Positioned so page content paints above the fixed grain layer on the canvas. */}
          <div className="relative flex min-h-dvh flex-col">
            <TopBar />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
