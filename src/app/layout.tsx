import type { Metadata, Viewport } from "next";
import { Georama, Instrument_Serif } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const satoshi = localFont({
  variable: "--font-satoshi",
  display: "swap",
  src: [
    { path: "./fonts/satoshi/Satoshi-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/satoshi/Satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/satoshi/Satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/satoshi/Satoshi-700.woff2", weight: "700", style: "normal" },
  ],
});

const georama = Georama({
  variable: "--font-georama",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nentra | AI order operations for online merchants",
  description:
    "Nentra investigates order exceptions, coordinates the next action, and helps merchants move orders toward verified fulfilment. There is always a next move.",
};

export const viewport: Viewport = {
  themeColor: "#0D0B07",
  colorScheme: "dark",
};

// Runs before first paint. The intro plays on every load and refresh, and reduced-motion
// users never see it or a flash of it.
const introGate = `(function(){var d=document.documentElement;try{d.dataset.intro=window.matchMedia("(prefers-reduced-motion: reduce)").matches?"skip":"play";}catch(e){d.dataset.intro="play";}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${satoshi.variable} ${georama.variable} ${instrumentSerif.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: introGate }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
