let tasks = [];
let sortedTasks = [];
let remainingTime = 0;
let timerInterval = null;
let nextTask = null;
let deadline = 0;
let spareTime = 0; // Variable to track cumulative spare time
let user = null; // Track the signed-in user

// Google Sign-In Initialization
async function handleAuth(isSignIn) {
    if (isSignIn) {
        try {
            const response = await fetch("https://nexttask-7rj8.onrender.com/auth/google", {
                credentials: "include",
            });
            if (response.ok) {
                user = await response.json();
                document.getElementById("userInfo").textContent = `Signed in as ${user.name}`;
                document.getElementById("userInfo").classList.remove("hidden");
                document.getElementById("googleSignOut").classList.remove("hidden");
                document.getElementById("googleSignIn").classList.add("hidden");
                document.getElementById("taskInput").classList.remove("hidden"); // Show task section
            }
        } catch (error) {
            console.error("Sign-in failed:", error);
        }
    } else {
        await fetch("https://nexttask-7rj8.onrender.com/logout", { credentials: "include" });
        user = null;
        document.getElementById("userInfo").classList.add("hidden");
        document.getElementById("googleSignOut").classList.add("hidden");
        document.getElementById("googleSignIn").classList.remove("hidden");
        document.getElementById("taskInput").classList.add("hidden"); // Hide task section
    }
}

// Attach event listeners to sign-in and sign-out buttons
document.getElementById("googleSignIn").addEventListener("click", () => handleAuth(true));
document.getElementById("googleSignOut").addEventListener("click", () => handleAuth(false));

// Step 1: Start Sorting (Input Task List and Sort)
document.getElementById("startSort").addEventListener("click", () => {
    const taskInput = document.getElementById("tasks").value.trim();
    if (taskInput) {
        tasks = taskInput.split("\n").map(task => task.trim()).filter(task => task);
        if (tasks.length > 1) {
            sortedTasks = startMergeSort(tasks);
            displaySortedTasks();
        } else {
            sortedTasks = tasks;
            displaySortedTasks();
        }
    } else {
        alert("Task list cannot be empty!");
    }
});

// Step 2: Display Sorted Tasks
function displaySortedTasks() {
    document.getElementById("taskInput").classList.add("hidden");
    document.getElementById("taskCompare").classList.add("hidden");
    const taskResult = document.getElementById("taskResult");
    taskResult.classList.remove("hidden");

    const sortedList = document.getElementById("sortedTasks");
    sortedList.innerHTML = "";

    sortedTasks.forEach(task => {
        const li = document.createElement("li");
        li.textContent = task;
        sortedList.appendChild(li);
    });

    const existingButton = document.querySelector("#taskResult button");
    if (existingButton) {
        existingButton.remove();
    }

    const getToWorkBtn = document.createElement("button");
    getToWorkBtn.textContent = "Get to Work";
    getToWorkBtn.addEventListener("click", () => {
        if (remainingTime != 0) {
            startFocusScreen();
        } else {
            startDeadlineSetting();
        }
    });
    taskResult.appendChild(getToWorkBtn);
}

// Optimized Merge Sort
function startMergeSort(array) {
    mergeSortInteractive(array).then(sorted => {
        sortedTasks = sorted;
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

            document.getElementById("taskCompare").classList.remove("hidden");
            document.getElementById("task1").textContent = left[0];
            document.getElementById("task2").textContent = right[0];

            document.getElementById("task1").onclick = () => {
                result.push(left.shift());
                document.getElementById("taskCompare").classList.add("hidden");
                compareNext();
            };

            document.getElementById("task2").onclick = () => {
                result.push(right.shift());
                document.getElementById("taskCompare").classList.add("hidden");
                compareNext();
            };
        }

        compareNext();
    });
}

// Ensure session is checked on page load
window.onload = async () => {
    try {
        const response = await fetch("https://nexttask-7rj8.onrender.com/auth/session", {
            credentials: "include",
        });
        if (response.ok) {
            user = await response.json();
            document.getElementById("userInfo").textContent = `Signed in as ${user.name}`;
            document.getElementById("userInfo").classList.remove("hidden");
            document.getElementById("googleSignOut").classList.remove("hidden");
            document.getElementById("googleSignIn").classList.add("hidden");
            document.getElementById("taskInput").classList.remove("hidden");
        }
    } catch (error) {
        console.log("No active session found.");
    }
};
