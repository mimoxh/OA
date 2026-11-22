"use client";

import { useEffect, useState } from "react";

export function useUnreadCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/notifications/unread")
        .then((r) => (r.ok ? r.json() : { count: 0 }))
        .then((d) => alive && setCount(d.count ?? 0))
        .catch(() => {});
    load();
    // 实时事件已覆盖主要场景，轮询降为兜底
    const t = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("notifications:changed", onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("notifications:changed", onFocus);
    };
  }, []);
  return count;
}
