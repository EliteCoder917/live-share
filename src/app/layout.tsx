import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flowbot — host live services, join with a code",
  description:
    "Create an account and host live services — share a live browser, terminal, or screen that others join with a code.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
