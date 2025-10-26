// src/PasswordGate.jsx
import { useState } from "react";

export default function PasswordGate({ children }) {
  const [pwd, setPwd] = useState("");
  const [ok, setOk] = useState(false);

  // Vite exposes env vars on import.meta.env and only ones prefixed with VITE_
  const REQUIRED = import.meta.env.VITE_SITE_PASSWORD || "";

  function submit(e) {
    e.preventDefault();
    if (pwd === REQUIRED) setOk(true);
    else alert("Incorrect password.");
  }

  // If no password configured, allow access (prevents lockout in dev)
  if (!REQUIRED) return children;
  if (ok) return children;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={submit}
        className="w-[320px] p-6 bg-white rounded-xl shadow space-y-3"
      >
        <h1 className="text-lg font-semibold">FmyBins Access</h1>
        <input
          type="password"
          placeholder="Enter password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
        <button
          type="submit"
          className="w-full bg-[#5BC980] text-white py-2 rounded font-semibold"
        >
          Enter
        </button>
        <p className="text-xs text-gray-500">
          Protected preview. Ask Chelsea for access.
        </p>
      </form>
    </div>
  );
}
