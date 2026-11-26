import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ذهب لايف — أسعار الذهب لحظياً",
    short_name: "ذهب لايف",
    description: "مراقبة أسعار الذهب لحظياً بالريال مع تنبيهات وقراءة فنية",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0a08",
    theme_color: "#0b0a08",
    categories: ["finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "التنبيهات", url: "/alerts" },
      { name: "قراءة السوق", url: "/market" },
    ],
  };
}
