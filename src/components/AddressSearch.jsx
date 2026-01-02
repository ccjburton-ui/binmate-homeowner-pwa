import React, { useEffect, useMemo, useState } from "react";

const token = import.meta.env.VITE_MAPBOX_TOKEN;

export default function AddressSearch({
  value,
  onSelect,
  placeholder = "Search address…",
}) {
  const [q, setQ] = useState(value?.label || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const canSearch = useMemo(() => (q || "").trim().length >= 3, [q]);

  useEffect(() => {
    // Keep input in sync if parent passes a saved value
    if (value?.label && value.label !== q) setQ(value.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.label]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setErr("");
      setResults([]);
      setActiveIndex(-1);

      if (!canSearch) return;

      if (!token) {
        setErr("Missing VITE_MAPBOX_TOKEN in .env");
        return;
      }

      setLoading(true);
      try {
        // AU restricted; includes street addresses + places for flexibility
        const url =
          "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
          encodeURIComponent(q) +
          ".json?autocomplete=true&limit=8&country=AU&types=address,place,locality&access_token=" +
          encodeURIComponent(token);

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
        const data = await res.json();

        if (cancelled) return;

        const mapped = (data.features || [])
          .map((f) => ({
            id: f.id,
            label: f.place_name,
            lng: f.center?.[0],
            lat: f.center?.[1],
            raw: f,
          }))
          .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

        setResults(mapped);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Search failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // debounce typing
    const t = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, canSearch]);

  function choose(r) {
    // App expects { label, lat, lng }
    onSelect?.({ label: r.label, lat: r.lat, lng: r.lng });
    setQ(r.label);
    setResults([]);
    setActiveIndex(-1);
  }

  function onKeyDown(e) {
    if (!results.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault();
        choose(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setResults([]);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="space-y-2">
      <input
        className="w-full h-12 rounded-xl border border-gray-200 px-4"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />

      {err ? <div className="text-sm text-red-600">{err}</div> : null}
      {loading ? <div className="text-sm text-gray-500">Searching…</div> : null}

      {results.length > 0 ? (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          {results.map((r, idx) => (
            <button
              key={r.id}
              type="button"
              className={`w-full text-left px-4 py-3 border-b last:border-b-0 ${
                idx === activeIndex ? "bg-gray-50" : "hover:bg-gray-50"
              }`}
              onMouseEnter={() => setActiveIndex(idx)}
              onClick={() => choose(r)}
            >
              <div className="font-medium">{r.label}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
