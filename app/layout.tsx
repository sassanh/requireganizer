import "./globals.css";

import Providers from "provider";

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
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
