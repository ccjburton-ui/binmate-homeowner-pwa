// src/components/MapPreview.jsx
const DEFAULT_MAPBOX_TOKEN =
  "pk.eyJ1IjoiZm15YmlucyIsImEiOiJjbWhtaWVsYTQyYXo1MmxxMW9xOGQxbTYxIn0.CGcTed2tafA5-_WjTySPLg";

export default function MapPreview({ lat, lon }) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN || DEFAULT_MAPBOX_TOKEN;
  console.log("MapPreview props:", { lat, lon, tokenPresent: !!token });

  if (!lat || !lon || !token) {
    console.warn("MapPreview missing input:", { lat, lon, tokenPresent: !!token });
    return (
      <div className="w-full h-40 rounded-2xl bg-gray-100 border flex items-center justify-center text-gray-500">
        Map preview unavailable
      </div>
    );
  }

  const url =
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
    `pin-l+2E3A3A(${lon},${lat})/${lon},${lat},15,0/750x300` +
    `?access_token=${token}`;

  console.log("MapPreview static URL:", url);

  return (
    <img
      src={url}
      alt="Map preview"
      className="w-full h-40 rounded-2xl object-cover border"
      onError={(e) => console.error("Map image failed to load", e)}
      onLoad={() => console.log("Map image loaded OK")}
    />
  );
}