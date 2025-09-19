import { Redis } from "@upstash/redis";

// Connects to Upstash using the environment variables from the Vercel integration
const redis = Redis.fromEnv();

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Method not allowed." });
  }

  try {
    const { subscription, city } = request.body;

    // Lấy thông tin địa lý của thành phố mới
    const geoResponse = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        city
      )}&count=1`
    );
    const geoData = await geoResponse.json();
    if (!geoData.results || geoData.results.length === 0) {
      return response.status(400).json({ message: "City not found." });
    }
    const newLocation = geoData.results[0];

    const key = `push-subscriber:${subscription.endpoint}`;

    // 1. Đọc dữ liệu cũ từ database
    const existingData = await redis.get(key);

    let finalValue;
    if (existingData) {
      // Nếu đã có đăng ký từ trước
      finalValue = existingData;
      // Kiểm tra xem thành phố mới đã có trong danh sách chưa
      const cityExists = finalValue.locations.some(
        (loc) => loc.id === newLocation.id
      );
      if (cityExists) {
        return response
          .status(200)
          .json({
            message: `Bạn đã đăng ký nhận thông báo cho ${newLocation.name} rồi.`,
          });
      }
      // 2. Thêm thành phố mới vào danh sách
      finalValue.locations.push({
        id: newLocation.id,
        city: newLocation.name,
        latitude: newLocation.latitude,
        longitude: newLocation.longitude,
        timezone: newLocation.timezone,
      });
    } else {
      // Nếu đây là lần đăng ký đầu tiên
      finalValue = {
        subscription,
        locations: [
          {
            id: newLocation.id,
            city: newLocation.name,
            latitude: newLocation.latitude,
            longitude: newLocation.longitude,
            timezone: newLocation.timezone,
          },
        ],
      };
    }

    // 3. Lưu lại dữ liệu đã cập nhật
    await redis.set(key, JSON.stringify(finalValue));
    response
      .status(201)
      .json({
        message: `Đã thêm ${newLocation.name} vào danh sách nhận thông báo!`,
      });
  } catch (error) {
    console.error("Error saving subscription:", error);
    response.status(500).json({ message: "Failed to save subscription." });
  }
}
