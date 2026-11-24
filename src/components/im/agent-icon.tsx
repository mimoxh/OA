import { useId, type ReactNode } from "react";
import { Bot, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandProps = { size: number; className?: string; title?: string };
type Brand = (p: BrandProps & { uid: string }) => ReactNode;

/** 品牌图标统一 24×24 画布，图形控制在 2–22 之间，与 lucide 图标的视觉重量对齐 */
function Svg({ size, className, children }: BrandProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

// Claude 星芒：长短交替、角度略不规则的放射线
const CLAUDE_RAYS = [0, 34, 70, 103, 140, 178, 214, 248, 286, 322]
  .map((deg, i) => {
    const r = (deg - 90) * (Math.PI / 180);
    const len = i % 2 ? 8 : 10;
    const p = (d: number) => `${(12 + Math.cos(r) * d).toFixed(2)} ${(12 + Math.sin(r) * d).toFixed(2)}`;
    return `M${p(1.2)}L${p(len)}`;
  })
  .join("");

const OPENAI_KNOT =
  "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

const BRANDS: Record<string, Brand> = {
  antigravity: ({ uid, ...p }) => (
    <Svg {...p}>
      <defs>
        <linearGradient id={uid} x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="0.55" stopColor="#6D5CF6" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
      </defs>
      <path
        d="M4.6 19.4 9.7 6.9a2.5 2.5 0 0 1 4.6 0l5.1 12.5"
        fill="none"
        stroke={`url(#${uid})`}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  ),
  claude: (p) => (
    <Svg {...p}>
      <path d={CLAUDE_RAYS} fill="none" stroke="#D97757" strokeWidth="2.3" strokeLinecap="round" />
    </Svg>
  ),
  codex: (p) => (
    <Svg {...p}>
      <g transform="translate(1.2 1.2) scale(0.9)">
        <path d={OPENAI_KNOT} fill="#10A37F" />
      </g>
    </Svg>
  ),
  droid: (p) => (
    <Svg {...p}>
      <path d="M12 7.2V4.6" stroke="#EF6C2E" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="3.6" r="1.5" fill="#EF6C2E" />
      <rect x="1.8" y="11" width="2" height="4.6" rx="1" fill="#EF6C2E" />
      <rect x="20.2" y="11" width="2" height="4.6" rx="1" fill="#EF6C2E" />
      <rect x="4.4" y="7" width="15.2" height="13" rx="3.6" fill="#EF6C2E" />
      <circle cx="9.2" cy="12.9" r="1.65" fill="#fff" />
      <circle cx="14.8" cy="12.9" r="1.65" fill="#fff" />
      <path d="M9.8 16.9h4.4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
    </Svg>
  ),
  opencode2: (p) => (
    <Svg {...p}>
      <path fillRule="evenodd" d="M5 2.5h14A2.5 2.5 0 0 1 21.5 5v14a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 19V5A2.5 2.5 0 0 1 5 2.5ZM8 7v10h8V7Z" fill="#5F5F6B" />
      <rect x="8" y="12" width="8" height="5" fill="#B4B4BF" />
    </Svg>
  ),
  dsh: (p) => (
    <Svg {...p}>
      <path
        d="M2.4 12.2C2.4 8.4 5.8 6 10.3 6c3.8 0 6.6 1.9 8 4.6l2.3-3c.4-.5 1.2-.2 1.1.4l-.9 3.4 1.3 1.2c.4.4.1 1-.4.9l-2.5-.5c-1.3 3.6-4.7 5.6-8.6 5.6-4.7 0-8.2-2.6-8.2-6.4Z"
        fill="#4D6BFE"
      />
      <path d="M5.6 14.6c1.6 1.5 4.6 2 7.2 1.1" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <circle cx="7.1" cy="10.6" r="1.15" fill="#fff" />
    </Svg>
  ),
  devin: (p) => (
    <Svg {...p}>
      <path d="M12 2.9 19.9 7.45v9.1L12 21.1l-7.9-4.55v-9.1Z" fill="#14B8A6" stroke="#14B8A6" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9.6 8.4h2.1a3.6 3.6 0 0 1 0 7.2H9.6Z" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    </Svg>
  ),
};

/**
 * 基座（Agent）品牌图标：已知基座使用内联品牌原色 SVG（离线可用），
 * 未指定时为中性 Bot 图标，自定义基座为 Terminal 图标。
 */
export function AgentIcon({ agent, size = 16, className }: { agent: string | null | undefined; size?: number; className?: string }) {
  // useId 的返回值可能含 CSS url() 中不安全的字符；多个图标同屏时依赖它避免渐变 id 冲突
  const uid = `agent-grad-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const key = agent?.trim().toLowerCase();
  if (!key) return <Bot size={size} aria-hidden="true" className={cn("shrink-0 text-ink-3", className)} />;
  const Brand = BRANDS[key];
  if (!Brand) return <SquareTerminal size={size} aria-hidden="true" className={cn("shrink-0 text-ink-3", className)} />;
  return <Brand uid={uid} size={size} className={className} />;
}
