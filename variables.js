// --- Front-End Configuration and Shared State ---
const MAX_TASK_MINUTES = 20;

// GitHub Pages hosts only the frontend. API requests must go to the deployed backend.
const API_BASE_URL = 'https://nexttask-7rj8.onrender.com';

// Holds raw task names while an interactive sort is in progress.
let currentSortRawTasks = [];

// --- Session ID & Initialization ---
let sessionId = localStorage.getItem('taskSorterSessionId');
if (!sessionId) {
    sessionId = 'session_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('taskSorterSessionId', sessionId);
}

let sortedTasks = []; // Array: { name, estimatedTime, actualTimeMs, timestamps: {} }
let currentTaskIndex = 0;
let timerInterval = null;
let deadline = 0;
let spareTime = 0;
let taskStartTimestamp = 0;
let pausedSecondsRemaining = 0;

// Track overall session constraints
let totalAvailableTime = 0;
let endConstraint = "";

// Global tracking timestamps (saved in state, hidden from UI)
let sessionStartTimestamp = null;
let currentStepStartTimestamp = null;
let sortStartTime = 0;
