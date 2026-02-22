import React, { useEffect, useState } from "react";
import MapPreview from "./components/MapPreview.jsx";
import AddressSearch from "./components/AddressSearch.jsx";
import { nextWeekly, nextFortnightly, isFortnightlyThisWeek } from "./utils/schedule.js";

// ─── Utilities ────────────────────────────────────────────────────────────────

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Fixed: starts on Monday, not Sunday
function startOfNextWeekMonday(now = new Date()) {
  const day = now.getDay(); // 0=Sun,1=Mon...6=Sat
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
  const start = new Date(`${startISO}T00:00:00`);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - start.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  return diffDays >= 0 && diffDays % 14 === 0;
}

function makeId() {
  try { return crypto.randomUUID(); }
  catch { return `job_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
}

function fmtDate(iso) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────

function Header({ title, onBack, right }) {
  return (
    <div className="w-full flex items-center justify-between py-4 px-5 sticky top-0 bg-white/80 backdrop-blur z-10 border-b">
      <button
        onClick={onBack}
        className={`text-sm px-3 py-1 rounded-full border ${onBack ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        ← Back
      </button>
      <h1 className="text-lg font-semibold text-brand-fg font-heading">FmyBins</h1>
      <div className="w-[60px] flex justify-end">{right}</div>
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, type = "button" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full h-12 rounded-xl text-white font-semibold transition active:scale-[0.98] ${
        disabled ? "bg-gray-300 cursor-not-allowed" : "bg-brand-dark hover:opacity-90"
      }`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full h-12 rounded-xl border border-gray-300 text-brand-fg font-semibold hover:bg-brand-muted transition"
    >
      {children}
    </button>
  );
}

function Input({ label, placeholder, type = "text", value, onChange }) {
  return (
    <label className="block w-full mb-4">
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-11 rounded-xl border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-brand-dark"
      />
    </label>
  );
}

function TextArea({ label, placeholder, value, onChange }) {
  return (
    <label className="block w-full mb-4">
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <textarea
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-xl border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-brand-dark"
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between w-full py-3">
      <span className="text-gray-800">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-12 h-7 rounded-full p-1 transition ${checked ? "bg-brand-dark" : "bg-gray-300"}`}
      >
        <div className={`h-5 w-5 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function Badge({ children, color = "gray" }) {
  const cls = {
    green: "bg-green-100 text-green-800",
    yellow: "bg-yellow-100 text-yellow-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
    gray: "bg-gray-100 text-gray-700",
  }[color] || "bg-gray-100 text-gray-700";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{children}</span>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 p-4 ${className}`}>
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

// ─── Bin config ───────────────────────────────────────────────────────────────

// Glass added; 4 options now
const BIN_OPTIONS = [
  { key: "general",   label: "General",   emoji: "🗑️" },
  { key: "recycling", label: "Recycling", emoji: "♻️" },
  { key: "fogo",      label: "FOGO",      emoji: "🌿" },
  { key: "glass",     label: "Glass",     emoji: "🍶" },
];

function binLabel(key) {
  return BIN_OPTIONS.find(b => b.key === key)?.label || key;
}

function WeekdaySelect({ value, onChange }) {
  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  return (
    <div className="w-full mb-4">
      <div className="text-sm text-gray-600 mb-1">Pickup Day</div>
      <div className="grid grid-cols-7 gap-1">
        {days.map(d => (
          <button
            key={d}
            onClick={() => onChange(d)}
            className={`h-9 rounded-lg border text-sm font-medium transition ${
              value === d ? "bg-brand-dark text-white border-brand-dark" : "border-gray-300 hover:border-brand-dark"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Welcome ──────────────────────────────────────────────────────────────────

function Welcome({ onSignIn, onCreate }) {
  return (
    <div className="min-h-screen bg-brand-muted flex flex-col items-center justify-center text-center px-4">
      <img
        src="/FmyBins_Logo_Transparent.png"
        alt="FmyBins logo"
        className="mt-12 mb-6 w-80 max-w-[90%] h-auto"
      />
      <p className="text-gray-500 text-sm mb-8 max-w-xs">
        Never forget bin day again. We take them out and bring them back — every week.
      </p>
      <div className="w-[360px] max-w-full p-5 bg-white rounded-2xl shadow-soft space-y-3">
        <button
          onClick={onSignIn}
          className="w-full h-12 rounded-xl bg-brand-dark text-white font-semibold hover:opacity-90 transition active:scale-[0.98]"
        >
          Sign In
        </button>
        <button
          onClick={onCreate}
          className="w-full h-12 rounded-xl border border-gray-300 text-brand-fg font-semibold hover:bg-brand-muted transition"
        >
          Create Account
        </button>
        <p className="text-[11px] text-gray-400">
          By continuing, you agree this is an early access build.
        </p>
      </div>
      {/* Quick-access portal links for demo */}
      <div className="mt-8 flex gap-3 text-xs text-gray-400">
        <span>Demo portals:</span>
        <button className="underline" onClick={onSignIn}>Customer</button>
        <span>·</span>
        <button className="underline" onClick={() => onCreate("provider")}>Provider</button>
        <span>·</span>
        <button className="underline" onClick={() => onCreate("ops")}>Ops</button>
      </div>
    </div>
  );
}

// ─── Onboarding: AddProperty ──────────────────────────────────────────────────

function AddProperty({ onBack, onNext, data, setData }) {
  const initialLabel =
    typeof data.address === "object" && data.address?.label
      ? data.address.label
      : (data.address || "");
  const initialObj = typeof data.address === "object" ? data.address : null;

  const [addr, setAddr] = useState(initialLabel);
  const [addrObj, setAddrObj] = useState(initialObj);
  const [notes, setNotes] = useState(data.notes || "");
  const hasCoords = addrObj?.lat != null && addrObj?.lng != null;

  return (
    <div className="min-h-screen bg-white">
      <Header title="Add Property" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">
        <p className="text-sm text-gray-500 mb-4">Start by searching your property address.</p>
        <AddressSearch
          value={addrObj}
          onSelect={(picked) => {
            setAddr(picked?.label || "");
            setAddrObj(picked || null);
          }}
          placeholder="Search address…"
        />

        {addrObj && (
          <div className="mt-2 text-sm text-gray-600">
            <div className="font-medium text-brand-fg">{addrObj.label}</div>
            {hasCoords && (
              <div className="text-xs text-gray-400">
                {Number(addrObj.lat).toFixed(5)}, {Number(addrObj.lng).toFixed(5)}
              </div>
            )}
          </div>
        )}

        {hasCoords && (
          <div className="mt-3 mb-3">
            <MapPreview lat={addrObj.lat} lon={addrObj.lng} />
          </div>
        )}

        <TextArea
          label="Notes (optional)"
          placeholder="Parking instructions, pets, access notes…"
          value={notes}
          onChange={setNotes}
        />

        <PrimaryButton
          onClick={() => {
            setData({ ...data, address: addrObj ?? (addr ? { label: addr } : null), notes });
            onNext();
          }}
          disabled={!addr}
        >
          Next: Bin Setup →
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Onboarding: BinSetup ─────────────────────────────────────────────────────

function BinSetup({ onBack, onNext, data, setData }) {
  const [bins, setBins] = useState(data.bins || []);
  const [day, setDay] = useState(data.day || data?.schedule?.weekday || "");
  const [startDates, setStartDates] = useState(
    data.startDates || data?.schedule?.startDates || { recycling: "", fogo: "", glass: "" }
  );

  function toggleBin(key) {
    setBins(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function DateInput({ label, value, onChange, hint }) {
    return (
      <label className="block w-full mb-4">
        <div className="text-sm text-gray-600 mb-1">{label}</div>
        <input
          type="date"
          value={value || ""}
          onChange={e => onChange(e.target.value)}
          className="w-full h-11 rounded-xl border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-brand-dark"
        />
        {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
      </label>
    );
  }

  // Fortnightly bins need a start date
  const needsRecyclingDate = bins.includes("recycling") && !startDates.recycling;
  const needsFogoDate      = bins.includes("fogo")      && !startDates.fogo;
  const needsGlassDate     = bins.includes("glass")     && !startDates.glass;
  const canProceed = bins.length > 0 && day && !needsRecyclingDate && !needsFogoDate && !needsGlassDate;

  return (
    <div className="min-h-screen bg-white">
      <Header title="Bin Setup" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">
        <div className="text-sm text-gray-600 mb-2">Which bins do you have?</div>

        {/* 4-col grid for 4 bin types */}
        <div className="grid grid-cols-4 gap-2 my-3">
          {BIN_OPTIONS.map(opt => {
            const isOn = bins.includes(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggleBin(opt.key)}
                className={`aspect-square rounded-2xl flex flex-col items-center justify-center border text-center px-1 transition ${
                  isOn ? "border-brand-dark bg-brand-muted" : "border-gray-300 bg-white"
                }`}
              >
                <div className={`text-2xl mb-1 ${isOn ? "" : "opacity-40"}`}>{opt.emoji}</div>
                <div className="text-[11px] font-medium">{opt.label}</div>
              </button>
            );
          })}
        </div>

        <WeekdaySelect value={day} onChange={setDay} />

        {/* Fortnightly start dates */}
        {bins.includes("recycling") && (
          <DateInput
            label="Recycling: next collection date"
            value={startDates.recycling}
            onChange={v => setStartDates(s => ({ ...s, recycling: v }))}
            hint="Pick the next date recycling is collected on your street (collected fortnightly)."
          />
        )}
        {bins.includes("fogo") && (
          <DateInput
            label="FOGO / Green: next collection date"
            value={startDates.fogo}
            onChange={v => setStartDates(s => ({ ...s, fogo: v }))}
            hint="Pick the next date FOGO is collected on your street (collected fortnightly)."
          />
        )}
        {bins.includes("glass") && (
          <DateInput
            label="Glass: next collection date"
            value={startDates.glass}
            onChange={v => setStartDates(s => ({ ...s, glass: v }))}
            hint="Pick the next date glass is collected on your street (collected fortnightly)."
          />
        )}

        <div className="text-xs text-gray-400 mt-2 mb-4">
          General waste is collected every week. Recycling, FOGO, and glass are fortnightly.
        </div>

        <PrimaryButton
          onClick={() => {
            setData({ ...data, bins, day, startDates, schedule: { weekday: day, startDates } });
            onNext();
          }}
          disabled={!canProceed}
        >
          Next: Access →
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Onboarding: AccessInfo ───────────────────────────────────────────────────

function AccessInfo({ onBack, onNext, data, setData }) {
  const [gate, setGate] = useState(data.gate || "");
  const [driveLong, setDriveLong] = useState(Boolean(data.driveLong));

  return (
    <div className="min-h-screen bg-white">
      <Header title="Access & Instructions" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">
        <Input
          label="Gate code (optional)"
          placeholder="e.g. 1234 — stored securely, only shown to your provider"
          value={gate}
          onChange={setGate}
        />
        <div className="w-full h-28 rounded-2xl border border-dashed border-gray-300 text-gray-400 flex flex-col items-center justify-center mb-4 text-sm gap-1">
          <span className="text-2xl">📷</span>
          Upload bin location photo (optional)
        </div>
        <Toggle label="Long or steep driveway (+$15.00/mo)" checked={driveLong} onChange={setDriveLong} />
        {driveLong && (
          <p className="text-xs text-gray-500 -mt-1 mb-2">
            This surcharge covers extra time for difficult access. Your provider receives the full $15.
          </p>
        )}
        <div className="mt-4">
          <PrimaryButton onClick={() => { setData({ ...data, gate, driveLong }); onNext(); }}>
            Next: Plan & Payment →
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding: PlanPayment ──────────────────────────────────────────────────

function PlanPayment({ onBack, onStart, data }) {
  const [agree, setAgree] = useState(false);
  const base = 59.90;
  const driveExtra = data.driveLong ? 15.00 : 0;
  const total = base + driveExtra;

  return (
    <div className="min-h-screen bg-white">
      <Header title="Plan & Payment" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">

        {/* Plan card */}
        <div className="rounded-2xl overflow-hidden border border-brand-dark mb-4">
          <div className="bg-brand-dark text-white px-5 py-3 text-base font-semibold font-heading">
            Weekly Bin Service
          </div>
          <div className="bg-white px-5 py-4">
            <div className="text-3xl font-bold mb-1 font-heading">
              ${total.toFixed(2)}<span className="text-base font-normal text-gray-500">/month</span>
            </div>
            {driveExtra > 0 && (
              <div className="text-sm text-gray-500 mb-2">
                ${base.toFixed(2)} base + ${driveExtra.toFixed(2)} steep/long driveway
              </div>
            )}
            <ul className="text-sm text-gray-700 list-disc ml-5 space-y-1 mt-2">
              <li>Up to 4 bins (general, recycling, FOGO, glass)</li>
              <li>Bins out the evening before collection</li>
              <li>Bins back in by 6 pm on collection day</li>
              <li>Photo proof on every service</li>
              <li>Cancel anytime</li>
            </ul>
          </div>
        </div>

        {/* Multi-property discount note */}
        <div className="rounded-xl bg-brand-muted border border-brand-dark/20 px-4 py-3 text-sm text-brand-fg mb-4">
          🏘️ <span className="font-semibold">Multiple properties?</span> Add more after sign-up and receive a discount for properties at the same address.
        </div>

        {/* Stripe placeholder */}
        <div className="w-full h-44 rounded-2xl bg-gray-50 border border-dashed border-gray-300 text-gray-400 flex flex-col items-center justify-center mb-4 text-sm gap-2">
          <span className="text-2xl">💳</span>
          Stripe Checkout
        </div>

        <div className="flex items-center gap-2 mb-4">
          <input
            id="agree"
            type="checkbox"
            className="h-5 w-5 accent-brand-dark"
            checked={agree}
            onChange={e => setAgree(e.target.checked)}
          />
          <label htmlFor="agree" className="text-sm text-gray-700">
            I understand this is an early access build.
          </label>
        </div>

        <PrimaryButton onClick={() => onStart()} disabled={!agree}>
          Start My Service →
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Customer Dashboard ───────────────────────────────────────────────────────

function Dashboard({ onOpenSettings, onOpenOps, onOpenProvider, onOpenAdHoc, data }) {
  const weekday      = data?.schedule?.weekday || data?.day || "Tue";
  const bins         = data?.bins || ["general"];
  const startRecycling = data?.schedule?.startDates?.recycling || null;
  const startFogo      = data?.schedule?.startDates?.fogo      || null;
  const startGlass     = data?.schedule?.startDates?.glass     || null;

  const nextGeneral   = nextWeekly(weekday);
  const nextRecycling = bins.includes("recycling") ? nextFortnightly(startRecycling, weekday) : null;
  const nextFogo      = bins.includes("fogo")      ? nextFortnightly(startFogo, weekday)      : null;
  const nextGlass     = bins.includes("glass")     ? nextFortnightly(startGlass, weekday)     : null;

  const thisWeek = [
    { key: "general",   label: "General",   on: bins.includes("general") },
    { key: "recycling", label: "Recycling", on: bins.includes("recycling") && isFortnightlyThisWeek(startRecycling, weekday) },
    { key: "fogo",      label: "FOGO / Green", on: bins.includes("fogo") && isFortnightlyThisWeek(startFogo, weekday) },
    { key: "glass",     label: "Glass",     on: bins.includes("glass") && isFortnightlyThisWeek(startGlass, weekday) },
  ].filter(x => x.on);

  const fmt = d => d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "—";
  const addrLabel = typeof data?.address === "object" ? data?.address?.label : data?.address;

  return (
    <div className="min-h-screen bg-brand-muted">
      <div className="w-full flex items-center justify-between py-4 px-5 sticky top-0 bg-white/80 backdrop-blur z-10 border-b">
        <h1 className="text-lg font-semibold text-brand-fg font-heading">FmyBins</h1>
        <div className="flex gap-2">
          <button onClick={onOpenAdHoc}  className="text-sm px-3 py-1 rounded-full border border-brand-dark text-brand-dark font-medium">⚡ Ad Hoc</button>
          <button onClick={onOpenOps}    className="text-sm px-3 py-1 rounded-full border">Ops</button>
          <button onClick={onOpenProvider} className="text-sm px-3 py-1 rounded-full border">Provider</button>
          <button onClick={onOpenSettings} className="text-sm px-3 py-1 rounded-full border">Settings</button>
        </div>
      </div>

      <div className="max-w-md mx-auto p-5 space-y-4">

        {/* Address */}
        {addrLabel && (
          <div className="text-xs text-gray-400 truncate px-1">{addrLabel}</div>
        )}

        {/* This week card */}
        <Card>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">This Week</div>
          <div className="flex flex-wrap gap-2 mb-3">
            {thisWeek.length === 0 ? (
              <span className="text-gray-400 text-sm">No services this week</span>
            ) : thisWeek.map(b => (
              <span key={b.key} className="px-3 py-1 rounded-full bg-brand-muted text-brand-fg text-sm font-medium border border-brand-dark/20">
                {b.label}
              </span>
            ))}
          </div>

          <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Next Dates</div>
          <ul className="space-y-1 text-sm">
            {bins.includes("general")   && <li><span className="font-medium">General:</span> {fmt(nextGeneral)}</li>}
            {bins.includes("recycling") && <li><span className="font-medium">Recycling:</span> {fmt(nextRecycling)}</li>}
            {bins.includes("fogo")      && <li><span className="font-medium">FOGO / Green:</span> {fmt(nextFogo)}</li>}
            {bins.includes("glass")     && <li><span className="font-medium">Glass:</span> {fmt(nextGlass)}</li>}
          </ul>

          <div className="flex gap-2 mt-4">
            <button className="px-4 h-10 rounded-xl border text-sm hover:bg-gray-50">Pause This Week</button>
            <button className="px-4 h-10 rounded-xl border text-sm hover:bg-gray-50" onClick={onOpenSettings}>Edit Property</button>
          </div>
        </Card>

        {/* Ad hoc CTA */}
        <button
          onClick={onOpenAdHoc}
          className="w-full rounded-2xl border-2 border-dashed border-brand-dark/40 bg-brand-muted/60 py-4 text-brand-fg font-medium text-sm hover:bg-brand-muted transition"
        >
          ⚡ Request a one-off ad hoc job
        </button>

        {/* Recent photos */}
        <Card>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Recent Photos</div>
          <div className="grid grid-cols-3 gap-2">
            {[1,2,3].map(n => (
              <div key={n} className="aspect-square rounded-xl bg-gray-100 border flex items-center justify-center text-gray-400 text-xs">
                Photo {n}
              </div>
            ))}
          </div>
        </Card>

      </div>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function Settings({ onBack }) {
  const [emailN, setEmailN] = useState(true);
  const [smsN, setSmsN]     = useState(false);
  const [pushN, setPushN]   = useState(true);

  return (
    <div className="min-h-screen bg-white">
      <Header title="Settings" onBack={onBack} />
      <div className="max-w-md mx-auto p-5 space-y-4">
        <Card>
          <h3 className="font-semibold mb-2 font-heading">Notifications</h3>
          <Toggle label="Email notifications" checked={emailN} onChange={setEmailN} />
          <Toggle label="SMS notifications"   checked={smsN}   onChange={setSmsN} />
          <Toggle label="Push notifications"  checked={pushN}  onChange={setPushN} />
        </Card>
        <Card>
          <h3 className="font-semibold mb-2 font-heading">Billing</h3>
          <p className="text-sm text-gray-500 mb-3">Manage your subscription and payment method.</p>
          <PrimaryButton onClick={() => alert("Open Stripe Customer Portal (coming soon)")}>
            Manage Billing
          </PrimaryButton>
        </Card>
        <Card>
          <h3 className="font-semibold mb-2 font-heading">Account</h3>
          <SecondaryButton onClick={() => alert("Sign out")}>Sign Out</SecondaryButton>
        </Card>
      </div>
    </div>
  );
}

// ─── Ad Hoc Job Request ───────────────────────────────────────────────────────

function AdHocRequest({ onBack, data, appState, setAppState }) {
  const [selectedBins, setSelectedBins] = useState([]);
  const [date, setDate]                 = useState("");
  const [note, setNote]                 = useState("");
  const [submitted, setSubmitted]       = useState(false);

  const addrLabel = typeof data?.address === "object" ? data?.address?.label : (data?.address || "");

  function toggleBin(key) {
    setSelectedBins(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function submit() {
    if (!date || selectedBins.length === 0) return;
    const job = {
      id: makeId(),
      jobKey: `adhoc_${date}_${makeId()}`,
      weekStartISO: date,
      propertyId: appState.activePropertyId || appState.properties?.[0]?.id || null,
      providerId: null,
      type: "adhoc",
      binTypes: selectedBins,
      scheduledFor: new Date(`${date}T09:00:00`).toISOString(),
      status: "unassigned",
      note,
      adHoc: true,
    };
    setAppState(s => ({ ...s, jobs: [...(s.jobs || []), job] }));
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-white">
        <Header title="Ad Hoc Job" onBack={onBack} />
        <div className="max-w-md mx-auto p-5 flex flex-col items-center text-center pt-16">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-semibold font-heading mb-2">Request Sent!</h2>
          <p className="text-gray-500 text-sm mb-6">
            We'll assign a provider and confirm your job shortly. One-off fee of $25.00 applies.
          </p>
          <PrimaryButton onClick={onBack}>Back to Dashboard</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Header title="Ad Hoc Job" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">
        <p className="text-sm text-gray-500 mb-4">
          Need a one-off bin service? We'll get a local provider out to you. A flat fee of <strong>$25.00</strong> applies.
        </p>

        {addrLabel && (
          <Card className="mb-4">
            <div className="text-xs text-gray-400 mb-1">Property</div>
            <div className="text-sm font-medium text-brand-fg">{addrLabel}</div>
          </Card>
        )}

        <label className="block w-full mb-4">
          <div className="text-sm text-gray-600 mb-1">Date needed</div>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full h-11 rounded-xl border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-brand-dark"
          />
        </label>

        <div className="text-sm text-gray-600 mb-2">Which bins?</div>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {BIN_OPTIONS.map(opt => {
            const isOn = selectedBins.includes(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggleBin(opt.key)}
                className={`aspect-square rounded-2xl flex flex-col items-center justify-center border text-center px-1 transition ${
                  isOn ? "border-brand-dark bg-brand-muted" : "border-gray-300 bg-white"
                }`}
              >
                <div className={`text-2xl mb-1 ${isOn ? "" : "opacity-40"}`}>{opt.emoji}</div>
                <div className="text-[11px] font-medium">{opt.label}</div>
              </button>
            );
          })}
        </div>

        <TextArea
          label="Special instructions (optional)"
          placeholder="e.g. Bins are behind the side gate, code 5678"
          value={note}
          onChange={setNote}
        />

        <PrimaryButton onClick={submit} disabled={!date || selectedBins.length === 0}>
          Request Ad Hoc Job — $25.00
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Provider Portal ──────────────────────────────────────────────────────────
// Fixed: moved outside OpsDashboard, now a proper top-level screen

function ProviderPortal({ onBack, appState, setAppState, providerSession, setProviderSession }) {
  const providers    = (appState.providers || []).filter(p => p.active);
  const providerId   = providerSession.providerId || "";
  const [tab, setTab] = useState("jobs"); // jobs | route | earnings

  const nextWeekStart    = startOfNextWeekMonday();
  const nextWeekStartISO = toISODate(nextWeekStart);

  const myJobs = (appState.jobs || [])
    .filter(j => j.providerId === providerId)
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));

  const propsById = Object.fromEntries((appState.properties || []).map(p => [p.id, p]));

  function markDone(jobId) {
    setAppState(s => ({
      ...s,
      jobs: (s.jobs || []).map(j =>
        j.id === jobId ? { ...j, status: "done", completedAt: new Date().toISOString() } : j
      ),
    }));
  }

  const completedToday = myJobs.filter(j => j.status === "done").length;
  const totalToday     = myJobs.length;
  const earnings       = myJobs.filter(j => j.status === "done").length * 5.63; // approx per job

  return (
    <div className="min-h-screen bg-brand-muted">
      <Header title="Provider Portal" onBack={onBack} />
      <div className="max-w-md mx-auto p-5 space-y-4">

        {/* Provider selector */}
        <Card>
          <div className="text-xs text-gray-500 mb-1">Logged in as</div>
          <select
            value={providerId}
            onChange={e => setProviderSession({ providerId: e.target.value })}
            className="w-full h-11 rounded-xl border border-gray-200 px-3 bg-white text-sm"
          >
            <option value="">— Select provider —</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Card>

        {!providerId ? (
          <Card>
            <p className="text-sm text-gray-500 text-center py-4">Select your name above to view your jobs.</p>
          </Card>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Jobs today"  value={`${completedToday}/${totalToday}`} />
              <StatCard label="Est. earnings" value={`$${earnings.toFixed(0)}`} sub="this week" />
              <StatCard label="Rating" value="4.9 ⭐" sub="142 jobs" />
            </div>

            {/* Tab bar */}
            <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-white">
              {[["jobs","📋 Jobs"],["route","🗺️ Route"],["earnings","💰 Earnings"]].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex-1 py-2.5 text-sm font-medium transition ${tab === id ? "bg-brand-dark text-white" : "text-gray-600 hover:bg-gray-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Jobs tab */}
            {tab === "jobs" && (
              <div className="space-y-3">
                {myJobs.length === 0 ? (
                  <Card>
                    <p className="text-sm text-gray-500 text-center py-4">No jobs assigned yet.</p>
                  </Card>
                ) : myJobs.map(j => {
                  const prop = propsById[j.propertyId];
                  const addr = prop?.address?.label || prop?.address || "—";
                  return (
                    <Card key={j.id}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-semibold text-sm">
                          {j.type === "bins_out" ? "🚮 Bins Out" : j.type === "bins_in" ? "↩️ Bins In" : "⚡ Ad Hoc"}
                        </div>
                        <Badge color={j.status === "done" ? "green" : j.status === "in_progress" ? "yellow" : "gray"}>
                          {j.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600">{fmtDate(j.scheduledFor)}</div>
                      <div className="text-sm text-gray-700 mt-1 truncate">{addr}</div>
                      {j.binTypes?.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          Bins: {j.binTypes.map(binLabel).join(", ")}
                        </div>
                      )}
                      {prop?.gate && <div className="text-xs text-gray-500 mt-1">Gate: {prop.gate}</div>}
                      {prop?.notes && <div className="text-xs text-gray-500 mt-1">Notes: {prop.notes}</div>}
                      {j.note && <div className="text-xs text-gray-500 mt-1">Instructions: {j.note}</div>}
                      <div className="mt-3">
                        <button
                          onClick={() => markDone(j.id)}
                          disabled={j.status === "done"}
                          className={`w-full h-11 rounded-xl text-white font-semibold transition ${
                            j.status === "done" ? "bg-gray-300 cursor-not-allowed" : "bg-brand-dark hover:opacity-90 active:scale-[0.98]"
                          }`}
                        >
                          {j.status === "done" ? "✓ Completed" : "Mark as Done"}
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Route tab */}
            {tab === "route" && (
              <Card>
                <div className="text-xs text-gray-500 mb-3 uppercase tracking-wide">Optimised Route — {myJobs.length} stops</div>
                {myJobs.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No jobs to route.</p>
                ) : (
                  <div className="space-y-0">
                    {myJobs.map((j, i) => {
                      const prop = propsById[j.propertyId];
                      const addr = prop?.address?.label || "—";
                      const isLast = i === myJobs.length - 1;
                      return (
                        <div key={j.id} className="flex gap-3 items-start">
                          <div className="flex flex-col items-center">
                            <div className="w-7 h-7 rounded-full bg-brand-dark text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {i + 1}
                            </div>
                            {!isLast && <div className="w-0.5 bg-gray-200 flex-1 my-1" style={{ minHeight: 24 }} />}
                          </div>
                          <div className="pb-4 flex-1">
                            <div className="text-sm font-medium">{j.type === "bins_out" ? "🚮 Bins Out" : "↩️ Bins In"}</div>
                            <div className="text-xs text-gray-500 truncate">{addr}</div>
                            <div className="text-xs text-gray-400">{fmtDate(j.scheduledFor)}</div>
                          </div>
                          <Badge color={j.status === "done" ? "green" : "gray"}>{j.status}</Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <div className="text-xs text-gray-400 mb-2">Powered by Mapbox Directions API</div>
                  <button
                    className="w-full h-10 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:opacity-90"
                    onClick={() => alert("Open in Maps (Mapbox Directions integration point)")}
                  >
                    Open Turn-by-Turn Directions
                  </button>
                </div>
              </Card>
            )}

            {/* Earnings tab */}
            {tab === "earnings" && (
              <div className="space-y-3">
                <Card>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">This Month</div>
                  <div className="text-3xl font-bold font-heading text-brand-fg">$1,140</div>
                  <div className="text-sm text-gray-500">from {myJobs.length} recurring jobs</div>
                </Card>
                <Card>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Pay Breakdown</div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Standard properties (×{Math.max(0, myJobs.length - 1)})</span>
                      <span className="font-medium">$45.00/mo each</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Steep driveway surcharge</span>
                      <span className="font-medium">$15.00/mo each</span>
                    </div>
                    <div className="flex justify-between text-sm border-t pt-2 font-semibold">
                      <span>Total (est.)</span>
                      <span>$1,140/mo</span>
                    </div>
                  </div>
                </Card>
                <Card>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Service Area</div>
                  <p className="text-sm text-gray-500 mb-3">
                    You'll be offered new recurring jobs in your area as customers sign up.
                  </p>
                  <button className="w-full h-10 rounded-xl border border-gray-300 text-sm font-medium hover:bg-gray-50">
                    Update My Service Area
                  </button>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Ops Dashboard ────────────────────────────────────────────────────────────

function OpsDashboard({ onBack, data, propertyId, appState, setAppState }) {
  const [tab, setTab] = useState("overview"); // overview | jobs | providers | finance

  const addrLabel  = typeof data?.address === "object" ? data?.address?.label : data?.address;
  const weekday    = data?.schedule?.weekday || data?.day || "—";
  const bins       = data?.bins || [];
  const notes      = data?.notes || "";
  const gate       = data?.gate || "";
  const driveLong  = Boolean(data?.driveLong);

  const startRecycling = data?.schedule?.startDates?.recycling || null;
  const startFogo      = data?.schedule?.startDates?.fogo      || null;
  const startGlass     = data?.schedule?.startDates?.glass     || null;

  const nextGeneral   = bins.includes("general")   ? nextWeekly(weekday) : null;
  const nextRecycling = bins.includes("recycling")  ? nextFortnightly(startRecycling, weekday) : null;
  const nextFogo      = bins.includes("fogo")       ? nextFortnightly(startFogo, weekday)      : null;
  const nextGlass     = bins.includes("glass")      ? nextFortnightly(startGlass, weekday)     : null;

  const fmt = d => d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "—";

  const nextWeekStart    = startOfNextWeekMonday();
  const nextWeekStartISO = toISODate(nextWeekStart);

  const providers        = (appState.providers || []).filter(p => p.active);
  const assignedProviderId = appState.weeklyAssignments?.[propertyId]?.[nextWeekStartISO] || "";
  const allJobs          = appState.jobs || [];
  const allProperties    = appState.properties || [];

  // ── Ops actions ──

  function assignProviderForWeek(providerId) {
    setAppState(s => {
      const weeklyAssignments = {
        ...(s.weeklyAssignments || {}),
        [propertyId]: {
          ...(s.weeklyAssignments?.[propertyId] || {}),
          [nextWeekStartISO]: providerId || null,
        },
      };
      const jobs = (s.jobs || []).map(j => {
        if (j.propertyId !== propertyId) return j;
        if (j.weekStartISO !== nextWeekStartISO) return j;
        return { ...j, providerId: providerId || null };
      });
      return { ...s, weeklyAssignments, jobs };
    });
  }

  function generateNextWeekJobs() {
    if (!propertyId) return;
    const prop = allProperties.find(p => p.id === propertyId);
    if (!prop) return;

    const pickupWeekday = prop.pickupWeekday || prop?.schedule?.weekday || "";
    const jsDay = weekdayToJsDay(pickupWeekday);
    if (jsDay == null) return;

    const pickupDate = addDays(nextWeekStart, (jsDay - 1 + 7) % 7); // Monday=0 offset
    const binTypes   = [];

    if (prop.bins?.includes("general"))   binTypes.push("general");
    if (prop.bins?.includes("recycling") && isDueFortnightly(prop.startDates?.recycling, pickupDate)) binTypes.push("recycling");
    if (prop.bins?.includes("fogo")      && isDueFortnightly(prop.startDates?.fogo,      pickupDate)) binTypes.push("fogo");
    if (prop.bins?.includes("glass")     && isDueFortnightly(prop.startDates?.glass,     pickupDate)) binTypes.push("glass");

    if (binTypes.length === 0) return;

    const pickupISO = toISODate(pickupDate);
    const keyOut    = `${propertyId}_bins_out_${pickupISO}`;
    const keyIn     = `${propertyId}_bins_in_${pickupISO}`;

    setAppState(s => {
      const existing = s.jobs || [];
      const assigned = s.weeklyAssignments?.[propertyId]?.[nextWeekStartISO] || null;
      const hasOut   = existing.some(j => j.jobKey === keyOut);
      const hasIn    = existing.some(j => j.jobKey === keyIn);
      const toAdd    = [];

      if (!hasOut) toAdd.push({
        id: makeId(), jobKey: keyOut, weekStartISO: nextWeekStartISO,
        propertyId, providerId: assigned, type: "bins_out", binTypes,
        scheduledFor: setTime(addDays(pickupDate, -1), 19, 0).toISOString(),
        status: "unassigned",
      });

      if (!hasIn) toAdd.push({
        id: makeId(), jobKey: keyIn, weekStartISO: nextWeekStartISO,
        propertyId, providerId: assigned, type: "bins_in", binTypes,
        scheduledFor: setTime(pickupDate, 15, 0).toISOString(),
        status: "unassigned",
      });

      return toAdd.length ? { ...s, jobs: [...existing, ...toAdd] } : s;
    });
  }

  const jobsForNextWeek = allJobs
    .filter(j => j.propertyId === propertyId && j.weekStartISO === nextWeekStartISO)
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));

  // Finance calcs
  const mrr = allProperties.reduce((sum, p) => sum + 59.90 + (p.driveLong ? 15 : 0), 0);
  const providerCost = allProperties.reduce((sum, p) => sum + 45 + (p.driveLong ? 15 : 0), 0);
  const margin = mrr - providerCost;

  const unassignedJobs = allJobs.filter(j => !j.providerId && j.status !== "done");

  return (
    <div className="min-h-screen bg-brand-muted">
      <Header title="Ops Dashboard" onBack={onBack} />

      {/* Tab bar */}
      <div className="sticky top-[65px] z-10 bg-white/90 backdrop-blur border-b px-4 py-2">
        <div className="max-w-2xl mx-auto flex gap-1">
          {[["overview","Overview"],["jobs","Jobs"],["providers","Providers"],["finance","Finance"]].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                tab === id ? "bg-brand-dark text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-5 space-y-4">

        {/* ── OVERVIEW TAB ── */}
        {tab === "overview" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Active properties"   value={allProperties.length}   sub="+2 this month" />
              <StatCard label="Jobs this week"       value={allJobs.filter(j => j.weekStartISO === nextWeekStartISO).length} sub={`${allJobs.filter(j => j.status === "done").length} completed`} />
              <StatCard label="Active providers"     value={providers.length}       sub="1 available" />
              <StatCard label="MRR"                  value={`$${mrr.toFixed(0)}`}  sub={`$${margin.toFixed(0)} margin`} />
            </div>

            {/* Property detail */}
            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Active Property</div>
              <div className="font-semibold text-brand-fg">{addrLabel || "—"}</div>
              {notes && <div className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{notes}</div>}
              <div className="mt-2 text-sm">
                <span className="font-medium">Pickup day:</span> {weekday}
              </div>
              <div className="text-sm mt-1">
                <span className="font-medium">Gate code:</span> {gate || "—"}
              </div>
              <div className="text-sm mt-1">
                <span className="font-medium">Driveway:</span>{" "}
                {driveLong ? <Badge color="yellow">Steep/Long (+$15)</Badge> : "Standard"}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {bins.map(b => {
                  const opt = BIN_OPTIONS.find(x => x.key === b);
                  return opt ? (
                    <span key={b} className="px-2.5 py-1 rounded-full bg-brand-muted text-brand-fg text-xs font-medium border border-brand-dark/20">
                      {opt.emoji} {opt.label}
                    </span>
                  ) : null;
                })}
              </div>
            </Card>

            {/* Unassigned jobs alert */}
            {unassignedJobs.length > 0 && (
              <Card className="border-red-200 bg-red-50">
                <div className="text-sm font-semibold text-red-700 mb-2">
                  🚨 {unassignedJobs.length} unassigned job{unassignedJobs.length > 1 ? "s" : ""}
                </div>
                {unassignedJobs.slice(0, 3).map(j => (
                  <div key={j.id} className="text-xs text-red-600 flex justify-between py-1 border-b border-red-100 last:border-0">
                    <span>{j.type === "bins_out" ? "Bins Out" : j.type === "bins_in" ? "Bins In" : "Ad Hoc"} — {fmtDate(j.scheduledFor)}</span>
                    <button
                      onClick={() => setTab("jobs")}
                      className="underline"
                    >
                      Assign
                    </button>
                  </div>
                ))}
              </Card>
            )}

            {/* This week schedule */}
            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Next Dates (Active Property)</div>
              <ul className="text-sm space-y-1">
                {bins.includes("general")   && <li><span className="font-medium">General:</span> {fmt(nextGeneral)}</li>}
                {bins.includes("recycling") && <li><span className="font-medium">Recycling:</span> {fmt(nextRecycling)}</li>}
                {bins.includes("fogo")      && <li><span className="font-medium">FOGO:</span> {fmt(nextFogo)}</li>}
                {bins.includes("glass")     && <li><span className="font-medium">Glass:</span> {fmt(nextGlass)}</li>}
              </ul>
            </Card>
          </>
        )}

        {/* ── JOBS TAB ── */}
        {tab === "jobs" && (
          <>
            {/* Generate jobs section */}
            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Weekly Batch</div>
              <div className="text-sm text-gray-700 mb-3">
                Generate jobs for week starting <span className="font-semibold">{nextWeekStartISO}</span>
              </div>

              <label className="block text-xs text-gray-500 mb-1">Assigned provider</label>
              <select
                value={assignedProviderId}
                onChange={e => assignProviderForWeek(e.target.value)}
                className="w-full h-11 rounded-xl border border-gray-200 px-3 bg-white text-sm mb-3"
              >
                <option value="">— Unassigned —</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              <button
                onClick={generateNextWeekJobs}
                className="w-full h-11 rounded-xl bg-brand-dark text-white font-semibold hover:opacity-90 transition"
              >
                Generate Next Week Jobs
              </button>
            </Card>

            {/* All jobs list */}
            <div className="space-y-2">
              {allJobs.length === 0 ? (
                <Card>
                  <p className="text-sm text-gray-400 text-center py-4">No jobs yet. Generate a batch above.</p>
                </Card>
              ) : allJobs
                .slice()
                .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))
                .map(j => {
                  const prop = allProperties.find(p => p.id === j.propertyId);
                  const addr = prop?.address?.label || "—";
                  const prov = providers.find(p => p.id === j.providerId);
                  return (
                    <Card key={j.id}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {j.type === "bins_out" ? "🚮 Bins Out" : j.type === "bins_in" ? "↩️ Bins In" : "⚡ Ad Hoc"}
                            {j.adHoc && <Badge color="blue" >Ad Hoc</Badge>}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">{fmtDate(j.scheduledFor)}</div>
                          <div className="text-xs text-gray-600 truncate mt-0.5">{addr}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            Bins: {Array.isArray(j.binTypes) ? j.binTypes.map(binLabel).join(", ") : "—"}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            Provider: {prov ? prov.name : <span className="text-red-500 font-medium">Unassigned</span>}
                          </div>
                        </div>
                        <div className="ml-2 flex flex-col items-end gap-2">
                          <Badge color={j.status === "done" ? "green" : j.status === "in_progress" ? "yellow" : j.providerId ? "gray" : "red"}>
                            {j.status}
                          </Badge>
                          {!j.providerId && (
                            <select
                              defaultValue=""
                              onChange={e => {
                                const pid = e.target.value;
                                if (!pid) return;
                                setAppState(s => ({
                                  ...s,
                                  jobs: (s.jobs || []).map(x => x.id === j.id ? { ...x, providerId: pid, status: "unassigned" } : x),
                                }));
                              }}
                              className="text-xs border rounded-lg px-2 py-1 bg-white"
                            >
                              <option value="">Assign…</option>
                              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
            </div>
          </>
        )}

        {/* ── PROVIDERS TAB ── */}
        {tab === "providers" && (
          <>
            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Active Providers</div>
              <div className="space-y-3">
                {providers.map(p => {
                  const pJobs = allJobs.filter(j => j.providerId === p.id);
                  const done  = pJobs.filter(j => j.status === "done").length;
                  return (
                    <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className="text-xs text-gray-500">{pJobs.length} jobs assigned · {done} done</div>
                      </div>
                      <Badge color="green">Active</Badge>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Provider Rates</div>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span>Standard property</span><span className="font-medium">$45.00/mo</span></div>
                <div className="flex justify-between"><span>Steep/long driveway bonus</span><span className="font-medium">$15.00/mo</span></div>
                <div className="flex justify-between text-gray-400 text-xs mt-2"><span>FmyBins margin (standard)</span><span>$14.90/mo</span></div>
              </div>
            </Card>
          </>
        )}

        {/* ── FINANCE TAB ── */}
        {tab === "finance" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Monthly Revenue" value={`$${mrr.toFixed(2)}`}    sub="MRR" />
              <StatCard label="Provider Costs"  value={`$${providerCost.toFixed(2)}`} sub="this month" />
              <StatCard label="Net Margin"      value={`$${margin.toFixed(2)}`} sub={`${mrr > 0 ? ((margin/mrr)*100).toFixed(0) : 0}% margin`} />
              <StatCard label="Properties"      value={allProperties.length}    sub={`${allProperties.filter(p => p.driveLong).length} steep`} />
            </div>

            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Per Property Breakdown</div>
              {allProperties.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No properties yet.</p>
              ) : allProperties.map(p => {
                const addr  = typeof p.address === "object" ? p.address?.label : p.address;
                const rev   = 59.90 + (p.driveLong ? 15 : 0);
                const cost  = 45    + (p.driveLong ? 15 : 0);
                return (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{addr || "—"}</div>
                      <div className="text-xs text-gray-400">{p.driveLong ? "Steep driveway" : "Standard"}</div>
                    </div>
                    <div className="text-right ml-2">
                      <div className="font-semibold">${rev.toFixed(2)}/mo</div>
                      <div className="text-xs text-gray-400">prov: ${cost.toFixed(2)}</div>
                    </div>
                  </div>
                );
              })}
              {allProperties.length > 0 && (
                <div className="flex justify-between pt-2 font-semibold text-sm">
                  <span>Total</span>
                  <span>${mrr.toFixed(2)}/mo</span>
                </div>
              )}
            </Card>

            <Card>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Ad Hoc Jobs</div>
              {allJobs.filter(j => j.adHoc).length === 0 ? (
                <p className="text-sm text-gray-400">No ad hoc jobs yet.</p>
              ) : allJobs.filter(j => j.adHoc).map(j => (
                <div key={j.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                  <span>{fmtDate(j.scheduledFor)}</span>
                  <span className="font-medium">$25.00</span>
                </div>
              ))}
            </Card>
          </>
        )}

      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("welcome");

  const EMPTY_STATE = {
    currentUser: { id: "admin-1", role: "admin" },
    customers: [],
    providers: [],
    properties: [],
    jobs: [],
    weeklyAssignments: {},
    activePropertyId: null,
  };

  const [providerSession, setProviderSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem("FmyBins_providerSession") || "null") || { providerId: "" }; }
    catch { return { providerId: "" }; }
  });

  useEffect(() => {
    try { localStorage.setItem("FmyBins_providerSession", JSON.stringify(providerSession)); }
    catch {}
  }, [providerSession]);

  const [appState, setAppState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("FmyBins_state") || "null");
      let state = saved && typeof saved === "object" ? saved : EMPTY_STATE;

      // Migration: old "profile" blob → property
      if (state.profile && (!state.properties || state.properties.length === 0)) {
        const p = state.profile;
        const addrObj = typeof p.address === "object" ? p.address : (p.address ? { label: p.address } : null);
        state = {
          ...state,
          properties: [{
            id: "prop-1",
            customerId: null,
            address: addrObj,
            lat: addrObj?.lat ?? null,
            lng: addrObj?.lng ?? null,
            notes: p.notes || "",
            gate: p.gate || "",
            driveLong: Boolean(p.driveLong),
            bins: p.bins || [],
            pickupWeekday: p.schedule?.weekday || p.day || "",
            startDates: p.schedule?.startDates || p.startDates || { recycling: "", fogo: "", glass: "" },
            schedule: p.schedule || null,
          }],
          activePropertyId: "prop-1",
        };
        delete state.profile;
      }

      return {
        ...EMPTY_STATE,
        ...state,
        properties: state.properties || [],
        jobs: state.jobs || [],
        customers: state.customers || [],
        providers: state.providers || [],
        activePropertyId: state.activePropertyId || (state.properties?.[0]?.id ?? null),
      };
    } catch { return EMPTY_STATE; }
  });

  useEffect(() => {
    try { localStorage.setItem("FmyBins_state", JSON.stringify(appState)); }
    catch {}
  }, [appState]);

  // Seed default providers if none exist
  useEffect(() => {
    if ((appState.providers || []).length === 0) {
      setAppState(s => ({
        ...s,
        providers: [
          { id: "prov-1", name: "Alex",   active: true },
          { id: "prov-2", name: "Jamie",  active: true },
          { id: "prov-3", name: "Taylor", active: true },
        ],
      }));
    }
  }, []);

  const activeProperty =
    appState.properties.find(p => p.id === appState.activePropertyId) ||
    appState.properties[0] ||
    null;

  const profile = activeProperty ? {
    ...activeProperty,
    day: activeProperty.pickupWeekday,
    startDates: activeProperty.startDates || { recycling: "", fogo: "", glass: "" },
    schedule: activeProperty.schedule || {
      weekday: activeProperty.pickupWeekday,
      startDates: activeProperty.startDates || { recycling: "", fogo: "", glass: "" },
    },
  } : {};

  const setProfile = (updatedProfile) =>
    setAppState(s => {
      const id = s.activePropertyId || s.properties?.[0]?.id;
      const addrObj = typeof updatedProfile.address === "object"
        ? updatedProfile.address
        : (updatedProfile.address ? { label: updatedProfile.address } : null);

      if (!id) {
        const newProp = {
          id: "prop-1", customerId: null,
          address: addrObj,
          lat: addrObj?.lat ?? null, lng: addrObj?.lng ?? null,
          notes: updatedProfile.notes || "", gate: updatedProfile.gate || "",
          driveLong: Boolean(updatedProfile.driveLong),
          bins: updatedProfile.bins || [],
          pickupWeekday: updatedProfile.schedule?.weekday || updatedProfile.day || "",
          startDates: updatedProfile.schedule?.startDates || updatedProfile.startDates || { recycling: "", fogo: "", glass: "" },
          schedule: updatedProfile.schedule || null,
        };
        return { ...s, properties: [newProp], activePropertyId: "prop-1" };
      }

      return {
        ...s,
        properties: (s.properties || []).map(p => {
          if (p.id !== id) return p;
          return {
            ...p,
            address: addrObj,
            lat: addrObj?.lat ?? p.lat ?? null,
            lng: addrObj?.lng ?? p.lng ?? null,
            notes: updatedProfile.notes ?? p.notes,
            gate: updatedProfile.gate ?? p.gate,
            driveLong: updatedProfile.driveLong ?? p.driveLong,
            bins: updatedProfile.bins ?? p.bins,
            pickupWeekday: updatedProfile.schedule?.weekday || updatedProfile.day || p.pickupWeekday,
            startDates: updatedProfile.schedule?.startDates || updatedProfile.startDates || p.startDates,
            schedule: updatedProfile.schedule || p.schedule,
          };
        }),
      };
    });

  return (
    <div className="min-h-screen font-body">
      {screen === "welcome" && (
        <Welcome
          onSignIn={() => setScreen("addProperty")}
          onCreate={(dest) => {
            if (dest === "provider") setScreen("provider");
            else if (dest === "ops") setScreen("ops");
            else setScreen("addProperty");
          }}
        />
      )}
      {screen === "addProperty" && (
        <AddProperty onBack={() => setScreen("welcome")} onNext={() => setScreen("binSetup")} data={profile} setData={setProfile} />
      )}
      {screen === "binSetup" && (
        <BinSetup onBack={() => setScreen("addProperty")} onNext={() => setScreen("access")} data={profile} setData={setProfile} />
      )}
      {screen === "access" && (
        <AccessInfo onBack={() => setScreen("binSetup")} onNext={() => setScreen("plan")} data={profile} setData={setProfile} />
      )}
      {screen === "plan" && (
        <PlanPayment onBack={() => setScreen("access")} onStart={() => setScreen("dashboard")} data={profile} />
      )}
      {screen === "dashboard" && (
        <Dashboard
          onOpenSettings={() => setScreen("settings")}
          onOpenOps={() => setScreen("ops")}
          onOpenProvider={() => setScreen("provider")}
          onOpenAdHoc={() => setScreen("adhoc")}
          data={profile}
        />
      )}
      {screen === "settings" && (
        <Settings onBack={() => setScreen("dashboard")} />
      )}
      {screen === "adhoc" && (
        <AdHocRequest
          onBack={() => setScreen("dashboard")}
          data={profile}
          appState={appState}
          setAppState={setAppState}
        />
      )}
      {screen === "provider" && (
        <ProviderPortal
          onBack={() => setScreen("dashboard")}
          appState={appState}
          setAppState={setAppState}
          providerSession={providerSession}
          setProviderSession={setProviderSession}
        />
      )}
      {screen === "ops" && (
        <OpsDashboard
          onBack={() => setScreen("dashboard")}
          data={profile}
          propertyId={activeProperty?.id || null}
          appState={appState}
          setAppState={setAppState}
        />
      )}
    </div>
  );
}
