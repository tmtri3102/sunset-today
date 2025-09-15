// File: api/subscribe.js

import { kv } from "@vercel/kv";

// Re-using the GeoCoding API from your frontend for validation
const GEOCodingApi = "https://geocoding-api.open-meteo.com/v1/search";

/**
 * A simple regex to validate email format.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * Fetches coordinates to validate if a city exists.
 * @param {string} city
 * @returns {object|null} Geo data or null if not found.
 */
async function getGeoCoordinates(city) {
  try {
    const response = await fetch(
      `${GEOCodingApi}?name=${encodeURIComponent(city)}&count=1`
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.results || data.results.length === 0) return null;
    return data.results[0];
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

  // --- Validation ---
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

  // --- Save to Database ---
  try {
    // We use the email as a unique key to prevent duplicate subscriptions.
    // The value is an object containing all the info we need for the daily check.
    const subscriberData = {
      email: email,
      city: geoData.name, // Use the official name from the API
      country: geoData.country,
      latitude: geoData.latitude,
      longitude: geoData.longitude,
      timezone: geoData.timezone,
    };

    await kv.set(email, subscriberData);

    return response
      .status(200)
      .json({
        message:
          "Đăng ký thành công! Bạn sẽ nhận được email khi có hoàng hôn đẹp.",
      });
  } catch (error) {
    console.error("Error saving to KV store:", error);
    return response
      .status(500)
      .json({
        message: "Đã có lỗi xảy ra phía máy chủ. Vui lòng thử lại sau.",
      });
  }
}
