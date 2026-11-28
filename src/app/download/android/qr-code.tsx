import { encode } from "uqr";

/** 服务端生成的二维码（SVG，不需要客户端脚本） */
export function QrCode({ text, size = 168, className }: { text: string; size?: number; className?: string }) {
  const qr = encode(text, { ecc: "M", border: 2 });
  let d = "";
  qr.data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return (
    <svg
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`二维码：${text}`}
      className={className}
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={d} fill="#111" />
    </svg>
  );
}
