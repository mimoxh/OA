"use client";

import { useState } from "react";
import { Music } from "lucide-react";
import { PreviewError } from "../preview-states";
import type { PreviewBodyProps } from "../types";

/**
 * 音频 / 视频：HTML5 原生播放器（进度条、全屏、倍速由系统提供），直接用文件地址播放——
 * 文件接口支持 Range，拖动进度条时按需分段读取，不用先下载整份。
 */
export default function MediaBody({ src, fileName, info, downloadHref, dark }: PreviewBodyProps) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <PreviewError
        dark={dark}
        failure={{
          title: info.kind === "video" ? "当前设备无法播放该视频" : "当前设备无法播放该音频",
          detail:
            info.ext === "mov"
              ? "MOV 视频常用 HEVC（H.265）等编码，很多浏览器和 WebView 不能直接播放。可以下载后用播放器打开。"
              : "文件可能已损坏，或使用了当前设备不支持的编码。可以下载后用播放器打开。",
        }}
        downloadHref={downloadHref}
        fileName={fileName}
      />
    );
  }
  if (info.kind === "video") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <video src={src} controls playsInline preload="metadata" className="max-h-full max-w-full" onError={() => setFailed(true)} data-media-player>
          当前浏览器不支持视频播放
        </video>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-white">
      <span className="flex size-24 items-center justify-center rounded-3xl bg-white/10">
        <Music className="size-12 text-white/80" />
      </span>
      <div className="max-w-full truncate text-sm text-white/85">{fileName}</div>
      <audio src={src} controls preload="metadata" className="w-full max-w-[480px]" onError={() => setFailed(true)} data-media-player>
        当前浏览器不支持音频播放
      </audio>
    </div>
  );
}
