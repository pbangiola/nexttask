"use client";

import { useState, useEffect, useRef } from "react";

// GLOBAL CONFIGURATION: Update this to your live Render Web Service URL!
const BACKEND_URL = "https://nexttask-backend.onrender.com";

declare global {
  interface Window {
    google: any;
    tokenClient: any;
  }
}

export default function TaskSorter() {
  const [view, setView] = useState<"INPUT" | "COMPARE" | "RESULTS" | "DEADLINE" | "FOCUS" | "COMPLETE">("INPUT");
  const [rawInput, setRawInput] = useState("");
  const [alreadySorted, setAlreadySorted] = useState(false);
  const [sortedTasks, setSortedTasks] = useState<string[]>([]);
  const [nextTask, setNextTask] = useState("");
  const [taskTimeInput, setTaskTimeInput] = useState("25");
  const [deadline, setDeadline] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [spareTime, setSpareTime] = useState(0);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [exportUrl, setExportUrl] = useState("");

  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const resolveRef = useRef<((value: string) => void) | null>(null);

  // Background ping to spin up Render if it is sleeping
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/ping`)
      .then(() => console.log("Backend server warmed up successfully!"))
      .catch(() => console.log("Backend warming up..."));
  }, []);

  // Dynamically inject Google Client Identity SDK script
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogleAuth;
    document.body.appendChild(script);
  }, []);

  function initializeGoogleAuth() {
    if (!window.google) return;
    window.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: "YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com", // Replace with your real Client ID
      scope: "https://www.googleapis.com/auth/spreadsheets",
      callback: (tokenResponse: any) => {
        if (tokenResponse.access_token) {
          setAccessToken(tokenResponse.access_token);
          setUserEmail("Connected Account");
        }
      },
    });
  }

  const handleGoogleLogin = () => {
    if (window.tokenClient) {
      window.tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      alert("Google script loading, try again in a moment.");
    }
  };

  const handleSignOut = () => {
    setAccessToken(null);
    setUserEmail(null);
    setExportUrl("");
  };

  const handleStartSort = async () => {
    const cleanTasks = rawInput.split("\n").map((t) => t.trim()).filter((t) => t.length > 0);
    if (cleanTasks.length === 0) return alert("Task list cannot be empty!");

    if (alreadySorted || cleanTasks.length <= 1) {
      setSortedTasks(cleanTasks);
      setNextTask(cleanTasks[0]);
      setView("RESULTS");
    } else {
      setView("COMPARE");
      const fullySorted = await mergeSortInteractive(cleanTasks);
      setSortedTasks(fullySorted);
      setNextTask(fullySorted[0]);
      setView("RESULTS");
    }
  };

  async function mergeSortInteractive(array: string[]): Promise<string[]> {
    if (array.length <= 1) return array;
    const middle = Math.floor(array.length / 2);
    const left = await mergeSortInteractive(array.slice(0, middle));
    const right = await mergeSortInteractive(array.slice(middle));
    return await mergeInteractive(left, right);
  }

  function mergeInteractive(left: string[], right: string[]): Promise<string[]> {
    return new Promise(async (resolve) => {
      const result: string[] = [];
      const leftCopy = [...left];
      const rightCopy = [...right];

      const compareNext = async () => {
        if (leftCopy.length === 0 && rightCopy.length === 0) return resolve(result);
        if (leftCopy.length === 0) { result.push(...rightCopy); return resolve(result); }
        if (rightCopy.length === 0) { result.push(...leftCopy); return resolve(result); }

        setCompareLeft(leftCopy[0]);
        setCompareRight(rightCopy[0]);

        const chosen = await new Promise<string>((res) => { resolveRef.current = res; });
        chosen === "left" ? result.push(leftCopy.shift()!) : result.push(rightCopy.shift()!);
        await compareNext();
      };
      await compareNext();
    });
  }

  const handleExportToSheets = async () => {
    if (!accessToken) return alert("Please log in with Google first!");
    setLoadingSheet(true);
    setExportUrl("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/sheets/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskList: sortedTasks, accessToken: accessToken }),
      });
      const data = await res.json();
      if (data.url) setExportUrl(data.url);
      else alert(data.error || "Export engine error encountered.");
    } catch (err) {
      alert("Could not reach backend. It might still be warming up from sleep mode.");
    } finally {
      setLoadingSheet(false);
    }
  };

  const handleStartTask = () => {
    const mins = parseInt(taskTimeInput, 10);
    if (mins >= 1 && mins <= 60) {
      setDeadline(Math.floor(Date.now() / 1000 + mins * 60));
      setView("FOCUS");
    } else {
      alert("Please enter a valid time between 1 and 60 minutes.");
    }
  };

  const handleDoneNext = () => {
    if (deadline !== null) setSpareTime((prev) => prev + (deadline - Math.floor(Date.now() / 1000)));
    const remainingTasks = sortedTasks.slice(1);
    setSortedTasks(remainingTasks);
    if (remainingTasks.length > 0) {
      setNextTask(remainingTasks[0]);
      setView("DEADLINE");
    } else {
      setView("COMPLETE");
    }
  };

  useEffect(() => {
    let timerInterval: NodeJS.Timeout;
    if (view === "FOCUS" && deadline !== null) {
      const updateTimer = () => setTimeRemaining(deadline - Math.floor(Date.now() / 1000));
      updateTimer();
      timerInterval = setInterval(updateTimer, 1000);
    }
    return () => clearInterval(timerInterval);
  }, [view, deadline]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 antialiased text-gray-900">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-6 space-y-6">
        <header className="border-b border-gray-100 pb-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold tracking-tight">⚡ NextTask</h1>
            <p className="text-xs text-gray-400 mt-0.5">{userEmail ? userEmail : "Static Client Mode"}</p>
          </div>
          {accessToken ? (
            <button onClick={handleSignOut} className="text-xs font-semibold px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition">Sign Out</button>
          ) : (
            <button onClick={handleGoogleLogin} className="text-xs font-semibold px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition shadow-sm">Google Login</button>
          )}
        </header>

        {view === "INPUT" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-500 mb-2">Enter Tasks (One per line)</h2>
              <textarea rows={6} value={rawInput} onChange={(e) => setRawInput(e.target.value)} placeholder="Buy groceries&#10;Finish report&#10;Call client..." className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 resize-none text-gray-800" />
            </div>
            <label className="flex items-center space-x-3 cursor-pointer p-1">
              <input type="checkbox" checked={alreadySorted} onChange={(e) => setAlreadySorted(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4 border-gray-300" />
              <span className="text-sm font-medium text-gray-600">My list is already sorted</span>
            </label>
            <button onClick={handleStartSort} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition">Start Sorting Process</button>
          </div>
        )}

        {view === "COMPARE" && (
          <div className="space-y-4 text-center">
            <h2 className="text-md font-semibold text-gray-400">Which task takes precedence?</h2>
            <div className="grid grid-cols-1 gap-3">
              <button onClick={() => resolveRef.current?.("left")} className="w-full bg-white hover:bg-indigo-50/50 hover:border-indigo-200 border-2 border-gray-200 text-gray-800 font-semibold p-4 rounded-xl transition text-left flex justify-between items-center group">
                <span>{compareLeft}</span><span className="text-xs text-gray-300 group-hover:text-indigo-500">A →</span>
              </button>
              <button onClick={() => resolveRef.current?.("right")} className="w-full bg-white hover:bg-indigo-50/50 hover:border-indigo-200 border-2 border-gray-200 text-gray-800 font-semibold p-4 rounded-xl transition text-left flex justify-between items-center group">
                <span>{compareRight}</span><span className="text-xs text-gray-300 group-hover:text-indigo-500">B →</span>
              </button>
            </div>
          </div>
        )}

        {view === "RESULTS" && (
          <div className="space-y-4">
            <h2 className="text-md font-semibold text-gray-500">Ranked Priority Sequence</h2>
            <ol className="divide-y divide-gray-100 max-h-48 overflow-y-auto pr-1">
              {sortedTasks.map((task, idx) => (
                <li key={idx} className="py-2 flex items-center space-x-3 text-sm font-medium text-gray-700">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 text-xs flex items-center justify-center font-bold">{idx + 1}</span>
                  <span className="truncate">{task}</span>
                </li>
              ))}
            </ol>
            <div className="pt-2 space-y-2">
              <button onClick={() => setView("DEADLINE")} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition shadow-sm">Get to Work</button>
              {accessToken ? (
                <button onClick={handleExportToSheets} disabled={loadingSheet} className="w-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-medium py-2.5 rounded-xl text-sm transition disabled:bg-gray-100">
                  {loadingSheet ? "Syncing Workspace..." : "Export to Google Sheets"}
                </button>
              ) : (
                <p className="text-center text-xs text-gray-400 italic">Sign in with Google to enable spreadsheet syncing integrations.</p>
              )}
              {exportUrl && (
                <a href={exportUrl} target="_blank" rel="noopener noreferrer" className="block text-center text-xs font-semibold text-emerald-600 underline mt-2">
                  🚀 Open Exported Spreadsheet link
                </a>
              )}
            </div>
          </div>
        )}

        {view === "DEADLINE" && (
          <div className="space-y-4">
            <h2 className="text-md font-semibold text-gray-500">Set timeframe window</h2>
            <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100"><p className="font-semibold text-gray-800 text-sm">{nextTask}</p></div>
            <input type="number" value={taskTimeInput} onChange={(e) => setTaskTimeInput(e.target.value)} className="w-full rounded-xl border border-gray-200 p-3 text-sm bg-gray-50 text-gray-800" />
            <button onClick={handleStartTask} className="w-full bg-indigo-600 text-white font-medium py-3 rounded-xl transition">Start Countdown</button>
          </div>
        )}

        {view === "FOCUS" && (
          <div className="space-y-4 text-center">
            <h2 className="text-md font-bold text-gray-700 truncate">{nextTask}</h2>
            <div className="py-6 bg-gray-50 rounded-xl border border-gray-100"><p className={`text-4xl font-mono font-bold ${timeRemaining >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{timeRemaining < 0 ? "-" : ""}{Math.floor(Math.abs(timeRemaining) / 60)}:{String(Math.abs(timeRemaining) % 60).padStart(2, "0")}</p></div>
            <button onClick={handleDoneNext} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 rounded-xl transition">Done, Next!</button>
          </div>
        )}

        {view === "COMPLETE" && (
          <div className="space-y-4 text-center">
            <h2 className="text-lg font-bold text-gray-800">Workspace Complete! 🎉</h2>
            <div className="p-4 bg-gray-50 rounded-xl text-center"><span className="text-xs font-semibold text-gray-400 block mb-1">Total Net Saved Time</span><p className={`text-xl font-bold ${spareTime >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{spareTime < 0 ? "-" : ""}{Math.floor(Math.abs(spareTime) / 3600)}h {Math.floor((Math.abs(spareTime) % 3600) / 60)}m</p></div>
            <button onClick={() => { setView("INPUT"); setSpareTime(0); setRawInput(""); setExportUrl(""); }} className="w-full bg-indigo-600 text-white font-medium py-3 rounded-xl">Restart Dashboard</button>
          </div>
        )}
      </div>
    </div>
  );
}
