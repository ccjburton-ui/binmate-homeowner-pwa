import React, { useState } from "react";
import MapPreview from "./components/MapPreview.jsx";
import AddressSearch from "./components/AddressSearch.jsx";

// Maps "Mon"..."Sun" to 1..7 (ISO: Mon=1)
const dayIndex = d => ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(d) + 1;

// Return the next date (local) for a given weekday code (Mon..Sun)
function nextWeekdayDate(weekday) {
  if (!weekday) return null;
  const target = dayIndex(weekday);
  const now = new Date();
  const todayIso = ((now.getDay() + 6) % 7) + 1; // JS Sun=0..Sat=6 -> ISO Mon=1..Sun=7
  const daysAhead = (target - todayIso + 7) % 7 || 7; // always future
  const next = new Date(now);
  next.setDate(now.getDate() + daysAhead);
  next.setHours(19, 0, 0, 0); // 7 pm start of OUT window
  return next;
}

function formatServiceWindow(dt) {
  if (!dt) return "—";
  const opts = { weekday: "short", day: "numeric", month: "short" };
  const start = dt.toLocaleString(undefined, opts);
  return `${start}, 7–10 pm (Bins Out)`;
}

function Header({ title, onBack }) {
  return (
    <div className="w-full flex items-center justify-between py-4 px-5 sticky top-0 bg-white/80 backdrop-blur z-10 border-b">
      <button
        onClick={onBack}
        className={`text-sm px-3 py-1 rounded-full border ${onBack ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        ← Back
      </button>
      <h1 className="text-lg font-semibold text-brand-fg font-heading">FmyBins</h1>
      <div className="w-[60px]" />
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full h-12 rounded-xl text-white font-semibold transition active:scale-[0.98] ${
  disabled ? "bg-gray-300" : "bg-brand-dark hover:opacity-90"
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
        <div className={`h-5 w-5 bg-white rounded-full transition ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

const BIN_OPTIONS = [
  { key: "general", label: "General Waste" },
  { key: "recycling", label: "Recycling" },
  { key: "fogo", label: "FOGO / Green" },
];

function BinChooser({ selected, onToggle }) {
  return (
    <div className="grid grid-cols-3 gap-3 my-2">
      {BIN_OPTIONS.map(opt => {
        const isOn = selected.includes(opt.key);
        return (
          <button
            key={opt.key}
            onClick={() => onToggle(opt.key)}
            className={`aspect-square rounded-2xl flex flex-col items-center justify-center border text-center px-2 ${
              isOn ? "border-brand-dark bg-brand-muted" : "border-gray-300 bg-white"
            }`}
          >
            <div className={`text-2xl mb-1 ${isOn ? "" : "opacity-50"}`}>🗑️</div>
            <div className="text-xs font-medium">{opt.label}</div>
          </button>
        );
      })}
    </div>
  );
}

function WeekdaySelect({ value, onChange }) {
  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  return (
    <div className="w-full mb-4">
      <div className="text-sm text-gray-600 mb-1">Pickup Day</div>
      <div className="grid grid-cols-7 gap-2">
        {days.map(d => (
          <button
            key={d}
            onClick={() => onChange(d)}
            className={`h-9 rounded-lg border text-sm ${value === d ? "bg-brand-dark text-white border-brand-dark" : "border-gray-300"}`}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

function Welcome({ onSignIn, onCreate }) {
  return (
    <div className="min-h-screen bg-brand-muted flex flex-col items-center justify-center text-center">
      <img
  src="/FmyBins_Logo_Transparent.png"
  alt="FmyBins logo"
  className="mt-12 mb-10 w-80 max-w-[90%] h-auto"
/>

      <div className="w-[360px] max-w-full p-5 bg-white rounded-2xl shadow-soft">
        <button
          onClick={onSignIn}
          className="w-full h-12 rounded-xl bg-brand-dark text-white font-semibold hover:opacity-90 transition active:scale-[0.98]"
        >
          Sign In
        </button>
        <div className="h-3" />
        <button
          onClick={onCreate}
          className="w-full h-12 rounded-xl border border-gray-300 text-brand-fg font-semibold hover:bg-brand-muted transition"
        >
          Create Account
        </button>
        <p className="text-[11px] text-gray-500 mt-4">
          By continuing, you agree this is an early access build.
        </p>
      </div>
    </div>
  );
}

function AddProperty({ onBack, onNext, data, setData }) {
  const [addr, setAddr] = useState(data.address || "");
  const [picked, setPicked] = useState(null); // from AddressSearch onSelect
  const [notes, setNotes] = useState(data.notes || "");

  return (
    <div className="min-h-screen bg-white">
      <Header title="Add Property" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">

        {/* Address search */}
        <AddressSearch
          label="Address"
          value={addr}
          onChange={setAddr}
          onSelect={(p) => {
            console.log("Address selected:", p);
            setPicked(p);          // p.lat, p.lon, p.label, etc.
            setAddr(p.label);
          }}
        />

        {/* Map preview (uses picked coords) */}
        <MapPreview
          lat={picked?.lat}
          lon={picked?.lon}
        />

        {/* Notes + Next button */}
        <TextArea
          label="Notes"
          placeholder="Gate code, pets, parking…"
          value={notes}
          onChange={setNotes}
        />
        <PrimaryButton
          onClick={() => {
            setData({
              ...data,
              address: addr,
              geo: picked ? { lat: picked.lat, lon: picked.lon } : undefined,
              notes,
            });
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

function BinSetup({ onBack, onNext, data, setData }) {
  const [bins, setBins] = useState(data.bins || []);
  const [day, setDay] = useState(data.day || "");

  function toggleBin(key) {
    setBins(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  return (
    <div className="min-h-screen bg-white">
      <Header title="Bin Setup" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">
        <div className="text-sm text-gray-600">Which bins do you have?</div>
        <BinChooser selected={bins} onToggle={toggleBin} />
        <WeekdaySelect value={day} onChange={setDay} />
        <div className="text-xs text-gray-500 mb-4">Unsure? We'll auto-suggest based on your council soon.</div>
        <PrimaryButton
          onClick={() => { setData({ ...data, bins, day }); onNext(); }}
          disabled={bins.length === 0 || !day}
        >
          Next: Access →
        </PrimaryButton>
      </div>
    </div>
  );
}

function AccessInfo({ onBack, onNext, data, setData }) {
  const [gate, setGate] = useState(data.gate || "");
  const [driveLong, setDriveLong] = useState(Boolean(data.driveLong));

  return (
    <div className="min-h-screen bg-white">
      <Header title="Access & Instructions" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">
        <Input label="Gate code (optional)" placeholder="4 digits (stored securely)" value={gate} onChange={setGate} />
        <div className="w-full h-28 rounded-2xl border border-dashed border-gray-300 text-gray-500 flex items-center justify-center mb-4">
          Upload photo of bin storage area (optional)
        </div>
        <Toggle label="Long or steep driveway (+$15/mo)" checked={driveLong} onChange={setDriveLong} />
        <PrimaryButton onClick={() => { setData({ ...data, gate, driveLong }); onNext(); }}>
          Next: Plan & Payment →
        </PrimaryButton>
      </div>
    </div>
  );
}

function PlanPayment({ onBack, onStart, data }) {
  const [agree, setAgree] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      <Header title="Plan & Payment" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">
        <div className="rounded-2xl overflow-hidden shadow-soft mb-4">
          <div className="bg-brand-dark text-white px-5 py-3 text-lg font-semibold">Early Access — Weekly Out & Return</div>
          <div className="bg-white px-5 py-4">
            <div className="text-2xl font-bold mb-1">$54.90<span className="text-base font-medium">/month</span></div>
            <ul className="text-sm text-gray-700 list-disc ml-5 space-y-1">
              <li>Up to 3 bins</li>
              <li>Out night before, back in after collection</li>
              <li>Photo proof every service</li>
            </ul>
          </div>
        </div>
        <Toggle label="Add long driveway support (+$15/mo)" checked={Boolean(data.driveLong)} onChange={()=>{}} />
        <div className="w-full h-48 rounded-2xl bg-gray-100 border border-dashed text-gray-500 flex items-center justify-center mb-4">
          Stripe Checkout (placeholder)
        </div>
        <div className="flex items-center gap-2 mb-4">
          <input id="agree" type="checkbox" className="h-5 w-5" checked={agree} onChange={e=>setAgree(e.target.checked)} />
          <label htmlFor="agree" className="text-sm text-gray-700">I understand this is an early access build.</label>
        </div>
        <PrimaryButton onClick={() => onStart()} disabled={!agree}>Start My Service</PrimaryButton>
      </div>
    </div>
  );
}

function Dashboard({ onOpenSettings, data }) {
  const nextDt = nextWeekdayDate(data.day || "Tue");
  const nextService = formatServiceWindow(nextDt);

  return (
    <div className="min-h-screen bg-brand-muted">
      <div className="w-full flex items-center justify-between py-4 px-5 sticky top-0 bg-white/80 backdrop-blur z-10 border-b">
        <h1 className="text-lg font-semibold text-brand-fg font-heading">FmyBins</h1>
        <button onClick={onOpenSettings} className="text-sm px-3 py-1 rounded-full border">Settings</button>
      </div>

      <div className="max-w-md mx-auto p-5">
        <div className="rounded-2xl p-5 bg-white shadow-soft mb-4">
          <div className="text-sm text-gray-600">Next Service</div>
          <div className="text-xl font-semibold mb-2">{nextService}</div>
          <div className="flex gap-2">
            <button className="px-4 h-10 rounded-xl border">Pause This Week</button>
            <button className="px-4 h-10 rounded-xl border">Edit Property</button>
          </div>
        </div>
        <div className="rounded-2xl p-5 bg-white shadow-soft">
          <div className="text-sm text-gray-600 mb-3">Recent Photos</div>
          <div className="grid grid-cols-3 gap-2">
            {[1,2,3].map(n => (
              <div key={n} className="aspect-square rounded-xl bg-gray-100 border flex items-center justify-center text-gray-400">Photo</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Settings({ onBack }) {
  const [emailN, setEmailN] = useState(true);
  const [smsN, setSmsN] = useState(false);
  const [pushN, setPushN] = useState(true);

  return (
    <div className="min-h-screen bg-white">
      <Header title="Settings" onBack={onBack} />
      <div className="max-w-md mx-auto p-5">
        <div className="rounded-2xl p-5 bg-white border mb-4">
          <h3 className="font-semibold mb-2">Notifications</h3>
          <Toggle label="Email" checked={emailN} onChange={setEmailN} />
          <Toggle label="SMS" checked={smsN} onChange={setSmsN} />
          <Toggle label="Push" checked={pushN} onChange={setPushN} />
        </div>
        <div className="rounded-2xl p-5 bg-white border">
          <h3 className="font-semibold mb-2">Billing</h3>
          <p className="text-sm text-gray-600 mb-3">Manage your subscription in the billing portal.</p>
          <PrimaryButton onClick={()=>alert('Open Stripe Customer Portal (stub)')}>Manage Billing</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const [profile, setProfile] = useState(() => {
  try { return JSON.parse(localStorage.getItem("FmyBins_profile") || "{}"); }
  catch { return {}; }
});
React.useEffect(() => {
  try { localStorage.setItem("FmyBins_profile", JSON.stringify(profile)); } catch {}
}, [profile]);


  return (
    <div className="min-h-screen font-[Inter]">
      {screen === "welcome" && (
        <Welcome onSignIn={() => setScreen("addProperty")} onCreate={() => setScreen("addProperty")} />
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
        <Dashboard onOpenSettings={() => setScreen("settings")} data={profile} />
      )}
      {screen === "settings" && (
        <Settings onBack={() => setScreen("dashboard")} />
      )}
    </div>
  );
}
