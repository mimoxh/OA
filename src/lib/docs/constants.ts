export const COVERS: Record<string, { label: string; css: string }> = {
  sunset: { label: "日落", css: "linear-gradient(120deg, #f6d365 0%, #fda085 100%)" },
  ocean: { label: "海洋", css: "linear-gradient(120deg, #89f7fe 0%, #66a6ff 100%)" },
  forest: { label: "森林", css: "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)" },
  lavender: { label: "薰衣草", css: "linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)" },
  peach: { label: "蜜桃", css: "linear-gradient(120deg, #ffecd2 0%, #fcb69f 100%)" },
  night: { label: "夜空", css: "linear-gradient(120deg, #30cfd0 0%, #330867 100%)" },
  rose: { label: "玫瑰", css: "linear-gradient(120deg, #ff9a9e 0%, #fecfef 100%)" },
  slate: { label: "石板", css: "linear-gradient(120deg, #cfd9df 0%, #e2ebf0 100%)" },
};

export function coverStyle(cover: string | null | undefined): string | null {
  if (!cover) return null;
  if (COVERS[cover]) return COVERS[cover].css;
  if (/^https?:\/\//.test(cover)) return `center / cover no-repeat url("${cover.replace(/"/g, "")}")`;
  return null;
}

export const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  {
    label: "常用",
    items: ["📄", "📝", "📘", "📚", "📌", "📎", "📊", "📈", "🗂️", "🗺️", "🧩", "🛠️", "💡", "🚀", "🎯", "✅", "⭐", "🔥", "💬", "📢"],
  },
  {
    label: "办公",
    items: ["💼", "🏢", "📅", "🗓️", "⏰", "📦", "🧾", "💰", "💳", "🏦", "🚚", "🏭", "🖥️", "💻", "⌨️", "🖨️", "📱", "☎️", "✉️", "🔒"],
  },
  {
    label: "表情",
    items: ["😀", "😃", "😄", "😊", "🙂", "😎", "🤔", "😮", "🥳", "😴", "🤝", "👏", "👍", "🙌", "💪", "👋", "🙏", "❤️", "💯", "✨"],
  },
  {
    label: "自然",
    items: ["🌱", "🌿", "🍀", "🌲", "🌴", "🌵", "🌸", "🌻", "🌈", "☀️", "🌙", "⚡", "❄️", "🌊", "🍎", "🍊", "☕", "🍵", "🎉", "🎁"],
  },
  {
    label: "符号",
    items: ["❗", "❓", "⚠️", "🚧", "🔔", "🔑", "🔗", "🧭", "🧪", "🧠", "🎨", "🎬", "🎵", "🏆", "🥇", "🏁", "🛡️", "⚙️", "🧱", "🌐"],
  },
];

export const ALL_EMOJIS = EMOJI_GROUPS.flatMap((g) => g.items);

export function randomEmoji() {
  return ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)];
}

export const SPACE_ROLES: Record<string, { label: string; color: "blue" | "green" | "gray" }> = {
  owner: { label: "所有者", color: "blue" },
  editor: { label: "可编辑", color: "green" },
  viewer: { label: "仅查看", color: "gray" },
};
