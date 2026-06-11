let sortedTasks = []; // Holds objects: { name: "Task", estimatedTime: 0, actualTime: 0 }
let currentTaskIndex = 0;
let timerInterval = null;
let deadline = 0;
let spareTime = 0; 
let taskStartTimestamp = 0; 
let pausedSecondsRemaining = 0; // Tracks exactly how many seconds were left on the countdown clock when paused

// Step 1: Start Sorting or Skip Sorting
document.getElementById('startSort').addEventListener('click', () => {
    const taskInput = document.getElementById('tasks').value.trim();
    if (!taskInput) {
        alert('Task list cannot be empty!');
        return;
    }

    const rawTasks = taskInput.split('\n').map(t => t.trim()).filter(t => t);
    const skipSort = document.getElementById('skipSortCheckbox').checked;

    if (skipSort || rawTasks.length <= 1) {
        sortedTasks = rawTasks.map(name => ({ name, estimatedTime: 0, actualTime: 0 }));
        currentTaskIndex = 0;
        displaySortedTasks();
    } else {
        startMergeSort(rawTasks);
    }
});

// Step 2: Display Sorted Tasks
function displaySortedTasks() {
    document.getElementById('taskInput').classList.add('hidden');
    document.getElementById('taskCompare').classList.add('hidden');
    
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = ''; 

    const taskResult = document.createElement('div');
    taskResult.id = 'taskResult';

    const title = document.createElement('h2');
    title.textContent = 'Sorted Task List';
    taskResult.appendChild(title);

    const sortedList = document.createElement('ol');
    sortedTasks.forEach((task, idx) => {
        const li = document.createElement('li');
        if (idx < currentTaskIndex) {
            const diff = task.estimatedTime - task.actualTime;
            li.textContent = `${task.name} (Done | Est: ${task.estimatedTime}m, Act: ${task.actualTime}m, Diff: ${diff}m)`;
            li.style.color = 'gray';
            li.style.textDecoration = 'line-through';
        } else {
            li.textContent = task.name;
            if (idx === currentTaskIndex && pausedSecondsRemaining > 0) {
                li.textContent += " (In Progress - Paused)";
            }
        }
        sortedList.appendChild(li);
    });
    taskResult.appendChild(sortedList);

    if (currentTaskIndex < sortedTasks.length) {
        const getToWorkBtn = document.createElement('button');
        getToWorkBtn.textContent = pausedSecondsRemaining > 0 ? 'Resume Working' : 'Get to Work';
        getToWorkBtn.addEventListener('click', () => {
            if (pausedSecondsRemaining > 0) {
                // If returning to a paused session, reconstruct the deadline wall and skip the time setter
                const now = Math.floor(Date.now() / 1000);
                deadline = now + pausedSecondsRemaining;
                startFocusScreen();
            } else {
                startDeadlineSetting();
            }
        });
        taskResult.appendChild(getToWorkBtn);
    } else {
        const completeBtn = document.createElement('button');
        completeBtn.textContent = 'View Final Efficiency Report';
        completeBtn.addEventListener('click', () => displaySpareTime());
        taskResult.appendChild(completeBtn);
    }

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Task List (CSV)';
    downloadBtn.addEventListener('click', downloadTaskListCSV);
    taskResult.appendChild(downloadBtn);

    container.appendChild(taskResult);
}

// Step 3: Deadline Setting Page
function startDeadlineSetting() {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const deadlinePage = document.createElement('div');
    deadlinePage.id = 'deadlinePage';

    const nextTask = sortedTasks[currentTaskIndex];

    const taskName = document.createElement('h2');
    taskName.textContent = `Set a deadline for: ${nextTask.name}`;
    deadlinePage.appendChild(taskName);

    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'taskTime';
    input.placeholder = 'Enter minutes (1-60)';
    deadlinePage.appendChild(input);

    const startButton = document.createElement('button');
    startButton.textContent = 'Start Task';
    startButton.addEventListener('click', () => {
        const time = parseInt(input.value, 10);
        if (time >= 1 && time <= 60) {
            nextTask.estimatedTime = time; 
            taskStartTimestamp = Math.floor(Date.now() / 1000); 
            deadline = taskStartTimestamp + (time * 60);
            pausedSecondsRemaining = 0; // Pure initialization string
            startFocusScreen();
        } else {
            alert('Please enter a valid time between 1 and 60 minutes.');
        }
    });
    deadlinePage.appendChild(startButton);

    container.appendChild(deadlinePage);
}

