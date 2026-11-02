import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["500", "600", "700", "800"],
  display: "swap",
});
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bitaqa · Compare UAE Credit Cards",
  description:
    "Transparent UAE credit card comparison. Filter by salary, Islamic or conventional, fees and rewards ecosystems. No phone number required.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${inter.variable} ${jakarta.variable} ${arabic.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
