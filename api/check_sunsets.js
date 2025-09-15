// File: api/check_sunsets.js

import { kv } from "@vercel/kv";
import { Resend } from "resend";

// Initialize Resend with the API key from Vercel Environment Variables
const resend = new Resend(process.env.RESEND_API_KEY);

// Your sunset calculation logic, ported from the frontend to Node.js
// (This is the same logic you already wrote)
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
    const score = maxScore - (distance * maxScore) / 100;
    return Math.max(0, score);
  };

  const cloudScore = calculateScore(cloud_cover, 40, 60);
  const humidityScore = calculateScore(relative_humidity_2m, 0, 40);
  const visibilityScore = Math.min(20, (visibility / 1000 / 20) * 20);
  const windScore = calculateScore(wind_speed_10m, 0, 10);
  const precipScore = calculateScore(precipitation_probability, 0, 5);

  const finalScore = Math.round(
    cloudScore + humidityScore + visibilityScore + windScore + precipScore
  );
  return Math.max(0, Math.min(100, finalScore));
}

export default async function handler(request, response) {
  try {
    // Get all subscriber keys (emails) from the KV store
    const subscriberKeys = [];
    for await (const key of kv.scanIterator()) {
      subscriberKeys.push(key);
    }

    if (subscriberKeys.length === 0) {
      return response
        .status(200)
        .json({ message: "No subscribers to notify." });
    }

    // Get all subscriber data in one go
    const subscribers = await kv.mget(...subscriberKeys);

    for (const subscriber of subscribers) {
      if (!subscriber) continue;

      // 1. Fetch weather for the subscriber's location
      const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${subscriber.latitude}&longitude=${subscriber.longitude}&current=cloud_cover,relative_humidity_2m,visibility,wind_speed_10m,precipitation_probability&timezone=${subscriber.timezone}`;
      const weatherResponse = await fetch(weatherApiUrl);
      const weatherData = await weatherResponse.json();

      // 2. Calculate sunset score
      const score = calculateSunsetQuality(weatherData.current);
      console.log(`Checked sunset for ${subscriber.city}. Score: ${score}`);

      // 3. If score is high, send an email
      if (score >= 80) {
        // Set your threshold
        await resend.emails.send({
          from: "Sunset Notifier <your-verified-email@your-domain.com>", // You must verify a domain or email with Resend
          to: subscriber.email,
          subject: `🌅 Hoàng hôn đẹp sắp tới tại ${subscriber.city}! (${score}/100)`,
          html: `
            <p>Chào bạn,</p>
            <p>Dự báo hôm nay sẽ có một hoàng hôn rất đẹp tại <strong>${subscriber.city}</strong>!</p>
            <p>Điểm chất lượng dự báo: <strong>${score}/100</strong>.</p>
            <p>Hãy tìm một nơi thoáng đãng để tận hưởng nhé!</p>
          `,
        });
      }
    }

    return response
      .status(200)
      .json({ message: `Checked ${subscribers.length} subscribers.` });
  } catch (error) {
    console.error("Error in cron job:", error);
    return response.status(500).json({ message: "Cron job failed." });
  }
}
