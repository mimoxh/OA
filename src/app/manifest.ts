import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "协作空间 · OA",
    short_name: "协作空间",
    description: "一体化办公协作平台：消息、文档、OA、CRM、ERP、WMS、TMS、PMS",
    start_url: "/messages",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2383e2",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
