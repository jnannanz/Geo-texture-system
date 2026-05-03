import type { Metadata } from "next";
import "./globals.css";
import PatternDefs from "@/components/PatternDefs";

export const metadata: Metadata = {
  title: "Geo-Texture System",
  description: "Geological Texture Visualization System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <PatternDefs />
        {children}
      </body>
    </html>
  );
}
