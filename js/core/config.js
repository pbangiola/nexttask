// Application-wide configuration values.
//
// During the incremental refactor, existing code may continue using its
// current constants until each feature is migrated to this shared namespace.

window.TaskSorterConfig = Object.freeze({
    MAX_TASK_MINUTES: 30
});
