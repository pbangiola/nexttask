// --- Config ---
// declare all front-end global variables

// --- User ID & Initialization ---
//// load existing session id from memory
let userId = localStorage.getItem('taskSorteruserId');
//create new sessionid if necessary
if (!userId) {
    userId = 'session_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('taskSorteruserId', sessionId);
}

// --- Project ID & Initialization ---
//// declare project id
let projectId = null;

// --- Session ID & Initialization ---
//// load existing session id from memory
let sessionId = localStorage.getItem('taskSorterSessionId');
//create new sessionid if necessary
if (!sessionId) {
    sessionId = 'session_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('taskSorterSessionId', sessionId);
}


// setup tasklist variables
let currentSortRawTasks = [];
let sortedTasks = []; // Array: { name, estimatedTime, actualTimeMs, timestamps: {} }
let currentTaskIndex = 0;

// Global tracking timestamps (saved in state, hidden from UI)
let sessionStartTimestamp = Date.now();
let setupStartTime = 0;
let workStartTime = null;
let currentStepStartTimes = null;
let availabletime = 0;
let hardstop = 0;
let hardstop_reason = "";
let spareTime = 0; 
let cumulativestimatedtime = 0;

const MAX_TASK_MINUTES = 30;
//sets maximum task length


