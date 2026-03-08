import React, { useEffect, useState } from "react";
import MapPreview from "./components/MapPreview.jsx";
import AddressSearch from "./components/AddressSearch.jsx";
import { nextWeekly, nextFortnightly, isFortnightlyThisWeek } from "./utils/schedule.js";

// ─── Utilities ────────────────────────────────────────────────────────────────

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

function autoOffer(jobs, providers, jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return jobs;
  const history  = job.offerHistory || [];
  const eligible = providers
    .filter(p => p.active && !history.includes(p.id))
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

// ─── Multi-property discount ──────────────────────────────────────────────────

function sameAddressGroup(properties) {
  const groups = {};
  properties.forEach(p => {
    const label = typeof p.address === "object" ? p.address?.label : p.address || "";
    const key   = label.split(",").map(s => s.trim()).slice(-2).join(",").toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(p.id);
  });
  const grouped = new Set();
  Object.values(groups).forEach(ids => { if (ids.length > 1) ids.forEach(id => grouped.add(id)); });
  return grouped;
}

function monthlyRate(property, groupedIds) {
  return 59.90 + (property.driveLong ? 15.00 : 0) + (groupedIds.has(property.id) ? -10.00 : 0);
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

function ProviderLogin({ onBack, onSuccess, providers }) {
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
          <p className="text-xs text-white/25 text-center mt-5">Can't log in? Contact your ops manager.</p>
        </div>
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

const STEP_LABELS = ["Address & Type", "Bins & Schedule", "Access"];

function emptyDraft() {
  return { type: "Holiday Home", address: null, notes: "", bins: [], pickupWeekday: "",
           startDates: { recycling: "", fogo: "", glass: "" }, gate: "", driveLong: false, active: true };
}

function stepCanProceed(step, draft, plan) {
  if (step === 0) return !!draft.address && !!draft.type;
  if (step === 1) {
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
  if (step === 0) {
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
          <TextArea label="Access notes (optional)" placeholder="Parking, pets, entry instructions, bin location…" value={draft.notes} onChange={v => setDraft(d => ({ ...d, notes: v }))} />
        </div>
      </div>
    );
  }
  if (step === 1) {
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
  if (step === 2) {
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

function AddPropertyFlow({ onBack, onDone, existingCount, allProperties }) {
  const [step, setStep]   = useState(0);
  const [plan, setPlan]   = useState("monthly");
  const [draft, setDraft] = useState(emptyDraft());

  // Steps: 0=address, 1=bins(+schedule if monthly), 2=access
  function next() {
    if (step < 2) { setStep(s => s + 1); return; }
    onDone(draft, plan);
  }

  return (
    <div className="min-h-screen bg-white">
      <Header onBack={step === 0 ? onBack : () => setStep(s => s - 1)} />
      <div className="max-w-md mx-auto px-5 pb-8">
        <StepDots current={step} total={3} />
        <h2 className="font-heading font-semibold text-xl text-brand-fg mb-0.5">{existingCount === 0 ? "Add your first property" : "Add another property"}</h2>
        <p className="text-sm text-gray-400 mb-5">Step {step + 1} of 3 — {STEP_LABELS[step]}</p>

        {/* Plan picker shown inline on step 0 (address step), below address */}
        <PropertyFormStep step={step} draft={draft} setDraft={setDraft} plan={plan} />

        {step === 0 && (
          <div className="mt-5">
            <div className="text-sm font-medium text-gray-700 mb-2">Service plan</div>
            <div className="grid grid-cols-2 gap-2">
              {PLANS.filter(p => p.key === "monthly" || p.key === "pack").map(p => (
                <button key={p.key} onClick={() => setPlan(p.key)}
                  className={`rounded-2xl border-2 p-3 text-left transition ${plan === p.key ? "border-brand-dark bg-brand-muted" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="text-lg mb-0.5">{p.emoji}</div>
                  <div className="font-semibold text-xs text-brand-fg">{p.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{p.price}</div>
                </button>
              ))}
            </div>
            {plan === "pack" && (
              <div className="mt-2 text-xs text-gray-500 rounded-xl bg-brand-muted px-3 py-2">
                🎟️ You'll choose a date each time you book — no fixed weekly schedule.
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
          <PrimaryButton onClick={next} disabled={!stepCanProceed(step, draft, plan)}>
            {step < 2 ? `Next: ${STEP_LABELS[step + 1]} →` : "Next: Payment →"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function EditPropertyFlow({ property, onBack, onSave, onDelete, onChangePlan }) {
  const [step, setStep]         = useState(0);
  const [draft, setDraft]       = useState({
    type: property.type || "Holiday Home", address: property.address || null,
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
      <Header onBack={step === 0 ? onBack : () => setStep(s => s - 1)} />
      <div className="max-w-md mx-auto px-5 pb-8">
        <StepDots current={step} total={3} />
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="font-heading font-semibold text-xl text-brand-fg">Edit Property</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{draft.active ? "Active" : "Paused"}</span>
            <Toggle label="" checked={draft.active} onChange={v => setDraft(d => ({ ...d, active: v }))} />
          </div>
        </div>
        <p className="text-sm text-gray-400 mb-5">Step {step + 1} of 3 — {STEP_LABELS[step]}</p>

        <PropertyFormStep step={step} draft={draft} setDraft={setDraft} plan={currentPlan} />

        {/* Plan + danger zone — shown on step 1 (address) for easy access */}
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
          <PrimaryButton onClick={next} disabled={!stepCanProceed(step, draft, currentPlan)}>
            {step < 2 ? `Next: ${STEP_LABELS[step + 1]} →` : "Save Changes"}
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

function PlanPayment({ onBack, onStart, property, allProperties, initialPlan }) {
  const [selected, setSelected] = useState(initialPlan || "monthly");
  const [agree,    setAgree]    = useState(false);
  const groupedIds  = sameAddressGroup([...allProperties, property].filter(Boolean));
  const rate        = property ? monthlyRate(property, groupedIds) : 59.90;
  const hasDiscount = property ? groupedIds.has(property.id) : false;
  const isChanging  = !!initialPlan;

  return (
    <div className="min-h-screen bg-white">
      <Header onBack={onBack} />
      <div className="max-w-md mx-auto p-5">
        <h2 className="font-heading font-semibold text-xl text-brand-fg mb-1">{isChanging ? "Change Plan" : "Choose Your Plan"}</h2>
        <p className="text-sm text-gray-400 mb-5">{isChanging ? "Switch your plan at any time. Changes take effect immediately." : "You can change this anytime from your dashboard."}</p>

        <div className="space-y-3 mb-6">
          {PLANS.map(plan => {
            const isSelected = selected === plan.key;
            const displayPrice = plan.key === "monthly"
              ? `$${rate.toFixed(2)}/mo`
              : plan.price;
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
                    {plan.key === "monthly" && hasDiscount && (
                      <div className="text-xs text-purple-600 font-medium mt-1">Multi-property discount applied ✓</div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-brand-fg text-sm">{displayPrice}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="w-full h-36 rounded-2xl bg-gray-50 border border-dashed border-gray-300 text-gray-400 flex flex-col items-center justify-center mb-4 text-sm gap-2">
          <span className="text-2xl">💳</span>Stripe Checkout
        </div>
        <div className="flex items-center gap-2 mb-4">
          <input id="agree" type="checkbox" className="h-5 w-5 accent-brand-dark" checked={agree} onChange={e => setAgree(e.target.checked)} />
          <label htmlFor="agree" className="text-sm text-gray-700">I understand this is an early access build.</label>
        </div>
        <PrimaryButton onClick={() => onStart(selected)} disabled={!agree}>
          {isChanging ? `Switch to ${PLANS.find(p => p.key === selected)?.name} →` : `Start with ${PLANS.find(p => p.key === selected)?.name} →`}
        </PrimaryButton>
      </div>
    </div>
  );
}

function MyProperties({ properties, activePropertyId, groupedIds, onSelect, onAdd, onEdit, onBack }) {
  const total = properties.reduce((sum, p) => sum + monthlyRate(p, groupedIds), 0);
  return (
    <div className="min-h-screen bg-brand-muted">
      <Header onBack={onBack} />
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
          const label    = typeof p.address === "object" ? p.address?.label : p.address || "—";
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
                    {p.driveLong          && <Badge color="yellow">Steep driveway</Badge>}
                    {groupedIds.has(p.id) && <Badge color="purple">Multi-property −$10</Badge>}
                  </div>
                  {p.pickupWeekday && <div className="text-xs text-gray-400">📅 {p.pickupWeekday}s</div>}
                  {isPack && <div className="text-xs text-gray-500 mt-0.5">🎟️ {credits} credit{credits !== 1 ? "s" : ""} remaining</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  {plan === "monthly" && <><div className="font-bold text-brand-fg">${monthlyRate(p, groupedIds).toFixed(2)}</div><div className="text-xs text-gray-400">/month</div></>}
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

function Dashboard({ data, allProperties, groupedIds, onOpenSettings, onOpenAdHoc, onOpenProperties, onSignOut }) {
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
  const addrLabel   = typeof data?.address === "object" ? data?.address?.label : data?.address;
  const rate        = data?.id ? monthlyRate(data, groupedIds) : null;
  const hasDiscount = data?.id ? groupedIds.has(data.id) : false;
  const plan        = data?.plan || "monthly";
  const packCredits = data?.packCredits ?? 0;
  const isMonthly   = plan === "monthly";
  const isPack      = plan === "pack";

  return (
    <div className="min-h-screen bg-brand-muted">
      <div className="w-full flex items-center justify-between py-4 px-5 sticky top-0 bg-white/90 backdrop-blur z-10 border-b">
        <h1 className="text-lg font-semibold text-brand-fg font-heading">FmyBins</h1>
        <div className="flex gap-1.5">
          <button onClick={onOpenAdHoc}      className="text-sm px-3 py-1 rounded-full border border-brand-dark text-brand-dark font-medium">⚡ Request</button>
          <button onClick={onOpenProperties} className="text-sm px-3 py-1 rounded-full border">🏠{allProperties.length > 1 ? ` ${allProperties.length}` : ""}</button>
          <button onClick={onOpenSettings}   className="text-sm px-3 py-1 rounded-full border">⚙️</button>
          <button onClick={onSignOut}        className="text-sm px-3 py-1 rounded-full border border-gray-300 text-gray-400">Sign out</button>
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
                {hasDiscount && <div className="text-xs text-purple-600 font-medium">Multi-property discount ✓</div>}
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

        <Card>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Recent Photos</div>
          <div className="grid grid-cols-3 gap-2">
            {[1,2,3].map(n => <div key={n} className="aspect-square rounded-xl bg-gray-100 border flex items-center justify-center text-gray-300 text-xl">📷</div>)}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Settings({ onBack, onSignOut }) {
  const [emailN, setEmailN] = useState(true);
  const [smsN,   setSmsN]   = useState(false);
  const [pushN,  setPushN]  = useState(true);
  return (
    <div className="min-h-screen bg-white">
      <Header onBack={onBack} />
      <div className="max-w-md mx-auto p-5 space-y-4">
        <h2 className="font-heading font-semibold text-xl text-brand-fg">Settings</h2>
        <Card>
          <h3 className="font-semibold mb-2">Notifications</h3>
          <Toggle label="Email" checked={emailN} onChange={setEmailN} />
          <Toggle label="SMS"   checked={smsN}   onChange={setSmsN} />
          <Toggle label="Push"  checked={pushN}  onChange={setPushN} />
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
  const [serviceType,  setServiceType]  = useState("once_off"); // once_off | urgent | pack
  const [selectedBins, setSelectedBins] = useState([]);
  const [date,         setDate]         = useState("");
  const [note,         setNote]         = useState("");
  const [submitted,    setSubmitted]    = useState(false);

  const selectedProp = allProperties.find(p => p.id === propId);
  const addrLabel    = selectedProp ? (typeof selectedProp.address === "object" ? selectedProp.address?.label : selectedProp.address) : "";
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
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-white">
        <Header onBack={onBack} />
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
      <Header onBack={onBack} />
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
                const label = typeof p.address === "object" ? p.address?.label : p.address || "—";
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

  const providers    = (appState.providers  || []).filter(p => p.active);
  const provider     = providers.find(p => p.id === providerId);
  const allJobs      = appState.jobs        || [];
  const allProps     = appState.properties  || [];

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
    setAppState(s => {
      const job  = (s.jobs || []).find(j => j.id === jobId);
      const prop = job ? (s.properties || []).find(p => p.id === job.propertyId) : null;
      return {
        ...s,
        jobs: (s.jobs || []).map(j => j.id === jobId
          ? { ...j, status: "accepted", providerId, offeredTo: null }
          : j),
        properties: (s.properties || []).map(p =>
          p.id === prop?.id && !p.permanentProviderId && job?.permanent
            ? { ...p, permanentProviderId: providerId }
            : p),
      };
    });
  }

  // Decline a targeted offer — auto-offer to next provider
  function declineOffer(jobId) {
    setAppState(s => {
      const updatedJobs = (s.jobs || []).map(j => j.id === jobId
        ? { ...j, offerHistory: [...(j.offerHistory || []), providerId], offeredTo: null }
        : j);
      return { ...s, jobs: autoOffer(updatedJobs, providers, jobId) };
    });
  }

  // Claim from open pool — sets permanent provider on the property
  function claimPoolJob(jobId) {
    setAppState(s => {
      const job  = (s.jobs || []).find(j => j.id === jobId);
      const prop = job ? (s.properties || []).find(p => p.id === job.propertyId) : null;
      return {
        ...s,
        jobs: (s.jobs || []).map(j => j.id === jobId
          ? { ...j, status: "accepted", providerId, offeredTo: null }
          : j),
        properties: (s.properties || []).map(p =>
          p.id === prop?.id && !p.permanentProviderId
            ? { ...p, permanentProviderId: providerId }
            : p),
      };
    });
  }

  // Decline this week only — permanent relationship untouched, auto-offer fires
  function declineThisWeek(jobId) {
    setAppState(s => {
      const updatedJobs = (s.jobs || []).map(j => j.id === jobId
        ? { ...j, providerId: null, status: "unassigned",
            offerHistory: [...(j.offerHistory || []), providerId],
            declinedByPermanent: true }
        : j);
      return { ...s, jobs: autoOffer(updatedJobs, providers, jobId) };
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

  function markDone(jobId) {
    setAppState(s => ({
      ...s,
      jobs: (s.jobs || []).map(j => j.id === jobId
        ? { ...j, status: "done", completedAt: new Date().toISOString() }
        : j),
    }));
  }

  // ── Inner job card component ──
  function JobCard({ j }) {
    const prop   = propsById[j.propertyId];
    const addr   = prop?.address?.label || "—";
    const isDone = j.status === "done";
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold text-sm">
            {j.type === "bins_out" ? "🚮 Bins Out" : j.type === "bins_in" ? "↩️ Bins In" : "⚡ Ad Hoc"}
            {j.permanent && <span className="ml-1 text-[10px] text-white/30 font-normal">recurring</span>}
          </div>
          <Badge color={isDone ? "green" : "blue"}>{isDone ? "done" : "accepted"}</Badge>
        </div>
        <div className="text-sm text-white/60">{fmtDate(j.scheduledFor)}</div>
        <div className="text-sm text-white/80 mt-0.5 truncate">{addr}</div>
        {j.binTypes?.length > 0 && <div className="text-xs text-white/40 mt-0.5">Bins: {j.binTypes.map(binLabel).join(", ")}</div>}
        {prop?.gate  && <div className="text-xs text-white/40 mt-0.5">🔑 Gate: {prop.gate}</div>}
        {prop?.notes && <div className="text-xs text-white/40 mt-0.5">📋 {prop.notes}</div>}
        {j.note      && <div className="text-xs text-white/40 mt-0.5">ℹ️ {j.note}</div>}
        <div className="flex gap-2 mt-3">
          <button onClick={() => markDone(j.id)} disabled={isDone}
            className={`flex-1 h-11 rounded-xl font-semibold transition active:scale-[0.98] text-sm ${
              isDone ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-brand-dark text-white hover:opacity-90"}`}>
            {isDone ? "✓ Done" : "Mark as Done"}
          </button>
          {!isDone && j.permanent && (
            <button onClick={() => declineThisWeek(j.id)}
              className="h-11 px-3 rounded-xl border border-white/20 text-white/50 text-xs hover:bg-white/10 hover:text-white/80 transition">
              Can't make it
            </button>
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
        <button onClick={onSignOut} className="text-xs text-white/40 hover:text-white/70 transition border border-white/20 px-3 py-1 rounded-full">
          Sign out
        </button>
      </div>

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
          {[["jobs","📋 Jobs"],["properties","🏠 Mine"],["pool","🔔 Pool"],["earnings","💰 Pay"]].map(([id, label]) => (
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
                  const addr = prop?.address?.label || "—";
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
              const label       = typeof p.address === "object" ? p.address?.label : p.address || "—";
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
                const addr = prop?.address?.label || "—";
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
                      const label = typeof p.address === "object" ? p.address?.label : p.address || "—";
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
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── OPS DASHBOARD ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function OpsDashboard({ appState, setAppState, onSignOut }) {
  const [tab, setTab] = useState("overview");

  const allProperties    = appState.properties || [];
  const allJobs          = appState.jobs        || [];
  const providers        = (appState.providers  || []).filter(p => p.active);
  const groupedIds       = sameAddressGroup(allProperties);
  const nextWeekStart    = startOfNextWeekMonday();
  const nextWeekStartISO = toISODate(nextWeekStart);

  const mrr                  = allProperties.reduce((sum, p) => sum + (p.plan === "monthly" ? monthlyRate(p, groupedIds) : 0), 0);
  const providerCost         = allProperties.reduce((sum, p) => sum + 45 + (p.driveLong ? 15 : 0), 0);
  const margin               = mrr - providerCost;
  const unassigned           = allJobs.filter(j => !j.providerId && j.status === "unassigned" && !j.urgent);
  const urgentJobs           = allJobs.filter(j => j.urgent && j.status === "unassigned");
  const offered              = allJobs.filter(j => j.status === "offered");
  const allDeclined          = allJobs.filter(j => j.allDeclined);
  const adHocJobs            = allJobs.filter(j => j.adHoc);
  const propsWithoutProvider = allProperties.filter(p => p.active !== false && !p.permanentProviderId && p.plan === "monthly");

  function offerJob(jobId, pid) {
    setAppState(s => ({
      ...s,
      jobs: (s.jobs || []).map(j => j.id === jobId
        ? { ...j, status: "offered", offeredTo: pid, providerId: null,
            offerHistory: [...(j.offerHistory || []), pid], allDeclined: false }
        : j),
    }));
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
        <button onClick={onSignOut} className="text-xs border border-gray-300 text-gray-400 px-3 py-1 rounded-full hover:text-gray-600 transition">Sign out</button>
      </div>

      <div className="sticky top-[65px] z-10 bg-white/90 backdrop-blur border-b px-4 py-2">
        <div className="max-w-2xl mx-auto flex gap-1 overflow-x-auto">
          {[["overview","Overview"],["jobs","Jobs"],["properties","Properties"],["providers","Providers"],["finance","Finance"]].map(([id, label]) => (
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
                  const label = typeof p.address === "object" ? p.address?.label : p.address || "—";
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
                      <span className="truncate mr-2">🚨 {(prop?.address?.label || "—").split(",")[0]}</span>
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
                      <span className="truncate mr-2">{j.type === "bins_out" ? "Bins Out" : "Bins In"} — {(prop?.address?.label || "—").split(",")[0]}</span>
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
                      <span className="truncate mr-2">{j.type === "bins_out" ? "Bins Out" : j.type === "bins_in" ? "Bins In" : "Ad Hoc"} — {(prop?.address?.label || "—").split(",")[0]}</span>
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
                const addr      = prop?.address?.label || "—";
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
                          {j.urgent  && <span className="ml-1"><Badge color="red">🚨 Urgent</Badge></span>}
                          {j.adHoc   && !j.urgent && <span className="ml-1"><Badge color="blue">Ad Hoc</Badge></span>}
                          {j.permanent && <span className="ml-1"><Badge color="purple">Recurring</Badge></span>}
                        </div>
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
                            {providers.filter(p => p.id !== j.offeredTo).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
                const label    = typeof p.address === "object" ? p.address?.label : p.address || "—";
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
                          {groupedIds.has(p.id) && <Badge color="purple">Multi-prop −$10</Badge>}
                          {p.active === false    && <Badge color="yellow">Paused</Badge>}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">📅 {p.pickupWeekday || "—"} · {(p.bins || []).map(binLabel).join(", ") || "No bins set"}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-bold">${monthlyRate(p, groupedIds).toFixed(2)}</div>
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
                    const label = typeof p.address === "object" ? p.address?.label : p.address || "—";
                    const rev   = monthlyRate(p, groupedIds);
                    const cost  = 45 + (p.driveLong ? 15 : 0);
                    const perm  = providers.find(pr => pr.id === p.permanentProviderId);
                    return (
                      <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{label.split(",")[0]}</div>
                          <div className="text-xs text-gray-400">{p.type}{p.driveLong ? " · steep" : ""}{groupedIds.has(p.id) ? " · multi-prop" : ""}{perm ? ` · ${perm.name}` : " · unassigned"}</div>
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

  const EMPTY_STATE = {
    currentUser: { id: "admin-1", role: "admin" },
    customers: [], providers: [], properties: [],
    jobs: [], weeklyAssignments: {}, activePropertyId: null,
  };

  const [appState, setAppState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("FmyBins_state") || "null");
      let state = saved && typeof saved === "object" ? saved : EMPTY_STATE;
      // Migration: old "profile" blob → first property
      if (state.profile && (!state.properties || state.properties.length === 0)) {
        const p = state.profile;
        const addrObj = typeof p.address === "object" ? p.address : (p.address ? { label: p.address } : null);
        state = {
          ...state,
          properties: [{
            id: "prop-1", type: "Holiday Home", customerId: null, address: addrObj,
            lat: addrObj?.lat ?? null, lng: addrObj?.lng ?? null,
            notes: p.notes || "", gate: p.gate || "", driveLong: Boolean(p.driveLong),
            bins: p.bins || [], pickupWeekday: p.schedule?.weekday || p.day || "",
            startDates: p.schedule?.startDates || p.startDates || { recycling: "", fogo: "", glass: "" },
            schedule: p.schedule || null, active: true,
          }],
          activePropertyId: "prop-1",
        };
        delete state.profile;
      }
      return {
        ...EMPTY_STATE, ...state,
        properties: state.properties || [], jobs: state.jobs || [],
        customers: state.customers || [], providers: state.providers || [],
        activePropertyId: state.activePropertyId || (state.properties?.[0]?.id ?? null),
      };
    } catch { return EMPTY_STATE; }
  });

  useEffect(() => {
    try { localStorage.setItem("FmyBins_state", JSON.stringify(appState)); } catch {}
  }, [appState]);

  // Seed default providers
  useEffect(() => {
    if ((appState.providers || []).length === 0) {
      setAppState(s => ({
        ...s,
        providers: [
          { id: "prov-1", name: "Alex",   active: true, username: "alex",   password: "password" },
          { id: "prov-2", name: "Jamie",  active: true, username: "jamie",  password: "password" },
          { id: "prov-3", name: "Taylor", active: true, username: "taylor", password: "password" },
        ],
      }));
    }
  }, []);

  const allProperties   = appState.properties || [];
  const groupedIds      = sameAddressGroup(allProperties);
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
      address: draft.address, lat: draft.address?.lat ?? null, lng: draft.address?.lng ?? null,
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

  return (
    <div className="min-h-screen font-body">

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
          onSuccess={pid => { setLoggedInProviderId(pid); setScreen("providerPortal"); }}
        />
      )}

      {screen === "opsLogin" && (
        <OpsLogin onBack={() => setScreen("rolePicker")} onSuccess={() => setScreen("ops")} />
      )}

      {screen === "addProperty" && (
        <AddPropertyFlow
          existingCount={allProperties.length}
          onBack={() => setScreen(allProperties.length === 0 ? "customerLogin" : "properties")}
          onDone={(draft, plan) => {
            const id = addProperty(draft, plan);
            setAppState(s => ({ ...s, activePropertyId: s.activePropertyId || id }));
            setScreen("plan"); // show payment screen, plan already chosen
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
          property={activeProperty} allProperties={allProperties} />
      )}

      {screen === "editProperty" && editingProperty && (
        <EditPropertyFlow
          property={editingProperty}
          onBack={() => { setEditingPropertyId(null); setScreen("properties"); }}
          onSave={updated => { saveProperty(updated); setEditingPropertyId(null); setScreen("properties"); }}
          onDelete={() => { deleteProperty(editingProperty.id); setEditingPropertyId(null); setScreen("properties"); }}
          onChangePlan={() => setScreen("changePlan")}
        />
      )}

      {screen === "changePlan" && editingProperty && (
        <PlanPayment
          onBack={() => setScreen("editProperty")}
          onStart={plan => {
            saveProperty({ ...editingProperty, plan, packCredits: plan === "pack" ? (editingProperty.packCredits ?? 10) : 0 });
            setScreen("editProperty");
          }}
          property={editingProperty}
          allProperties={allProperties}
          initialPlan={editingProperty.plan || "monthly"}
        />
      )}

      {screen === "properties" && (
        <MyProperties
          properties={allProperties}
          activePropertyId={appState.activePropertyId}
          groupedIds={groupedIds}
          onSelect={id => { setAppState(s => ({ ...s, activePropertyId: id })); setScreen("dashboard"); }}
          onAdd={() => setScreen("addProperty")}
          onEdit={id => { setEditingPropertyId(id); setScreen("editProperty"); }}
          onBack={() => setScreen("customerWelcome")}
        />
      )}

      {screen === "dashboard" && (
        <Dashboard
          data={profile} allProperties={allProperties} groupedIds={groupedIds}
          onOpenSettings={()   => setScreen("settings")}
          onOpenAdHoc={()      => setScreen("adhoc")}
          onOpenProperties={() => setScreen("properties")}
          onSignOut={signOut}
        />
      )}

      {screen === "settings" && (
        <Settings onBack={() => setScreen("dashboard")} onSignOut={signOut} />
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
  );
}
