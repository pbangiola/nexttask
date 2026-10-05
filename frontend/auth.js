'use strict';

(() => {
    const API_BASE_URL = 'https://nexttask-production.up.railway.app';
    const APP_SCRIPTS = [
        'frontend/initialization.js?v=20260929-dev-1',
        'frontend/persistence.js?v=20260929-dev-1',
        'frontend/task-graph.js?v=20261005-task-graph-1',
        'frontend/ui.js?v=20260929-dev-1',
        'frontend/core.js?v=20260929-dev-1',
        'frontend/timing.js?v=20260929-dev-1',
        'frontend/work-planner.js?v=20260929-dev-1',
        'frontend/planner.js?v=20260929-dev-1',
        'frontend/project-queue-filter.js?v=20260929-dev-1',
        'frontend/project-editor.js?v=20260929-dev-1',
        'frontend/duplicate-review.js?v=20260929-dev-1',
        'frontend/project-csv.js?v=20260929-dev-1',
        'frontend/planner-bridge.js?v=20260929-dev-1'
    ];

    const nativeFetch = window.fetch.bind(window);

    function showFatal(message) {
        document.getElementById('authLoading')?.classList.add('hidden');
        const error = document.getElementById('authError');
        if (error) {
            error.textContent = message;
            error.classList.remove('hidden');
        }
    }

    function loadScript(src, attributes = {}) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            Object.entries(attributes).forEach(([name, value]) => script.setAttribute(name, value));
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
    }

    async function loadClerk(publishableKey) {
        const encodedDomain = publishableKey.split('_')[2];
        if (!encodedDomain) throw new Error('Invalid Clerk publishable key.');
        const clerkDomain = atob(encodedDomain).slice(0, -1);

        await loadScript(`https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`, {
            crossorigin: 'anonymous'
        });
        await loadScript(`https://${clerkDomain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
            crossorigin: 'anonymous',
            'data-clerk-publishable-key': publishableKey
        });

        await window.Clerk.load({
            ui: { ClerkUI: window.__internal_ClerkUICtor }
        });
        return window.Clerk;
    }

    async function loadApplication() {
        for (const src of APP_SCRIPTS) await loadScript(src);
        if (typeof window.init === 'function') window.init();
    }

    async function boot() {
        try {
            const configResponse = await nativeFetch(`${API_BASE_URL}/api/config`);
            if (!configResponse.ok) throw new Error(`Authentication configuration failed (${configResponse.status}).`);
            const config = await configResponse.json();
            const clerk = await loadClerk(config.clerkPublishableKey);

            document.getElementById('authLoading')?.classList.add('hidden');

            if (!clerk.isSignedIn || !clerk.user?.id || !clerk.session) {
                const signIn = document.getElementById('signIn');
                signIn?.classList.remove('hidden');
                const appUrl = new URL('.', window.location.href).href;
                clerk.mountSignIn(signIn, {
                    forceRedirectUrl: appUrl,
                    signUpForceRedirectUrl: appUrl
                });
                return;
            }

            const userId = clerk.user.id;
            window.taskSorterAuth = { userId };

            // Remove anonymous-era identity/state so authenticated accounts always
            // start from their own Clerk-owned server data and browser snapshot.
            localStorage.removeItem('taskSorterUserId');
            localStorage.removeItem('taskSorterSessionId');

            const originalFetch = nativeFetch;
            window.fetch = async (input, options = {}) => {
                const url = typeof input === 'string' ? input : input?.url;
                if (!url || !url.startsWith(API_BASE_URL)) return originalFetch(input, options);

                const token = await clerk.session.getToken();
                const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
                if (token) headers.set('Authorization', `Bearer ${token}`);
                return originalFetch(input, { ...options, headers });
            };

            const account = document.getElementById('account');
            account?.classList.remove('hidden');
            const userButton = document.getElementById('userButton');
            if (userButton) clerk.mountUserButton(userButton);

            document.getElementById('taskSorterApp')?.classList.remove('hidden');
            await loadApplication();
        } catch (error) {
            console.error('Authentication bootstrap failed:', error);
            showFatal('Sign-in could not be initialized. Please reload the page.');
        }
    }

    window.addEventListener('load', boot, { once: true });
})();
