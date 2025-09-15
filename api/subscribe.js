import { Redis } from "@upstash/redis";

// Manually initialize the Redis client from your specific Vercel environment variables
const redis = new Redis({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});

const GEOCodingApi = "https://geocoding-api.open-meteo.com/v1/search";

function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

async function getGeoCoordinates(city) {
  try {
    const response = await fetch(
      `${GEOCodingApi}?name=${encodeURIComponent(city)}&count=1`
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.results && data.results.length > 0 ? data.results[0] : null;
  } catch (error) {
    console.error("Error fetching geo coordinates:", error);
    return null;
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response
      .status(405)
      .json({ message: "Only POST requests are allowed." });
  }

  const { city, email } = request.body;

  if (!city || !email) {
    return response
      .status(400)
      .json({ message: "Vui lòng nhập đầy đủ thành phố và email." });
  }
  if (!isValidEmail(email)) {
    return response
      .status(400)
      .json({ message: "Địa chỉ email không hợp lệ." });
  }

  const geoData = await getGeoCoordinates(city);
  if (!geoData) {
    return response
      .status(400)
      .json({
        message: `Không tìm thấy thành phố "${city}". Vui lòng thử lại.`,
      });
  }

  try {
    const subscriberData = {
      email: email,
      city: geoData.name,
      country: geoData.country,
      latitude: geoData.latitude,
      longitude: geoData.longitude,
      timezone: geoData.timezone,
    };

    await redis.set(`subscriber:${email}`, JSON.stringify(subscriberData));
    return response
      .status(200)
      .json({
        message:
          "Đăng ký thành công! Bạn sẽ nhận được email khi có hoàng hôn đẹp.",
      });
  } catch (error) {
    console.error("Error saving to Upstash:", error);
    return response
      .status(500)
      .json({ message: "Đã có lỗi xảy ra. Vui lòng thử lại sau." });
  }
}
