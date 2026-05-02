import React, { useEffect, useRef, useState } from "react";
import MapPreview from "./components/MapPreview.jsx";
import AddressSearch from "./components/AddressSearch.jsx";
import { nextWeekly, nextFortnightly, isFortnightlyThisWeek } from "./utils/schedule.js";
import {
  fetchProperties, upsertProperty, deleteProperty as dbDeleteProperty,
  fetchJobs, upsertJob, upsertJobs, updateJob,
  fetchProviders, upsertProvider, deleteProvider as dbDeleteProvider,
  fetchNotifications, insertNotification, markNotificationsRead, clearNotifications,
  fetchProviderNotifications, insertProviderNotification, clearProviderNotifications,
  saveSetting, fetchSetting,
} from "./db.js";

// ─── Utilities ────────────────────────────────────────────────────────────────

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addrWithUnit(property) {
  const base = typeof property?.address === "object" ? property?.address?.label : property?.address || "";
  return property?.unit ? `${property.unit}/${base}` : base;
}

function startOfNextWeekMonday(now = new Date()) {
  const day = now.getDay();
  const daysUntilNextMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysUntilNextMonday);
  return d;
}

function weekdayToJsDay(weekday) {
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? null;
}

function setTime(d, hh, mm) {
  const x = new Date(d);
  x.setHours(hh, mm, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isDueFortnightly(startISO, targetDate) {
  if (!startISO) return false;
  const start  = new Date(`${startISO}T00:00:00`);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - start) / 86400000);
  return diffDays >= 0 && diffDays % 14 === 0;
}

function makeId() {
  try { return crypto.randomUUID(); }
  catch { return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
       + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtShortDate(d) {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// ─── Job offer engine ─────────────────────────────────────────────────────────
// Returns updated jobs array with next auto-offer applied after a decline.
// Priority: active providers not in offerHistory, sorted by fewest current jobs.

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center px-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="font-heading font-semibold text-xl mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-500 mb-2">{this.state.error?.message}</p>
          <pre className="text-xs text-red-500 bg-red-50 rounded-xl p-3 mb-4 text-left max-w-sm overflow-auto">
            {this.state.error?.stack?.slice(0, 400)}
          </pre>
          <button onClick={() => this.setState({ error: null })}
            className="h-11 px-6 rounded-xl bg-brand-dark text-white font-semibold text-sm">
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}



function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function providerCoversProperty(provider, property) {
  if (!provider.serviceArea) return true; // no area set → assume covers all
  const { lat, lng, radiusKm } = provider.serviceArea;
  if (!lat || !lng || !radiusKm) return true;
  const pLat = property.lat ?? property.address?.lat;
  const pLng = property.lng ?? property.address?.lng;
  if (!pLat || !pLng) return true; // no coords on property → don't exclude
  return haversineKm(lat, lng, Number(pLat), Number(pLng)) <= radiusKm;
}

function autoOffer(jobs, providers, jobId, properties = []) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return jobs;
  const property = properties.find(p => p.id === job.propertyId);
  const history  = job.offerHistory || [];

  // Filter by coverage first, fall back to all active if none cover the area
  const active    = providers.filter(p => p.active && !history.includes(p.id));
  const covering  = property ? active.filter(p => providerCoversProperty(p, property)) : active;
  const eligible  = (covering.length > 0 ? covering : active)
    .sort((a, b) => {
      const aLoad = jobs.filter(j => j.offeredTo === a.id || j.providerId === a.id).length;
      const bLoad = jobs.filter(j => j.offeredTo === b.id || j.providerId === b.id).length;
      return aLoad - bLoad;
    });

  if (eligible.length === 0) {
    return jobs.map(j => j.id === jobId
      ? { ...j, status: "unassigned", offeredTo: null, providerId: null, allDeclined: true }
      : j);
  }
  const next = eligible[0];
  return jobs.map(j => j.id === jobId
    ? { ...j, status: "offered", offeredTo: next.id, providerId: null, allDeclined: false }
    : j);
}

function monthlyRate(property) {
  return 59.90 + (property?.driveLong ? 15.00 : 0);
}


// ─── Bin / property config ────────────────────────────────────────────────────

const BIN_OPTIONS = [
  { key: "general",   label: "General",   emoji: "🗑️" },
  { key: "recycling", label: "Recycling", emoji: "♻️" },
  { key: "fogo",      label: "FOGO",      emoji: "🌿" },
  { key: "glass",     label: "Glass",     emoji: "🍶" },
];
function binLabel(key) { return BIN_OPTIONS.find(b => b.key === key)?.label || key; }

const PROPERTY_TYPES = ["Holiday Home", "Strata", "Residential", "Other"];

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function Header({ onBack, right }) {
  return (
    <div className="w-full flex items-center justify-between py-4 px-5 sticky top-0 bg-white/90 backdrop-blur z-10 border-b">
      <button onClick={onBack}
        className={`text-sm px-3 py-1 rounded-full border transition hover:bg-gray-50 ${onBack ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        ← Back
      </button>
      <h1 className="text-lg font-semibold text-brand-fg font-heading">FmyBins</h1>
      <div className="w-[60px] flex justify-end">{right}</div>
    </div>
  );
}

function NotifBell({ appState, setAppState }) {
  const [open, setOpen] = useState(false);
  const notifications   = appState?.notifications || [];
  const unread          = notifications.filter(n => !n.read).length;

  function markAllRead() {
    setAppState(s => ({ ...s, notifications: (s.notifications || []).map(n => ({ ...n, read: true })) }));
  }
  function clearAll() {
    setAppState(s => ({ ...s, notifications: [] }));
    setOpen(false);
  }

  if (!appState) return <div className="w-6" />;
  return (
    <div className="relative">
      <button onClick={() => { setOpen(true); markAllRead(); }}
        className="relative text-sm px-2.5 py-1 rounded-full border">
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <NotificationDrawer
          notifications={notifications}
          onClose={() => setOpen(false)}
          onMarkAllRead={markAllRead}
          onClear={clearAll}
        />
      )}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full h-12 rounded-xl text-white font-semibold transition active:scale-[0.98] ${disabled ? "bg-gray-300 cursor-not-allowed" : "bg-brand-dark hover:opacity-90"}`}>
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }) {
  return (
    <button onClick={onClick}
      className="w-full h-12 rounded-xl border border-gray-300 text-brand-fg font-semibold hover:bg-brand-muted transition">
      {children}
    </button>
  );
}

function Input({ label, placeholder, type = "text", value, onChange, autoComplete }) {
  return (
    <label className="block w-full mb-4">
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full h-11 rounded-xl border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-brand-dark" />
    </label>
  );
}

function TextArea({ label, placeholder, value, onChange }) {
  return (
    <label className="block w-full mb-4">
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <textarea placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} rows={3}
        className="w-full rounded-xl border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-brand-dark resize-none" />
    </label>
  );
}

function Toggle({ label, sub, checked, onChange }) {
  return (
    <div className="flex items-center justify-between w-full py-3">
      <div>
        <div className="text-gray-800 text-sm">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
      <button onClick={() => onChange(!checked)}
        className={`w-12 h-7 rounded-full p-1 transition flex-shrink-0 ml-4 ${checked ? "bg-brand-dark" : "bg-gray-300"}`}>
        <div className={`h-5 w-5 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function Badge({ children, color = "gray" }) {
  const cls = {
    green:  "bg-green-100 text-green-800",
    yellow: "bg-yellow-100 text-yellow-800",
    red:    "bg-red-100 text-red-800",
    blue:   "bg-blue-100 text-blue-800",
    purple: "bg-purple-100 text-purple-800",
    orange: "bg-orange-100 text-orange-800",
    gray:   "bg-gray-100 text-gray-700",
  }[color] || "bg-gray-100 text-gray-700";
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{children}</span>;
}

function Card({ children, className = "", onClick }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 p-4 ${onClick ? "cursor-pointer hover:border-brand-dark transition" : ""} ${className}`}
      onClick={onClick}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <Card>
      <div className="text-2xl font-bold text-brand-fg font-heading">{value}</div>
      <div className="text-sm text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-brand-dark mt-1">{sub}</div>}
    </Card>
  );
}

