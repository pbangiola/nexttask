let tasks = [];
let sortedTasks = [];
let deadline = 0;
let spareTime = 0;
let timerInterval = null;

// Google SSO
const googleSignIn = document.getElementById('googleSignIn');
const googleSignOut = document.getElementById('googleSignOut');

googleSignIn.addEventListener('click', () => {
    window.location.href = '/auth/google';
});

googleSignOut.addEventListener('click', () => {
    fetch('/auth/logout').then(() => location.reload());
});

// Start Sorting
const startSortBtn = document.getElementById('startSort');
startSortBtn.addEventListener('click', () => {
    const taskInput = document.getElementById('tasks').value.trim();
    if (taskInput) {
        tasks = taskInput.split('\n').map(task => task.trim()).filter(task => task);
        sortedTasks = mergeSort(tasks);
        displaySortedTasks();
    } else {
        alert('Task list cannot be empty!');
    }
});

// Display Sorted Tasks
function displaySortedTasks() {
    document.getElementById('taskInput').classList.add('hidden');
    const taskResult = document.getElementById('taskResult');
    taskResult.classList.remove('hidden');
    
    const sortedList = document.getElementById('sortedTasks');
    sortedList.innerHTML = '';
    sortedTasks.forEach(task => {
        const li = document.createElement('li');
        li.textContent = task;
        sortedList.appendChild(li);
    });
}

// Focus Screen Logic
function startFocusScreen() {
    document.getElementById('taskResult').classList.add('hidden');
    const focusScreen = document.getElementById('focusScreen');
    focusScreen.classList.remove('hidden');
    
    const currentTask = sortedTasks.shift();
    document.getElementById('currentTask').textContent = `Current Task: ${currentTask}`;
    
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

// Timer and Spare Time Calculation
function updateTimer() {
    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = deadline - now;
    
    const timerDisplay = document.getElementById('timer');
    timerDisplay.style.color = timeRemaining >= 0 ? 'green' : 'red';
    
    const absTime = Math.abs(timeRemaining);
    const minutes = Math.floor(absTime / 60);
    const seconds = absTime % 60;
    timerDisplay.textContent = `${timeRemaining >= 0 ? '' : '-'}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// Completing a Task
const doneNextBtn = document.getElementById('doneNext');
doneNextBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    spareTime += deadline - Math.floor(Date.now() / 1000);
    updateSpareTimeDisplay();
    if (sortedTasks.length > 0) {
        startFocusScreen();
    } else {
        alert('All tasks completed!');
    }
});

// Display Spare Time
function updateSpareTimeDisplay() {
    const spareTimeDisplay = document.getElementById('spareTime');
    spareTimeDisplay.classList.remove('hidden');
    spareTimeDisplay.style.color = spareTime >= 0 ? 'green' : 'red';
    
    const absTime = Math.abs(spareTime);
    const hours = Math.floor(absTime / 3600);
    const minutes = Math.floor((absTime % 3600) / 60);
    const seconds = absTime % 60;
    
    spareTimeDisplay.textContent = `Spare Time: ${spareTime >= 0 ? '' : '-'}${hours}:${minutes}:${seconds}`;
}

// Merge Sort Algorithm
function mergeSort(array) {
    if (array.length <= 1) return array;
    const middle = Math.floor(array.length / 2);
    const left = mergeSort(array.slice(0, middle));
    const right = mergeSort(array.slice(middle));
    return merge(left, right);
}

function merge(left, right) {
    let result = [], lIndex = 0, rIndex = 0;
    while (lIndex < left.length && rIndex < right.length) {
        if (left[lIndex] < right[rIndex]) {
            result.push(left[lIndex++]);
        } else {
            result.push(right[rIndex++]);
        }
    }
    return result.concat(left.slice(lIndex)).concat(right.slice(rIndex));
}
