//helper, ux, and utility functions outside core functionality
//ux functions

//reset button
function showStartOverBtn() {
    document.getElementById('startOverBtn')?.classList.remove('hidden');
}

function hideStartOverBtn() {
    document.getElementById('startOverBtn')?.classList.add('hidden');
}

// Shows a three-option overlay: restart just the current step, restart the
// whole session, or cancel and return to whatever was on screen.
function showStartOverPrompt() {
    if (document.getElementById('startOverModal')) return; // already open

    const overlay = document.createElement('div');
    overlay.id = 'startOverModal';
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
        <div class="modal-box">
            <p class="modal-title">What would you like to do?</p>
            <button id="restartStepBtn" class="modal-btn">Restart This Step</button>
            <button id="restartAllBtn" class="modal-btn">Restart From the Beginning</button>
            <button id="cancelModalBtn" class="modal-btn modal-btn-cancel">Cancel</button>
        </div>
    `;

    document.body.appendChild(overlay);

    // Attach click handlers
    document.getElementById('restartStepBtn').addEventListener('click', () => {
        overlay.remove();
        restartCurrentScreen();
    });

    document.getElementById('restartAllBtn').addEventListener('click', async () => {
        overlay.remove();
        await clearSession();
        window.location.reload();
    });

    document.getElementById('cancelModalBtn').addEventListener('click', () => {
        overlay.remove();
    });
}
