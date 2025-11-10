// src/components/MapPreview.jsx
import React from "react";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapPreview({ lat, lon, zoom = 16, width = 640, height = 240 }) {
  if (!lat || !lon || !TOKEN) {
    return (
      <div className="w-full h-40 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400">
        Map Preview
      </div>
    );
  }

  const url = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/pin-l+285A98(${lon},${lat})/${lon},${lat},${zoom},0/${width}x${height}@2x?access_token=${TOKEN}`;

  return (
    <div className="w-full">
      <img
        src={url}
        alt="Location preview"
        className="w-full h-auto rounded-2xl border"
        loading="lazy"
      />
      <div className="text-[10px] text-gray-500 mt-1">
        © Mapbox © OpenStreetMap
      </div>
    </div>
  );
}
