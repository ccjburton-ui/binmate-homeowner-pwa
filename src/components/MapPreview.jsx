// src/components/MapPreview.jsx
import React from "react";
const DEFAULT_MAPBOX_TOKEN =
  "pk.eyJ1IjoiZm15YmlucyIsImEiOiJjbWhtaWVsYTQyYXo1MmxxMW9xOGQxbTYxIn0.CGcTed2tafA5-_WjTySPLg";

const STATIC_OSM = ({ lat, lon }) =>
  `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=15&size=750x300&markers=${lat},${lon},lightred1`;

const STATIC_MAPBOX = ({ lat, lon, token }) =>
  `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
  `pin-l+2E3A3A(${lon},${lat})/${lon},${lat},15,0/750x300` +
  `?access_token=${token}`;

export default function MapPreview({ lat, lon }) {
  const token = (import.meta.env.VITE_MAPBOX_TOKEN || DEFAULT_MAPBOX_TOKEN || "").trim();
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  const [src, setSrc] = React.useState(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!hasCoords) {
      setSrc(null);
      return;
    }

    // Try Mapbox first if we have a token, otherwise start with OSM
    if (token) {
      setSrc(STATIC_MAPBOX({ lat, lon, token }));
      setFailed(false);
    } else {
      setSrc(STATIC_OSM({ lat, lon }));
      setFailed(false);
    }
  }, [lat, lon, token, hasCoords]);

  if (!hasCoords) {
    return (
      <div className="w-full h-40 rounded-2xl bg-gray-100 border flex items-center justify-center text-gray-500">
        Map preview unavailable
      </div>
    );
  }

  return (
    <img
      src={src || STATIC_OSM({ lat, lon })}
      alt="Map preview"
      className="w-full h-40 rounded-2xl object-cover border"
      onError={() => {
        if (!failed && token) {
          // fall back to OSM if Mapbox fails (network, token, rate limit, etc.)
          setSrc(STATIC_OSM({ lat, lon }));
          setFailed(true);
        }
      }}
      onLoad={() => setFailed(false)}
    />
  );
}
