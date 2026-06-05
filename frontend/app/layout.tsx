import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PyServer Manager",
  description: "Manage your Python services remotely",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-surface text-gray-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
