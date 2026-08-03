/**
 * api.js - Database Schema & Backend Sync API
 * Handlers for users, projects, tasks, and frozen session records.
 */

const API = {
  // SQL Schema Definition for Backend Database Setup
  schemaSQL: `
    -- 1. Users
    CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255) NULL,
        first_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Projects
    CREATE TABLE IF NOT EXISTS projects (
        project_id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) REFERENCES users(user_id) ON DELETE CASCADE,
        project_name VARCHAR(255) NOT NULL,
        parent_project_id VARCHAR(64) NULL REFERENCES projects(project_id) ON DELETE SET NULL
    );

    -- 3. Master Tasks Store
    CREATE TABLE IF NOT EXISTS tasks (
        task_id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) REFERENCES users(user_id) ON DELETE CASCADE,
        project_id VARCHAR(64) NULL REFERENCES projects(project_id) ON DELETE SET NULL,
        task_title TEXT NOT NULL,
        list_position INT DEFAULT 0,
        estimated_minutes INT DEFAULT 10,
        accumulated_duration_ms BIGINT DEFAULT 0,
        is_completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP NULL
    );

    -- 4. Sessions (Frozen Summaries)
    CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) REFERENCES users(user_id) ON DELETE CASCADE,
        session_start_at TIMESTAMP NOT NULL,
        session_end_at TIMESTAMP NULL,
        time_available_minutes INT NULL,
        stop_reason_text TEXT NULL,
        hard_stop_time TIMESTAMP NULL,
        soft_stop_time TIMESTAMP NULL,
        est_time_total_minutes INT DEFAULT 0,
        actual_time_total_minutes INT DEFAULT 0,
        session_delta_minutes INT DEFAULT 0,
        tasks_count INT DEFAULT 0,
        tasks_completed_count INT DEFAULT 0,
        tasks_uncompleted_count INT DEFAULT 0,
        is_completed BOOLEAN DEFAULT FALSE
    );

    -- 5. Session Tasks Junction
    CREATE TABLE IF NOT EXISTS session_tasks (
        session_id VARCHAR(64) REFERENCES sessions(session_id) ON DELETE CASCADE,
        task_id VARCHAR(64) REFERENCES tasks(task_id) ON DELETE CASCADE,
        session_order INT NOT NULL,
        PRIMARY KEY (session_id, task_id)
    );
  `,

  /**
   * Fetch active user tasks ordered by list_position
   */
  async getTasks(userId, projectId = null) {
    const url = projectId 
      ? `/api/tasks?user_id=${userId}&project_id=${projectId}`
      : `/api/tasks?user_id=${userId}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load tasks');
    return await response.json();
  },

  /**
   * Update task order after merge sort or reordering on frontend
   * @param {Array<string>} orderedTaskIds - Array of task_id strings in sorted order
   */
  async updateTaskOrder(userId, orderedTaskIds) {
    const payload = {
      user_id: userId,
      order: orderedTaskIds.map((id, index) => ({ task_id: id, list_position: index }))
    };

    const response = await fetch('/api/tasks/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.ok;
  },

  /**
   * Push frozen session summary from frontend to backend on session end
   * @param {Object} sessionSummary - Immutable calculations computed by state.js
   */
  async saveSessionSummary(sessionSummary) {
    const response = await fetch('/api/sessions/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionSummary)
    });
    return await response.json();
  }
};

if (typeof module !== 'undefined') {
  module.exports = { API };
}
