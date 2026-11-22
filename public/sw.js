// 轻量 Service Worker：支持 PWA 安装与桌面通知点击跳转，不拦截动态请求缓存
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/messages";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) return client.navigate(targetUrl);
          return client;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});
