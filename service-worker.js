// File: service-worker.js

self.addEventListener("push", (event) => {
  let title = "Sunset Alert!";
  let body = "";

  try {
    // First, try to parse the data as JSON (this is for REAL notifications from your server)
    const data = event.data.json();
    title = data.title;
    body = data.body;
  } catch (e) {
    // If it fails, it's probably a plain text message (like the one from the DevTools test button)
    console.log("Push event data was not JSON, treating as plain text.");
    body = event.data.text();
  }

  const options = {
    body: body,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
