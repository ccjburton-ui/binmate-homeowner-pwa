// src/components/AddressSearch.jsx
import React, { useEffect, useRef, useState } from "react";

const DEFAULT_MAPBOX_TOKEN =
  "pk.eyJ1IjoiZm15YmlucyIsImEiOiJjbWhtaWVsYTQyYXo1MmxxMW9xOGQxbTYxIn0.CGcTed2tafA5-_WjTySPLg";

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || DEFAULT_MAPBOX_TOKEN).trim();

export default function AddressSearch({
  label = "Address",
  value,
  onChange,           // (string) typed text
  onSelect,           // ({ label, lat, lon, suburb, state, postcode }) chosen result
  placeholder = "e.g., 123 Jetty Rd, Rosebud VIC",
}) {
  const [q, setQ] = useState(value || "");
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState("");
  const rootRef = useRef(null);

  // keep external value in sync if parent updates it
  useEffect(() => { setQ(value || ""); }, [value]);

  // close on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // debounced search
  useEffect(() => {
    const term = q?.trim();
    if (!term || term.length < 3) {
      setItems([]);
      setError("");
      return;
    }
    const controller = new AbortController();
    const id = setTimeout(async () => {
      try {
        setError("");
        let out = [];

        if (MAPBOX_TOKEN) {
          const url =
            `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
            `${encodeURIComponent(term)}.json?` +
            `autocomplete=true&country=AU&limit=5&access_token=${MAPBOX_TOKEN}`;
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          out = (data.features || []).map(f => {
            const [lon, lat] = f.center || [];
            const props = f.context || [];
            const byType = Object.fromEntries(
              props.map(x => [String(x.id || "").split(".")[0], x.text])
            );
            return {
              label: f.place_name,
              lat,
              lon,
              suburb: byType.place || byType.locality || "",
              state: byType.region || "",
              postcode: byType.postcode || "",
            };
          });
        } else {
          const url =
            `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(term)}`;
          const res = await fetch(url, {
            signal: controller.signal,
            headers: {
              "Accept-Language": "en",
              "User-Agent": "FmyBins/1.0 (support@fmybins.com)",
            },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          out = (data || []).map(f => ({
            label: f.display_name,
            lat: Number(f.lat),
            lon: Number(f.lon),
            suburb: f.address?.suburb || f.address?.town || f.address?.city || "",
            state: f.address?.state || "",
            postcode: f.address?.postcode || "",
          }));
        }

        setItems(out);
        setOpen(out.length > 0);
        setHighlight(-1);
      } catch (e) {
        if (e.name === "AbortError") return;
        console.error("Address search failed:", e);
        setError("Address lookup unavailable right now. Please type your address manually.");
        setItems([]);
        setOpen(false);
      }
    }, 300);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [q]);

  function handleChange(v) {
    setQ(v);
    onChange?.(v);
  }

  function choose(item) {
    setQ(item.label);
    onChange?.(item.label);
    onSelect?.(item);
    setOpen(false);
  }

  function onKey(e) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && highlight >= 0) {
      e.preventDefault();
      choose(items[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative w-full mb-4">
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <input
        value={q}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="w-full h-11 rounded-xl border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-brand-dark"
      />
      {error && (
        <div className="mt-1 text-xs text-red-600" role="alert">{error}</div>
      )}
      {open && items.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border bg-white shadow-soft overflow-hidden">
          {items.map((it, i) => (
            <button
              type="button"
              key={it.label + i}
              onMouseDown={() => choose(it)}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left px-4 py-2 text-sm ${
                i === highlight ? "bg-brand-muted" : "hover:bg-gray-50"
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}