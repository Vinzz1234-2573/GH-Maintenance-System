import "./globals.css";

export const metadata = {
  title: "Gentle Hill — Daily Equipment Maintenance",
  description: "Daily maintenance checklist for Gentle Hill Elder Care Centre",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
