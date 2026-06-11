let sortedTasks = []; // Holds objects: { name: "Task", estimatedTime: 0, actualTime: 0 }
let currentTaskIndex = 0;
let timerInterval = null;
let deadline = 0;
let spareTime = 0; 
let taskStartTimestamp = 0; 
let pausedSecondsRemaining = 0; 

// Initializing Event Listeners
document.getElementById('csvUpload').addEventListener('change', handleCSVUpload);
document.getElementById('stopWorkingBtn').addEventListener('click', handleStopWorking);

// Step 1: Handle Initial Task Sorter Submission
document.getElementById('startSort').addEventListener('click', () => {
    const taskInput = document.getElementById('tasks').value.trim();
    if (!taskInput) {
        alert('Task list cannot be empty!');
        return;
    }

    const rawTasks = taskInput.split('\n').map(t => t.trim()).filter(t => t);
    const skipSort = document.getElementById('skipSortCheckbox').checked;

    // Hide the landing page inputs immediately upon clicking
    document.getElementById('taskInput').classList.add('hidden');

    if (skipSort || rawTasks.length <= 1) {
        sortedTasks = rawTasks.map(name => ({ name, estimatedTime: 0, actualTime: 0 }));
        currentTaskIndex = 0;
        promptForUpfrontTimings();
    } else {
        startMergeSort(rawTasks);
    }
});

// Step 1b: CSV Session Resumption
function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n').map(line => line.trim()).filter(line => line);
        
        if (lines.length <= 1) {
            alert("Invalid or empty CSV file structure.");
            return;
        }

        const parsedTasks = [];
        let runningCompletedCount = 0;

        for (let i = 1; i < lines.length; i++) {
            const matches = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$|\s*\n)/g);
            if (!matches || matches.length < 3) continue;

            const name = matches[0].replace(/^"|"$/g, '').trim();
            const estimatedTime = parseInt(matches[1], 10) || 0;
            const actualTime = parseInt(matches[2], 10) || 0;

            parsedTasks.push({ name, estimatedTime, actualTime });

            if (actualTime > 0) {
                runningCompletedCount++;
            }
        }

        if (parsedTasks.length === 0) {
            alert("No valid task data rows matched your target upload format.");
            return;
        }

        // Hide the landing page inputs on successful CSV loading
        document.getElementById('taskInput').classList.add('hidden');

        sortedTasks = parsedTasks;
        currentTaskIndex = runningCompletedCount; 
        
        displaySortedTasks();
    };
    reader.readAsText(file);
}

// Step 2a: Upfront Timings Gateway Motif
function promptForUpfrontTimings() {
    document.getElementById('taskCompare').classList.add('hidden');

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const gatewayScreen = document.createElement('div');
    
    const question = document.createElement('h2');
    question.textContent = 'Do you want to set timings now?';
    gatewayScreen.appendChild(question);

    const yesBtn = document.createElement('button');
    yesBtn.textContent = 'Yes';
    yesBtn.addEventListener('click', () => {
        runSequentialTimingInput(0);
    });
    gatewayScreen.appendChild(yesBtn);

    const noBtn = document.createElement('button');
    noBtn.textContent = 'No';
    noBtn.addEventListener('click', () => {
        displaySortedTasks();
    });
    gatewayScreen.appendChild(noBtn);

    container.appendChild(gatewayScreen);
}

// Step 2b: Sequential Timing Entry Routine
function runSequentialTimingInput(index) {
    if (index >= sortedTasks.length) {
        displaySortedTasks();
        return;
    }

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const timingScreen = document.createElement('div');
    const targetTask = sortedTasks[index];

    const title = document.createElement('h2');
    title.textContent = `Set estimate for task (${index + 1} of ${sortedTasks.length})`;
    timingScreen.appendChild(title);

    const taskLabel = document.createElement('p');
    taskLabel.innerHTML = `Task: <strong>${targetTask.name}</strong>`;
    timingScreen.appendChild(taskLabel);

    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = 'Enter minutes (1-120)';
    if (targetTask.estimatedTime > 0) input.value = targetTask.estimatedTime;
    timingScreen.appendChild(input);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = index === sortedTasks.length - 1 ? 'Finish and View List' : 'Next Task';
    
    nextBtn.addEventListener('click', () => {
        const timeVal = parseInt(input.value, 10);
        if (timeVal >= 1 && timeVal <= 120) {
            targetTask.estimatedTime = timeVal;
            runSequentialTimingInput(index + 1); 
        } else {
            alert('Please specify an estimate between 1 and 120 minutes.');
        }
    });
    timingScreen.appendChild(nextBtn);

    container.appendChild(timingScreen);
}

