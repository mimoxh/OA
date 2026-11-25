import { useId } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ORCA_ICON_ALIASES,
  ORCA_LETTER_ICON,
  ORCA_PNG_ICONS,
  ORCA_SVG_ICONS,
  type OrcaIconTone,
  type OrcaSvgIcon,
} from "@/components/im/orca-agent-icons.generated";

/**
 * 主题对比度适配（dark 变体由 globals.css 中的 .dark / [data-theme=dark] 触发）：
 * auto 图标使用 currentColor 随文字颜色变化；深色底块在深色主题下加浅色描边；
 * 透明底深色图形在深色主题下反色；浅色图形在浅色主题下加一圈淡描边，避免融进白底。
 */
const TONE_CLASS: Record<OrcaIconTone, string> = {
  auto: "",
  color: "",
  "dark-tile": "dark:drop-shadow-[0_0_1px_rgba(255,255,255,0.7)]",
  "dark-glyph": "dark:invert",
  light: "drop-shadow-[0_0_0.5px_rgba(0,0,0,0.45)] dark:drop-shadow-none",
};

/** 解析基座图标：别名（claude-agent-teams → claude、opencode2 → opencode、dsb → dsh）后查矢量，再查位图 */
export function resolveAgentIcon(agent: string | null | undefined):
  | { kind: "svg"; icon: OrcaSvgIcon }
  | { kind: "png"; src: string; tone: OrcaIconTone }
  | { kind: "letter"; letter: string }
  | { kind: "none" } {
  const raw = agent?.trim().toLowerCase();
  if (!raw) return { kind: "none" };
  const key = ORCA_ICON_ALIASES[raw] ?? raw;
  const svg = ORCA_SVG_ICONS[key];
  if (svg) return { kind: "svg", icon: svg };
  const png = ORCA_PNG_ICONS[key];
  if (png) return { kind: "png", src: png.src, tone: png.tone };
  return { kind: "letter", letter: (/[a-z0-9]/.exec(raw)?.[0] ?? "?").toUpperCase() };
}

function SvgIcon({ icon, size, className, uid }: { icon: OrcaSvgIcon; size: number; className?: string; uid: string }) {
  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", TONE_CLASS[icon.tone], className)}
      style={icon.rounded ? { borderRadius: 2 } : undefined}
      // 图标数据由 scripts/orca/extract-agent-icons.mjs 从 Orca 安装包生成并随代码提交，不含用户输入
      dangerouslySetInnerHTML={{ __html: icon.body.replaceAll("__UID__", uid) }}
    />
  );
}

/**
 * 基座（Agent）图标：与 Orca 客户端相同的原版图标（矢量内联、位图位于 public/agent-icons，均离线可用）。
 * 未指定基座时为中性 Bot 图标；Orca 未内置图标的自定义基座与 Orca 一致，显示首字母方块。
 */
export function AgentIcon({ agent, size = 16, className }: { agent: string | null | undefined; size?: number; className?: string }) {
  // useId 的返回值含 CSS url() 中不安全的字符；多个图标同屏时依赖它避免渐变 / 遮罩 id 冲突
  const uid = `agent-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const r = resolveAgentIcon(agent);
  if (r.kind === "none") return <Bot size={size} aria-hidden="true" className={cn("shrink-0 text-ink-3", className)} />;
  if (r.kind === "svg") return <SvgIcon icon={r.icon} size={size} className={className} uid={uid} />;
  if (r.kind === "png") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 16px 静态图标，无需 next/image 的优化管线
      <img
        src={r.src}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn("shrink-0 rounded-[2px]", TONE_CLASS[r.tone], className)}
      />
    );
  }
  if (!ORCA_LETTER_ICON) return <Bot size={size} aria-hidden="true" className={cn("shrink-0 text-ink-3", className)} />;
  const letter = { ...ORCA_LETTER_ICON, body: ORCA_LETTER_ICON.body.replace(">?</text>", `>${r.letter}</text>`) };
  return <SvgIcon icon={letter} size={size} className={cn("text-ink-2", className)} uid={uid} />;
}
