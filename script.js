let tasks = [];
let sortedTasks = [];
let remainingTime = 0;
let timerInterval = null;
let nextTask = null;
let deadline = 0;
let spareTime = 0; // Variable to track cumulative spare time

// Step 1: Start Sorting (Input Task List and Sort)
document.getElementById('startSort').addEventListener('click', () => {
    const taskInput = document.getElementById('tasks').value.trim();
    const alreadySorted = document.getElementById('alreadySorted').checked;
    
    if (taskInput) {
        tasks = taskInput.split('\n').map(task => task.trim()).filter(task => task);
        if (alreadySorted) {
            sortedTasks = tasks;
            displaySortedTasks();
        } else if (tasks.length > 1) {
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

    const addToEndCheckbox = document.createElement('label');
    addToEndCheckbox.innerHTML = '<input type="checkbox" id="addToEnd"> Add task to end of the list';
    addTaskPage.appendChild(addToEndCheckbox);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save Task';
    saveButton.addEventListener('click', () => {
        const newTask = input.value.trim();
        const addToEnd = document.getElementById('addToEnd').checked;
        if (newTask) {
            tasks = sortedTasks; // Update the tasks array with the current sorted tasks
            if (addToEnd) {
                tasks.push(newTask);
                sortedTasks = tasks;
            } else {
                tasks.push(newTask);
                sortedTasks = startMergeSort(tasks); // Re-sort the tasks
            }
            addTaskPage.remove(); // Remove the "Add Task" page
            displaySortedTasks(); // Redisplay the sorted tasks
        } else {
            alert('Please enter a valid task.');
        }
    });
    addTaskPage.appendChild(saveButton);

    document.body.appendChild(addTaskPage);
}