// Step 3: Main Dashboard Listing
function displaySortedTasks() {
    document.getElementById('taskCompare').classList.add('hidden');
    document.getElementById('stopWorkingBtn').classList.add('hidden'); // Hidden on dashboard list
    
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
            if (task.estimatedTime > 0) {
                li.textContent += ` (Estimated: ${task.estimatedTime}m)`;
            }
            if (idx === currentTaskIndex && pausedSecondsRemaining > 0) {
                li.textContent += " [Paused Session In Progress]";
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

// Step 4: Deadline Setup
function startDeadlineSetting() {
    document.getElementById('stopWorkingBtn').classList.remove('hidden'); // Show on setup flow

    const nextTask = sortedTasks[currentTaskIndex];
    
    if (nextTask.estimatedTime > 0) {
        taskStartTimestamp = Math.floor(Date.now() / 1000); 
        deadline = taskStartTimestamp + (nextTask.estimatedTime * 60);
        pausedSecondsRemaining = 0;
        startFocusScreen();
        return;
    }

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const deadlinePage = document.createElement('div');
    deadlinePage.id = 'deadlinePage';

    const taskName = document.createElement('h2');
    taskName.textContent = `Set a deadline for: ${nextTask.name}`;
    deadlinePage.appendChild(taskName);

    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'taskTime';
    input.placeholder = 'Enter minutes (1-120)';
    deadlinePage.appendChild(input);

    const startButton = document.createElement('button');
    startButton.textContent = 'Start Task';
    startButton.addEventListener('click', () => {
        const time = parseInt(input.value, 10);
        if (time >= 1 && time <= 120) {
            nextTask.estimatedTime = time; 
            taskStartTimestamp = Math.floor(Date.now() / 1000); 
            deadline = taskStartTimestamp + (time * 60);
            pausedSecondsRemaining = 0;
            startFocusScreen();
        } else {
            alert('Please enter a valid time between 1 and 120 minutes.');
        }
    });
    deadlinePage.appendChild(startButton);

    container.appendChild(deadlinePage);
}

// Step 5: Live Execution Focus Panel
function startFocusScreen() {
    document.getElementById('stopWorkingBtn').classList.remove('hidden'); // Show on active execution

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
        const totalSecondsSpent = now - taskStartTimestamp;
        currentTask.actualTime += Math.ceil(totalSecondsSpent / 60);

        const timeDifference = deadline - now;
        spareTime += timeDifference;

        pausedSecondsRemaining = 0; 
        currentTaskIndex++; 

        if (currentTaskIndex < sortedTasks.length) {
            startDeadlineSetting();
        } else {
            document.getElementById('stopWorkingBtn').classList.add('hidden');
            displaySpareTime();
        }
    });
    focusScreen.appendChild(doneNext);

    const addTask = document.createElement('button');
    addTask.textContent = 'Add New Task';
    addTask.addEventListener('click', () => {
        clearInterval(timerInterval);
        
        const now = Math.floor(Date.now() / 1000);
        const elapsedSeconds = now - taskStartTimestamp;
        currentTask.actualTime += Math.ceil(elapsedSeconds / 60);
        pausedSecondsRemaining = deadline - now;
        
        startAddTask();
    });
    focusScreen.appendChild(addTask);

    container.appendChild(focusScreen);
}

// Action Trigger for Stop Working Routine
function handleStopWorking() {
    clearInterval(timerInterval);
    
    // Process current run metrics if stopped while mid-timer
    if (document.getElementById('focusScreen') && currentTaskIndex < sortedTasks.length) {
        const now = Math.floor(Date.now() / 1000);
        sortedTasks[currentTaskIndex].actualTime += Math.ceil((now - taskStartTimestamp) / 60);
        spareTime += (deadline - now);
    }

    document.getElementById('stopWorkingBtn').classList.add('hidden');
    
    downloadRemainingTasksCSV();
    displaySpareTime();
}

