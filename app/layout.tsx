import "server-only";
import "./globals.css";
import { Inter } from "next/font/google";

import Providers from "provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Software Factory",
  description:
    "Software is requirements, elaborated in the language of requirements.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
