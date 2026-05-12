import "./globals.css";
import { Space_Grotesk, IBM_Plex_Sans } from "next/font/google";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import MuiThemeProvider from "@/components/mui-theme-provider";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const bodyFont = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

export const metadata = {
  title: "Bookable",
  description: "Bookable extracts statement PDFs into cleaned, bookable CSV rows without any bank API connection.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${headingFont.variable} ${bodyFont.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AppRouterCacheProvider>
          <MuiThemeProvider>{children}</MuiThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