// Drops completed logs, slices current + downstream components
function downloadRemainingTasksCSV() {
    let csvContent = "Task Name,Estimated Time (Min),Actual Time (Min),Difference (Min)\n";
    const remaining = sortedTasks.slice(currentTaskIndex);
    
    remaining.forEach(task => {
        const diff = task.estimatedTime - task.actualTime;
        const sanitizedName = `"${task.name.replace(/"/g, '""')}"`;
        csvContent += `${sanitizedName},${task.estimatedTime},${task.actualTime},${diff}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'remaining_tasks.csv';
    link.click();
}

// Step 6: Targeted Numerical Index Insertion Panel
function startAddTask() {
    document.getElementById('stopWorkingBtn').classList.add('hidden'); // Hidden while altering queues

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const addTaskPage = document.createElement('div');
    addTaskPage.id = 'addTaskPage';

    const title = document.createElement('h2');
    title.textContent = 'Insert New Task Into List';
    addTaskPage.appendChild(title);

    const layout = document.createElement('div');
    layout.className = 'insertion-layout';

    const leftCol = document.createElement('div');
    leftCol.className = 'insertion-column';
    const leftTitle = document.createElement('h3');
    leftTitle.textContent = 'Current Master Queue:';
    leftCol.appendChild(leftTitle);

    const listContainer = document.createElement('ol');
    listContainer.start = 1; 
    sortedTasks.forEach((task, idx) => {
        const item = document.createElement('li');
        item.innerHTML = `<strong>[Slot ${idx + 1}]</strong> ${task.name}`;
        if (idx < currentTaskIndex) {
            item.style.color = '#ccc';
            item.innerHTML += ' <em>(Done)</em>';
        } else if (idx === currentTaskIndex) {
            item.style.backgroundColor = '#fff9c4';
            item.innerHTML += ' <em>(Current Active Anchor)</em>';
        }
        listContainer.appendChild(item);
    });
    
    const terminalSlot = document.createElement('li');
    terminalSlot.style.listStyleType = 'none';
    terminalSlot.innerHTML = `<em>[Slot ${sortedTasks.length + 1}] Push to absolute bottom layout end</em>`;
    listContainer.appendChild(terminalSlot);

    leftCol.appendChild(listContainer);

    const rightCol = document.createElement('div');
    rightCol.className = 'insertion-column';
    
    const rightTitle = document.createElement('h3');
    rightTitle.textContent = 'New Task:';
    rightCol.appendChild(rightTitle);

    const input = document.createElement('textarea');
    input.id = 'newTaskInput';
    input.rows = 4;
    input.cols = 30;
    input.placeholder = 'Type task instructions here...';
    rightCol.appendChild(input);

    const label = document.createElement('p');
    label.innerHTML = `Where should this task go in the list?' (Min: ${currentTaskIndex + 1}, Max: ${sortedTasks.length + 1}):`;
    rightCol.appendChild(label);

    const slotInput = document.createElement('input');
    slotInput.type = 'number';
    slotInput.min = currentTaskIndex + 1;
    slotInput.max = sortedTasks.length + 1;
    slotInput.value = currentTaskIndex + 1; 
    rightCol.appendChild(slotInput);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save and Resume Work';
    saveButton.addEventListener('click', () => {
        const taskName = input.value.trim();
        const targetSlot = parseInt(slotInput.value, 10);

        if (!taskName) {
            alert('Please supply valid task documentation text strings.');
            return;
        }

        if (isNaN(targetSlot) || targetSlot < (currentTaskIndex + 1) || targetSlot > (sortedTasks.length + 1)) {
            alert(`Please choose a number between ${currentTaskIndex + 1} and ${sortedTasks.length + 1}.`);
            return;
        }

        const newTaskObj = { name: taskName, estimatedTime: 0, actualTime: 0 };
        const arrayInsertionIndex = targetSlot - 1; 

        sortedTasks.splice(arrayInsertionIndex, 0, newTaskObj);
        
        displaySortedTasks();
    });
    rightCol.appendChild(saveButton);

    layout.appendChild(leftCol);
    layout.appendChild(rightCol);
    addTaskPage.appendChild(layout);

    container.appendChild(addTaskPage);
}

// Cumulative Metric Engine Execution Views
function displaySpareTime() {
    document.getElementById('stopWorkingBtn').classList.add('hidden');

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const completionScreen = document.createElement('div');
    completionScreen.id = 'completionScreen';

    const title = document.createElement('h2');
    title.textContent = 'Tasks Finished / Stopped';
    completionScreen.appendChild(title);

    const spareTimeDisplay = document.createElement('p');
    const absSpareTime = Math.abs(spareTime);
    const hours = Math.floor(absSpareTime / 3600);
    const minutes = Math.floor((absSpareTime % 3600) / 60);
    const seconds = absSpareTime % 60;
    spareTimeDisplay.textContent = `Time Remaining: ${spareTime >= 0 ? '' : '-'}${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    spareTimeDisplay.style.color = spareTime >= 0 ? 'green' : 'red';
    completionScreen.appendChild(spareTimeDisplay);

    const breakdownTitle = document.createElement('h3');
    breakdownTitle.textContent = 'Detailed Timing Logs:';
    completionScreen.appendChild(breakdownTitle);

    const reportList = document.createElement('ul');
    sortedTasks.forEach(task => {
        const item = document.createElement('li');
        const variance = task.estimatedTime - task.actualTime;
        item.textContent = `${task.name} took ${task.actualTime}m | Ahead by ${variance >= 0 ? '+' : ''}${variance}m`;
        reportList.appendChild(item);
    });
    completionScreen.appendChild(reportList);

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download stats (CSV)';
    downloadBtn.addEventListener('click', downloadTaskListCSV);
    completionScreen.appendChild(downloadBtn);

    container.appendChild(completionScreen);
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
        promptForUpfrontTimings();
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
