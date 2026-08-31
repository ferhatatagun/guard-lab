import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SITE_ORIGIN } from "@/lib/site";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const TITLE = "guard-lab — one run proves nothing";
const DESCRIPTION =
  "Define a schema, run a prompt against it N times, and see the distribution of ways it breaks. Separates the failures that throw from the ones that parse cleanly and are wrong. Browser-only, BYOK, nothing stored.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: TITLE, template: "%s · guard-lab" },
  description: DESCRIPTION,
  applicationName: "guard-lab",
  keywords: [
    "LLM guardrails",
    "structured output",
    "JSON schema validation",
    "prompt reliability",
    "schema compliance",
    "enum drift",
    "LLM testing",
    "Claude",
    "developer tool",
    "Ferhat Atagun",
  ],
  authors: [{ name: "Ferhat Atagün", url: "https://ferhatatagun.com" }],
  creator: "Ferhat Atagün",
  publisher: "Ferhat Atagün",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_ORIGIN,
    siteName: "guard-lab",
    title: TITLE,
    description:
      "Schema failures are distributional. One clean run tells you nothing — and zero failures in fifty runs is not a zero failure rate.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@ferhatatagun",
    creator: "@ferhatatagun",
    title: TITLE,
    description:
      "Run a prompt N times against a schema and see how it breaks — especially the failures that parse cleanly and are wrong.",
  },
  robots: { index: true, follow: true },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "guard-lab",
  url: SITE_ORIGIN,
  description: DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any (browser-based)",
  browserRequirements: "Requires JavaScript",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: {
    "@type": "Person",
    "@id": "https://ferhatatagun.com/#person",
    name: "Ferhat Atagün",
    url: "https://ferhatatagun.com",
  },
  isPartOf: { "@id": "https://ferhatatagun.com/tools#suite" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* Extensions inject attributes onto <body> before React hydrates, which
          React reports as a mismatch it won't patch up. Nothing here depends on
          body attributes, so the honest fix is to stop React policing a node it
          doesn't own. */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
      </body>
    </html>
  );
}
