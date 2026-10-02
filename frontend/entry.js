'use strict';

(() => {
    const API_BASE_URL = 'https://nexttask-production.up.railway.app';
    const CORE_SCRIPTS = [
        'frontend/initialization.js?v=20261002-guest-1',
        'frontend/persistence.js?v=20261002-guest-1',
        'frontend/ui.js?v=20261002-guest-1',
        'frontend/core.js?v=20261002-guest-1',
        'frontend/timing.js?v=20261002-guest-1'
    ];
    const AUTH_ONLY_SCRIPTS = [
        'frontend/work-planner.js?v=20261002-guest-1',
        'frontend/planner.js?v=20261002-guest-1',
        'frontend/project-queue-filter.js?v=20261002-guest-1',
        'frontend/project-editor.js?v=20261002-guest-1',
        'frontend/duplicate-review.js?v=20261002-guest-1',
        'frontend/project-csv.js?v=20261002-guest-1',
        'frontend/planner-bridge.js?v=20261002-guest-1'
    ];

    const nativeFetch = window.fetch.bind(window);

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

    async function loadCore() {
        for (const src of CORE_SCRIPTS) await loadScript(src);
    }

    async function loadClerk(publishableKey) {
        const encodedDomain = publishableKey.split('_')[2];
        if (!encodedDomain) throw new Error('Invalid Clerk publishable key.');
        const clerkDomain = atob(encodedDomain).slice(0, -1);
        await loadScript(`https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`, { crossorigin: 'anonymous' });
        await loadScript(`https://${clerkDomain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
            crossorigin: 'anonymous',
            'data-clerk-publishable-key': publishableKey
        });
        await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
        return window.Clerk;
    }

    async function openSignIn() {
        const authShell = document.getElementById('authShell');
        const loading = document.getElementById('authLoading');
        const error = document.getElementById('authError');
        const signIn = document.getElementById('signIn');
        authShell?.classList.remove('hidden');
        loading?.classList.remove('hidden');
        error?.classList.add('hidden');
        signIn?.classList.add('hidden');

        try {
            const configResponse = await nativeFetch(`${API_BASE_URL}/api/config`);
            if (!configResponse.ok) throw new Error(`Authentication configuration failed (${configResponse.status}).`);
            const config = await configResponse.json();
            const clerk = await loadClerk(config.clerkPublishableKey);
            loading?.classList.add('hidden');

            if (!clerk.isSignedIn || !clerk.user?.id || !clerk.session) {
                signIn?.classList.remove('hidden');
                const appUrl = new URL('.', window.location.href).href;
                clerk.mountSignIn(signIn, { forceRedirectUrl: appUrl, signUpForceRedirectUrl: appUrl });
                return;
            }
            window.location.reload();
        } catch (e) {
            console.error(e);
            loading?.classList.add('hidden');
            if (error) {
                error.textContent = 'Sign-in could not be initialized. Please try again.';
                error.classList.remove('hidden');
            }
        }
    }

    async function detectExistingSignIn() {
        // Authentication is deliberately lazy for guests: this is the only
        // startup network request, and no task/project data is sent unless signed in.
        try {
            const configResponse = await nativeFetch(`${API_BASE_URL}/api/config`);
            if (!configResponse.ok) return false;
            const config = await configResponse.json();
            const clerk = await loadClerk(config.clerkPublishableKey);
            if (!clerk.isSignedIn || !clerk.user?.id || !clerk.session) return false;

            window.taskSorterAuth = { userId: clerk.user.id };
            window.taskSorterMode = 'authenticated';
            window.fetch = async (input, options = {}) => {
                const url = typeof input === 'string' ? input : input?.url;
                if (!url || !url.startsWith(API_BASE_URL)) return nativeFetch(input, options);
                const token = await clerk.session.getToken();
                const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
                if (token) headers.set('Authorization', `Bearer ${token}`);
                return nativeFetch(input, { ...options, headers });
            };
            document.getElementById('signInBtn')?.classList.add('hidden');
            const account = document.getElementById('account');
            account?.classList.remove('hidden');
            const userButton = document.getElementById('userButton');
            if (userButton) clerk.mountUserButton(userButton);
            return true;
        } catch (e) {
            console.warn('Continuing in local guest mode:', e);
            return false;
        }
    }

    async function boot() {
        document.getElementById('signInBtn')?.addEventListener('click', openSignIn);
        window.taskSorterMode = 'guest';
        const authenticated = await detectExistingSignIn();
        await loadCore();
        if (authenticated) {
            for (const src of AUTH_ONLY_SCRIPTS) await loadScript(src);
        }
    }

    window.addEventListener('load', boot, { once: true });
})();