// File: api/check_sunsets.js
import { Redis } from "@upstash/redis";
import webpush from "web-push";
const redis = Redis.fromEnv();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function calculateSunsetQuality(weather) {
  const {
    cloud_cover,
    relative_humidity_2m,
    visibility,
    wind_speed_10m,
    precipitation_probability,
  } = weather;
  const calculateScore = (value, targetStart, targetEnd) => {
    const maxScore = 20;
    if (value >= targetStart && value <= targetEnd) return maxScore;
    const distance =
      value < targetStart ? targetStart - value : value - targetEnd;
    return Math.max(0, maxScore - (distance * maxScore) / 100);
  };
  const cloudScore = calculateScore(cloud_cover, 40, 60);
  const humidityScore = calculateScore(relative_humidity_2m, 0, 40);
  const visibilityScore = Math.min(20, (visibility / 1000 / 20) * 20);
  const windScore = calculateScore(wind_speed_10m, 0, 10);
  const precipScore = calculateScore(precipitation_probability, 0, 5);
  return Math.round(
    cloudScore + humidityScore + visibilityScore + windScore + precipScore
  );
}

export default async function handler(request, response) {
  const subscriberKeys = await redis.keys("push-subscriber:*");
  if (subscriberKeys.length === 0) {
    return response
      .status(200)
      .json({ message: "No push subscribers to notify." });
  }

  const subscribers = await redis.mget(...subscriberKeys);

  for (const subData of subscribers) {
    if (!subData) continue;

    const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${subData.latitude}&longitude=${subData.longitude}&current=cloud_cover,relative_humidity_2m,visibility,wind_speed_10m,precipitation_probability&daily=sunset&timezone=${subData.timezone}`;
    const weatherResponse = await fetch(weatherApiUrl);
    const weatherData = await weatherResponse.json();
    const score = calculateSunsetQuality(weatherData.current);
    console.log(`Checked push subscriber for ${subData.city}. Score: ${score}`);

    if (score >= 1) {
      // Using score >= 1 for testing
      const sunsetTime = new Date(weatherData.daily.sunset[0]);
      const now = new Date();
      const minutesToSunset =
        (sunsetTime.getTime() - now.getTime()) / (1000 * 60);

      const payload = JSON.stringify({
        title: `Hoàng hôn hôm nay tại ${subData.city}: ${score}/100!`,
        body: `15 phút nữa là hoàng hôn. Chúc bạn buổi chiều vui vẻ!`,
      });

      try {
        // We temporarily removed the time check for this test
        await webpush.sendNotification(subData.subscription, payload);
        console.log(`Notification sent to ${subData.city} subscriber.`);
      } catch (error) {
        // --- THIS IS THE NEW SELF-HEALING LOGIC ---
        if (error.statusCode === 410) {
          // 410 Gone - The subscription is expired and should be deleted.
          const keyToDelete = `push-subscriber:${error.endpoint}`;
          console.log(
            `Subscription for ${error.endpoint} is expired. Deleting...`
          );
          await redis.del(keyToDelete);
        } else {
          // For any other error, just log it.
          console.error(
            `Error sending notification to ${subData.city}:`,
            error
          );
        }
      }
    }
  }

  return response
    .status(200)
    .json({ message: `Checked ${subscribers.length} push subscribers.` });
}
