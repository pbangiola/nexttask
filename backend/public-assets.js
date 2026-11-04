const path = require('node:path');

// Enumerate the intended browser surface; do not mount the checkout, backend,
// or even the entire frontend directory (which can contain local data files).
const scripts = [
    'agenda', 'agenda-scheduler', 'navigation', 'plan-domain', 'plan', 'auth', 'initialization', 'persistence', 'ui', 'core', 'timing',
    'work-planner', 'planner', 'project-queue-filter', 'project-editor',
    'duplicate-review', 'project-csv', 'planner-bridge', 'deadline-audio',
    'project-queue', 'task-entry', 'guest-graph', 'beta-insights', 'task-graph', 'task-graph-timing', 'focus-durability'
];

module.exports = function publicAssets(app) {
    const root = path.resolve(__dirname, '..');
    const files = new Map([
        ['/', 'index.html'],
        ['/index.html', 'index.html'],
        ['/learn-more.html', 'learn-more.html'],
        ['/frontend/design.css', 'frontend/design.css'],
        ['/frontend/plan.css', 'frontend/plan.css'],
        ...['task-landscape','illustrative-day','pairwise-sorting'].map(name=>[`/frontend/diagrams/${name}.svg`,`frontend/diagrams/${name}.svg`]),
        ...scripts.map(name => [`/frontend/${name}.js`, `frontend/${name}.js`])
    ]);
    for (const [url, file] of files) {
        app.get(url, (req, res, next) => {
            res.sendFile(path.join(root, file), { dotfiles: 'deny' }, error => {
                if (error) next(error);
            });
        });
    }
};