function WeekdaySelect({ value, onChange }) {
  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  return (
    <div className="w-full mb-4">
      <div className="text-sm text-gray-600 mb-1">Bin Collection Day</div>
      <div className="grid grid-cols-7 gap-1">
        {days.map(d => (
          <button key={d} onClick={() => onChange(d)}
            className={`h-9 rounded-lg border text-sm font-medium transition ${value === d ? "bg-brand-dark text-white border-brand-dark" : "border-gray-300 hover:border-brand-dark"}`}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

function DateInput({ label, value, onChange, hint }) {
  return (
    <label className="block w-full mb-4">
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <input type="date" value={value || ""} onChange={e => onChange(e.target.value)}
        className="w-full h-11 rounded-xl border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-brand-dark" />
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </label>
  );
}

function BinGrid({ bins, onToggle }) {
  return (
    <div className="grid grid-cols-4 gap-2 my-3">
      {BIN_OPTIONS.map(opt => {
        const isOn = bins.includes(opt.key);
        return (
          <button key={opt.key} type="button" onClick={() => onToggle(opt.key)}
            className={`aspect-square rounded-2xl flex flex-col items-center justify-center border text-center px-1 transition ${isOn ? "border-brand-dark bg-brand-muted" : "border-gray-300 bg-white hover:border-gray-400"}`}>
            <div className={`text-2xl mb-1 ${isOn ? "" : "opacity-40"}`}>{opt.emoji}</div>
            <div className="text-[11px] font-medium">{opt.label}</div>
          </button>
        );
      })}
    </div>
  );
}

function StepDots({ current, total }) {
  return (
    <div className="flex justify-center gap-2 py-4">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`rounded-full transition-all ${i === current ? "w-6 h-2 bg-brand-dark" : "w-2 h-2 bg-gray-300"}`} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AUTH SCREENS ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function RolePicker({ onCustomer, onProvider, onOps }) {
  return (
    <div className="min-h-screen bg-brand-muted flex flex-col items-center justify-center px-4">
      <img src="/FmyBins_Logo_Transparent.png" alt="FmyBins" className="mb-8 w-72 max-w-[85%] h-auto" />
      <div className="w-full max-w-sm space-y-3">
        {[
          { emoji: "🏠", title: "I'm a Customer", sub: "Manage my bin service",  onClick: onCustomer },
          { emoji: "🚛", title: "I'm a Provider",  sub: "View my jobs for today", onClick: onProvider },
        ].map(item => (
          <button key={item.title} onClick={item.onClick}
            className="w-full bg-white rounded-2xl border border-gray-200 px-5 py-4 text-left hover:border-brand-dark transition group shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-brand-muted flex items-center justify-center text-2xl flex-shrink-0 group-hover:bg-brand-dark/10 transition">
                {item.emoji}
              </div>
              <div>
                <div className="font-semibold text-brand-fg">{item.title}</div>
                <div className="text-sm text-gray-400 mt-0.5">{item.sub}</div>
              </div>
              <div className="ml-auto text-gray-300 group-hover:text-brand-dark transition text-lg">→</div>
            </div>
          </button>
        ))}
        <button onClick={onOps} className="w-full text-center text-xs text-gray-400 py-3 hover:text-gray-600 transition">
          Ops access →
        </button>
      </div>
      <p className="mt-10 text-[11px] text-gray-400">Early access build</p>
    </div>
  );
}

function CustomerLogin({ onBack, onSignIn, onCreateAccount }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [mode, setMode]         = useState("signin");

  return (
    <div className="min-h-screen bg-brand-muted flex flex-col">
      <div className="flex items-center px-5 py-4">
        <button onClick={onBack} className="text-sm px-3 py-1 rounded-full border bg-white hover:bg-gray-50 transition">← Back</button>
        <div className="flex-1 text-center"><span className="text-base font-semibold text-brand-fg font-heading">FmyBins</span></div>
        <div className="w-[60px]" />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🏠</div>
            <h2 className="text-2xl font-bold font-heading text-brand-fg mb-1">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="text-sm text-gray-500">
              {mode === "signin" ? "Sign in to manage your bin service." : "Get started in under 2 minutes."}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-1">
            <Input label="Email" placeholder="you@example.com" type="email" value={email} onChange={setEmail} autoComplete="email" />
            <Input label="Password" placeholder={mode === "signin" ? "Your password" : "Choose a password"} type="password"
              value={password} onChange={setPassword} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
            {error && <div className="text-red-500 text-sm pb-1">{error}</div>}
            {mode === "signin"
              ? <>
                  <PrimaryButton onClick={() => { if (!email) { setError("Please enter your email."); return; } onSignIn(); }}>Sign In</PrimaryButton>
                  <div className="pt-2"><button className="w-full text-center text-sm text-gray-400 hover:text-brand-dark py-1">Forgot password?</button></div>
                </>
              : <PrimaryButton onClick={() => { if (!email) { setError("Please enter your email."); return; } onCreateAccount(); }}>Create Account →</PrimaryButton>
            }
          </div>
          <div className="text-center mt-5 text-sm text-gray-500">
            {mode === "signin"
              ? <>Don't have an account? <button onClick={() => { setMode("create"); setError(""); }} className="text-brand-dark font-semibold">Sign up</button></>
              : <>Already have an account? <button onClick={() => { setMode("signin"); setError(""); }} className="text-brand-dark font-semibold">Sign in</button></>
            }
          </div>
          {mode === "create" && (
            <div className="mt-5 rounded-xl bg-white/70 border border-brand-dark/20 px-4 py-3 text-sm text-brand-fg text-center">
              From <strong>$59.90/month</strong> · No contracts · Cancel anytime
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomerWelcome({ onViewProperties, onAddProperty, onSignOut, properties }) {
  const count = properties.length;
  return (
    <div className="min-h-screen bg-brand-muted flex flex-col">
      <div className="flex items-center justify-between px-5 py-4">
        <h1 className="text-lg font-semibold text-brand-fg font-heading">FmyBins</h1>
        <button onClick={onSignOut} className="text-xs border border-gray-300 text-gray-400 px-3 py-1 rounded-full hover:text-gray-600 transition">Sign out</button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">👋</div>
            <h2 className="text-2xl font-bold font-heading text-brand-fg mb-1">Welcome!</h2>
            <p className="text-sm text-gray-500">
              {count > 0 ? `You have ${count} propert${count === 1 ? "y" : "ies"} on your plan.` : "Let's get your first property set up."}
            </p>
          </div>
          <div className="space-y-3">
            {count > 0 && (
              <button onClick={onViewProperties}
                className="w-full bg-white rounded-2xl border border-gray-200 px-5 py-5 text-left hover:border-brand-dark transition group shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-brand-muted flex items-center justify-center text-2xl flex-shrink-0 group-hover:bg-brand-dark/10 transition">🏠</div>
                  <div>
                    <div className="font-semibold text-brand-fg">View My Properties</div>
                    <div className="text-sm text-gray-400 mt-0.5">{count} propert{count === 1 ? "y" : "ies"} · manage schedules & billing</div>
                  </div>
                  <div className="ml-auto text-gray-300 group-hover:text-brand-dark transition text-lg">→</div>
                </div>
              </button>
            )}
            <button onClick={onAddProperty}
              className="w-full bg-white rounded-2xl border border-gray-200 px-5 py-5 text-left hover:border-brand-dark transition group shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-brand-muted flex items-center justify-center text-2xl flex-shrink-0 group-hover:bg-brand-dark/10 transition">➕</div>
                <div>
                  <div className="font-semibold text-brand-fg">{count === 0 ? "Add Your First Property" : "Add Another Property"}</div>
                  <div className="text-sm text-gray-400 mt-0.5">{count === 0 ? "Get started in under 2 minutes" : "Holiday homes, strata, rentals…"}</div>
                </div>
                <div className="ml-auto text-gray-300 group-hover:text-brand-dark transition text-lg">→</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SERVICE AREA PICKER ─────────────────────────────────────────────────────

function ServiceAreaPicker({ value, onChange }) {
  const mapRef      = useRef(null);
  const leafletMap  = useRef(null);
  const markerRef   = useRef(null);
  const circleRef   = useRef(null);
  const [radius, setRadius] = useState(value?.radiusKm || 5);
  const [centre, setCentre] = useState(
    value?.lat && value?.lng ? { lat: value.lat, lng: value.lng } : null
  );
  const [leafletReady, setLeafletReady] = useState(!!window.L);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);

  // Load Leaflet CSS + JS if not already loaded
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    script.onload = () => setLeafletReady(true);
    document.head.appendChild(script);
  }, []);

  // Init map once Leaflet is ready
  useEffect(() => {
    if (!leafletReady || !mapRef.current || leafletMap.current) return;
    const L   = window.L;
    const initLat = centre?.lat || -37.7749;
    const initLng = centre?.lng || 144.9963;
    const map = L.map(mapRef.current, { zoomControl: true }).setView([initLat, initLng], centre ? 11 : 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);
    leafletMap.current = map;

    if (centre) {
      addMarkerAndCircle(L, map, centre.lat, centre.lng, radius);
    }

    map.on("click", e => {
      const { lat, lng } = e.latlng;
      setCentre({ lat, lng });
      addMarkerAndCircle(L, map, lat, lng, radius);
      onChange({ lat, lng, radiusKm: radius });
    });

    return () => { map.remove(); leafletMap.current = null; };
  }, [leafletReady]);

  // Update circle when radius changes
  useEffect(() => {
    if (!circleRef.current) return;
    circleRef.current.setRadius(radius * 1000);
    if (centre) onChange({ ...centre, radiusKm: radius });
  }, [radius]);

  function addMarkerAndCircle(L, map, lat, lng, r) {
    if (markerRef.current) markerRef.current.remove();
    if (circleRef.current) circleRef.current.remove();
    const icon = L.divIcon({
      html: `<div style="background:#2E3A3A;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8], className: "",
    });
    markerRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
    markerRef.current.on("dragend", e => {
      const { lat: newLat, lng: newLng } = e.target.getLatLng();
      setCentre({ lat: newLat, lng: newLng });
      circleRef.current?.setLatLng([newLat, newLng]);
      onChange({ lat: newLat, lng: newLng, radiusKm: radius });
    });
    circleRef.current = L.circle([lat, lng], {
      radius: r * 1000, color: "#2E3A3A", fillColor: "#2E3A3A", fillOpacity: 0.15, weight: 2,
    }).addTo(map);
    map.setView([lat, lng], 11);
  }

  async function searchSuburb() {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(search + ", Australia")}&limit=1`);
      const data = await res.json();
      if (data[0]) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        setCentre({ lat, lng });
        const L = window.L;
        if (leafletMap.current && L) addMarkerAndCircle(L, leafletMap.current, lat, lng, radius);
        onChange({ lat, lng, radiusKm: radius });
      }
    } catch {}
    setSearching(false);
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && searchSuburb()}
          placeholder="Search suburb or address…"
          className="flex-1 h-10 rounded-xl bg-white/10 border border-white/20 px-3 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark" />
        <button onClick={searchSuburb} disabled={searching}
          className="h-10 px-4 rounded-xl bg-brand-dark text-white text-sm font-medium hover:opacity-90 transition">
          {searching ? "…" : "Search"}
        </button>
      </div>
      {!leafletReady && (
        <div className="w-full h-56 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 text-sm">
          Loading map…
        </div>
      )}
      <div ref={mapRef} className="w-full h-56 rounded-2xl overflow-hidden border border-white/20"
        style={{ display: leafletReady ? "block" : "none" }} />
      <p className="text-xs text-white/40 mt-1.5 mb-3">
        {centre ? "Tap the map or drag the pin to reposition." : "Tap the map or search a suburb to set your centre point."}
      </p>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-white/60">Service radius</span>
          <span className="text-sm font-semibold text-white">{radius} km</span>
        </div>
        <input type="range" min={1} max={50} step={1} value={radius}
          onChange={e => setRadius(Number(e.target.value))}
          className="w-full accent-brand-dark" />
        <div className="flex justify-between text-xs text-white/30 mt-0.5">
          <span>1 km</span><span>50 km</span>
        </div>
      </div>
      {centre && (
        <div className="mt-2 text-xs text-white/40">
          Centre: {centre.lat.toFixed(4)}, {centre.lng.toFixed(4)} · {radius}km radius
        </div>
      )}
    </div>
  );
}

function ProviderLogin({ onBack, onSuccess, onSignUp, providers }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  function handleLogin() {
    if (!username || !password) { setError("Please enter your username and password."); return; }
    setLoading(true); setError("");
    setTimeout(() => {
      setLoading(false);
      const match = providers.find(p =>
        p.active &&
        (p.username || p.name.toLowerCase().replace(/\s+/g, "")) === username.toLowerCase().trim() &&
        (p.password || "password") === password
      );
      if (match) { onSuccess(match.id); }
      else { setError("Incorrect username or password."); setPassword(""); }
    }, 400);
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col text-white">
      <div className="flex items-center px-5 py-4">
        <button onClick={onBack} className="text-sm px-3 py-1 rounded-full border border-white/20 text-white/70 hover:bg-white/10 transition">← Back</button>
        <div className="flex-1 text-center"><span className="text-base font-semibold font-heading">FmyBins</span></div>
        <div className="w-[60px]" />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-5 pb-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🚛</div>
            <h2 className="text-2xl font-bold font-heading mb-1">Provider Login</h2>
            <p className="text-sm text-white/50">Sign in to see your jobs.</p>
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-sm text-white/60 mb-1">Username</div>
              <input type="text" placeholder="your.username" value={username}
                onChange={e => { setUsername(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                autoCapitalize="none" autoComplete="username"
                className="w-full h-12 rounded-xl bg-white/10 border border-white/20 px-4 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-dark" />
            </div>
            <div>
              <div className="text-sm text-white/60 mb-1">Password</div>
              <input type="password" placeholder="••••••••" value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                autoComplete="current-password"
                className="w-full h-12 rounded-xl bg-white/10 border border-white/20 px-4 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-dark" />
            </div>
            {error && <div className="bg-red-500/20 border border-red-500/40 rounded-xl px-4 py-2 text-red-300 text-sm">{error}</div>}
            <button onClick={handleLogin} disabled={loading || !username || !password}
              className={`w-full h-12 rounded-xl font-semibold transition active:scale-[0.98] ${loading || !username || !password ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-brand-dark text-white hover:opacity-90"}`}>
              {loading ? "Signing in…" : "Sign In →"}
            </button>
          </div>
          <div className="mt-8 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
            <div className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Demo credentials</div>
            <div className="space-y-1 text-xs text-white/50 font-mono">
              <div>alex / password</div>
              <div>jamie / password</div>
              <div>taylor / password</div>
            </div>
          </div>
          <button onClick={onSignUp}
            className="w-full mt-4 h-11 rounded-xl border border-white/20 text-white/60 text-sm font-medium hover:bg-white/10 hover:text-white transition">
            New provider? Register here →
          </button>
          <p className="text-xs text-white/25 text-center mt-5">Can't log in? Contact your ops manager.</p>
        </div>
      </div>
    </div>
  );
}

function ProviderSignup({ onBack, onDone }) {
  const [step,       setStep]       = useState(0); // 0=details, 1=service area
  const [name,       setName]       = useState("");
  const [phone,      setPhone]      = useState("");
  const [bio,        setBio]        = useState("");
  const [serviceArea, setServiceArea] = useState(null);
  const [done,       setDone]       = useState(false);

  function submit() {
    if (!name || !phone) return;
    const newProvider = {
      id: makeId(), name, phone, bio, serviceArea,
      active: false, pending: true,
      username: name.toLowerCase().replace(/\s+/g, "."),
      password: "password",
      appliedAt: new Date().toISOString(),
    };
    onDone(newProvider);
    setDone(true);
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col text-white items-center justify-center px-5">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold font-heading mb-2 text-center">Application Submitted!</h2>
        <p className="text-white/50 text-sm text-center mb-6 max-w-xs">
          Thanks {name}! Your application is being reviewed by our team. We'll be in touch shortly.
        </p>
        <button onClick={onBack}
          className="h-11 px-6 rounded-xl bg-brand-dark text-white font-semibold hover:opacity-90 transition">
          Back to Login
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col text-white">
      <div className="flex items-center px-5 py-4">
        <button onClick={step === 0 ? onBack : () => setStep(0)}
          className="text-sm px-3 py-1 rounded-full border border-white/20 text-white/70 hover:bg-white/10 transition">← Back</button>
        <div className="flex-1 text-center"><span className="text-base font-semibold font-heading">FmyBins</span></div>
        <div className="w-[60px]" />
      </div>
      <div className="flex-1 px-5 pb-12 max-w-sm mx-auto w-full pt-4">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🚛</div>
          <h2 className="text-2xl font-bold font-heading mb-1">Join as a Provider</h2>
          <p className="text-sm text-white/50">Step {step + 1} of 2 — {step === 0 ? "Your details" : "Service area"}</p>
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <div>
              <div className="text-sm text-white/60 mb-1">Full name <span className="text-red-400">*</span></div>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jordan Smith"
                className="w-full h-12 rounded-xl bg-white/10 border border-white/20 px-4 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-dark" />
            </div>
            <div>
              <div className="text-sm text-white/60 mb-1">Phone number <span className="text-red-400">*</span></div>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 0412 345 678" type="tel"
                className="w-full h-12 rounded-xl bg-white/10 border border-white/20 px-4 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-dark" />
            </div>
            <div>
              <div className="text-sm text-white/60 mb-1">Brief bio (optional)</div>
              <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3}
                placeholder="e.g. Reliable, punctual, available most weekday mornings…"
                className="w-full rounded-xl bg-white/10 border border-white/20 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-dark resize-none text-sm" />
            </div>
            <button onClick={() => setStep(1)} disabled={!name || !phone}
              className={`w-full h-12 rounded-xl font-semibold transition active:scale-[0.98] ${!name || !phone ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-brand-dark text-white hover:opacity-90"}`}>
              Next: Set Service Area →
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-white/50">Set the area you're willing to service. Search your suburb and adjust the radius.</p>
            <ServiceAreaPicker value={serviceArea} onChange={setServiceArea} />
            <button onClick={submit}
              className="w-full h-12 rounded-xl bg-brand-dark text-white font-semibold hover:opacity-90 transition active:scale-[0.98]">
              Submit Application →
            </button>
            <button onClick={submit} className="w-full text-center text-sm text-white/30 hover:text-white/50 transition">
              Skip for now
            </button>
            <p className="text-xs text-white/30 text-center">Applications are reviewed within 1–2 business days.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OpsLogin({ onBack, onSuccess }) {
  const [pwd, setPwd]   = useState("");
  const [error, setError] = useState("");
  const REQUIRED = import.meta.env.VITE_SITE_PASSWORD || "";

  function handleSubmit(e) {
    e?.preventDefault();
    if (!REQUIRED || pwd === REQUIRED) { onSuccess(); }
    else { setError("Incorrect password."); setPwd(""); }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col text-white">
      <div className="flex items-center px-5 py-4">
        <button onClick={onBack} className="text-sm px-3 py-1 rounded-full border border-white/20 text-white/60 hover:bg-white/10 transition">← Back</button>
        <div className="flex-1 text-center"><span className="text-base font-semibold font-heading text-white/80">FmyBins Ops</span></div>
        <div className="w-[60px]" />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-5 pb-16">
        <div className="w-full max-w-xs">
          <div className="text-center mb-8">
            <div className="text-3xl mb-3">🔒</div>
            <h2 className="text-xl font-bold font-heading mb-1">Ops Access</h2>
            <p className="text-sm text-white/40">Authorised personnel only.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input type="password" placeholder="Password" value={pwd}
              onChange={e => { setPwd(e.target.value); setError(""); }}
              autoComplete="current-password"
              className="w-full h-12 rounded-xl bg-white/10 border border-white/20 px-4 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-dark" />
            {error && <div className="text-red-400 text-sm text-center">{error}</div>}
            <button type="submit" className="w-full h-12 rounded-xl bg-brand-dark text-white font-semibold hover:opacity-90 transition">Enter</button>
          </form>
          <p className="text-xs text-white/25 text-center mt-6">Contact Chelsea for access.</p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ONBOARDING / PROPERTY FLOWS ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const STEP_LABELS = ["Choose Plan", "Address & Type", "Bins & Schedule", "Access"];

function emptyDraft() {
  return { type: "Holiday Home", address: null, unit: "", notes: "", bins: [], pickupWeekday: "",
           startDates: { recycling: "", fogo: "", glass: "" }, gate: "", driveLong: false, active: true };
}

function stepCanProceed(step, draft, plan) {
  if (step === 0) return !!plan; // plan selection
  if (step === 1) return !!draft.address && !!draft.type;
  if (step === 2) {
    if (!draft.bins.length) return false;
    if (plan === "pack") return true;
    if (!draft.pickupWeekday) return false;
    if (draft.bins.includes("recycling") && !draft.startDates.recycling) return false;
    if (draft.bins.includes("fogo")      && !draft.startDates.fogo)      return false;
    if (draft.bins.includes("glass")     && !draft.startDates.glass)     return false;
    return true;
  }
  return true;
}

function PropertyFormStep({ step, draft, setDraft, plan }) {
  function toggleBin(key) {
    setDraft(d => ({ ...d, bins: d.bins.includes(key) ? d.bins.filter(k => k !== key) : [...d.bins, key] }));
  }
  if (step === 1) {
    const hasCoords = draft.address?.lat != null && draft.address?.lng != null;
    return (
      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">Property type</div>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {PROPERTY_TYPES.map(t => (
            <button key={t} onClick={() => setDraft(d => ({ ...d, type: t }))}
              className={`h-10 rounded-xl border text-sm font-medium transition ${draft.type === t ? "border-brand-dark bg-brand-muted text-brand-fg" : "border-gray-300 hover:border-gray-400"}`}>{t}</button>
          ))}
        </div>
        <div className="text-sm text-gray-600 mb-1">Property address</div>
        <AddressSearch value={draft.address} onSelect={picked => setDraft(d => ({ ...d, address: picked || null }))} placeholder="Search address…" />
        {draft.address && <div className="mt-1 text-xs text-gray-400">{draft.address.label}{hasCoords && ` · ${Number(draft.address.lat).toFixed(4)}, ${Number(draft.address.lng).toFixed(4)}`}</div>}
        {hasCoords && <div className="mt-3 mb-1"><MapPreview lat={draft.address.lat} lon={draft.address.lng} /></div>}
        <div className="mt-3">
          <Input label="Unit / apartment number (optional)" placeholder="e.g. 4B, Unit 12, Apt 3" value={draft.unit || ""} onChange={v => setDraft(d => ({ ...d, unit: v }))} />
        </div>
        <div className="mt-1">
          <TextArea label="Access notes (optional)" placeholder="Parking, pets, entry instructions, bin location…" value={draft.notes} onChange={v => setDraft(d => ({ ...d, notes: v }))} />
        </div>
      </div>
    );
  }
  if (step === 2) {
    const isPack = plan === "pack";
    return (
      <div>
        <div className="text-sm text-gray-600 mb-1">Which bins does this property have?</div>
        <BinGrid bins={draft.bins} onToggle={toggleBin} />
        {isPack ? (
          <div className="mt-3 rounded-xl bg-brand-muted border border-brand-dark/10 px-4 py-3 text-sm text-brand-fg">
            🎟️ You're on the 10-Service Pack — you'll choose your collection date each time you book, no fixed schedule needed.
          </div>
        ) : (
          <>
            <WeekdaySelect value={draft.pickupWeekday} onChange={v => setDraft(d => ({ ...d, pickupWeekday: v }))} />
            {draft.bins.includes("recycling") && (
              <DateInput label="Recycling — next collection date" value={draft.startDates.recycling}
                onChange={v => setDraft(d => ({ ...d, startDates: { ...d.startDates, recycling: v } }))} hint="Collected fortnightly." />
            )}
            {draft.bins.includes("fogo") && (
              <DateInput label="FOGO / Green — next collection date" value={draft.startDates.fogo}
                onChange={v => setDraft(d => ({ ...d, startDates: { ...d.startDates, fogo: v } }))} hint="Collected fortnightly." />
            )}
            {draft.bins.includes("glass") && (
              <DateInput label="Glass — next collection date" value={draft.startDates.glass}
                onChange={v => setDraft(d => ({ ...d, startDates: { ...d.startDates, glass: v } }))} hint="Collected fortnightly." />
            )}
            <p className="text-xs text-gray-400 mt-1">General waste is weekly. Others are fortnightly.</p>
          </>
        )}
      </div>
    );
  }
  if (step === 3) {
    return (
      <div>
        <Input label="Gate code (optional)" placeholder="e.g. 1234" value={draft.gate} onChange={v => setDraft(d => ({ ...d, gate: v }))} />
        <div className="w-full h-24 rounded-2xl border border-dashed border-gray-300 text-gray-400 flex flex-col items-center justify-center mb-4 text-sm gap-1">
          <span className="text-xl">📷</span>Upload bin location photo (optional)
        </div>
        <Toggle label="Long or steep driveway" sub="+$15.00/month" checked={draft.driveLong} onChange={v => setDraft(d => ({ ...d, driveLong: v }))} />
      </div>
    );
  }
  return null;
}

function AddPropertyFlow({ onBack, onDone, existingCount, appState, setAppState }) {
  const [step, setStep]   = useState(0);
  const [plan, setPlan]   = useState("monthly");
  const [draft, setDraft] = useState(emptyDraft());

  function next() {
    if (step < 3) { setStep(s => s + 1); return; }
    onDone(draft, plan);
  }

  return (
    <div className="min-h-screen bg-white">
      <Header onBack={step === 0 ? onBack : () => setStep(s => s - 1)} right={<NotifBell appState={appState} setAppState={setAppState} />} />
      <div className="max-w-md mx-auto px-5 pb-8">
        <StepDots current={step} total={4} />
        <h2 className="font-heading font-semibold text-xl text-brand-fg mb-0.5">{existingCount === 0 ? "Add your first property" : "Add another property"}</h2>
        <p className="text-sm text-gray-400 mb-5">Step {step + 1} of 4 — {STEP_LABELS[step]}</p>

        {step === 0 && (
          <div className="space-y-3">
            {PLANS.map(p => (
              <button key={p.key} onClick={() => setPlan(p.key)}
                className={`w-full text-left rounded-2xl border-2 p-4 transition ${plan === p.key ? "border-brand-dark bg-brand-muted" : "border-gray-200 hover:border-gray-300 bg-white"}`}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl flex-shrink-0 mt-0.5">{p.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-brand-fg text-sm">{p.name}</span>
                      {p.badge && <Badge color={p.key === "urgent" ? "red" : "blue"}>{p.badge}</Badge>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{p.tagline}</div>
                    <div className="text-xs text-gray-500 mt-1">{p.detail}</div>
                  </div>
                  <div className="font-bold text-brand-fg text-sm flex-shrink-0">{p.price}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step > 0 && <PropertyFormStep step={step} draft={draft} setDraft={setDraft} plan={plan} />}

        <div className="mt-4">
          <PrimaryButton onClick={next} disabled={!stepCanProceed(step, draft, plan)}>
            {step < 3 ? `Next: ${STEP_LABELS[step + 1]} →` : "Save Property →"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function EditPropertyFlow({ property, onBack, onSave, onDelete, onChangePlan, appState, setAppState }) {
  const [step, setStep]         = useState(0);
  const [draft, setDraft]       = useState({
    type: property.type || "Holiday Home", address: property.address || null,
    unit: property.unit || "",
    notes: property.notes || "", bins: property.bins || [],
    pickupWeekday: property.pickupWeekday || "",
    startDates: property.startDates || { recycling: "", fogo: "", glass: "" },
    gate: property.gate || "", driveLong: Boolean(property.driveLong), active: property.active !== false,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const currentPlan  = property.plan || "monthly";
  const packCredits  = property.packCredits ?? 0;

  function next() {
    if (step < 2) { setStep(s => s + 1); return; }
    onSave({ ...property, ...draft, schedule: { weekday: draft.pickupWeekday, startDates: draft.startDates } });
  }

  return (
    <div className="min-h-screen bg-white">
      <Header onBack={step === 0 ? onBack : () => setStep(s => s - 1)} right={<NotifBell appState={appState} setAppState={setAppState} />} />
      <div className="max-w-md mx-auto px-5 pb-8">
        <StepDots current={step} total={3} />
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="font-heading font-semibold text-xl text-brand-fg">Edit Property</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{draft.active ? "Active" : "Paused"}</span>
            <Toggle label="" checked={draft.active} onChange={v => setDraft(d => ({ ...d, active: v }))} />
          </div>
        </div>
        <p className="text-sm text-gray-400 mb-5">Step {step + 1} of 3 — {STEP_LABELS[step + 1]}</p>

        <PropertyFormStep step={step + 1} draft={draft} setDraft={setDraft} plan={currentPlan} />

        {/* Plan + danger zone — shown on step 0 (address) for easy access */}
        {step === 0 && (
          <div className="mt-4 space-y-3">
            {/* Current plan */}
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Current Plan</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm text-brand-fg">{planLabel(currentPlan)}</div>
                  {currentPlan === "pack" && (
                    <div className="text-xs text-gray-400 mt-0.5">🎟️ {packCredits} credit{packCredits !== 1 ? "s" : ""} remaining</div>
                  )}
                </div>
                <button onClick={onChangePlan}
                  className="text-xs font-semibold text-brand-dark border border-brand-dark px-3 py-1.5 rounded-lg hover:bg-brand-muted transition">
                  Change Plan
                </button>
              </div>
            </div>

            {/* Delete */}
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)}
                className="w-full h-11 rounded-xl border border-red-300 text-red-500 font-semibold hover:bg-red-50 transition text-sm">
                Remove This Property
              </button>
            ) : (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <div className="text-sm font-semibold text-red-700 mb-1">Remove this property?</div>
                <div className="text-xs text-red-600 mb-3">All scheduled jobs will be cancelled.</div>
                <div className="flex gap-2">
                  <button onClick={onDelete} className="flex-1 h-11 rounded-xl bg-red-600 text-white font-semibold text-sm">Yes, Remove</button>
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 h-11 rounded-xl border border-gray-300 font-semibold text-sm">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
          <PrimaryButton onClick={next} disabled={!stepCanProceed(step + 1, draft, currentPlan)}>
            {step < 2 ? `Next: ${STEP_LABELS[step + 2]} →` : "Save Changes"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

const PLANS = [
  {
    key:      "monthly",
    emoji:    "📅",
    name:     "Monthly Subscription",
    tagline:  "Best for regularly used properties",
    price:    "$59.90/mo",
    detail:   "Automatic weekly service. Bins out the night before, back in same day.",
    badge:    null,
  },
  {
    key:      "pack",
    emoji:    "🎟️",
    name:     "10-Service Pack",
    tagline:  "Best for holiday homes used occasionally",
    price:    "$220 upfront",
    detail:   "10 credits, each covering one bins-out + bins-in pair. Request when you need it.",
    badge:    "Popular",
  },
  {
    key:      "once_off",
    emoji:    "1️⃣",
    name:     "Once-Off Service",
    tagline:  "One visit, no commitment",
    price:    "$27",
    detail:   "Schedule for any future date. Bins out + in included.",
    badge:    null,
  },
  {
    key:      "urgent",
    emoji:    "🚨",
    name:     "Urgent Once-Off",
    tagline:  "Need it done today",
    price:    "$35",
    detail:   "Same-day service. We'll dispatch a provider as soon as possible.",
    badge:    "Same day",
  },
];

function planLabel(key) {
  return PLANS.find(p => p.key === key)?.name || key;
}

const SUPABASE_FUNCTION_URL = "https://iquxbygkkgwsmrmairei.supabase.co/functions/v1/create-checkout";
const SUPABASE_ANON_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxdXhieWdra2d3c21ybWFpcmVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTMwMzYsImV4cCI6MjA5MjY4OTAzNn0.cffL4dimRJCQ2DxiOL-zzcg-tZc9sqLztu6FAEje_Dk";

function PlanPayment({ onBack, onStart, property, allProperties, initialPlan, appState, setAppState }) {
  const [selected,  setSelected]  = useState(initialPlan || "monthly");
  const [agree,     setAgree]     = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const rate       = property ? monthlyRate(property) : 59.90;
  const isChanging = !!initialPlan;

  async function handleCheckout() {
    if (!agree) return;
    setLoading(true);
    setError(null);
    try {
      const origin     = window.location.origin;
      const propertyId = property?.id || appState?.activePropertyId || "";

      const res = await fetch(SUPABASE_FUNCTION_URL, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "apikey":        SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          plan:       selected,
          propertyId,
          successUrl: `${origin}/?payment=success`,
          cancelUrl:  `${origin}/?payment=cancel`,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.url)   window.location.href = data.url;
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <Header onBack={onBack} right={<NotifBell appState={appState} setAppState={setAppState} />} />
      <div className="max-w-md mx-auto p-5">
        <h2 className="font-heading font-semibold text-xl text-brand-fg mb-1">
          {isChanging ? "Change Plan" : "Confirm & Pay"}
        </h2>
        <p className="text-sm text-gray-400 mb-5">
          {isChanging ? "Switch your plan at any time. Changes take effect immediately." : "Review your selected plan and complete payment to get started."}
        </p>

        <div className="space-y-3 mb-6">
          {PLANS.map(plan => {
            const isSelected   = selected === plan.key;
            const displayPrice = plan.key === "monthly" ? `$${rate.toFixed(2)}/mo` : plan.price;
            return (
              <button key={plan.key} onClick={() => setSelected(plan.key)}
                className={`w-full text-left rounded-2xl border-2 p-4 transition ${isSelected ? "border-brand-dark bg-brand-muted" : "border-gray-200 hover:border-gray-300 bg-white"}`}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl flex-shrink-0 mt-0.5">{plan.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-brand-fg text-sm">{plan.name}</span>
                      {plan.badge && <Badge color={plan.key === "urgent" ? "red" : "blue"}>{plan.badge}</Badge>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{plan.tagline}</div>
                    <div className="text-xs text-gray-500 mt-1.5">{plan.detail}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-brand-fg text-sm">{displayPrice}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Stripe security badge */}
        <div className="rounded-2xl bg-gray-50 border border-gray-200 px-4 py-3 mb-4 flex items-center gap-3">
          <span className="text-2xl">🔒</span>
          <div>
            <div className="text-sm font-medium text-gray-700">Secure payment via Stripe</div>
            <div className="text-xs text-gray-400">Your card details are never stored by FmyBins</div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 mb-4 text-sm text-red-600">
            ⚠️ {error}
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <input id="agree" type="checkbox" className="h-5 w-5 accent-brand-dark"
            checked={agree} onChange={e => setAgree(e.target.checked)} />
          <label htmlFor="agree" className="text-sm text-gray-700">
            I agree to the FmyBins terms of service.
          </label>
        </div>

        <PrimaryButton onClick={handleCheckout} disabled={!agree || loading}>
          {loading
            ? "Redirecting to payment…"
            : isChanging
              ? `Switch to ${PLANS.find(p => p.key === selected)?.name} →`
              : `Pay & Start ${PLANS.find(p => p.key === selected)?.name} →`}
        </PrimaryButton>

        {/* Test mode note */}
        <p className="text-xs text-center text-gray-400 mt-3">
          🧪 Test mode — use card <span className="font-mono">4242 4242 4242 4242</span>, any future date, any CVC
        </p>
      </div>
    </div>
  );
}

function PaymentSuccess({ plan, onContinue }) {
  const planInfo = PLANS.find(p => p.key === plan);
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="font-heading font-bold text-2xl text-brand-fg mb-2">Payment Successful!</h2>
      <p className="text-gray-500 text-sm mb-2">
        You're all set with the <strong>{planInfo?.name || plan}</strong>.
      </p>
      <p className="text-gray-400 text-xs mb-8">
        A confirmation receipt has been sent to your email by Stripe.
      </p>
      <PrimaryButton onClick={onContinue}>Go to Dashboard →</PrimaryButton>
    </div>
  );
}

function PaymentCancelled({ onBack }) {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl mb-4">↩️</div>
      <h2 className="font-heading font-semibold text-xl text-brand-fg mb-2">Payment Cancelled</h2>
      <p className="text-gray-400 text-sm mb-8">No charge was made. You can complete payment any time.</p>
      <PrimaryButton onClick={onBack}>Back to Plan Selection →</PrimaryButton>
    </div>
  );
}

function MyProperties({ properties, activePropertyId, onSelect, onAdd, onEdit, onBack, appState, setAppState }) {
  const total = properties.reduce((sum, p) => sum + monthlyRate(p), 0);
  return (
    <div className="min-h-screen bg-brand-muted">
      <Header onBack={onBack} right={<NotifBell appState={appState} setAppState={setAppState} />} />
      <div className="max-w-md mx-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading font-semibold text-xl text-brand-fg">My Properties</h2>
            <p className="text-sm text-gray-500">{properties.length} propert{properties.length === 1 ? "y" : "ies"} · ${total.toFixed(2)}/mo</p>
          </div>
          <button onClick={onAdd} className="h-10 px-4 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:opacity-90 transition">+ Add</button>
        </div>
        {properties.length === 0 && (
          <Card><p className="text-sm text-gray-400 text-center py-6">No properties yet. <button className="text-brand-dark underline" onClick={onAdd}>Add one →</button></p></Card>
        )}
        {properties.map(p => {
          const label = addrWithUnit(p);
          const isActive = p.id === activePropertyId;
          const plan     = p.plan || "monthly";
          const isPack   = plan === "pack";
          const credits  = p.packCredits ?? 0;
          const planColor = plan === "monthly" ? "blue" : isPack ? "purple" : "orange";
          return (
            <Card key={p.id} className={isActive ? "border-brand-dark" : ""} onClick={() => onSelect(p.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <span className="font-semibold text-brand-fg truncate">{label.split(",")[0]}</span>
                    {isActive          && <Badge color="green">Viewing</Badge>}
                    {p.active === false && <Badge color="yellow">Paused</Badge>}
                  </div>
                  <div className="text-xs text-gray-400 truncate mb-2">{label.split(",").slice(1, 3).join(",").trim()}</div>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    <Badge color={planColor}>{planLabel(plan)}</Badge>
                    {p.driveLong && <Badge color="yellow">Steep driveway</Badge>}
                  </div>
                  {p.pickupWeekday && <div className="text-xs text-gray-400">📅 {p.pickupWeekday}s</div>}
                  {isPack && <div className="text-xs text-gray-500 mt-0.5">🎟️ {credits} credit{credits !== 1 ? "s" : ""} remaining</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  {plan === "monthly" && <><div className="font-bold text-brand-fg">${monthlyRate(p).toFixed(2)}</div><div className="text-xs text-gray-400">/month</div></>}
                  {isPack            && <><div className="font-bold text-brand-fg">{credits}</div><div className="text-xs text-gray-400">credits</div></>}
                  <button onClick={e => { e.stopPropagation(); onEdit(p.id); }} className="mt-2 text-xs text-brand-dark underline block">Edit</button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Dashboard({ data, allProperties, onOpenSettings, onOpenAdHoc, onOpenProperties, onSignOut, appState, setAppState }) {
  const weekday        = data?.schedule?.weekday || data?.day || "";
  const bins           = data?.bins || [];
  const startRecycling = data?.schedule?.startDates?.recycling || null;
  const startFogo      = data?.schedule?.startDates?.fogo      || null;
  const startGlass     = data?.schedule?.startDates?.glass     || null;
  const nextGeneral    = weekday ? nextWeekly(weekday) : null;
  const nextRecycling  = bins.includes("recycling") ? nextFortnightly(startRecycling, weekday) : null;
  const nextFogo       = bins.includes("fogo")      ? nextFortnightly(startFogo, weekday)      : null;
  const nextGlass      = bins.includes("glass")     ? nextFortnightly(startGlass, weekday)     : null;
  const thisWeek = [
    { key: "general",   label: "General",      on: bins.includes("general") && !!weekday },
    { key: "recycling", label: "Recycling",    on: bins.includes("recycling") && isFortnightlyThisWeek(startRecycling, weekday) },
    { key: "fogo",      label: "FOGO / Green", on: bins.includes("fogo") && isFortnightlyThisWeek(startFogo, weekday) },
    { key: "glass",     label: "Glass",        on: bins.includes("glass") && isFortnightlyThisWeek(startGlass, weekday) },
  ].filter(x => x.on);
  const addrLabel   = addrWithUnit(data);
  const rate        = data?.id ? monthlyRate(data) : null;
  const plan        = data?.plan || "monthly";
  const packCredits = data?.packCredits ?? 0;
  const isMonthly   = plan === "monthly";
  const isPack      = plan === "pack";

  return (
    <div className="min-h-screen bg-brand-muted">
      <div className="w-full flex items-center justify-between py-4 px-5 sticky top-0 bg-white/90 backdrop-blur z-10 border-b">
        <h1 className="text-lg font-semibold text-brand-fg font-heading">FmyBins</h1>
        <div className="flex gap-1.5 items-center">
          <button onClick={onOpenAdHoc} className="text-sm px-3 py-1 rounded-full border border-brand-dark text-brand-dark font-medium">⚡ Request</button>
          <button onClick={onOpenProperties} className="text-sm px-3 py-1 rounded-full border">🏠{allProperties.length > 1 ? ` ${allProperties.length}` : ""}</button>
          <NotifBell appState={appState} setAppState={setAppState} />
          <button onClick={onOpenSettings} className="text-sm px-3 py-1 rounded-full border">⚙️</button>
          <button onClick={onSignOut} className="text-sm px-3 py-1 rounded-full border border-gray-300 text-gray-400">Sign out</button>
        </div>
      </div>
      <div className="max-w-md mx-auto p-5 space-y-4">
        {allProperties.length > 1 && (
          <button onClick={onOpenProperties} className="w-full text-left rounded-2xl bg-white border border-gray-200 px-4 py-3 hover:border-brand-dark transition">
            <div className="text-xs text-gray-400 mb-0.5">Currently viewing</div>
            <div className="font-semibold text-brand-fg text-sm truncate">{addrLabel?.split(",")[0] || "—"}</div>
            <div className="text-xs text-brand-dark mt-0.5">Tap to switch →</div>
          </button>
        )}

        {/* Plan card */}
        <Card>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Your Plan</div>
            <Badge color={isMonthly ? "blue" : isPack ? "purple" : "orange"}>{planLabel(plan)}</Badge>
          </div>
          {isMonthly && rate && (
            <div className="flex items-end justify-between">
              <div>
                <div className="font-bold text-2xl font-heading text-brand-fg">${rate.toFixed(2)}<span className="text-sm font-normal text-gray-400">/mo</span></div>
              </div>
              <button onClick={onOpenProperties} className="text-xs text-brand-dark underline">Manage →</button>
            </div>
          )}
          {isPack && (
            <div className="flex items-end justify-between">
              <div>
                <div className="font-bold text-2xl font-heading text-brand-fg">{packCredits} <span className="text-base font-normal text-gray-500">credit{packCredits !== 1 ? "s" : ""} remaining</span></div>
                {packCredits <= 2 && packCredits > 0 && <div className="text-xs text-amber-600 font-medium mt-0.5">⚠️ Running low — top up soon</div>}
                {packCredits === 0 && <div className="text-xs text-red-600 font-medium mt-0.5">No credits left</div>}
              </div>
              <button className="text-xs font-semibold text-white bg-brand-dark px-3 py-1.5 rounded-lg hover:opacity-90 transition"
                onClick={() => alert("Top up — Stripe coming soon")}>
                Top up $220 →
              </button>
            </div>
          )}
          {(plan === "once_off" || plan === "urgent") && (
            <div className="text-sm text-gray-500">No active subscription. Request a service below.</div>
          )}
        </Card>

        {!weekday && (
          <Card><p className="text-sm text-gray-500 text-center py-4">No property set up. <button className="text-brand-dark underline" onClick={onOpenProperties}>Add one now →</button></p></Card>
        )}

        {weekday && isMonthly && (
          <>
            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">This Week</div>
              <div className="flex flex-wrap gap-2 mb-3">
                {thisWeek.length === 0
                  ? <span className="text-gray-400 text-sm">No services this week</span>
                  : thisWeek.map(b => <span key={b.key} className="px-3 py-1 rounded-full bg-brand-muted text-brand-fg text-sm font-medium border border-brand-dark/20">{b.label}</span>)
                }
              </div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Next Dates</div>
              <ul className="space-y-1 text-sm">
                {bins.includes("general")   && <li><span className="font-medium">General:</span> {fmtShortDate(nextGeneral)}</li>}
                {bins.includes("recycling") && <li><span className="font-medium">Recycling:</span> {fmtShortDate(nextRecycling)}</li>}
                {bins.includes("fogo")      && <li><span className="font-medium">FOGO / Green:</span> {fmtShortDate(nextFogo)}</li>}
                {bins.includes("glass")     && <li><span className="font-medium">Glass:</span> {fmtShortDate(nextGlass)}</li>}
              </ul>
              <div className="flex gap-2 mt-4">
                <button className="px-4 h-10 rounded-xl border text-sm hover:bg-gray-50 transition">Pause This Week</button>
                <button className="px-4 h-10 rounded-xl border text-sm hover:bg-gray-50 transition" onClick={onOpenProperties}>Edit Property</button>
              </div>
            </Card>
          </>
        )}

        {/* Request service button — always visible */}
        <button onClick={onOpenAdHoc}
          className="w-full rounded-2xl border-2 border-dashed border-brand-dark/40 bg-brand-muted/60 py-4 text-brand-fg font-medium text-sm hover:bg-brand-muted transition">
          {isPack
            ? `🎟️ Use a credit (${packCredits} remaining)`
            : "⚡ Request a once-off or urgent service"}
        </button>

        {(() => {
          const recentPhotos = (appState.jobs || [])
            .filter(j => j.propertyId === data?.id && j.status === "done" && j.photos?.length > 0)
            .flatMap(j => j.photos.map(p => ({ ...p, jobType: j.type, completedAt: j.completedAt })))
            .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
            .slice(0, 6);

          return (
            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Recent Photos</div>
              {recentPhotos.length === 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {[1,2,3].map(n => (
                    <div key={n} className="aspect-square rounded-xl bg-gray-100 border flex items-center justify-center text-gray-300 text-xl">📷</div>
                  ))}
                </div>
              ) : (
                <PhotoGrid photos={recentPhotos} />
              )}
            </Card>
          );
        })()}
      </div>
    </div>
  );
}

// ─── PHOTO PROOF ──────────────────────────────────────────────────────────────

function PhotoGrid({ photos }) {
  const [viewing, setViewing] = useState(null);
  return (
    <>
      {viewing !== null && (
        <PhotoViewer photos={photos} onClose={() => setViewing(null)} />
      )}
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p, i) => (
          <button key={p.id} onClick={() => setViewing(i)}
            className="aspect-square rounded-xl overflow-hidden border border-gray-200 hover:opacity-90 transition relative">
            <img src={p.dataUrl} alt="proof" className="w-full h-full object-cover" />
            <div className="absolute bottom-1 left-1">
              <span className="text-[10px] bg-black/50 text-white rounded px-1">
                {p.jobType === "bins_out" ? "🚮" : "↩️"}
              </span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function PhotoUploader({ photos = [], onChange, maxPhotos = 3 }) {
  const fileRef = useRef(null);

  function handleFiles(files) {
    const remaining = maxPhotos - photos.length;
    const toAdd     = Array.from(files).slice(0, remaining);
    toAdd.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => onChange([...photos, { id: makeId(), dataUrl: e.target.result, caption: "" }]);
      reader.readAsDataURL(file);
    });
  }

  function removePhoto(id) {
    onChange(photos.filter(p => p.id !== id));
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        {photos.map(p => (
          <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden border border-white/20">
            <img src={p.dataUrl} alt="proof" className="w-full h-full object-cover" />
            <button onClick={() => removePhoto(p.id)}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-black/80">
              ×
            </button>
          </div>
        ))}
        {photos.length < maxPhotos && (
          <button onClick={() => fileRef.current?.click()}
            className="aspect-square rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center gap-1 text-white/40 hover:border-white/40 hover:text-white/60 transition">
            <span className="text-2xl">📷</span>
            <span className="text-xs">Add photo</span>
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple capture="environment"
        className="hidden" onChange={e => handleFiles(e.target.files)} />
      <p className="text-xs text-white/30">{photos.length}/{maxPhotos} photos · Tap + to add</p>
    </div>
  );
}

function PhotoViewer({ photos, onClose }) {
  const [idx, setIdx] = useState(0);
  if (!photos?.length) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-5 py-4" onClick={e => e.stopPropagation()}>
        <span className="text-white/60 text-sm">{idx + 1} / {photos.length}</span>
        <button onClick={onClose} className="text-white/60 text-2xl leading-none hover:text-white">×</button>
      </div>
      <div className="flex-1 flex items-center justify-center px-4" onClick={e => e.stopPropagation()}>
        <img src={photos[idx].dataUrl} alt="proof" className="max-w-full max-h-full rounded-2xl object-contain" />
      </div>
      {photos.length > 1 && (
        <div className="flex justify-center gap-4 py-5" onClick={e => e.stopPropagation()}>
          <button onClick={() => setIdx(i => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="w-10 h-10 rounded-full border border-white/20 text-white disabled:opacity-30 hover:bg-white/10 transition">‹</button>
          <div className="flex gap-1.5 items-center">
            {photos.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)}
                className={`w-2 h-2 rounded-full transition ${i === idx ? "bg-white" : "bg-white/30"}`} />
            ))}
          </div>
          <button onClick={() => setIdx(i => Math.min(photos.length - 1, i + 1))}
            disabled={idx === photos.length - 1}
            className="w-10 h-10 rounded-full border border-white/20 text-white disabled:opacity-30 hover:bg-white/10 transition">›</button>
        </div>
      )}
    </div>
  );
}



const NOTIF_EVENTS = [
  { key: "booking_confirmed",   label: "Booking confirmed" },
  { key: "provider_assigned",   label: "Provider assigned" },
  { key: "bins_out",            label: "Bins put out" },
  { key: "bins_in",             label: "Bins brought in" },
  { key: "urgent_received",     label: "Urgent request received" },
  { key: "low_credits",         label: "Low pack credits" },
];

function defaultNotifPrefs() {
  const prefs = {};
  NOTIF_EVENTS.forEach(e => { prefs[e.key] = { email: true, push: true }; });
  return prefs;
}

function makeNotif({ event, message, propertyLabel = "", channel }) {
  return {
    id: makeId(), event, message, propertyLabel,
    channel, // "email" | "push" | "both"
    timestamp: new Date().toISOString(),
    read: false,
  };
}

// Returns a fire() function that adds notifications to appState
function useNotifications(appState, setAppState) {
  const prefs = appState.notifPrefs || defaultNotifPrefs();

  function fire(event, message, propertyLabel = "") {
    const p = prefs[event];
    if (!p) return;
    const channels = [];
    if (p.email) channels.push("email");
    if (p.push)  channels.push("push");
    if (!channels.length) return;
    const notif = makeNotif({ event, message, propertyLabel, channel: channels.join("+") });
    setAppState(s => ({ ...s, notifications: [notif, ...(s.notifications || [])] }));
    // Simulate a brief toast (handled in Dashboard via toast state)
    return notif;
  }

  return { fire, prefs };
}

function NotifToast({ notif, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [notif]);
  if (!notif) return null;
  const isEmail = notif.channel.includes("email");
  const isPush  = notif.channel.includes("push");
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90vw]
      bg-brand-dark text-white rounded-2xl px-4 py-3 shadow-lg flex items-start gap-3 animate-fade-in">
      <div className="text-lg flex-shrink-0">{isPush ? "🔔" : "📧"}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold opacity-70 mb-0.5">
          {[isEmail && "Email", isPush && "Push"].filter(Boolean).join(" + ")} sent
        </div>
        <div className="text-sm">{notif.message}</div>
      </div>
      <button onClick={onDismiss} className="text-white/50 hover:text-white text-lg leading-none flex-shrink-0">×</button>
    </div>
  );
}

function NotificationDrawer({ notifications, onClose, onMarkAllRead, onClear }) {
  const unread = notifications.filter(n => !n.read).length;
  return (
    <div className="fixed inset-0 z-40 flex flex-col" onClick={onClose}>
      <div className="flex-1" />
      <div className="bg-white rounded-t-3xl shadow-2xl max-h-[75vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b">
          <div>
            <h2 className="font-heading font-semibold text-brand-fg">Notifications</h2>
            {unread > 0 && <div className="text-xs text-brand-dark font-medium">{unread} unread</div>}
          </div>
          <div className="flex gap-2">
            {unread > 0 && (
              <button onClick={onMarkAllRead} className="text-xs text-brand-dark underline">Mark all read</button>
            )}
            {notifications.length > 0 && (
              <button onClick={onClear} className="text-xs text-gray-400 underline">Clear all</button>
            )}
            <button onClick={onClose} className="text-gray-400 text-xl leading-none ml-2">×</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
          {notifications.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No notifications yet.</p>
          )}
          {notifications.map(n => {
            const isEmail = n.channel.includes("email");
            const isPush  = n.channel.includes("push");
            const time    = new Date(n.timestamp);
            const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
                            " · " + time.toLocaleDateString([], { day: "numeric", month: "short" });
            return (
              <div key={n.id} className={`rounded-2xl p-3 flex gap-3 ${n.read ? "bg-gray-50" : "bg-brand-muted border border-brand-dark/10"}`}>
                <div className="text-lg flex-shrink-0">{isPush ? "🔔" : "📧"}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-brand-fg">{n.message}</div>
                  {n.propertyLabel && <div className="text-xs text-gray-400 mt-0.5 truncate">{n.propertyLabel}</div>}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">{timeStr}</span>
                    {isEmail && <Badge color="gray">Email</Badge>}
                    {isPush  && <Badge color="blue">Push</Badge>}
                  </div>
                </div>
                {!n.read && <div className="w-2 h-2 rounded-full bg-brand-dark flex-shrink-0 mt-1" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Settings({ onBack, onSignOut, appState, setAppState }) {
  const prefs = appState.notifPrefs || defaultNotifPrefs();

  function toggle(event, channel) {
    setAppState(s => ({
      ...s,
      notifPrefs: {
        ...(s.notifPrefs || defaultNotifPrefs()),
        [event]: { ...(s.notifPrefs?.[event] || { email: true, push: true }), [channel]: !prefs[event][channel] },
      },
    }));
  }

  return (
    <div className="min-h-screen bg-white">
      <Header onBack={onBack} right={<NotifBell appState={appState} setAppState={setAppState} />} />
      <div className="max-w-md mx-auto p-5 space-y-4">
        <h2 className="font-heading font-semibold text-xl text-brand-fg">Settings</h2>
        <Card>
          <h3 className="font-semibold mb-3">Notification Preferences</h3>
          <div className="grid grid-cols-3 gap-1 mb-2">
            <div className="text-xs text-gray-400 col-span-1">Event</div>
            <div className="text-xs text-gray-500 font-medium text-center">📧 Email</div>
            <div className="text-xs text-gray-500 font-medium text-center">🔔 Push</div>
          </div>
          {NOTIF_EVENTS.map(e => (
            <div key={e.key} className="grid grid-cols-3 gap-1 items-center py-2 border-t border-gray-100 first:border-0">
              <div className="text-sm text-gray-700 col-span-1 pr-2">{e.label}</div>
              <div className="flex justify-center">
                <input type="checkbox" checked={prefs[e.key]?.email ?? true}
                  onChange={() => toggle(e.key, "email")}
                  className="h-4 w-4 accent-brand-dark cursor-pointer" />
              </div>
              <div className="flex justify-center">
                <input type="checkbox" checked={prefs[e.key]?.push ?? true}
                  onChange={() => toggle(e.key, "push")}
                  className="h-4 w-4 accent-brand-dark cursor-pointer" />
              </div>
            </div>
          ))}
        </Card>

        <Card>
          <h3 className="font-semibold mb-2">Billing</h3>
          <PrimaryButton onClick={() => alert("Stripe Customer Portal — coming soon")}>Manage Billing</PrimaryButton>
        </Card>
        <Card>
          <h3 className="font-semibold mb-2">Account</h3>
          <SecondaryButton onClick={onSignOut}>Sign Out</SecondaryButton>
        </Card>
      </div>
    </div>
  );
}

function ServiceRequest({ onBack, allProperties, activePropertyId, appState, setAppState }) {
  const [propId,       setPropId]       = useState(activePropertyId || allProperties[0]?.id || "");
  const [serviceType,  setServiceType]  = useState("once_off");
  const [selectedBins, setSelectedBins] = useState([]);
  const [date,         setDate]         = useState("");
  const [note,         setNote]         = useState("");
  const [submitted,    setSubmitted]    = useState(false);
  const { fire } = useNotifications(appState, setAppState);

  function fireNotif(event, message, propertyLabel = "") {
    fire(event, message, propertyLabel);
  }

  const selectedProp = allProperties.find(p => p.id === propId);
  const addrLabel    = addrWithUnit(selectedProp);
  const propPlan     = selectedProp?.plan || "monthly";
  const packCredits  = selectedProp?.packCredits ?? 0;

  const today        = toISODate(new Date());
  const isUrgent     = serviceType === "urgent";
  const isPack       = serviceType === "pack";
  const price        = isUrgent ? 35 : isPack ? 0 : 27;

  const canSubmit = selectedBins.length > 0 && (isUrgent ? true : !!date) && (isPack ? packCredits > 0 : true);

  function submit() {
    if (!canSubmit) return;
    const jobDate = isUrgent ? today : date;
    const jobDateObj = new Date(`${jobDate}T00:00:00`);
    setAppState(s => {
      const updatedProps = isPack
        ? (s.properties || []).map(p => p.id === propId ? { ...p, packCredits: Math.max(0, (p.packCredits || 0) - 1) } : p)
        : s.properties;
      const baseJob = {
        propertyId: propId, providerId: null, binTypes: selectedBins,
        status: "unassigned", note, adHoc: true, serviceType, urgent: isUrgent, price,
        weekStartISO: jobDate,
      };
      // For pack + once-off: create bins_out (evening before) + bins_in (day of) pair
      const newJobs = (isPack || !isUrgent)
        ? [
            { ...baseJob, id: makeId(), jobKey: `pack_out_${jobDate}_${makeId()}`, type: "bins_out",
              scheduledFor: setTime(addDays(jobDateObj, -1), 19, 0).toISOString() },
            { ...baseJob, id: makeId(), jobKey: `pack_in_${jobDate}_${makeId()}`,  type: "bins_in",
              scheduledFor: setTime(jobDateObj, 15, 0).toISOString() },
          ]
        : [
            // Urgent: single same-day job
            { ...baseJob, id: makeId(), jobKey: `urgent_${jobDate}_${makeId()}`, type: "adhoc",
              scheduledFor: new Date(`${jobDate}T09:00:00`).toISOString() },
          ];
      return { ...s, properties: updatedProps, jobs: [...(s.jobs || []), ...newJobs] };
    });
    setSubmitted(true);
    const propLabel = addrWithUnit(allProperties.find(p => p.id === propId));
    if (isUrgent) {
      fire("urgent_received", "Your urgent bin service request has been received. We're dispatching a provider now.", propLabel);
    } else {
      fire("booking_confirmed", `Your ${isPack ? "credit booking" : "once-off service"} for ${jobDate} has been confirmed.`, propLabel);
    }
    // Low credits warning
    if (isPack) {
      const remaining = (allProperties.find(p => p.id === propId)?.packCredits ?? 1) - 1;
      if (remaining <= 3 && remaining > 0) {
        fire("low_credits", `You have ${remaining} service credit${remaining !== 1 ? "s" : ""} remaining. Top up to avoid running out.`, propLabel);
      }
    }
  } // end submit

  if (submitted) {
    return (
      <div className="min-h-screen bg-white">
        <Header onBack={onBack} right={<NotifBell appState={appState} setAppState={setAppState} />} />
        <div className="max-w-md mx-auto p-5 flex flex-col items-center text-center pt-16">
          <div className="text-5xl mb-4">{isUrgent ? "🚨" : "✅"}</div>
          <h2 className="text-xl font-semibold font-heading mb-2">{isUrgent ? "Urgent Request Sent!" : "Request Sent!"}</h2>
          <p className="text-gray-500 text-sm mb-2">
            {isUrgent
              ? "We're dispatching a provider now. Expect service today."
              : isPack
                ? `Credit used. You have ${Math.max(0, packCredits - 1)} credit${packCredits - 1 !== 1 ? "s" : ""} remaining.`
                : `Service booked for ${date}. We'll confirm shortly.`}
          </p>
          {isPack && packCredits - 1 <= 2 && packCredits - 1 > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm text-amber-700 mb-4">
              ⚠️ Only {packCredits - 1} credit{packCredits - 1 !== 1 ? "s" : ""} left — consider topping up.
            </div>
          )}
          {isPack && packCredits - 1 === 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-700 mb-4">
              No credits remaining. Top up to book more services.
            </div>
          )}
          <PrimaryButton onClick={onBack}>Back to Dashboard</PrimaryButton>
        </div>
      </div>
    );
  }

  // Which service types to show depends on property plan
  const serviceOptions = propPlan === "pack"
    ? [
        { key: "pack",     emoji: "🎟️", label: "Use a Credit",       sub: `${packCredits} credit${packCredits !== 1 ? "s" : ""} remaining`,  price: "−1 credit" },
        { key: "urgent",   emoji: "🚨", label: "Urgent Once-Off",    sub: "Same-day service",                                                  price: "$35" },
      ]
    : [
        { key: "once_off", emoji: "1️⃣", label: "Once-Off Service",   sub: "Any future date",                                                   price: "$27" },
        { key: "urgent",   emoji: "🚨", label: "Urgent Once-Off",    sub: "Same-day service",                                                   price: "$35" },
      ];

  // Set default service type based on plan
  const defaultType = propPlan === "pack" ? "pack" : "once_off";
  if (serviceType === "once_off" && propPlan === "pack") setServiceType("pack");

  return (
    <div className="min-h-screen bg-white">
      <Header onBack={onBack} right={<NotifBell appState={appState} setAppState={setAppState} />} />
      <div className="max-w-md mx-auto p-5">
        <h2 className="font-heading font-semibold text-xl text-brand-fg mb-1">Request a Service</h2>
        <p className="text-sm text-gray-400 mb-5">Choose the type of service you need.</p>

        {/* Property selector */}
        {allProperties.length > 1 && (
          <div className="mb-4">
            <div className="text-sm text-gray-600 mb-1">Property</div>
            <select value={propId} onChange={e => setPropId(e.target.value)}
              className="w-full h-11 rounded-xl border border-gray-300 px-4 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark">
              {allProperties.map(p => {
                const label = addrWithUnit(p);
                return <option key={p.id} value={p.id}>{label.split(",")[0]}</option>;
              })}
            </select>
          </div>
        )}
        {addrLabel && (
          <div className="rounded-xl bg-brand-muted border border-brand-dark/10 px-4 py-2 text-sm text-brand-fg mb-4 flex items-center justify-between">
            <span className="truncate">{addrLabel.split(",")[0]}</span>
            <Badge color="gray">{planLabel(propPlan)}</Badge>
          </div>
        )}

        {/* Service type selector */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {serviceOptions.map(opt => {
            const isSelected = serviceType === opt.key;
            const isDisabled = opt.key === "pack" && packCredits <= 0;
            return (
              <button key={opt.key} onClick={() => !isDisabled && setServiceType(opt.key)} disabled={isDisabled}
                className={`rounded-2xl border-2 p-3 text-left transition ${
                  isDisabled ? "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                  : isSelected ? "border-brand-dark bg-brand-muted"
                  : "border-gray-200 hover:border-gray-300 bg-white"}`}>
                <div className="text-xl mb-1">{opt.emoji}</div>
                <div className="font-semibold text-sm text-brand-fg">{opt.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{opt.sub}</div>
                <div className="text-xs font-bold text-brand-dark mt-1">{opt.price}</div>
              </button>
            );
          })}
        </div>

        {/* Urgent warning */}
        {isUrgent && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 mb-4 flex gap-2">
            <span className="text-red-500 text-lg flex-shrink-0">🚨</span>
            <div>
              <div className="text-sm font-semibold text-red-700">Same-day urgent service</div>
              <div className="text-xs text-red-600 mt-0.5">We'll dispatch a provider immediately. Service today, no date selection needed.</div>
            </div>
          </div>
        )}

        {/* Date picker — not shown for urgent */}
        {!isUrgent && (
          <label className="block w-full mb-4">
            <div className="text-sm text-gray-600 mb-1">Date needed</div>
            <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)}
              className="w-full h-11 rounded-xl border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-brand-dark" />
          </label>
        )}

        {/* Bins */}
        <div className="text-sm text-gray-600 mb-1">Which bins?</div>
        <BinGrid bins={selectedBins} onToggle={key => setSelectedBins(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])} />

        <TextArea label="Special instructions (optional)" placeholder="e.g. Bins are behind the side gate, code is 5678" value={note} onChange={setNote} />

        {/* Price summary */}
        <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-gray-600">Total</span>
          <span className="font-bold text-brand-fg">
            {isPack ? "1 credit" : `$${price.toFixed(2)}`}
          </span>
        </div>

        <PrimaryButton onClick={submit} disabled={!canSubmit}>
          {isUrgent ? "🚨 Request Urgent Service" : isPack ? "🎟️ Use Credit & Book" : "Book Once-Off Service"}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PROVIDER PORTAL ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function ProviderPortal({ appState, setAppState, providerId, onSignOut }) {
  const [tab,             setTab]             = useState("jobs");
  const [releasingPropId, setReleasingPropId] = useState(null);
  const [showNotifs,      setShowNotifs]      = useState(false);

  const providers    = (appState.providers  || []).filter(p => p.active);
  const provider     = providers.find(p => p.id === providerId);
  const allJobs      = appState.jobs        || [];
  const allProps     = appState.properties  || [];

  const providerNotifs = (appState.providerNotifs || []).filter(n => n.providerId === providerId);
  const unreadNotifs   = providerNotifs.filter(n => !n.read).length;

  function fireProviderNotif(message, emoji = "🔔") {
    const notif = {
      id: makeId(), providerId, message, emoji,
      timestamp: new Date().toISOString(), read: false,
    };
    setAppState(s => ({ ...s, providerNotifs: [notif, ...(s.providerNotifs || [])] }));
  }

  function markProviderNotifsRead() {
    setAppState(s => ({
      ...s,
      providerNotifs: (s.providerNotifs || []).map(n =>
        n.providerId === providerId ? { ...n, read: true } : n),
    }));
  }

  // Jobs offered to this provider awaiting response
  const pendingOffers = allJobs
    .filter(j => j.status === "offered" && j.offeredTo === providerId)
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));

  // Jobs this provider has accepted
  const myJobs = allJobs
    .filter(j => j.providerId === providerId && j.status !== "offered")
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));

  // Open pool: unassigned, not offered, not done
  const poolJobs = allJobs
    .filter(j => j.status === "unassigned" && !j.offeredTo && !j.providerId && j.type !== "adhoc")
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));

  // Properties permanently assigned to this provider
  const myProperties = allProps.filter(p => p.permanentProviderId === providerId && p.active !== false);

  const propsById       = Object.fromEntries(allProps.map(p => [p.id, p]));
  const offerBadgeCount = pendingOffers.length;

  // Accept a targeted offer — sets permanent provider on the property
  function acceptOffer(jobId) {
    const job  = (appState.jobs || []).find(j => j.id === jobId);
    const prop = job ? (appState.properties || []).find(p => p.id === job.propertyId) : null;
    setAppState(s => {
      const sJob  = (s.jobs || []).find(j => j.id === jobId);
      const sProp = sJob ? (s.properties || []).find(p => p.id === sJob.propertyId) : null;
      return {
        ...s,
        jobs: (s.jobs || []).map(j => j.id === jobId
          ? { ...j, status: "accepted", providerId, offeredTo: null }
          : j),
        properties: (s.properties || []).map(p =>
          p.id === sProp?.id && !p.permanentProviderId && sJob?.permanent
            ? { ...p, permanentProviderId: providerId }
            : p),
      };
    });
    if (prop) fireProviderNotif(`✅ Job accepted — ${addrWithUnit(prop).split(",")[0]}. You're confirmed for this service.`, "✅");
  }

  // Decline a targeted offer — auto-offer to next provider
  function declineOffer(jobId) {
    setAppState(s => {
      const updatedJobs = (s.jobs || []).map(j => j.id === jobId
        ? { ...j, offerHistory: [...(j.offerHistory || []), providerId], offeredTo: null }
        : j);
      return { ...s, jobs: autoOffer(updatedJobs, providers, jobId, s.properties || []) };
    });
  }

  // Claim from open pool — sets permanent provider on the property
  function claimPoolJob(jobId) {
    const job  = (appState.jobs || []).find(j => j.id === jobId);
    const prop = job ? (appState.properties || []).find(p => p.id === job.propertyId) : null;
    setAppState(s => {
      const sJob  = (s.jobs || []).find(j => j.id === jobId);
      const sProp = sJob ? (s.properties || []).find(p => p.id === sJob.propertyId) : null;
      return {
        ...s,
        jobs: (s.jobs || []).map(j => j.id === jobId
          ? { ...j, status: "accepted", providerId, offeredTo: null }
          : j),
        properties: (s.properties || []).map(p =>
          p.id === sProp?.id && !p.permanentProviderId
            ? { ...p, permanentProviderId: providerId }
            : p),
      };
    });
    if (prop) fireProviderNotif(`🏠 Property claimed — ${addrWithUnit(prop).split(",")[0]}. You're now the permanent provider.`, "🏠");
  }

  // Decline this week only — permanent relationship untouched, auto-offer fires
  function declineThisWeek(jobId) {
    setAppState(s => {
      const updatedJobs = (s.jobs || []).map(j => j.id === jobId
        ? { ...j, providerId: null, status: "unassigned",
            offerHistory: [...(j.offerHistory || []), providerId],
            declinedByPermanent: true }
        : j);
      return { ...s, jobs: autoOffer(updatedJobs, providers, jobId, s.properties || []) };
    });
  }

  // Release a property permanently
  function releaseProperty(propertyId) {
    setAppState(s => ({
      ...s,
      properties: (s.properties || []).map(p =>
        p.id === propertyId ? { ...p, permanentProviderId: null } : p),
      jobs: (s.jobs || []).map(j =>
        j.propertyId === propertyId && j.permanent && j.status !== "done"
          ? { ...j, providerId: null, status: "unassigned", offeredTo: null }
          : j),
    }));
    setReleasingPropId(null);
  }

  function fireNotif(event, message, propertyLabel = "") {
    const prefs = appState.notifPrefs || defaultNotifPrefs();
    const p = prefs[event];
    if (!p) return;
    const channels = [p.email && "email", p.push && "push"].filter(Boolean);
    if (!channels.length) return;
    const notif = makeNotif({ event, message, propertyLabel, channel: channels.join("+") });
    setAppState(s => ({ ...s, notifications: [notif, ...(s.notifications || [])] }));
  }

  function markDone(jobId, photos = []) {
    const job  = (appState.jobs || []).find(j => j.id === jobId);
    const prop = job ? (appState.properties || []).find(p => p.id === job.propertyId) : null;
    const propLabel = addrWithUnit(prop);
    setAppState(s => ({
      ...s,
      jobs: (s.jobs || []).map(j => j.id === jobId
        ? { ...j, status: "done", completedAt: new Date().toISOString(), photos }
        : j),
    }));
    if (job?.type === "bins_out") fireProviderNotif("bins_out", "Your bins have been put out for collection. 🚮", propLabel);
    if (job?.type === "bins_in")  fireProviderNotif("bins_in",  "Your bins have been brought back in. ✅", propLabel);
    if (job?.type === "bins_out") fireNotif("bins_out", "Your bins have been put out for collection. 🚮", propLabel);
    if (job?.type === "bins_in")  fireNotif("bins_in",  "Your bins have been brought back in. ✅", propLabel);
  }

  // ── Inner job card component ──
  function JobCard({ j }) {
    const prop   = propsById[j.propertyId];
    const addr   = addrWithUnit(prop);
    const isDone = j.status === "done";
    const [showPhotoPrompt, setShowPhotoPrompt] = useState(false);
    const [pendingPhotos,   setPendingPhotos]   = useState([]);
    const [viewingPhotos,   setViewingPhotos]   = useState(false);

    function handleMarkDone() {
      if (showPhotoPrompt) {
        markDone(j.id, pendingPhotos);
        setShowPhotoPrompt(false);
      } else {
        setShowPhotoPrompt(true);
      }
    }

    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
        {viewingPhotos && j.photos?.length > 0 && (
          <PhotoViewer photos={j.photos} onClose={() => setViewingPhotos(false)} />
        )}
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold text-sm">
            {j.type === "bins_out" ? "🚮 Bins Out" : j.type === "bins_in" ? "↩️ Bins In" : "⚡ Ad Hoc"}
            {j.permanent && <span className="ml-1 text-[10px] text-white/30 font-normal">recurring</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {isDone && j.photos?.length > 0 && (
              <button onClick={() => setViewingPhotos(true)}
                className="text-xs text-white/50 hover:text-white/80 transition">
                📷 {j.photos.length}
              </button>
            )}
            <Badge color={isDone ? "green" : "blue"}>{isDone ? "done" : "accepted"}</Badge>
          </div>
        </div>
        <div className="text-sm text-white/60">{fmtDate(j.scheduledFor)}</div>
        <div className="text-sm text-white/80 mt-0.5 truncate">{addr}</div>
        {j.binTypes?.length > 0 && <div className="text-xs text-white/40 mt-0.5">Bins: {j.binTypes.map(binLabel).join(", ")}</div>}
        {prop?.gate  && <div className="text-xs text-white/40 mt-0.5">🔑 Gate: {prop.gate}</div>}
        {prop?.notes && <div className="text-xs text-white/40 mt-0.5">📋 {prop.notes}</div>}
        {j.note      && <div className="text-xs text-white/40 mt-0.5">ℹ️ {j.note}</div>}

        {/* Photo upload prompt */}
        {showPhotoPrompt && !isDone && (
          <div className="mt-3 bg-white/5 rounded-xl p-3 border border-white/10">
            <div className="text-xs text-white/60 mb-2 font-medium">Add photo proof (optional)</div>
            <PhotoUploader photos={pendingPhotos} onChange={setPendingPhotos} maxPhotos={3} />
          </div>
        )}

        <div className="flex gap-2 mt-3">
          {!isDone ? (
            <>
              <button onClick={handleMarkDone}
                className="flex-1 h-11 rounded-xl font-semibold transition active:scale-[0.98] text-sm bg-brand-dark text-white hover:opacity-90">
                {showPhotoPrompt ? "✓ Confirm Done" : "Mark as Done"}
              </button>
              {showPhotoPrompt && (
                <button onClick={() => { markDone(j.id, []); setShowPhotoPrompt(false); }}
                  className="h-11 px-3 rounded-xl border border-white/20 text-white/50 text-xs hover:bg-white/10 transition">
                  Skip photo
                </button>
              )}
              {!showPhotoPrompt && j.permanent && (
                <button onClick={() => declineThisWeek(j.id)}
                  className="h-11 px-3 rounded-xl border border-white/20 text-white/50 text-xs hover:bg-white/10 hover:text-white/80 transition">
                  Can't make it
                </button>
              )}
            </>
          ) : (
            <div className="flex-1 h-11 rounded-xl bg-white/10 text-white/30 flex items-center justify-center text-sm font-semibold cursor-not-allowed">
              ✓ Done
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="w-full flex items-center justify-between py-4 px-5 sticky top-0 bg-gray-900/95 backdrop-blur z-10 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-dark flex items-center justify-center text-sm font-bold">
            {provider?.name?.[0] || "?"}
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">{provider?.name || "Provider"}</div>
            <div className="text-xs text-white/40 mt-0.5">{myProperties.length} propert{myProperties.length !== 1 ? "ies" : "y"} · FmyBins</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Provider bell */}
          <button onClick={() => { setShowNotifs(v => !v); markProviderNotifsRead(); }}
            className="relative text-sm px-2.5 py-1 rounded-full border border-white/20 text-white/70 hover:bg-white/10 transition">
            🔔
            {unreadNotifs > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                {unreadNotifs > 9 ? "9+" : unreadNotifs}
              </span>
            )}
          </button>
          <button onClick={onSignOut} className="text-xs text-white/40 hover:text-white/70 transition border border-white/20 px-3 py-1 rounded-full">
            Sign out
          </button>
        </div>
      </div>

      {/* Provider notification drawer */}
      {showNotifs && (
        <div className="fixed inset-0 z-40 flex flex-col" onClick={() => setShowNotifs(false)}>
          <div className="flex-1" />
          <div className="bg-gray-800 rounded-t-3xl shadow-2xl max-h-[65vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
              <h2 className="font-heading font-semibold text-white">Notifications</h2>
              <div className="flex gap-3">
                {providerNotifs.length > 0 && (
                  <button onClick={() => setAppState(s => ({ ...s, providerNotifs: (s.providerNotifs || []).filter(n => n.providerId !== providerId) }))}
                    className="text-xs text-white/40 underline">Clear all</button>
                )}
                <button onClick={() => setShowNotifs(false)} className="text-white/40 text-xl leading-none">×</button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
              {providerNotifs.length === 0 && (
                <p className="text-sm text-white/30 text-center py-8">No notifications yet.</p>
              )}
              {providerNotifs.map(n => {
                const time = new Date(n.timestamp);
                const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
                                " · " + time.toLocaleDateString([], { day: "numeric", month: "short" });
                return (
                  <div key={n.id} className={`rounded-2xl p-3 flex gap-3 ${n.read ? "bg-white/5" : "bg-white/10 border border-white/20"}`}>
                    <div className="text-lg flex-shrink-0">{n.emoji || "🔔"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white">{n.message}</div>
                      <div className="text-xs text-white/30 mt-1">{timeStr}</div>
                    </div>
                    {!n.read && <div className="w-2 h-2 rounded-full bg-brand-dark flex-shrink-0 mt-1" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-md mx-auto p-5 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "My jobs",      value: `${myJobs.filter(j => j.status === "done").length}/${myJobs.length}` },
            { label: "My properties", value: myProperties.length },
            { label: "Rating",        value: "4.9 ⭐" },
          ].map(s => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-3 text-center">
              <div className="text-xl font-bold font-heading">{s.value}</div>
              <div className="text-xs text-white/40 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl overflow-hidden border border-white/10 bg-white/5">
          {[["jobs","📋 Jobs"],["properties","🏠 Mine"],["pool","🔔 Pool"],["earnings","💰 Pay"],["profile","👤 Profile"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 py-2.5 text-xs font-medium transition relative ${tab === id ? "bg-brand-dark text-white" : "text-white/50 hover:text-white/80"}`}>
              {label}
              {id === "jobs" && offerBadgeCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {offerBadgeCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Jobs tab */}
        {tab === "jobs" && (
          <div className="space-y-3">
            {pendingOffers.length > 0 && (
              <div>
                <div className="text-xs text-amber-400 uppercase tracking-wide font-semibold mb-2 px-1">
                  🔔 {pendingOffers.length} pending offer{pendingOffers.length > 1 ? "s" : ""} — respond now
                </div>
                {pendingOffers.map(j => {
                  const prop = propsById[j.propertyId];
                  const addr = addrWithUnit(prop);
                  return (
                    <div key={j.id} className="rounded-2xl border-2 border-amber-500/60 bg-amber-500/10 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-sm">
                          {j.type === "bins_out" ? "🚮 Bins Out" : j.type === "bins_in" ? "↩️ Bins In" : "⚡ Ad Hoc"}
                        </div>
                        <Badge color="yellow">offer pending</Badge>
                      </div>
                      <div className="text-sm text-white/70">{fmtDate(j.scheduledFor)}</div>
                      <div className="text-sm text-white/90 mt-0.5 truncate font-medium">{addr}</div>
                      {j.binTypes?.length > 0 && <div className="text-xs text-white/50 mt-0.5">Bins: {j.binTypes.map(binLabel).join(", ")}</div>}
                      {prop?.notes && <div className="text-xs text-white/40 mt-0.5">{prop.notes}</div>}
                      {j.permanent && <div className="text-xs text-amber-300/70 mt-1">✨ Accepting makes you the permanent provider for this property</div>}
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => acceptOffer(j.id)}
                          className="flex-1 h-11 rounded-xl bg-brand-dark text-white font-semibold hover:opacity-90 active:scale-[0.98] transition text-sm">
                          ✓ Accept
                        </button>
                        <button onClick={() => declineOffer(j.id)}
                          className="flex-1 h-11 rounded-xl border border-white/20 text-white/60 font-semibold hover:bg-white/10 active:scale-[0.98] transition text-sm">
                          ✕ Decline
                        </button>
                      </div>
                    </div>
                  );
                })}
                {myJobs.length > 0 && <div className="text-xs text-white/30 uppercase tracking-wide font-semibold px-1 pt-1">Accepted jobs</div>}
              </div>
            )}
            {myJobs.length === 0 && pendingOffers.length === 0 && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center text-white/40 text-sm">
                No jobs yet. Check the Pool tab or wait for an offer.
              </div>
            )}
            {myJobs.map(j => <JobCard key={j.id} j={j} />)}
          </div>
        )}

        {/* My Properties tab */}
        {tab === "properties" && (
          <div className="space-y-3">
            <div className="text-xs text-white/40 px-1">Your permanent properties — you receive jobs automatically each week.</div>
            {myProperties.length === 0 ? (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center text-white/40 text-sm">
                No permanent properties yet. Accept a job offer or claim one from the Pool.
              </div>
            ) : myProperties.map(p => {
              const label = addrWithUnit(p);
              const shortAddr   = label.split(",")[0];
              const suburb      = label.split(",").slice(1, 3).join(",").trim();
              const isReleasing = releasingPropId === p.id;
              return (
                <div key={p.id} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{shortAddr}</div>
                      <div className="text-xs text-white/40 truncate">{suburb}</div>
                    </div>
                    <Badge color="green">permanent</Badge>
                  </div>
                  <div className="text-xs text-white/40 space-y-0.5">
                    <div>📅 {p.pickupWeekday || "—"}s</div>
                    {(p.bins || []).length > 0 && <div>{p.bins.map(b => BIN_OPTIONS.find(o => o.key === b)?.emoji || "").join(" ")} {p.bins.map(binLabel).join(", ")}</div>}
                    {p.gate     && <div>🔑 Gate: {p.gate}</div>}
                    {p.notes    && <div>📋 {p.notes}</div>}
                    {p.driveLong && <div>⚠️ Steep/long driveway (+$15/mo)</div>}
                  </div>
                  {!isReleasing ? (
                    <button onClick={() => setReleasingPropId(p.id)}
                      className="mt-3 w-full h-10 rounded-xl border border-white/15 text-white/40 text-xs hover:bg-white/10 hover:text-white/70 transition">
                      Release this property
                    </button>
                  ) : (
                    <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                      <div className="text-sm font-semibold text-red-300 mb-1">Release {shortAddr}?</div>
                      <div className="text-xs text-red-300/70 mb-3">Future jobs go back to the pool. This week's accepted jobs are unaffected.</div>
                      <div className="flex gap-2">
                        <button onClick={() => releaseProperty(p.id)} className="flex-1 h-10 rounded-xl bg-red-600 text-white font-semibold text-sm">Yes, Release</button>
                        <button onClick={() => setReleasingPropId(null)} className="flex-1 h-10 rounded-xl border border-white/20 text-white/60 font-semibold text-sm">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pool tab */}
        {tab === "pool" && (
          <div className="space-y-3">
            <div className="text-xs text-white/40 px-1">Open jobs — first to accept becomes the permanent provider for that property.</div>
            {poolJobs.length === 0
              ? <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center text-white/40 text-sm">No open jobs right now.</div>
              : poolJobs.map(j => {
                const prop = propsById[j.propertyId];
                const addr = addrWithUnit(prop);
                return (
                  <div key={j.id} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                    <div className="font-semibold text-sm mb-1">{j.type === "bins_out" ? "🚮 Bins Out" : "↩️ Bins In"}</div>
                    <div className="text-sm text-white/60">{fmtDate(j.scheduledFor)}</div>
                    <div className="text-sm text-white/80 mt-0.5 truncate">{addr}</div>
                    {j.binTypes?.length > 0 && <div className="text-xs text-white/40 mt-0.5">Bins: {j.binTypes.map(binLabel).join(", ")}</div>}
                    {prop?.driveLong && <div className="text-xs text-amber-400 mt-0.5">⚠️ Steep driveway (+$15/mo)</div>}
                    <div className="text-xs text-green-400/70 mt-1">✨ Accepting makes you the permanent provider for this property</div>
                    <button onClick={() => claimPoolJob(j.id)}
                      className="w-full mt-3 h-11 rounded-xl bg-brand-dark text-white font-semibold hover:opacity-90 active:scale-[0.98] transition">
                      Accept & Own This Property
                    </button>
                  </div>
                );
              })
            }
          </div>
        )}

        {/* Pay tab */}
        {tab === "earnings" && (
          <div className="space-y-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide mb-1">This Month (est.)</div>
              <div className="text-3xl font-bold font-heading">
                ${myProperties.reduce((s, p) => s + 45 + (p.driveLong ? 15 : 0), 0).toFixed(2)}
              </div>
              <div className="text-sm text-white/40">from {myProperties.length} permanent propert{myProperties.length !== 1 ? "ies" : "y"}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide mb-3">Pay Rates</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-white/60">Standard property</span><span className="font-medium">$45.00/mo</span></div>
                <div className="flex justify-between"><span className="text-white/60">Steep driveway bonus</span><span className="font-medium">$15.00/mo</span></div>
                {myProperties.length > 0 && (
                  <div className="border-t border-white/10 pt-2 mt-1 space-y-0.5">
                    {myProperties.map(p => {
                      const label = addrWithUnit(p);
                      return (
                        <div key={p.id} className="flex justify-between text-xs text-white/50">
                          <span className="truncate mr-2">{label.split(",")[0]}</span>
                          <span>${(45 + (p.driveLong ? 15 : 0)).toFixed(2)}/mo</span>
                        </div>
                      );
                    })}
                    <div className="flex justify-between font-bold text-sm border-t border-white/10 pt-2 mt-1">
                      <span>Total</span>
                      <span>${myProperties.reduce((s, p) => s + 45 + (p.driveLong ? 15 : 0), 0).toFixed(2)}/mo</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {/* Profile tab */}
        {tab === "profile" && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide mb-3">Your Details</div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-white/50">Name</span><span>{provider?.name}</span></div>
                <div className="flex justify-between"><span className="text-white/50">Username</span><span className="font-mono text-xs">{provider?.username}</span></div>
                {provider?.phone  && <div className="flex justify-between"><span className="text-white/50">Phone</span><span>{provider.phone}</span></div>}
                {provider?.bio    && <div className="mt-2 text-white/50 text-xs italic">"{provider.bio}"</div>}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide mb-1">Service Area</div>
              <p className="text-xs text-white/40 mb-3">
                {provider?.serviceArea
                  ? `Currently set to ${provider.serviceArea.radiusKm}km radius. Update below.`
                  : "No service area set — you'll receive offers for all properties. Set an area to filter by location."}
              </p>
              <ServiceAreaPicker
                value={provider?.serviceArea || null}
                onChange={area => {
                  setAppState(s => ({
                    ...s,
                    providers: (s.providers || []).map(p =>
                      p.id === providerId ? { ...p, serviceArea: area } : p),
                  }));
                }}
              />
              {provider?.serviceArea && (
                <button onClick={() => setAppState(s => ({
                  ...s,
                  providers: (s.providers || []).map(p =>
                    p.id === providerId ? { ...p, serviceArea: null } : p),
                }))} className="mt-3 text-xs text-white/30 underline hover:text-white/50 transition">
                  Clear service area
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function OpsDashboard({ appState, setAppState, onSignOut }) {
  const [tab,               setTab]               = useState("overview");
  const [editingCustomerId, setEditingCustomerId] = useState(null);
  const [customerDraft,     setCustomerDraft]     = useState(null);
  const [showInbox,         setShowInbox]         = useState(false);
  const [viewingPhotos,     setViewingPhotos]     = useState(null); // { photos, start }

  const allProperties    = appState.properties || [];
  const allJobs          = appState.jobs        || [];
  const providers        = (appState.providers  || []).filter(p => p.active);
  const allCustomers     = appState.customers   || [];
  const nextWeekStart    = startOfNextWeekMonday();
  const nextWeekStartISO = toISODate(nextWeekStart);

  const mrr                  = allProperties.reduce((sum, p) => sum + (p.plan === "monthly" ? monthlyRate(p) : 0), 0);
  const providerCost         = allProperties.reduce((sum, p) => sum + 45 + (p.driveLong ? 15 : 0), 0);
  const margin               = mrr - providerCost;
  const unassigned           = allJobs.filter(j => !j.providerId && j.status === "unassigned" && !j.urgent);
  const urgentJobs           = allJobs.filter(j => j.urgent && j.status === "unassigned");
  const offered              = allJobs.filter(j => j.status === "offered");
  const allDeclined          = allJobs.filter(j => j.allDeclined);
  const adHocJobs            = allJobs.filter(j => j.adHoc);
  const propsWithoutProvider = allProperties.filter(p => p.active !== false && !p.permanentProviderId && p.plan === "monthly");
  const pendingProviders     = (appState.providers || []).filter(p => p.pending && !p.active);

  // Ops inbox — live action-needed items
  const inboxItems = [
    ...urgentJobs.map(j => {
      const prop = allProperties.find(p => p.id === j.propertyId);
      return { id: j.id, type: "urgent", emoji: "🚨", label: "Urgent job needs provider",
        sub: addrWithUnit(prop)?.split(",")[0] || "—", action: "Assign", jobId: j.id };
    }),
    ...allDeclined.map(j => {
      const prop = allProperties.find(p => p.id === j.propertyId);
      return { id: j.id, type: "declined", emoji: "⚠️", label: "All providers declined",
        sub: addrWithUnit(prop)?.split(",")[0] || "—", action: "Re-offer", jobId: j.id };
    }),
    ...unassigned.filter(j => {
      const ageHours = (Date.now() - new Date(j.scheduledFor).getTime()) / 36e5;
      return ageHours > 24;
    }).map(j => {
      const prop = allProperties.find(p => p.id === j.propertyId);
      return { id: j.id, type: "stale", emoji: "🕐", label: "Job unassigned 24h+",
        sub: addrWithUnit(prop)?.split(",")[0] || "—", action: "Assign", jobId: j.id };
    }),
    ...pendingProviders.map(p => ({
      id: p.id, type: "application", emoji: "📋", label: "New provider application",
      sub: `${p.name} · ${p.phone || ""}`, action: "Review", providerId: p.id,
    })),
  ];

  function fireNotif(event, message, propertyLabel = "") {
    const prefs = appState.notifPrefs || defaultNotifPrefs();
    const p = prefs[event];
    if (!p) return;
    const channels = [p.email && "email", p.push && "push"].filter(Boolean);
    if (!channels.length) return;
    const notif = makeNotif({ event, message, propertyLabel, channel: channels.join("+") });
    setAppState(s => ({ ...s, notifications: [notif, ...(s.notifications || [])] }));
  }

  function offerJob(jobId, pid) {
    const job      = allJobs.find(j => j.id === jobId);
    const prop     = allProperties.find(p => p.id === job?.propertyId);
    const provider = providers.find(p => p.id === pid);
    setAppState(s => ({
      ...s,
      jobs: (s.jobs || []).map(j => j.id === jobId
        ? { ...j, status: "offered", offeredTo: pid, providerId: null,
            offerHistory: [...(j.offerHistory || []), pid], allDeclined: false }
        : j),
    }));
    if (provider && prop) {
      fireNotif("provider_assigned",
        `${provider.name} has been assigned to your property and will handle your bins.`,
        addrWithUnit(prop));
      // Also notify the provider
      const provNotif = {
        id: makeId(), providerId: pid,
        message: `📋 New job offer — ${addrWithUnit(prop).split(",")[0]}. Tap to view and accept.`,
        emoji: "📋", timestamp: new Date().toISOString(), read: false,
      };
      setAppState(s => ({ ...s, providerNotifs: [provNotif, ...(s.providerNotifs || [])] }));
    }
  }

  function assignPermanentProvider(propertyId, pid) {
    setAppState(s => ({
      ...s,
      properties: (s.properties || []).map(p =>
        p.id === propertyId ? { ...p, permanentProviderId: pid || null } : p),
      jobs: (s.jobs || []).map(j =>
        j.propertyId === propertyId && j.permanent && j.status !== "done"
          ? { ...j, providerId: pid || null, status: pid ? "accepted" : "unassigned", offeredTo: null, allDeclined: false }
          : j),
    }));
  }

  function generateJobsForProp(prop, existingJobs) {
    const jsDay = weekdayToJsDay(prop.pickupWeekday || prop?.schedule?.weekday || "");
    if (jsDay == null) return [];
    const pickupDate = addDays(nextWeekStart, (jsDay - 1 + 7) % 7);
    const binTypes   = [];
    if (prop.bins?.includes("general"))   binTypes.push("general");
    if (prop.bins?.includes("recycling") && isDueFortnightly(prop.startDates?.recycling || prop?.schedule?.startDates?.recycling, pickupDate)) binTypes.push("recycling");
    if (prop.bins?.includes("fogo")      && isDueFortnightly(prop.startDates?.fogo      || prop?.schedule?.startDates?.fogo,      pickupDate)) binTypes.push("fogo");
    if (prop.bins?.includes("glass")     && isDueFortnightly(prop.startDates?.glass     || prop?.schedule?.startDates?.glass,     pickupDate)) binTypes.push("glass");
    if (!binTypes.length) return [];
    const pickupISO  = toISODate(pickupDate);
    const keyOut     = `${prop.id}_bins_out_${pickupISO}`;
    const keyIn      = `${prop.id}_bins_in_${pickupISO}`;
    const permProv   = prop.permanentProviderId || null;
    const initStatus = permProv ? "accepted" : "unassigned";
    const toAdd      = [];
    if (!existingJobs.some(j => j.jobKey === keyOut))
      toAdd.push({ id: makeId(), jobKey: keyOut, weekStartISO: nextWeekStartISO, propertyId: prop.id,
        providerId: permProv, type: "bins_out", binTypes, permanent: true,
        scheduledFor: setTime(addDays(pickupDate, -1), 19, 0).toISOString(), status: initStatus });
    if (!existingJobs.some(j => j.jobKey === keyIn))
      toAdd.push({ id: makeId(), jobKey: keyIn, weekStartISO: nextWeekStartISO, propertyId: prop.id,
        providerId: permProv, type: "bins_in", binTypes, permanent: true,
        scheduledFor: setTime(pickupDate, 15, 0).toISOString(), status: initStatus });
    return toAdd;
  }

  function generateAll() {
    setAppState(s => {
      const existing    = s.jobs || [];
      const activeProps = (s.properties || []).filter(p => p.active !== false && p.plan === "monthly");
      const allNew      = [];
      for (const prop of activeProps) {
        const newJobs = generateJobsForProp(prop, [...existing, ...allNew]);
        allNew.push(...newJobs);
      }
      if (!allNew.length) return s;
      return { ...s, jobs: [...existing, ...allNew] };
    });
  }

  function setProviderCredentials(pid, field, value) {
    setAppState(s => ({
      ...s,
      providers: (s.providers || []).map(p => p.id === pid ? { ...p, [field]: value } : p),
    }));
  }

  return (
    <div className="min-h-screen bg-brand-muted">
      <div className="w-full flex items-center justify-between py-4 px-5 sticky top-0 bg-white/90 backdrop-blur z-10 border-b">
        <h1 className="text-lg font-semibold text-brand-fg font-heading">FmyBins Ops</h1>
        <div className="flex items-center gap-2">
          {/* Ops inbox bell */}
          <button onClick={() => setShowInbox(v => !v)}
            className="relative text-sm px-2.5 py-1 rounded-full border border-gray-300 hover:bg-gray-50 transition">
            🔔
            {inboxItems.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                {inboxItems.length > 9 ? "9+" : inboxItems.length}
              </span>
            )}
          </button>
          <button onClick={onSignOut} className="text-xs border border-gray-300 text-gray-400 px-3 py-1 rounded-full hover:text-gray-600 transition">Sign out</button>
        </div>
      </div>

      {viewingPhotos && (
        <PhotoViewer photos={viewingPhotos.photos} onClose={() => setViewingPhotos(null)} />
      )}

      {/* Ops inbox drawer */}
      {showInbox && (
        <div className="fixed inset-0 z-40 flex flex-col" onClick={() => setShowInbox(false)}>
          <div className="flex-1" />
          <div className="bg-white rounded-t-3xl shadow-2xl max-h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b">
              <div>
                <h2 className="font-heading font-semibold text-brand-fg">Action Required</h2>
                <div className="text-xs text-gray-400">{inboxItems.length} item{inboxItems.length !== 1 ? "s" : ""} need{inboxItems.length === 1 ? "s" : ""} attention</div>
              </div>
              <button onClick={() => setShowInbox(false)} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
              {inboxItems.length === 0 && (
                <div className="text-center py-10">
                  <div className="text-4xl mb-3">✅</div>
                  <p className="text-sm text-gray-400 font-medium">All clear! Nothing needs attention.</p>
                </div>
              )}
              {inboxItems.map(item => (
                <div key={item.id}
                  className={`rounded-2xl border p-3 flex items-center gap-3 ${
                    item.type === "urgent"      ? "bg-red-50 border-red-200" :
                    item.type === "declined"    ? "bg-orange-50 border-orange-200" :
                    item.type === "application" ? "bg-amber-50 border-amber-200" :
                    "bg-gray-50 border-gray-200"}`}>
                  <div className="text-xl flex-shrink-0">{item.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-brand-fg">{item.label}</div>
                    <div className="text-xs text-gray-500 truncate mt-0.5">{item.sub}</div>
                  </div>
                  <button onClick={() => {
                    setShowInbox(false);
                    if (item.type === "application") setTab("providers");
                    else setTab("jobs");
                  }} className={`flex-shrink-0 h-8 px-3 rounded-lg text-xs font-semibold transition ${
                    item.type === "urgent"   ? "bg-red-600 text-white hover:bg-red-700" :
                    item.type === "declined" ? "bg-orange-500 text-white hover:bg-orange-600" :
                    "bg-brand-dark text-white hover:opacity-90"}`}>
                    {item.action} →
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="sticky top-[65px] z-10 bg-white/90 backdrop-blur border-b px-4 py-2">
        <div className="max-w-2xl mx-auto flex gap-1 overflow-x-auto">
          {[["overview","Overview"],["jobs","Jobs"],["properties","Properties"],["providers","Providers"],["customers","Customers"],["reporting","Reporting"],["finance","Finance"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${tab === id ? "bg-brand-dark text-white" : "text-gray-600 hover:bg-gray-100"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-5 space-y-4">

        {/* ── Overview ── */}
        {tab === "overview" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Active properties" value={allProperties.filter(p => p.active !== false).length} sub={`${allProperties.length} total`} />
              <StatCard label="Jobs this week"    value={allJobs.filter(j => j.weekStartISO === nextWeekStartISO).length} sub={`${allJobs.filter(j => j.status === "done").length} done`} />
              <StatCard label="Providers"         value={providers.length} sub="active" />
              <StatCard label="MRR"               value={`$${mrr.toFixed(0)}`} sub={`$${margin.toFixed(0)} margin`} />
            </div>

            {propsWithoutProvider.length > 0 && (
              <Card className="border-orange-200 bg-orange-50">
                <div className="text-sm font-semibold text-orange-700 mb-2">
                  🏠 {propsWithoutProvider.length} propert{propsWithoutProvider.length > 1 ? "ies" : "y"} without a permanent provider
                </div>
                {propsWithoutProvider.slice(0, 3).map(p => {
                  const label = addrWithUnit(p);
                  return (
                    <div key={p.id} className="text-xs text-orange-700 flex justify-between py-1 border-b border-orange-100 last:border-0">
                      <span className="truncate mr-2">{label.split(",")[0]}</span>
                      <button onClick={() => setTab("properties")} className="underline flex-shrink-0">Assign</button>
                    </div>
                  );
                })}
              </Card>
            )}

            {urgentJobs.length > 0 && (
              <Card className="border-red-400 bg-red-50">
                <div className="text-sm font-semibold text-red-700 mb-2">🚨 {urgentJobs.length} URGENT job{urgentJobs.length > 1 ? "s" : ""} — assign NOW</div>
                {urgentJobs.map(j => {
                  const prop = allProperties.find(p => p.id === j.propertyId);
                  return (
                    <div key={j.id} className="text-xs text-red-600 flex justify-between py-1 border-b border-red-200 last:border-0">
                      <span className="truncate mr-2">🚨 {addrWithUnit(prop).split(",")[0]}</span>
                      <button onClick={() => setTab("jobs")} className="underline flex-shrink-0 font-semibold">Assign →</button>
                    </div>
                  );
                })}
              </Card>
            )}

            {allDeclined.length > 0 && (
              <Card className="border-red-300 bg-red-50">
                <div className="text-sm font-semibold text-red-700 mb-2">🚨 {allDeclined.length} job{allDeclined.length > 1 ? "s" : ""} — all providers declined</div>
                {allDeclined.slice(0, 3).map(j => {
                  const prop = allProperties.find(p => p.id === j.propertyId);
                  return (
                    <div key={j.id} className="text-xs text-red-600 flex justify-between py-1 border-b border-red-100 last:border-0">
                      <span className="truncate mr-2">{j.type === "bins_out" ? "Bins Out" : "Bins In"} — {addrWithUnit(prop).split(",")[0]}</span>
                      <button onClick={() => setTab("jobs")} className="underline flex-shrink-0">Re-offer</button>
                    </div>
                  );
                })}
              </Card>
            )}

            {unassigned.length > 0 && (
              <Card className="border-amber-200 bg-amber-50">
                <div className="text-sm font-semibold text-amber-700 mb-2">⚠️ {unassigned.length} job{unassigned.length > 1 ? "s" : ""} need{unassigned.length === 1 ? "s" : ""} offering</div>
                {unassigned.slice(0, 3).map(j => {
                  const prop = allProperties.find(p => p.id === j.propertyId);
                  return (
                    <div key={j.id} className="text-xs text-amber-700 flex justify-between py-1 border-b border-amber-100 last:border-0">
                      <span className="truncate mr-2">{j.type === "bins_out" ? "Bins Out" : j.type === "bins_in" ? "Bins In" : "Ad Hoc"} — {addrWithUnit(prop).split(",")[0]}</span>
                      <button onClick={() => setTab("jobs")} className="underline flex-shrink-0">Offer</button>
                    </div>
                  );
                })}
              </Card>
            )}

            {offered.length > 0 && (
              <Card className="border-blue-200 bg-blue-50">
                <div className="text-sm font-semibold text-blue-700 mb-1">🕐 {offered.length} offer{offered.length > 1 ? "s" : ""} pending response</div>
                <div className="text-xs text-blue-500">{offered.map(j => providers.find(p => p.id === j.offeredTo)?.name || "?").join(", ")}</div>
              </Card>
            )}

            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Weekly Batch</div>
              <p className="text-sm text-gray-600 mb-3">Generate jobs for all active properties — week of <span className="font-semibold">{nextWeekStartISO}</span></p>
              <button onClick={generateAll} className="w-full h-11 rounded-xl bg-brand-dark text-white font-semibold hover:opacity-90 transition">
                Generate All Jobs for Next Week
              </button>
            </Card>
          </>
        )}

        {/* ── Jobs ── */}
        {tab === "jobs" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-medium text-gray-700">{allJobs.length} total jobs</div>
              <div className="flex gap-2">
                <button onClick={() => {
                  const before = (appState.jobs || []).length;
                  generateAll();
                  // Brief feedback via title flash — real toast would need state
                  setTimeout(() => alert(`Jobs generated for week of ${nextWeekStartISO}`), 100);
                }} className="h-9 px-4 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:opacity-90">
                  Generate Next Week
                </button>
                <button onClick={() => {
                  const cutoff = toISODate(new Date());
                  setAppState(s => ({ ...s, jobs: (s.jobs || []).filter(j => j.weekStartISO >= cutoff || j.status !== "done") }));
                }} className="h-9 px-3 rounded-xl border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
                  Clear Done
                </button>
              </div>
            </div>
            {allJobs.length === 0
              ? <Card><p className="text-sm text-gray-400 text-center py-4">No jobs yet. Generate a batch above.</p></Card>
              : allJobs.slice().sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor)).map(j => {
                const prop      = allProperties.find(p => p.id === j.propertyId);
                const addr = addrWithUnit(prop);
                const prov      = providers.find(p => p.id === j.providerId);
                const offeredTo = providers.find(p => p.id === j.offeredTo);
                const isOffered  = j.status === "offered";
                const isAccepted = j.status === "accepted" || (j.providerId && !isOffered && j.status !== "done");
                const isDone     = j.status === "done";
                const declined   = j.allDeclined;
                const badgeColor = isDone ? "green" : isAccepted ? "blue" : isOffered ? "yellow" : declined ? "red" : "gray";
                const badgeLabel = isDone ? "done" : isAccepted ? "accepted" : isOffered ? "offered" : declined ? "all declined" : "unassigned";
                return (
                  <Card key={j.id} className={declined ? "border-red-200" : isOffered ? "border-yellow-200" : ""}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          {j.type === "bins_out" ? "🚮 Bins Out" : j.type === "bins_in" ? "↩️ Bins In" : "⚡ Ad Hoc"}
                          {j.urgent    && <span className="ml-1"><Badge color="red">🚨 Urgent</Badge></span>}
                          {j.adHoc     && !j.urgent && <span className="ml-1"><Badge color="blue">Ad Hoc</Badge></span>}
                          {j.permanent && <span className="ml-1"><Badge color="purple">Recurring</Badge></span>}
                          {j.photos?.length > 0 && <span className="ml-1 text-xs text-gray-400">📷 {j.photos.length}</span>}
                        </div>
                        {isDone && j.photos?.length > 0 && (
                          <div className="grid grid-cols-3 gap-1 mt-2 max-w-[140px]">
                            {j.photos.slice(0, 3).map((p, i) => (
                              <img key={i} src={p.dataUrl} alt="proof"
                                className="aspect-square rounded-lg object-cover border border-gray-200 cursor-pointer hover:opacity-80 transition"
                                onClick={() => setViewingPhotos({ photos: j.photos, start: i })} />
                            ))}
                          </div>
                        )}
                        <div className="text-xs text-gray-500 mt-0.5">{fmtDate(j.scheduledFor)}</div>
                        <div className="text-xs text-gray-600 truncate mt-0.5">{addr.split(",")[0]}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {isAccepted  && prov      && <>✅ Accepted by <span className="font-medium">{prov.name}</span></>}
                          {isOffered   && offeredTo  && <>🕐 Offered to <span className="font-medium">{offeredTo.name}</span> — awaiting response</>}
                          {declined    && <span className="text-red-500 font-medium">All providers declined</span>}
                          {!isOffered && !isAccepted && !declined && !isDone && <span className="text-amber-600">Not yet offered</span>}
                          {isDone      && prov      && <>Completed by {prov.name}</>}
                        </div>
                        {(j.offerHistory || []).length > 0 && !isAccepted && !isDone && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            Declined by: {(j.offerHistory || []).map(id => providers.find(p => p.id === id)?.name || "?").join(", ")}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <Badge color={badgeColor}>{badgeLabel}</Badge>
                        {!isAccepted && !isDone && (
                          <select value="" onChange={e => { if (e.target.value) offerJob(j.id, e.target.value); }}
                            className="text-xs border rounded-lg px-2 py-1 bg-white">
                            <option value="">{isOffered || declined ? "Re-offer…" : "Offer to…"}</option>
                            {providers.filter(p => p.id !== j.offeredTo).map(p => {
                              const covers = providerCoversProperty(p, prop || {});
                              return (
                                <option key={p.id} value={p.id}>
                                  {covers ? "✓ " : "⚠️ "}{p.name}{!covers ? " (outside area)" : ""}
                                </option>
                              );
                            })}
                          </select>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })
            }
          </div>
        )}

        {/* ── Properties ── */}
        {tab === "properties" && (
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700">
              {allProperties.length} propert{allProperties.length === 1 ? "y" : "ies"} · {propsWithoutProvider.length} without provider
            </div>
            {allProperties.length === 0
              ? <Card><p className="text-sm text-gray-400 text-center py-4">No properties yet.</p></Card>
              : allProperties.map(p => {
                const label = addrWithUnit(p);
                const permProv = providers.find(pr => pr.id === p.permanentProviderId);
                return (
                  <Card key={p.id} className={!p.permanentProviderId && p.active !== false ? "border-orange-200" : ""}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{label.split(",")[0]}</div>
                        <div className="text-xs text-gray-400 truncate">{label.split(",").slice(1).join(",").trim()}</div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          <Badge color="gray">{p.type || "Holiday Home"}</Badge>
                          <Badge color={p.plan === "monthly" ? "blue" : p.plan === "pack" ? "purple" : "orange"}>{planLabel(p.plan || "monthly")}</Badge>
                          {p.plan === "pack" && <Badge color="gray">🎟️ {p.packCredits ?? 0} credits</Badge>}
                          {p.driveLong          && <Badge color="yellow">Steep</Badge>}
                          {p.active === false    && <Badge color="yellow">Paused</Badge>}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">📅 {p.pickupWeekday || "—"} · {(p.bins || []).map(binLabel).join(", ") || "No bins set"}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-bold">${monthlyRate(p).toFixed(2)}</div>
                        <div className="text-xs text-gray-400">/month</div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                      <div className="text-xs text-gray-500 flex-shrink-0">Permanent provider:</div>
                      {permProv ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Badge color="green">✓ {permProv.name}</Badge>
                          <button onClick={() => assignPermanentProvider(p.id, null)} className="text-xs text-gray-400 hover:text-red-500 transition ml-auto">Unassign</button>
                        </div>
                      ) : (
                        <select value="" onChange={e => { if (e.target.value) assignPermanentProvider(p.id, e.target.value); }}
                          className="flex-1 h-8 rounded-lg border border-orange-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-dark">
                          <option value="">Assign provider…</option>
                          {providers.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                        </select>
                      )}
                    </div>
                  </Card>
                );
              })
            }
          </div>
        )}

        {/* ── Providers ── */}
        {tab === "providers" && (
          <div className="space-y-3">

            {/* Pending applicants */}
            {(() => {
              const pending = (appState.providers || []).filter(p => p.pending && !p.active);
              if (!pending.length) return null;
              return (
                <Card className="border-amber-200 bg-amber-50">
                  <div className="text-sm font-semibold text-amber-700 mb-3">
                    🕐 {pending.length} pending application{pending.length !== 1 ? "s" : ""}
                  </div>
                  <div className="space-y-3">
                    {pending.map(p => (
                      <div key={p.id} className="rounded-xl border border-amber-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <div className="font-semibold text-sm">{p.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5">📞 {p.phone} · 📍 {p.suburb}</div>
                            {p.bio && <div className="text-xs text-gray-400 mt-1 italic">"{p.bio}"</div>}
                            <div className="text-xs text-gray-400 mt-1">Applied {new Date(p.appliedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setAppState(s => ({
                            ...s,
                            providers: (s.providers || []).map(pr =>
                              pr.id === p.id ? { ...pr, active: true, pending: false } : pr),
                          }))} className="flex-1 h-9 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition">
                            ✓ Approve
                          </button>
                          <button onClick={() => setAppState(s => ({
                            ...s,
                            providers: (s.providers || []).filter(pr => pr.id !== p.id),
                          }))} className="flex-1 h-9 rounded-lg border border-red-300 text-red-500 text-sm font-semibold hover:bg-red-50 transition">
                            ✕ Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })()}

            <p className="text-sm text-gray-500">Manage provider credentials. Providers log in with username and password.</p>
            {providers.map(p => {
              const pJobs     = allJobs.filter(j => j.providerId === p.id);
              const pProps    = allProperties.filter(prop => prop.permanentProviderId === p.id);
              return (
                <Card key={p.id}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-xs text-gray-500">{pProps.length} properties · {pJobs.length} jobs · {pJobs.filter(j => j.status === "done").length} done</div>
                      {p.serviceArea
                        ? <div className="text-xs text-brand-dark mt-0.5">📍 {p.serviceArea.radiusKm}km radius set</div>
                        : <div className="text-xs text-amber-500 mt-0.5">⚠️ No service area — covers all properties</div>}
                    </div>
                    <Badge color="green">Active</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Username</div>
                      <input type="text" defaultValue={p.username || p.name.toLowerCase().replace(/\s+/g, "")}
                        onBlur={e => setProviderCredentials(p.id, "username", e.target.value)}
                        className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark" />
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Password</div>
                      <input type="text" defaultValue={p.password || "password"}
                        onBlur={e => setProviderCredentials(p.id, "password", e.target.value)}
                        className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark" />
                    </div>
                  </div>
                </Card>
              );
            })}
            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Pay Rates</div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span>Standard property</span><span className="font-medium">$45.00/mo</span></div>
                <div className="flex justify-between"><span>Steep driveway bonus</span><span className="font-medium">$15.00/mo</span></div>
                <div className="flex justify-between text-gray-400 text-xs border-t pt-1.5 mt-1"><span>FmyBins margin (standard)</span><span>$14.90/mo per property</span></div>
              </div>
            </Card>
          </div>
        )}

        {/* ── Customers ── */}
        {tab === "customers" && (
          <div className="space-y-3">
            {editingCustomerId === null ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-500">{allProperties.length} propert{allProperties.length !== 1 ? "ies" : "y"} across {new Set(allProperties.map(p => p.customerId || "anon")).size} customer{new Set(allProperties.map(p => p.customerId || "anon")).size !== 1 ? "s" : ""}</div>
                </div>

                {allProperties.length === 0 && (
                  <Card><p className="text-sm text-gray-400 text-center py-6">No customers yet.</p></Card>
                )}

                {/* Group properties by customer — for now each property is treated as a customer record */}
                {allProperties.map(p => {
                  const label       = addrWithUnit(p);
                  const pJobs       = allJobs.filter(j => j.propertyId === p.id);
                  const doneJobs    = pJobs.filter(j => j.status === "done");
                  const isPack      = p.plan === "pack";
                  const isMonthly   = p.plan === "monthly";
                  const credits     = p.packCredits ?? 0;
                  const lowCredits  = isPack && credits <= 2;
                  const noProvider  = isMonthly && !p.permanentProviderId && p.active !== false;
                  const perm        = providers.find(pr => pr.id === p.permanentProviderId);

                  return (
                    <Card key={p.id} className={lowCredits ? "border-amber-300" : noProvider ? "border-orange-200" : ""}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                            <span className="font-semibold text-brand-fg truncate">{label.split(",")[0]}</span>
                            {p.active === false && <Badge color="yellow">Paused</Badge>}
                            {lowCredits && <Badge color="yellow">⚠️ Low credits</Badge>}
                          </div>
                          <div className="text-xs text-gray-400 truncate mb-2">{label.split(",").slice(1, 3).join(",").trim()}</div>
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            <Badge color={isMonthly ? "blue" : isPack ? "purple" : "orange"}>{planLabel(p.plan || "monthly")}</Badge>
                            {isPack && <Badge color="gray">🎟️ {credits} credits</Badge>}
                            {p.type && <Badge color="gray">{p.type}</Badge>}
                          </div>
                          <div className="text-xs text-gray-400">
                            {perm ? `Provider: ${perm.name}` : <span className="text-orange-500">No provider assigned</span>}
                            {" · "}{doneJobs.length} service{doneJobs.length !== 1 ? "s" : ""} completed
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          <button onClick={() => { setEditingCustomerId(p.id); setCustomerDraft({ ...p }); }}
                            className="h-8 px-3 rounded-lg border text-xs font-medium hover:bg-gray-50 transition">
                            Edit
                          </button>
                          <button onClick={() => setAppState(s => ({
                            ...s,
                            properties: (s.properties || []).map(pr => pr.id === p.id ? { ...pr, active: pr.active === false } : pr),
                          }))} className={`h-8 px-3 rounded-lg border text-xs font-medium transition ${p.active === false ? "border-green-300 text-green-600 hover:bg-green-50" : "border-yellow-300 text-yellow-600 hover:bg-yellow-50"}`}>
                            {p.active === false ? "Unpause" : "Pause"}
                          </button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </>
            ) : (
              // ── Customer edit panel ──
              (() => {
                const p = customerDraft;
                if (!p) return null;
                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <button onClick={() => { setEditingCustomerId(null); setCustomerDraft(null); }}
                        className="text-sm text-brand-dark underline">← Back</button>
                      <h3 className="font-semibold text-brand-fg">Edit Customer</h3>
                    </div>
                    <Card>
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Property</div>
                      <div className="font-semibold text-sm mb-0.5">{addrWithUnit(p).split(",")[0]}</div>
                      <div className="text-xs text-gray-400 mb-3">{addrWithUnit(p).split(",").slice(1).join(",").trim()}</div>

                      <div className="space-y-3">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Customer name</div>
                          <input type="text" value={p.customerName || ""} placeholder="e.g. Sarah Johnson"
                            onChange={e => setCustomerDraft(d => ({ ...d, customerName: e.target.value }))}
                            className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark" />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Email</div>
                          <input type="email" value={p.customerEmail || ""} placeholder="e.g. sarah@example.com"
                            onChange={e => setCustomerDraft(d => ({ ...d, customerEmail: e.target.value }))}
                            className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark" />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Phone</div>
                          <input type="tel" value={p.customerPhone || ""} placeholder="e.g. 0412 345 678"
                            onChange={e => setCustomerDraft(d => ({ ...d, customerPhone: e.target.value }))}
                            className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark" />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Ops notes</div>
                          <textarea value={p.opsNotes || ""} rows={3} placeholder="Internal notes visible only to ops…"
                            onChange={e => setCustomerDraft(d => ({ ...d, opsNotes: e.target.value }))}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark resize-none" />
                        </div>
                        {p.plan === "pack" && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Pack credits (manual adjust)</div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setCustomerDraft(d => ({ ...d, packCredits: Math.max(0, (d.packCredits ?? 0) - 1) }))}
                                className="w-9 h-9 rounded-lg border font-bold text-lg hover:bg-gray-50">−</button>
                              <span className="text-lg font-bold w-8 text-center">{p.packCredits ?? 0}</span>
                              <button onClick={() => setCustomerDraft(d => ({ ...d, packCredits: (d.packCredits ?? 0) + 1 }))}
                                className="w-9 h-9 rounded-lg border font-bold text-lg hover:bg-gray-50">+</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                    <div className="flex gap-3">
                      <PrimaryButton onClick={() => {
                        setAppState(s => ({ ...s, properties: (s.properties || []).map(pr => pr.id === p.id ? { ...pr, ...p } : pr) }));
                        setEditingCustomerId(null); setCustomerDraft(null);
                      }}>Save Changes</PrimaryButton>
                      <button onClick={() => { setEditingCustomerId(null); setCustomerDraft(null); }}
                        className="flex-1 h-12 rounded-xl border border-gray-300 font-semibold text-sm hover:bg-gray-50 transition">Cancel</button>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        )}

        {/* ── Reporting ── */}
        {tab === "reporting" && (() => {
          const activeProps     = allProperties.filter(p => p.active !== false);
          const monthlyProps    = activeProps.filter(p => p.plan === "monthly");
          const packProps       = activeProps.filter(p => p.plan === "pack");
          const onceOffJobs     = allJobs.filter(j => j.adHoc && !j.urgent);
          const urgentJobsDone  = allJobs.filter(j => j.urgent && j.status === "done");
          const totalJobs       = allJobs.length;
          const doneJobs        = allJobs.filter(j => j.status === "done");
          const completionRate  = totalJobs > 0 ? Math.round((doneJobs.length / totalJobs) * 100) : 0;
          const packRevenue     = packProps.reduce((s, p) => s + ((10 - (p.packCredits ?? 10)) * 22), 0);
          const onceOffRevenue  = onceOffJobs.filter(j => j.status === "done").length * 27;
          const urgentRevenue   = urgentJobsDone.length * 35;
          const totalRevenue    = mrr + packRevenue + onceOffRevenue + urgentRevenue;

          // Provider performance
          const providerStats = providers.map(p => {
            const pJobs     = allJobs.filter(j => j.providerId === p.id);
            const done      = pJobs.filter(j => j.status === "done").length;
            const pProps    = activeProps.filter(pr => pr.permanentProviderId === p.id).length;
            const rate      = pJobs.length > 0 ? Math.round((done / pJobs.length) * 100) : null;
            return { ...p, jobCount: pJobs.length, doneCount: done, propCount: pProps, completionRate: rate };
          }).sort((a, b) => b.doneCount - a.doneCount);

          // Simple bar chart data — revenue by plan type
          const revenueBreakdown = [
            { label: "Monthly", value: mrr,           color: "#2E3A3A" },
            { label: "10-Pack", value: packRevenue,    color: "#6B7C7C" },
            { label: "Once-Off", value: onceOffRevenue, color: "#9CA8A8" },
            { label: "Urgent",  value: urgentRevenue,  color: "#C2392A" },
          ].filter(d => d.value > 0);
          const maxRevVal = Math.max(...revenueBreakdown.map(d => d.value), 1);

          // Job completion by provider bar chart
          const maxJobs = Math.max(...providerStats.map(p => p.jobCount), 1);

          return (
            <div className="space-y-4">
              {/* Top stats */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Total revenue"    value={`$${totalRevenue.toFixed(0)}`} sub="all plans combined" />
                <StatCard label="Completion rate"  value={`${completionRate}%`}          sub={`${doneJobs.length}/${totalJobs} jobs done`} />
                <StatCard label="Active customers" value={activeProps.length}             sub={`${monthlyProps.length} monthly · ${packProps.length} pack`} />
                <StatCard label="Provider count"   value={providers.length}              sub={`${providerStats.filter(p => p.propCount > 0).length} with properties`} />
              </div>

              {/* Revenue breakdown chart */}
              <Card>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-4">Revenue by Plan Type</div>
                {revenueBreakdown.length === 0
                  ? <p className="text-sm text-gray-400">No revenue data yet.</p>
                  : (
                    <div className="space-y-3">
                      {revenueBreakdown.map(d => (
                        <div key={d.label}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-600">{d.label}</span>
                            <span className="font-semibold">${d.value.toFixed(0)}</span>
                          </div>
                          <div className="h-6 bg-gray-100 rounded-lg overflow-hidden">
                            <div className="h-full rounded-lg transition-all duration-500"
                              style={{ width: `${Math.max(4, (d.value / maxRevVal) * 100)}%`, backgroundColor: d.color }} />
                          </div>
                        </div>
                      ))}
                      <div className="pt-2 border-t flex justify-between text-sm font-bold">
                        <span>Total</span><span>${totalRevenue.toFixed(0)}</span>
                      </div>
                    </div>
                  )}
              </Card>

              {/* Provider performance chart */}
              <Card>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-4">Provider Performance</div>
                {providerStats.length === 0
                  ? <p className="text-sm text-gray-400">No providers yet.</p>
                  : (
                    <div className="space-y-3">
                      {providerStats.map(p => (
                        <div key={p.id}>
                          <div className="flex justify-between text-sm mb-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{p.name}</span>
                              <span className="text-xs text-gray-400">{p.propCount} prop{p.propCount !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {p.completionRate !== null && (
                                <Badge color={p.completionRate >= 90 ? "green" : p.completionRate >= 70 ? "yellow" : "red"}>
                                  {p.completionRate}%
                                </Badge>
                              )}
                              <span className="text-xs text-gray-400">{p.doneCount}/{p.jobCount} done</span>
                            </div>
                          </div>
                          <div className="h-5 bg-gray-100 rounded-lg overflow-hidden flex">
                            <div className="h-full bg-brand-dark rounded-lg transition-all duration-500"
                              style={{ width: `${Math.max(2, (p.doneCount / maxJobs) * 100)}%` }} />
                            {(p.jobCount - p.doneCount) > 0 && (
                              <div className="h-full bg-gray-300 transition-all duration-500"
                                style={{ width: `${((p.jobCount - p.doneCount) / maxJobs) * 100}%` }} />
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="flex gap-4 pt-1 text-xs text-gray-400">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-brand-dark"/><span>Done</span></div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-gray-300"/><span>Pending</span></div>
                      </div>
                    </div>
                  )}
              </Card>

              {/* Jobs summary */}
              <Card>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Jobs Summary</div>
                <div className="space-y-2 text-sm">
                  {[
                    ["Total jobs",          totalJobs],
                    ["Completed",           doneJobs.length],
                    ["Unassigned",          allJobs.filter(j => j.status === "unassigned").length],
                    ["Offered (pending)",   allJobs.filter(j => j.status === "offered").length],
                    ["Once-off (adhoc)",    onceOffJobs.length],
                    ["Urgent",              allJobs.filter(j => j.urgent).length],
                  ].map(([label, val]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-medium">{val}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Properties without providers */}
              {propsWithoutProvider.length > 0 && (
                <Card className="border-orange-200 bg-orange-50">
                  <div className="text-sm font-semibold text-orange-700 mb-2">
                    ⚠️ {propsWithoutProvider.length} propert{propsWithoutProvider.length !== 1 ? "ies" : "y"} without a provider
                  </div>
                  {propsWithoutProvider.map(p => (
                    <div key={p.id} className="text-xs text-orange-600 py-1 border-b border-orange-100 last:border-0">
                      {addrWithUnit(p).split(",")[0]}
                    </div>
                  ))}
                </Card>
              )}
            </div>
          );
        })()}

        {/* ── Finance ── */}
        {tab === "finance" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="MRR"            value={`$${mrr.toFixed(2)}`}          sub="monthly revenue" />
              <StatCard label="Provider costs" value={`$${providerCost.toFixed(2)}`} sub="this month" />
              <StatCard label="Net margin"     value={`$${margin.toFixed(2)}`}        sub={`${mrr > 0 ? ((margin/mrr)*100).toFixed(0) : 0}% margin`} />
              <StatCard label="Ad hoc revenue" value={`$${(adHocJobs.length * 25).toFixed(2)}`} sub={`${adHocJobs.length} jobs`} />
            </div>
            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Per Property</div>
              {allProperties.length === 0
                ? <p className="text-sm text-gray-400">No properties yet.</p>
                : <>
                  {allProperties.map(p => {
                    const label = addrWithUnit(p);
                    const rev   = monthlyRate(p);
                    const cost  = 45 + (p.driveLong ? 15 : 0);
                    const perm  = providers.find(pr => pr.id === p.permanentProviderId);
                    return (
                      <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{label.split(",")[0]}</div>
                          <div className="text-xs text-gray-400">{p.type}{p.driveLong ? " · steep" : ""}{perm ? ` · ${perm.name}` : " · unassigned"}</div>
                        </div>
                        <div className="text-right ml-2">
                          <div className="font-semibold">${rev.toFixed(2)}</div>
                          <div className="text-xs text-gray-400">prov: ${cost.toFixed(2)}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex justify-between pt-2 font-bold text-sm"><span>Total</span><span>${mrr.toFixed(2)}/mo</span></div>
                </>
              }
            </Card>
          </div>
        )}

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ROOT APP ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [screen,             setScreen]             = useState("rolePicker");
  const [loggedInProviderId, setLoggedInProviderId] = useState(null);
  const [editingPropertyId,  setEditingPropertyId]  = useState(null);
  const [pendingPlan,        setPendingPlan]        = useState("monthly");
  const [paymentResult,      setPaymentResult]      = useState(null); // { status, plan, propertyId }

  // Handle Stripe return redirect
  useEffect(() => {
    const params      = new URLSearchParams(window.location.search);
    const payment     = params.get("payment");
    const plan        = params.get("plan");
    const propertyId  = params.get("property_id");
    if (payment === "success") {
      setPaymentResult({ status: "success", plan, propertyId });
      setScreen("paymentResult");
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (payment === "cancel") {
      setPaymentResult({ status: "cancel" });
      setScreen("paymentResult");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const EMPTY_STATE = {
    currentUser: { id: "admin-1", role: "admin" },
    customers: [], providers: [], properties: [],
    jobs: [], weeklyAssignments: {}, activePropertyId: null,
    notifications: [], providerNotifs: [], notifPrefs: null,
  };

  const [appState,  setAppState]  = useState(EMPTY_STATE);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError,   setDbError]   = useState(null);

  // ── Load all data from Supabase on mount ──────────────────────────────────
  useEffect(() => {
    async function loadAll() {
      try {
        const [
          { data: properties, error: pErr },
          { data: jobs,       error: jErr },
          { data: providers,  error: prErr },
          { data: activeProp, error: apErr },
          { data: notifPrefs, error: npErr },
        ] = await Promise.all([
          fetchProperties(),
          fetchJobs(),
          fetchProviders(),
          fetchSetting("activePropertyId"),
          fetchSetting("notifPrefs"),
        ]);

        if (pErr || jErr || prErr) {
          console.error("DB load error", pErr || jErr || prErr);
          setDbError("Failed to load data. Check your connection.");
          setDbLoading(false);
          return;
        }

        // Fetch notifications for all properties
        const propIds = (properties || []).map(p => p.id);
        const { data: notifications } = propIds.length
          ? await fetchNotifications(propIds)
          : { data: [] };

        const activePropertyId = activeProp || properties?.[0]?.id || null;

        // Seed default providers if none exist
        let finalProviders = providers || [];
        if (finalProviders.length === 0) {
          const seeds = [
            { id: "prov-1", name: "Alex",   username: "alex",   password: "password", active: true, pending: false },
            { id: "prov-2", name: "Jamie",  username: "jamie",  password: "password", active: true, pending: false },
            { id: "prov-3", name: "Taylor", username: "taylor", password: "password", active: true, pending: false },
          ];
          await Promise.all(seeds.map(p => upsertProvider(p)));
          finalProviders = seeds;
        }

        setAppState(s => ({
          ...s,
          properties:        properties    || [],
          jobs:              jobs          || [],
          providers:         finalProviders,
          notifications:     notifications || [],
          providerNotifs:    [],
          notifPrefs:        notifPrefs    || null,
          activePropertyId,
        }));
      } catch (err) {
        console.error("Unexpected load error", err);
        setDbError("Unexpected error loading data.");
      }
      setDbLoading(false);
    }
    loadAll();
  }, []);

  // ── Sync setAppState changes to Supabase ──────────────────────────────────
  // We wrap setAppState to detect what changed and sync only that entity
  const prevStateRef = useRef(appState);

  useEffect(() => {
    if (dbLoading) return;
    const prev = prevStateRef.current;
    const curr = appState;
    prevStateRef.current = curr;

    // Properties — upsert changed/added, delete removed
    if (prev.properties !== curr.properties) {
      const prevIds = new Set((prev.properties || []).map(p => p.id));
      const currIds = new Set((curr.properties || []).map(p => p.id));
      // Upsert changed or new
      for (const p of curr.properties || []) {
        const prevP = (prev.properties || []).find(x => x.id === p.id);
        if (!prevP || JSON.stringify(prevP) !== JSON.stringify(p)) {
          upsertProperty(p).catch(console.error);
        }
      }
      // Delete removed
      for (const id of prevIds) {
        if (!currIds.has(id)) dbDeleteProperty(id).catch(console.error);
      }
    }

    // Jobs — upsert changed/added
    if (prev.jobs !== curr.jobs) {
      const prevMap = new Map((prev.jobs || []).map(j => [j.id, j]));
      for (const j of curr.jobs || []) {
        const prevJ = prevMap.get(j.id);
        if (!prevJ || JSON.stringify(prevJ) !== JSON.stringify(j)) {
          upsertJob(j).catch(console.error);
        }
      }
    }

    // Providers — upsert changed/added, delete removed
    if (prev.providers !== curr.providers) {
      const prevIds = new Set((prev.providers || []).map(p => p.id));
      const currIds = new Set((curr.providers || []).map(p => p.id));
      for (const p of curr.providers || []) {
        const prevP = (prev.providers || []).find(x => x.id === p.id);
        if (!prevP || JSON.stringify(prevP) !== JSON.stringify(p)) {
          upsertProvider(p).catch(console.error);
        }
      }
      for (const id of prevIds) {
        if (!currIds.has(id)) dbDeleteProvider(id).catch(console.error);
      }
    }

    // Active property ID setting
    if (prev.activePropertyId !== curr.activePropertyId && curr.activePropertyId) {
      saveSetting("activePropertyId", curr.activePropertyId).catch(console.error);
    }

    // Notif prefs setting
    if (prev.notifPrefs !== curr.notifPrefs && curr.notifPrefs) {
      saveSetting("notifPrefs", curr.notifPrefs).catch(console.error);
    }

    // New notifications — insert to DB
    if (prev.notifications !== curr.notifications) {
      const prevIds = new Set((prev.notifications || []).map(n => n.id));
      const newNotifs = (curr.notifications || []).filter(n => !prevIds.has(n.id));
      for (const n of newNotifs) {
        const propId = (curr.properties || []).find(p => addrWithUnit(p) === n.propertyLabel)?.id || null;
        insertNotification(n, propId).catch(console.error);
      }
    }

    // New provider notifications — insert to DB
    if (prev.providerNotifs !== curr.providerNotifs) {
      const prevIds = new Set((prev.providerNotifs || []).map(n => n.id));
      const newNotifs = (curr.providerNotifs || []).filter(n => !prevIds.has(n.id));
      for (const n of newNotifs) {
        insertProviderNotification(n).catch(console.error);
      }
    }
  }, [appState, dbLoading]);

  const allProperties   = appState.properties || [];
  const activeProperty  = allProperties.find(p => p.id === appState.activePropertyId) || allProperties[0] || null;
  const editingProperty = allProperties.find(p => p.id === editingPropertyId) || null;
  const activeProviders = (appState.providers || []).filter(p => p.active);

  const profile = activeProperty ? {
    ...activeProperty,
    day: activeProperty.pickupWeekday,
    startDates: activeProperty.startDates || { recycling: "", fogo: "", glass: "" },
    schedule: activeProperty.schedule || {
      weekday: activeProperty.pickupWeekday,
      startDates: activeProperty.startDates || { recycling: "", fogo: "", glass: "" },
    },
  } : {};

  function signOut() { setLoggedInProviderId(null); setScreen("rolePicker"); }

  function addProperty(draft, plan = "monthly") {
    const id = makeId();
    const newProp = {
      id, type: draft.type || "Holiday Home", customerId: null,
      address: draft.address, unit: draft.unit || "",
      lat: draft.address?.lat ?? null, lng: draft.address?.lng ?? null,
      notes: draft.notes || "", gate: draft.gate || "",
      driveLong: Boolean(draft.driveLong), bins: draft.bins || [],
      pickupWeekday: draft.pickupWeekday || "",
      startDates: draft.startDates || { recycling: "", fogo: "", glass: "" },
      schedule: { weekday: draft.pickupWeekday, startDates: draft.startDates },
      plan, packCredits: plan === "pack" ? 10 : 0,
      active: true,
    };
    setAppState(s => ({
      ...s,
      properties: [...(s.properties || []), newProp],
      activePropertyId: s.activePropertyId || id,
    }));
    return id;
  }

  function saveProperty(updated) {
    setAppState(s => ({ ...s, properties: (s.properties || []).map(p => p.id === updated.id ? { ...p, ...updated } : p) }));
  }

  function deleteProperty(id) {
    setAppState(s => {
      const remaining = (s.properties || []).filter(p => p.id !== id);
      return {
        ...s,
        properties: remaining,
        jobs: (s.jobs || []).filter(j => j.propertyId !== id),
        activePropertyId: remaining.length > 0 ? (s.activePropertyId === id ? remaining[0].id : s.activePropertyId) : null,
      };
    });
  }

  // Loading screen while Supabase data loads
  if (dbLoading) {
    return (
      <div className="min-h-screen bg-brand-muted flex flex-col items-center justify-center gap-4">
        <div className="text-4xl animate-pulse">🗑️</div>
        <div className="font-heading font-semibold text-brand-fg text-xl">FmyBins</div>
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  if (dbError) {
    return (
      <div className="min-h-screen bg-brand-muted flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="text-4xl">⚠️</div>
        <div className="font-heading font-semibold text-brand-fg text-xl">Connection Error</div>
        <div className="text-sm text-gray-500">{dbError}</div>
        <button onClick={() => window.location.reload()}
          className="mt-2 h-11 px-6 rounded-xl bg-brand-dark text-white font-semibold text-sm hover:opacity-90 transition">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="min-h-screen font-body">

      {screen === "paymentResult" && paymentResult?.status === "success" && (
        <PaymentSuccess
          plan={paymentResult.plan}
          onContinue={() => { setPaymentResult(null); setScreen("dashboard"); }}
        />
      )}

      {screen === "paymentResult" && paymentResult?.status === "cancel" && (
        <PaymentCancelled
          onBack={() => { setPaymentResult(null); setScreen("plan"); }}
        />
      )}

      {screen === "rolePicker" && (
        <RolePicker
          onCustomer={() => setScreen("customerLogin")}
          onProvider={() => setScreen("providerLogin")}
          onOps={()      => setScreen("opsLogin")}
        />
      )}

      {screen === "customerLogin" && (
        <CustomerLogin
          onBack={() => setScreen("rolePicker")}
          onSignIn={() => setScreen("customerWelcome")}
          onCreateAccount={() => setScreen("addProperty")}
        />
      )}

      {screen === "customerWelcome" && (
        <CustomerWelcome
          properties={allProperties}
          onViewProperties={() => setScreen(allProperties.length > 0 ? "properties" : "addProperty")}
          onAddProperty={() => setScreen("addProperty")}
          onSignOut={signOut}
        />
      )}

      {screen === "providerLogin" && (
        <ProviderLogin
          onBack={() => setScreen("rolePicker")}
          providers={activeProviders}
          onSuccess={async pid => {
            setLoggedInProviderId(pid);
            setScreen("providerPortal");
            // Load this provider's notifications from DB
            const { data: pNotifs } = await fetchProviderNotifications(pid);
            setAppState(s => ({ ...s, providerNotifs: pNotifs || [] }));
          }}
          onSignUp={() => setScreen("providerSignup")}
        />
      )}

      {screen === "providerSignup" && (
        <ProviderSignup
          onBack={() => setScreen("providerLogin")}
          onDone={newProvider => {
            setAppState(s => ({ ...s, providers: [...(s.providers || []), newProvider] }));
          }}
        />
      )}

      {screen === "opsLogin" && (
        <OpsLogin onBack={() => setScreen("rolePicker")} onSuccess={() => setScreen("ops")} />
      )}

      {screen === "addProperty" && (
        <AddPropertyFlow
          existingCount={allProperties.length}
          onBack={() => setScreen(allProperties.length === 0 ? "customerLogin" : "properties")}
          appState={appState} setAppState={setAppState}
          onDone={(draft, plan) => {
            const id = makeId();
            const newProp = {
              id, type: draft.type || "Holiday Home", customerId: null,
              address: draft.address, unit: draft.unit || "",
              lat: draft.address?.lat ?? null, lng: draft.address?.lng ?? null,
              notes: draft.notes || "", gate: draft.gate || "",
              driveLong: Boolean(draft.driveLong), bins: draft.bins || [],
              pickupWeekday: draft.pickupWeekday || "",
              startDates: draft.startDates || { recycling: "", fogo: "", glass: "" },
              schedule: { weekday: draft.pickupWeekday, startDates: draft.startDates },
              plan, packCredits: plan === "pack" ? 10 : 0,
              active: true,
            };
            setAppState(s => ({
              ...s,
              properties: [...(s.properties || []), newProp],
              activePropertyId: id,
            }));
            setPendingPlan(plan);
            setScreen("plan");
          }}
        />
      )}

      {screen === "plan" && (
        <PlanPayment onBack={() => setScreen("addProperty")} onStart={plan => {
          if (activeProperty) {
            saveProperty({ ...activeProperty, plan, packCredits: plan === "pack" ? 10 : 0 });
          }
          setScreen("dashboard");
        }}
          property={activeProperty} allProperties={allProperties}
          initialPlan={pendingPlan} appState={appState} setAppState={setAppState} />
      )}

      {screen === "editProperty" && editingProperty && (
        <EditPropertyFlow
          property={editingProperty}
          onBack={() => { setEditingPropertyId(null); setScreen("properties"); }}
          onSave={updated => { saveProperty(updated); setEditingPropertyId(null); setScreen("properties"); }}
          onDelete={() => { deleteProperty(editingProperty.id); setEditingPropertyId(null); setScreen("properties"); }}
          onChangePlan={() => setScreen("changePlan")}
          appState={appState} setAppState={setAppState}
        />
      )}

      {screen === "changePlan" && editingProperty && (
        <PlanPayment
          onBack={() => setScreen("editProperty")}
          onStart={plan => {
            saveProperty({ ...editingProperty, plan, packCredits: plan === "pack" ? (editingProperty.packCredits ?? 10) : 0 });
            setScreen("editProperty");
          }}
          property={editingProperty} allProperties={allProperties}
          initialPlan={editingProperty.plan || "monthly"}
          appState={appState} setAppState={setAppState}
        />
      )}

      {screen === "properties" && (
        <MyProperties
          properties={allProperties}
          activePropertyId={appState.activePropertyId}
          onSelect={id => { setAppState(s => ({ ...s, activePropertyId: id })); setScreen("dashboard"); }}
          onAdd={() => setScreen("addProperty")}
          onEdit={id => { setEditingPropertyId(id); setScreen("editProperty"); }}
          onBack={() => setScreen("customerWelcome")}
          appState={appState} setAppState={setAppState}
        />
      )}

      {screen === "dashboard" && (
        <Dashboard
          data={profile} allProperties={allProperties}
          onOpenSettings={()   => setScreen("settings")}
          onOpenAdHoc={()      => setScreen("adhoc")}
          onOpenProperties={() => setScreen("properties")}
          onSignOut={signOut}
          appState={appState}
          setAppState={setAppState}
        />
      )}

      {screen === "settings" && (
        <Settings onBack={() => setScreen("dashboard")} onSignOut={signOut}
          appState={appState} setAppState={setAppState} />
      )}

      {screen === "adhoc" && (
        <ServiceRequest
          onBack={() => setScreen("dashboard")}
          allProperties={allProperties}
          activePropertyId={appState.activePropertyId}
          appState={appState}
          setAppState={setAppState}
        />
      )}

      {screen === "providerPortal" && (
        <ProviderPortal
          appState={appState}
          setAppState={setAppState}
          providerId={loggedInProviderId}
          onSignOut={signOut}
        />
      )}

      {screen === "ops" && (
        <OpsDashboard
          appState={appState}
          setAppState={setAppState}
          onSignOut={signOut}
        />
      )}

    </div>
    </ErrorBoundary>
  );
}
