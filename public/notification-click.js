// Klick auf eine Erinnerung (src/platform/notifications.ts). Wird per workbox.importScripts
// in den generierten Service Worker geladen. Ist die App offen, navigiert sie selbst zur
// Aufgabe (kein Neuladen); sonst öffnet sich ein neues Fenster direkt im Detail.
self.addEventListener('notificationclick', (event) => {
  const taskId = event.notification.data && event.notification.data.taskId;
  if (typeof taskId !== 'string') return;
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (client === undefined) return self.clients.openWindow(`/task/${encodeURIComponent(taskId)}`);
      client.postMessage({ type: 'tidypepple:open-task', taskId });
      return client.focus();
    }),
  );
});
