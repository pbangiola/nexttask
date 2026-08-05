// Final-screen session lifecycle behavior.
// Starting a new session must preserve the completed session in Railway.
(function initializeSessionActions() {
    const FINAL_SCREEN_ID = 'completionScreen';
    const OLD_LABEL = 'Start Over';
    const NEW_LABEL = 'Start New Session';

    function isFinalScreenStartButton(target) {
        return target instanceof HTMLButtonElement
            && target.closest(`#${FINAL_SCREEN_ID}`)
            && [OLD_LABEL, NEW_LABEL].includes(target.textContent.trim());
    }

    function renameFinalScreenButton(root = document) {
        const completionScreen = root.id === FINAL_SCREEN_ID
            ? root
            : root.querySelector?.(`#${FINAL_SCREEN_ID}`);

        if (!completionScreen) return;

        const button = Array.from(completionScreen.querySelectorAll('button'))
            .find(candidate => [OLD_LABEL, NEW_LABEL].includes(candidate.textContent.trim()));

        if (button) {
            button.textContent = NEW_LABEL;
            button.title = 'Preserve this session and begin a new one';
        }
    }

    function createFreshSessionId() {
        const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2, 11);

        return `session_${randomPart}`;
    }

    function startNewSession() {
        // Do not call clearSession() or DELETE the old server session.
        const newSessionId = createFreshSessionId();
        localStorage.setItem('taskSorterSessionId', newSessionId);
        localStorage.removeItem('taskSorterSession_fallback');
        window.location.reload();
    }

    // Capture phase runs before the legacy button listener. This prevents the
    // old clearSession() handler from deleting the completed Railway session.
    document.addEventListener('click', event => {
        if (!isFinalScreenStartButton(event.target)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        startNewSession();
    }, true);

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node instanceof Element) renameFinalScreenButton(node);
            }
        }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    renameFinalScreenButton();
})();
