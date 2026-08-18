"use client";

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";

/**
 * Fallback shown by the service worker when a navigation cannot reach the
 * network and no cached shell exists for that route. Precached at install time,
 * so it must not depend on the API or on an authenticated session.
 */
export default function OfflinePage() {
  // Defaults to offline: this page is only ever reached because a navigation
  // failed, so that is the correct server-rendered copy. The effect below
  // corrects it if connectivity is actually up.
  const [online, setOnline] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);

    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // The moment connectivity returns, go back to the app on its own.
  useEffect(() => {
    if (!online) return;
    const id = setTimeout(() => window.location.replace("/dashboard"), 600);
    return () => clearTimeout(id);
  }, [online]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-lg">
          <CloudOff size={30} />
        </div>

        <h1 className="mt-6 text-xl font-extrabold text-slate-900">
          {online ? "Reconnecting" : "You are offline"}
        </h1>

        <p className="mt-2 text-sm font-medium text-slate-500 leading-relaxed">
          {online
            ? "Connection restored. Taking you back."
            : "Radha Madhav Medical Hall could not reach the server. Counter billing keeps working offline and queued invoices sync automatically once you are back online."}
        </p>

        <button
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
        >
          <RefreshCw size={16} />
          <span>Try again</span>
        </button>
      </div>
    </main>
  );
}