// Step 4: Focus Screen (Countdown and Task Handling)
function startFocusScreen() {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const focusScreen = document.createElement('div');
    focusScreen.id = 'focusScreen';

    const currentTask = sortedTasks[currentTaskIndex];

    const taskName = document.createElement('h2');
    taskName.textContent = `Current Task: ${currentTask.name}`;
    focusScreen.appendChild(taskName);

    const timerDisplay = document.createElement('p');
    timerDisplay.id = 'timer';
    timerDisplay.style.fontSize = '24px';
    timerDisplay.style.fontWeight = 'bold';
    focusScreen.appendChild(timerDisplay);

    function updateTimer() {
        const now = Math.floor(Date.now() / 1000);
        const timeRemaining = deadline - now;

        timerDisplay.style.color = timeRemaining >= 0 ? 'green' : 'red';

        const absTime = Math.abs(timeRemaining);
        const minutes = Math.floor(absTime / 60);
        const seconds = absTime % 60;
        timerDisplay.textContent = `Time Remaining: ${timeRemaining >= 0 ? '' : '-'}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);

    const doneNext = document.createElement('button');
    doneNext.textContent = 'Done, Next!';
    doneNext.addEventListener('click', () => {
        clearInterval(timerInterval);

        const now = Math.floor(Date.now() / 1000);
        
        // Finalize total actual minutes accumulated
        const totalSecondsSpent = now - taskStartTimestamp;
        currentTask.actualTime += Math.ceil(totalSecondsSpent / 60);

        const timeDifference = deadline - now;
        spareTime += timeDifference;

        pausedSecondsRemaining = 0; // Clear the pause state completely for the next task
        currentTaskIndex++; 

        if (currentTaskIndex < sortedTasks.length) {
            startDeadlineSetting();
        } else {
            displaySpareTime();
        }
    });
    focusScreen.appendChild(doneNext);

    const addTask = document.createElement('button');
    addTask.textContent = 'Add New Task';
    addTask.addEventListener('click', () => {
        clearInterval(timerInterval);
        
        const now = Math.floor(Date.now() / 1000);
        
        // 1. Calculate and permanently lock down the time spent up to this exact split-second
        const elapsedSeconds = now - taskStartTimestamp;
        currentTask.actualTime += Math.ceil(elapsedSeconds / 60);
        
        // 2. Lock down the exact remaining time footprint left on the clock wrapper
        pausedSecondsRemaining = deadline - now;
        
        startAddTask();
    });
    focusScreen.appendChild(addTask);

    container.appendChild(focusScreen);
}

// Step 5: Display Efficiency Report
function displaySpareTime() {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const completionScreen = document.createElement('div');
    completionScreen.id = 'completionScreen';

    const title = document.createElement('h2');
    title.textContent = 'All Tasks Completed!';
    completionScreen.appendChild(title);

    const spareTimeDisplay = document.createElement('p');
    const absSpareTime = Math.abs(spareTime);
    const hours = Math.floor(absSpareTime / 3600);
    const minutes = Math.floor((absSpareTime % 3600) / 60);
    const seconds = absSpareTime % 60;
    spareTimeDisplay.textContent = `Cumulative Clock Delta: ${spareTime >= 0 ? '' : '-'}${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    spareTimeDisplay.style.color = spareTime >= 0 ? 'green' : 'red';
    completionScreen.appendChild(spareTimeDisplay);

    const breakdownTitle = document.createElement('h3');
    breakdownTitle.textContent = 'Detailed Timing Logs:';
    completionScreen.appendChild(breakdownTitle);

    const reportList = document.createElement('ul');
    sortedTasks.forEach(task => {
        const item = document.createElement('li');
        const variance = task.estimatedTime - task.actualTime;
        item.textContent = `${task.name} ➔ Est: ${task.estimatedTime}m | Act: ${task.actualTime}m | Diff: ${variance >= 0 ? '+' : ''}${variance}m`;
        reportList.appendChild(item);
    });
    completionScreen.appendChild(reportList);

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Metrics (CSV)';
    downloadBtn.addEventListener('click', downloadTaskListCSV);
    completionScreen.appendChild(downloadBtn);

    container.appendChild(completionScreen);
}

// Step 6: Add New Task Workflow
function startAddTask() {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const addTaskPage = document.createElement('div');
    addTaskPage.id = 'addTaskPage';

    const title = document.createElement('h2');
    title.textContent = 'Add New Task';
    addTaskPage.appendChild(title);

    const input = document.createElement('textarea');
    input.id = 'newTaskInput';
    input.placeholder = 'Enter your new task description...';
    addTaskPage.appendChild(input);

    const appendCheckboxContainer = document.createElement('div');
    appendCheckboxContainer.className = 'checkbox-container';
    const appendLabel = document.createElement('label');
    const appendCheckbox = document.createElement('input');
    appendCheckbox.type = 'checkbox';
    appendCheckbox.id = 'appendToEndCheckbox';
    appendLabel.appendChild(appendCheckbox);
    appendLabel.appendChild(document.createTextNode(' Push this task to the absolute end of the list'));
    appendCheckboxContainer.appendChild(appendLabel);
    addTaskPage.appendChild(appendCheckboxContainer);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save and Process Task';
    saveButton.addEventListener('click', async () => {
        const newTaskName = input.value.trim();
        if (!newTaskName) {
            alert('Please enter a valid task name.');
            return;
        }

        const newTaskObj = { name: newTaskName, estimatedTime: 0, actualTime: 0 };

        if (appendCheckbox.checked) {
            sortedTasks.push(newTaskObj);
            displaySortedTasks();
        } else {
            const completeTasks = sortedTasks.slice(0, currentTaskIndex);
            const remainingTasks = sortedTasks.slice(currentTaskIndex);

            const namesToSort = [...remainingTasks.map(t => t.name), newTaskObj.name];
            
            document.getElementById('taskCompare').classList.remove('hidden');
            const freshlySortedNames = await mergeSortInteractive(namesToSort);
            document.getElementById('taskCompare').classList.add('hidden');

            const freshlySortedObjects = freshlySortedNames.map(name => {
                const match = remainingTasks.find(t => t.name === name);
                return match ? match : (name === newTaskObj.name ? newTaskObj : { name, estimatedTime: 0, actualTime: 0 });
            });

            sortedTasks = [...completeTasks, ...freshlySortedObjects];
            displaySortedTasks();
        }
    });
    addTaskPage.appendChild(saveButton);

    container.appendChild(addTaskPage);
}

// Function to download task list as a spreadsheet CSV file
function downloadTaskListCSV() {
    let csvContent = "Task Name,Estimated Time (Min),Actual Time (Min),Difference (Min)\n";
    
    sortedTasks.forEach(task => {
        const diff = task.estimatedTime - task.actualTime;
        const sanitizedName = `"${task.name.replace(/"/g, '""')}"`;
        csvContent += `${sanitizedName},${task.estimatedTime},${task.actualTime},${diff}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'sorted_tasks_metrics.csv';
    link.click();
}

// Interactive Merge Sort Foundations
function startMergeSort(array) {
    mergeSortInteractive(array).then(sortedNames => {
        sortedTasks = sortedNames.map(name => ({ name, estimatedTime: 0, actualTime: 0 }));
        currentTaskIndex = 0;
        displaySortedTasks();
    });
}

async function mergeSortInteractive(array) {
    if (array.length <= 1) return array;

    const middle = Math.floor(array.length / 2);
    const left = await mergeSortInteractive(array.slice(0, middle));
    const right = await mergeSortInteractive(array.slice(middle));

    return mergeInteractive(left, right);
}

function mergeInteractive(left, right) {
    return new Promise(resolve => {
        const result = [];

        function compareNext() {
            if (!left.length && !right.length) {
                resolve(result);
                return;
            }
            if (!left.length) {
                result.push(...right);
                resolve(result);
                return;
            }
            if (!right.length) {
                result.push(...left);
                resolve(result);
                return;
            }

            document.getElementById('taskCompare').classList.remove('hidden');
            document.getElementById('task1').textContent = left[0];
            document.getElementById('task2').textContent = right[0];

            document.getElementById('task1').onclick = () => {
                result.push(left.shift());
                compareNext();
            };

            document.getElementById('task2').onclick = () => {
                result.push(right.shift());
                compareNext();
            };
        }

        compareNext();
    });
}
