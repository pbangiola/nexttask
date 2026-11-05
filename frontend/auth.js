'use strict';

(() => {
    const API_BASE_URL = window.location.hostname !== 'pbangiola.github.io'
        ? window.location.origin
        : 'https://nexttask-production.up.railway.app';
    const APP_SCRIPTS = [
        'frontend/initialization.js?v=20261104-plan-5',
        'frontend/task-entry.js?v=20261104-plan-5',
        'frontend/guest-graph.js?v=20261104-plan-5',
        'frontend/task-graph.js?v=20261104-plan-5',
        'frontend/task-graph-timing.js?v=20261104-plan-5',
        'frontend/persistence.js?v=20261104-plan-5',
        'frontend/ui.js?v=20261104-plan-5',
        'frontend/core.js?v=20261104-plan-5',
        'frontend/timing.js?v=20261104-plan-5',
        'frontend/project-queue.js?v=20261104-plan-5',
        'frontend/focus-durability.js?v=20261104-plan-5',
        'frontend/work-planner.js?v=20261104-plan-5',
        'frontend/planner.js?v=20261104-plan-5',
        'frontend/project-queue-filter.js?v=20261104-plan-5',
        'frontend/project-editor.js?v=20261104-plan-5',
        'frontend/duplicate-review.js?v=20261104-plan-5',
        'frontend/project-csv.js?v=20261104-plan-5',
        'frontend/planner-bridge.js?v=20261104-plan-5',
        'frontend/beta-insights.js?v=20261104-plan-5',
        'frontend/plan-domain.js?v=20261104-plan-5',
        'frontend/plan.js?v=20261104-plan-5',
        'frontend/agenda-scheduler.js?v=20261104-plan-5',
        'frontend/agenda.js?v=20261104-plan-5',
        'frontend/navigation.js?v=20261104-plan-5'
    ];

    const nativeFetch = window.fetch.bind(window);

    function showFatal(message) {
        document.getElementById('getStartedScreen')?.classList.remove('hidden');
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

    let clerkLoading = null;
    function loadClerk(publishableKey) {
        if (!clerkLoading) clerkLoading = initializeClerk(publishableKey).catch(error => { clerkLoading = null; throw error; });
        return clerkLoading;
    }
    async function initializeClerk(publishableKey) {
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
        if (typeof window.init === 'function') await window.init();
        if(window.taskSorterMode==='authenticated' && window.FocusDurability.ready){
            clearSessionTiming();
            window.AppNavigation.go('home',{},true);
            history.replaceState({route:{screen:'home'}},'',location.pathname+location.search);
            await window.AppNavigation?.restore();
            showModeSelect();
        } else await window.AppNavigation?.restore();
    }

    let applicationStarted = false;
    async function guest() {
        document.getElementById('welcomeScreen')?.classList.add('hidden');
        document.getElementById('getStartedScreen')?.classList.add('hidden');
        if (applicationStarted) {document.getElementById('taskSorterApp')?.classList.remove('hidden');return;}
        applicationStarted = true;
        window.taskSorterMode = 'guest';
        window.taskSorterAuth = null;
        window.fetch = (input, options) => {
            const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
            if (url.origin === API_BASE_URL && url.pathname.startsWith('/api/') && !['/api/config','/api/health'].includes(url.pathname)) return Promise.reject(new Error('Guest private requests are disabled.'));
            return nativeFetch(input, options);
        };
        await loadApplication();
        document.getElementById('planBtn').disabled = true;
        document.getElementById('agendaBtn').classList.add('hidden');document.getElementById('calendarBtn').classList.add('hidden');
        document.getElementById('planBtn').title = 'Sign in for saved nested projects. Guest lists stay local.';
        document.getElementById('taskSorterApp').classList.remove('hidden');
        document.getElementById('authLoading')?.classList.add('hidden');
        document.getElementById('guestNotice')?.classList.remove('hidden');
        const signIn=document.createElement('button');signIn.textContent='Sign In';signIn.onclick=()=>document.getElementById('signInBtn').click();document.getElementById('sessionMenu')?.append(signIn);
        document.getElementById('taskSorterApp')?.prepend(document.getElementById('guestNotice'));
    }
    async function boot() {
        document.getElementById('guestEntryBtn').onclick = async()=>{await guest();window.AppNavigation.go('entry');showTaskInput();};
        document.getElementById('getStartedBtn').onclick=()=>{history.pushState({onboarding:'started'},'', '#get-started');showOnboarding();};
        function showOnboarding(){
            document.body.classList.toggle('signing-in',location.hash==='#sign-in');
            if(location.hash!=='#sign-in')document.getElementById('signIn')?.classList.add('hidden');
            const started=['#get-started','#sign-in'].includes(location.hash),welcome=!location.hash;
            if(applicationStarted){document.getElementById('getStartedScreen').classList.toggle('hidden',!started);document.getElementById('welcomeScreen').classList.toggle('hidden',!welcome);document.getElementById('taskSorterApp').classList.toggle('hidden',started||welcome);return;}
            document.getElementById('welcomeScreen').classList.toggle('hidden',started);document.getElementById('getStartedScreen').classList.toggle('hidden',!started);
        }
        window.addEventListener('popstate',showOnboarding);showOnboarding();
        document.getElementById('signInBtn').onclick = async () => {
            document.getElementById('authError')?.classList.add('hidden');
            if(location.hash!=='#sign-in')history.pushState({onboarding:'sign-in'},'', '#sign-in');showOnboarding();
            if (window.Clerk?.isSignedIn) { window.location.reload(); return; }
            try {
                const response = await nativeFetch(`${API_BASE_URL}/api/config`);
                if(!response.ok) throw new Error('Sign-in is unavailable.');
                const config=await response.json();
                if(location.hash!=='#sign-in')return;
                const clerk=await loadClerk(config.clerkPublishableKey);
                if(location.hash!=='#sign-in')return;
                if(clerk.isSignedIn){window.location.reload();return;}
                const target=document.getElementById('signIn');target.classList.remove('hidden');
                clerk.mountSignIn(target,{forceRedirectUrl:window.location.href,signUpForceRedirectUrl:window.location.href});
            } catch(_) { if(location.hash==='#sign-in')showFatal('Sign-in is unavailable. You can keep using your local guest list.'); }
        };
        const fallback = setTimeout(() => document.getElementById('authLoading')?.classList.add('hidden'),1500);
        try {
            const configResponse = await nativeFetch(`${API_BASE_URL}/api/config`);
            if (!configResponse.ok) throw new Error(`Authentication configuration failed (${configResponse.status}).`);
            const config = await configResponse.json();
            if (config.localDemo) {
                clearTimeout(fallback); applicationStarted=true;document.body.classList.remove('signing-in');window.taskSorterMode='authenticated';window.taskSorterAuth={userId:'local_demo'};
                document.getElementById('guestEntryBtn')?.classList.add('hidden');document.getElementById('signInBtn')?.classList.add('hidden');
                await loadApplication();document.getElementById('welcomeScreen')?.classList.add('hidden');document.getElementById('getStartedScreen')?.classList.add('hidden');document.getElementById('taskSorterApp').classList.remove('hidden');document.getElementById('authLoading')?.classList.add('hidden');return;
            }
            const clerk = await loadClerk(config.clerkPublishableKey);

            document.getElementById('authLoading')?.classList.add('hidden');

            if (!clerk.isSignedIn || !clerk.user?.id || !clerk.session) {
                const signIn = document.getElementById('signIn');
                clearTimeout(fallback);if(location.hash==='#sign-in')await document.getElementById('signInBtn').onclick();else if(location.hash.startsWith('#app/'))await guest();return;
            }
            if (applicationStarted) return;
            clearTimeout(fallback); applicationStarted = true;
            document.body.classList.remove('signing-in');window.taskSorterMode = 'authenticated';
            document.getElementById('guestEntryBtn')?.classList.add('hidden');
            document.getElementById('signInBtn')?.classList.add('hidden');

            const userId = clerk.user.id;
            window.taskSorterAuth = { userId };
            const authenticatedSession = clerk.session;
            const abort = new AbortController();
            const sameAccount = () => clerk.user?.id === userId && clerk.session?.id === authenticatedSession.id;
            clerk.addListener(() => {
                if (sameAccount()) return;
                window.taskSorterAuth = null;
                window.FocusAlarm?.stop();
                if (window.focusNormalTitle != null) { document.title = window.focusNormalTitle; window.focusNormalTitle = null; }
                abort.abort();
                window.TaskGraph?.invalidate();
                clearInterval(typeof timerInterval === 'undefined' ? null : timerInterval);
                clearInterval(typeof hardStopInterval === 'undefined' ? null : hardStopInterval);
                document.getElementById('taskSorterApp')?.classList.add('hidden');
                showFatal('Account changed. Reload to continue with this account.');
            });

            // Remove anonymous-era identity/state so authenticated accounts always
            // start from their own Clerk-owned server data and browser snapshot.
            localStorage.removeItem('taskSorterUserId');
            localStorage.removeItem('taskSorterSessionId');

            const originalFetch = nativeFetch;
            window.fetch = async (input, options = {}) => {
                const url = typeof input === 'string' ? input : input?.url;
                if (!url || new URL(url, window.location.href).origin !== API_BASE_URL || !new URL(url, window.location.href).pathname.startsWith('/api/')) return originalFetch(input, options);

                if (!sameAccount()) throw new Error('Account changed. Reload to continue.');
                const token = await authenticatedSession.getToken();
                if (!sameAccount() || !token) throw new Error('Authenticated account is unavailable.');
                const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
                if (token) headers.set('Authorization', `Bearer ${token}`);
                const response = await originalFetch(input, { ...options, headers, signal: abort.signal });
                if (!sameAccount()) throw new Error('Account changed. Reload to continue.');
                return response;
            };

            const account = document.getElementById('account');
            account?.classList.remove('hidden');
            const userButton = document.getElementById('userButton');
            if (userButton) clerk.mountUserButton(userButton);

            await loadApplication();
            if (!sameAccount()) throw new Error('Account changed. Reload to continue.');
            document.getElementById('welcomeScreen')?.classList.add('hidden');document.getElementById('getStartedScreen')?.classList.add('hidden');
            document.getElementById('taskSorterApp')?.classList.remove('hidden');
        } catch (error) {
            clearTimeout(fallback);
            if (!applicationStarted){document.getElementById('authLoading')?.classList.add('hidden');if(location.hash.startsWith('#app/'))await guest();}
            else if(window.taskSorterMode==='authenticated') showFatal('Sign-in could not be initialized. Reload to retry.');
        }
    }

    window.addEventListener('load', boot, { once: true });
})();
