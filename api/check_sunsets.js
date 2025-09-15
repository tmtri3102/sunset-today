import { Redis } from "@upstash/redis";
import nodemailer from "nodemailer";

// Manually initialize the Redis client
const redis = new Redis({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});

// Create a Nodemailer "transporter" using your Gmail App Password
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

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
  try {
    const subscriberKeys = await redis.keys("subscriber:*");

    if (subscriberKeys.length === 0) {
      return response
        .status(200)
        .json({ message: "No subscribers to notify." });
    }

    const subscribersData = await redis.mget(...subscriberKeys);

    for (const subscriber of subscribersData) {
      if (!subscriber) continue;

      const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${subscriber.latitude}&longitude=${subscriber.longitude}&current=cloud_cover,relative_humidity_2m,visibility,wind_speed_10m,precipitation_probability&timezone=${subscriber.timezone}`;
      const weatherResponse = await fetch(weatherApiUrl);
      const weatherData = await weatherResponse.json();
      const score = calculateSunsetQuality(weatherData.current);
      console.log(`Checked sunset for ${subscriber.city}. Score: ${score}`);

      if (score >= 80) {
        // Your notification threshold
        await transporter.sendMail({
          from: `"Sunset Notifier" <${process.env.GMAIL_USER}>`,
          to: subscriber.email,
          subject: `🌅 Hoàng hôn đẹp sắp tới tại ${subscriber.city}! (${score}/100)`,
          html: `<p>Dự báo hôm nay sẽ có một hoàng hôn rất đẹp tại <strong>${subscriber.city}</strong>!</p><p>Điểm chất lượng dự báo: <strong>${score}/100</strong>.</p><p>Hãy tìm một nơi thoáng đãng để tận hưởng nhé!</p>`,
        });
      }
    }
    return response
      .status(200)
      .json({ message: `Checked ${subscribersData.length} subscribers.` });
  } catch (error) {
    console.error("Error in cron job:", error);
    return response.status(500).json({ message: "Cron job failed." });
  }
}
