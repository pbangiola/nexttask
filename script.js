let tasks = [];
let sortedTasks = [];
let remainingTime = 0;
let timerInterval = null;
let nextTask = null;
let deadline = Date.now();

// Step 1: Start Sorting (Input Task List and Sort)
document.getElementById('startSort').addEventListener('click', () => {
    const taskInput = document.getElementById('tasks').value.trim();
    if (taskInput) {
        tasks = taskInput.split('\n').map(task => task.trim()).filter(task => task);
        if (tasks.length > 1) {
            sortedTasks = startMergeSort(tasks); // Sort the tasks initially
            displaySortedTasks(); // Display sorted task list
        } else {
            sortedTasks = tasks;
            displaySortedTasks();
        }
    } else {
        alert('Task list cannot be empty!');
    }
});

// Step 2: Display Sorted Tasks
function displaySortedTasks() {
    document.getElementById('taskInput').classList.add('hidden');
    document.getElementById('taskCompare').classList.add('hidden');
    const taskResult = document.getElementById('taskResult');
    taskResult.classList.remove('hidden');

    const sortedList = document.getElementById('sortedTasks');
    sortedList.innerHTML = ''; // Clear the previous task list

    sortedTasks.forEach(task => {
        const li = document.createElement('li');
        li.textContent = task;
        sortedList.appendChild(li);
    });

    // Remove any existing "Get to Work" button
    const existingButton = document.querySelector('#taskResult button');
    if (existingButton) {
        existingButton.remove();
    }

    // Add "Get to Work" button at the bottom of the list
    const getToWorkBtn = document.createElement('button');
    getToWorkBtn.textContent = 'Get to Work';
    getToWorkBtn.addEventListener('click', () => {
        if (remainingTime > 0) {
            // If a task is already in progress, skip deadline setting
            startFocusScreen();
        } else {
            // Otherwise, go to deadline setting
            startDeadlineSetting();
        }
    });
    taskResult.appendChild(getToWorkBtn);

    // Add "Download Task List" button
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Task List';
    downloadBtn.addEventListener('click', downloadTaskList);
    taskResult.appendChild(downloadBtn);
}

// Step 3: Deadline Setting Page
function startDeadlineSetting() {
    document.getElementById('taskResult').classList.add('hidden');

    const deadlinePage = document.createElement('div');
    deadlinePage.id = 'deadlinePage';

    nextTask = sortedTasks[0]; // Default to the highest priority task (first task in sorted list)

    const taskName = document.createElement('h2');
    taskName.textContent = `Set a deadline for: ${nextTask}`;
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
            remainingTime = time * 60; // Set initial remaining time in seconds
            startFocusScreen(); // Start Focus Screen with the selected time
        } else {
            alert('Please enter a valid time between 1 and 60 minutes.');
        }
    });
    deadline = deadline + remainingTime
    deadlinePage.appendChild(startButton);

    document.body.appendChild(deadlinePage);
}

// Step 4: Focus Screen (Countdown and Task Handling)
function startFocusScreen() {
    const deadlinePage = document.getElementById('deadlinePage');
    deadlinePage.remove();

    const focusScreen = document.createElement('div');
    focusScreen.id = 'focusScreen';

    const taskName = document.createElement('h2');
    taskName.textContent = `Current Task: ${nextTask}`;
    focusScreen.appendChild(taskName);

    const timerDisplay = document.createElement('p');
    timerDisplay.id = 'timer';
    focusScreen.appendChild(timerDisplay);

    function updateTimer() {
        const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
        const timeRemaining = deadline - now; // Calculate the time difference

        // Set the text and color based on remaining time
        if (timeRemaining >= 0) {
            timerDisplay.style.color = 'green';
        } else {
            timerDisplay.style.color = 'red';
        }

        const absTime = Math.abs(timeRemaining);
        const minutes = Math.floor(absTime / 60);
        const seconds = absTime % 60;
        timerDisplay.textContent = `Time Remaining: ${timeRemaining >= 0 ? '' : '-'}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    updateTimer(); // Initial timer update
    timerInterval = setInterval(() => {
        updateTimer();
    }, 1000);

    const doneNext = document.createElement('button');
    doneNext.textContent = 'Done, Next!';
    doneNext.addEventListener('click', () => {
        clearInterval(timerInterval);
        remainingTime = 0; // Reset remaining time
        sortedTasks = sortedTasks.slice(1); // Remove the current task from the list
        if (sortedTasks.length > 0) {
            startDeadlineSetting();
        } else {
            alert('All tasks completed!');
            focusScreen.remove(); // Remove the focus screen
        }
    });
    focusScreen.appendChild(doneNext);

    const addTask = document.createElement('button');
    addTask.textContent = 'Add New Task';
    addTask.addEventListener('click', () => {
        clearInterval(timerInterval);
        focusScreen.remove();
        startAddTask();
    });
    focusScreen.appendChild(addTask);

    document.body.appendChild(focusScreen);
}

// Step 5: Add New Task Workflow
function startAddTask() {
    const addTaskPage = document.createElement('div');
    addTaskPage.id = 'addTaskPage';

    const title = document.createElement('h2');
    title.textContent = 'Add New Task';
    addTaskPage.appendChild(title);

    const input = document.createElement('textarea');
    input.id = 'newTaskInput';
    input.placeholder = 'Enter your new task';
    addTaskPage.appendChild(input);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save Task';
    saveButton.addEventListener('click', () => {
        const newTask = input.value.trim();
        if (newTask) {
            tasks = sortedTasks; // Update the tasks array with the current sorted tasks
            tasks.push(newTask);
            sortedTasks = startMergeSort(tasks); // Re-sort the tasks
            addTaskPage.remove(); // Remove the "Add Task" page
            displaySortedTasks(); // Redisplay the sorted tasks
        } else {
            alert('Please enter a valid task.');
        }
    });
    addTaskPage.appendChild(saveButton);

    document.body.appendChild(addTaskPage);
}

// Optimized Merge Sort
function startMergeSort(array) {
    mergeSortInteractive(array).then(sorted => {
        sortedTasks = sorted;
        displaySortedTasks(sortedTasks);
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
                document.getElementById('taskCompare').classList.add('hidden');
                compareNext();
            };

            document.getElementById('task2').onclick = () => {
                result.push(right.shift());
                document.getElementById('taskCompare').classList.add('hidden');
                compareNext();
            };
        }

        compareNext();
    });
}

// Function to download task list as a text file
function downloadTaskList() {
    const blob = new Blob([sortedTasks.join('\n')], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'sorted_tasks.txt';
    link.click();
}
