self.addEventListener("push", function (event) {
  const data = event.data.json();
  const title = data.title || "Sunset Alert!";
  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
