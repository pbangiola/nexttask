const path = require('node:path');

// Enumerate the intended browser surface; do not mount the checkout, backend,
// or even the entire frontend directory (which can contain local data files).
const scripts = [
    'auth', 'initialization', 'persistence', 'ui', 'core', 'timing',
    'work-planner', 'planner', 'project-queue-filter', 'project-editor',
    'duplicate-review', 'project-csv', 'planner-bridge', 'deadline-audio',
    'task-graph', 'task-graph-timing', 'focus-durability'
];

module.exports = function publicAssets(app) {
    const root = path.resolve(__dirname, '..');
    const files = new Map([
        ['/', 'index.html'],
        ['/index.html', 'index.html'],
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
