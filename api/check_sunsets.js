import { Redis } from "@upstash/redis";
import webpush from "web-push";

const redis = Redis.fromEnv();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function calculateSunsetQuality(weather, airQuality) {
  const { cloud_cover, relative_humidity_2m, visibility, pressure_msl } =
    weather;
  const { pm2_5 } = airQuality;

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
  const pressureScore = calculateScore(pressure_msl, 1020, 1040); // Higher is better, 1020+ is great
  const aerosolScore = calculateScore(pm2_5, 12, 35); // Moderate is best

  return Math.round(
    cloudScore + humidityScore + visibilityScore + pressureScore + aerosolScore
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

    const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${subData.latitude}&longitude=${subData.longitude}&current=cloud_cover,relative_humidity_2m,visibility,pressure_msl&daily=sunset&timezone=${subData.timezone}`;
    const airQualityApiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${subData.latitude}&longitude=${subData.longitude}&current=pm2_5&timezone=${subData.timezone}`;

    const [weatherResponse, airQualityResponse] = await Promise.all([
      fetch(weatherApiUrl),
      fetch(airQualityApiUrl),
    ]);

    const weatherData = await weatherResponse.json();
    const airQualityData = await airQualityResponse.json();

    if (!weatherData.current || !airQualityData.current) {
      console.log(
        `Skipping push subscriber for ${subData.city} due to incomplete data.`
      );
      continue;
    }

    const score = calculateSunsetQuality(
      weatherData.current,
      airQualityData.current
    );
    console.log(`Checked push subscriber for ${subData.city}. Score: ${score}`);

    // --- RESTORED LOGIC 1: Score check is back to 80 ---
    if (score >= 80) {
      const sunsetTime = new Date(weatherData.daily.sunset[0]);
      const now = new Date();
      const minutesToSunset =
        (sunsetTime.getTime() - now.getTime()) / (1000 * 60);

      // --- RESTORED LOGIC 2: Time check is re-enabled ---
      if (minutesToSunset > 0 && minutesToSunset <= 15) {
        const payload = JSON.stringify({
          title: `Hoàng hôn hôm nay tại ${subData.city}: ${score}/100!`,
          body: `15 phút nữa là hoàng hôn. Chúc bạn buổi chiều vui vẻ!`,
        });

        try {
          await webpush.sendNotification(subData.subscription, payload);
          console.log(`Notification sent to ${subData.city} subscriber.`);
        } catch (error) {
          if (error.statusCode === 410) {
            const keyToDelete = `push-subscriber:${error.endpoint}`;
            console.log(
              `Subscription for ${error.endpoint} is expired. Deleting...`
            );
            await redis.del(keyToDelete);
          } else {
            console.error(
              `Error sending notification to ${subData.city}:`,
              error
            );
          }
        }
      }
    }
  }

  return response
    .status(200)
    .json({ message: `Checked ${subscribers.length} push subscribers.` });
}
