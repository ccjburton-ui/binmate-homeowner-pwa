import React from "react";

const AU_PROXIMITY_MEL = [144.9631, -37.8136]; // bias toward Melbourne CBD (lon, lat)

export default function AddressSearch({ label = "Address", value, onChange, onSelect }) {
  const [query, setQuery] = React.useState(value || "");
  const [items, setItems] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const controllerRef = React.useRef(null);
  const listRef = React.useRef(null);

  // keep external value in sync if parent updates it
  React.useEffect(() => { setQuery(value || ""); }, [value]);

  React.useEffect(() => {
    if (!query || query.trim().length < 3) { setItems([]); setOpen(false); return; }

    const run = async () => {
      try {
        setLoading(true);
        if (controllerRef.current) controllerRef.current.abort();
        controllerRef.current = new AbortController();

        const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
        url.searchParams.set("autocomplete", "true");
        url.searchParams.set("country", "au");
        url.searchParams.set("types", "address,place,locality,neighborhood,postcode");
        url.searchParams.set("limit", "6");
        url.searchParams.set("proximity", AU_PROXIMITY_MEL.join(",")); // bias to VIC; adjust later per user GPS
        url.searchParams.set("access_token", import.meta.env.VITE_MAPBOX_TOKEN);

        const res = await fetch(url.toString(), { signal: controllerRef.current.signal });
        if (!res.ok) throw new Error("geocode failed");
        const data = await res.json();

        const next = (data.features || []).map(f => ({
          id: f.id,
          label: f.place_name,
          lon: f.center?.[0],
          lat: f.center?.[1],
          // small helpers:
          suburb: f.context?.find(c => c.id?.startsWith("locality"))?.text || "",
          postcode: f.context?.find(c => c.id?.startsWith("postcode"))?.text || "",
          state: f.context?.find(c => c.id?.startsWith("region"))?.text || "",
        }));
        setItems(next);
        setOpen(true);
      } catch (e) {
        if (e.name !== "AbortError") { setItems([]); setOpen(false); }
      } finally {
        setLoading(false);
      }
    };

    const t = setTimeout(run, 250); // debounce
    return () => clearTimeout(t);
  }, [query]);

  function handleSelect(item) {
    setQuery(item.label);
    setOpen(false);
    onChange?.(item.label);
    onSelect?.(item); // {label,lat,lon,suburb,postcode,state}
  }

  return (
    <div className="mb-4 relative">
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); onChange?.(e.target.value); }}
        onFocus={() => items.length && setOpen(true)}
        placeholder="e.g., 123 Jetty Rd, Rosebud VIC"
        className="w-full h-11 rounded-xl border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-brand-dark"
      />
      {open && items.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-20 mt-1 w-full bg-white rounded-xl border shadow-soft max-h-64 overflow-auto"
        >
          {items.map(item => (
            <button
              key={item.id}
              className="w-full text-left px-4 py-2 hover:bg-brand-muted"
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleSelect(item)}
            >
              {item.label}
            </button>
          ))}
          {loading && <div className="px-4 py-2 text-sm text-gray-500">Searching…</div>}
        </div>
      )}
    </div>
  );
}