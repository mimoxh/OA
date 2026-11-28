import type { PreviewInfo } from "@/lib/file-preview/kinds";

export type PreviewBodyProps = {
  src: string;
  fileName: string;
  size?: number;
  info: PreviewInfo;
  downloadHref: string;
  /** 手机全屏（App 或手机浏览器）；false 为电脑上的弹窗 */
  fullscreen: boolean;
  dark: boolean;
};
