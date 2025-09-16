import { Redis } from "@upstash/redis";

// Connects to Upstash using the environment variables from the Vercel integration
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    const { subscription, city } = request.body;

    // Fetch geo-data for the city to store coordinates
    const geoResponse = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        city
      )}&count=1`
    );
    const geoData = await geoResponse.json();
    if (!geoData.results || geoData.results.length === 0) {
      return response.status(400).json({ message: "City not found." });
    }
    const location = geoData.results[0];

    // The subscription endpoint is a unique identifier for the device/browser
    const key = subscription.endpoint;
    const value = {
      subscription,
      city: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
    };

    // Store the data in Redis
    await redis.set(`push-subscriber:${key}`, JSON.stringify(value));
    response.status(201).json({ message: "Subscription saved." });
  } catch (error) {
    console.error("Error saving subscription:", error);
    response.status(500).json({ message: "Failed to save subscription." });
  }
}
