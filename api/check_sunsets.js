import { Redis } from "@upstash/redis";
import webpush from "web-push";

const redis = Redis.fromEnv();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// FIX #1: Sửa lại hoàn toàn hàm tính điểm để sử dụng đúng 5 tham số đầu vào.
// Code cũ của bạn bị lỗi ReferenceError vì dùng các biến không tồn tại.
function calculateSunsetQuality(clouds, pm25, visibility, humidity, pressure) {
  const calculateScore = (value, targetStart, targetEnd) => {
    const maxScore = 20;
    if (value >= targetStart && value <= targetEnd) return maxScore;
    const distance =
      value < targetStart ? targetStart - value : value - targetEnd;
    const score = maxScore - (distance * maxScore) / 100;
    return Math.max(0, score);
  };

  const cloudScore = calculateScore(clouds, 40, 60);
  const humidityScore = calculateScore(humidity, 0, 40);
  const visibilityScore = Math.min(20, (visibility / 1000 / 20) * 20);
  const pressureScore = calculateScore(pressure, 1020, 1040);
  const aerosolScore = calculateScore(pm25, 12, 35);

  // FIX #2: Bỏ Math.round() để giữ lại số thập phân cho điểm tổng.
  return (
    cloudScore + humidityScore + visibilityScore + pressureScore + aerosolScore
  );
}

// FIX #3: Thêm hàm findSunsetHourIndex bị thiếu.
function findSunsetHourIndex(sunsetTime, hourlyTimes) {
  const sunsetTimestamp = sunsetTime.getTime();
  for (let i = 0; i < hourlyTimes.length; i++) {
    const hourlyTimestamp = new Date(hourlyTimes[i]).getTime();
    if (hourlyTimestamp >= sunsetTimestamp) {
      if (i > 0) {
        const prevHourlyTimestamp = new Date(hourlyTimes[i - 1]).getTime();
        return Math.abs(sunsetTimestamp - prevHourlyTimestamp) <
          Math.abs(sunsetTimestamp - hourlyTimestamp)
          ? i - 1
          : i;
      }
      return i;
    }
  }
  return hourlyTimes.length - 1;
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
    if (!subData || !subData.locations) continue;

    for (const location of subData.locations) {
      // FIX #4: Cập nhật API URL để lấy đúng 5 yếu tố cần thiết.
      const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=cloud_cover,relative_humidity_2m,visibility,pressure_msl&hourly=cloud_cover,relative_humidity_2m,visibility,pressure_msl&daily=sunset&timezone=${location.timezone}`;
      const airQualityApiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.latitude}&longitude=${location.longitude}&hourly=pm2_5&timezone=${location.timezone}`;

      try {
        const [weatherResponse, airQualityResponse] = await Promise.all([
          fetch(weatherApiUrl),
          fetch(airQualityApiUrl),
        ]);

        const weatherData = await weatherResponse.json();
        const airQualityData = await airQualityResponse.json();

        if (
          !weatherData.hourly ||
          !airQualityData.hourly ||
          !weatherData.daily
        ) {
          console.log(
            `Bỏ qua check cho ${location.city} do thiếu dữ liệu từ API.`
          );
          continue;
        }

        const sunsetTime = new Date(weatherData.daily.sunset[0]);
        const weatherHourIndex = findSunsetHourIndex(
          sunsetTime,
          weatherData.hourly.time
        );
        const airQualityHourIndex = findSunsetHourIndex(
          sunsetTime,
          airQualityData.hourly.time
        );

        const score = calculateSunsetQuality(
          weatherData.hourly.cloud_cover[weatherHourIndex],
          airQualityData.hourly.pm2_5[airQualityHourIndex],
          weatherData.hourly.visibility[weatherHourIndex],
          weatherData.hourly.relative_humidity_2m[weatherHourIndex],
          weatherData.hourly.pressure_msl[weatherHourIndex]
        );

        console.log(
          `Checked subscriber for ${location.city}. Score: ${score.toFixed(1)}`
        );

        if (score >= 80) {
          const offsetSeconds = weatherData.utc_offset_seconds;
          const offsetHours = Math.floor(offsetSeconds / 3600);
          const offsetSign = offsetHours >= 0 ? "+" : "-";
          const offsetString = `${offsetSign}${Math.abs(offsetHours)
            .toString()
            .padStart(2, "0")}:00`;
          const sunsetISOString = `${weatherData.daily.sunset[0]}${offsetString}`;

          const sunsetTimeWithOffset = new Date(sunsetISOString);
          const now = new Date();
          const minutesToSunset =
            (sunsetTimeWithOffset.getTime() - now.getTime()) / (1000 * 60);

          if (minutesToSunset > 0 && minutesToSunset <= 15) {
            const payload = JSON.stringify({
              title: `${score.toFixed(1)}/100 tại ${location.city}`,
              body: `Hoàng hôn trong vòng 15 phút nữa!`,
            });

            try {
              await webpush.sendNotification(subData.subscription, payload);
              console.log(`Notification sent to ${location.city} subscriber.`);
            } catch (error) {
              if (error.statusCode === 410) {
                const keyToDelete = `push-subscriber:${error.endpoint}`;
                console.log(
                  `Subscription for ${error.endpoint} is expired. Deleting...`
                );
                await redis.del(keyToDelete);
              } else {
                console.error(
                  `Error sending notification to ${location.city}:`,
                  error
                );
              }
            }
          }
        }
      } catch (error) {
        console.error(`Lỗi khi xử lý cho thành phố ${location.city}:`, error);
      }
    }
  }

  return response
    .status(200)
    .json({ message: `Checked ${subscribers.length} push subscribers.` });
}
