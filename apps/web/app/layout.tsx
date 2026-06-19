import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CICANET · La red del futuro",
  description:
    "Mapa de cobertura en tiempo real — CICANET, plataforma operacional para ISP.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
