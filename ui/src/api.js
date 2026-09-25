// api.js — HTTP data layer for jarvis-voice's plain-HTTP resources (tasks
// list/detail, worker backends, subscription credits, memory search).
//
// Turn-by-turn state (turns, timeline, notices, fsm, health) stays WS-driven
// in store.js — this file is the UI.useEndpoint/UI.useAction side, so those
// resources get shared caching, retry, stale/error detection and pending
// states for free instead of the plugin hand-rolling them.
//
// Cadences UNCHANGED from the pre-migration app.js: tasks/backends/credits
// are never polled (poll omitted below) — fetched on first mount (by
// whichever component subscribes first) and re-fetched on WS reconnect via
// invalidate() (see app.js's onStatus("open") handler) or a manual refresh
// action. Task-detail and memory-search are on-demand only.
import { UI } from "./hui.js";
import { API_BASE } from "./sdk.js";

export var TASKS_URL = API_BASE + "/tasks";
export var BACKENDS_URL = API_BASE + "/backends";
export var CREDITS_URL = API_BASE + "/credits";

export function taskDetailUrl(id) {
  return API_BASE + "/tasks/" + encodeURIComponent(id);
}
export function memorySearchUrl(q, k) {
  return API_BASE + "/memory/search?q=" + encodeURIComponent(q) + "&k=" + (k || 8);
}

// Same {id: task} normalisation the pre-migration app.js used (the endpoint
// may answer a bare array or {tasks:[...]}).
export function tasksFromResponse(data) {
  var list = Array.isArray(data) ? data : data && Array.isArray(data.tasks) ? data.tasks : [];
  var map = {};
  list.forEach(function (t) {
    map[t.id] = t;
  });
  return map;
}

/** GET /tasks, shared+cached. Returns the useEndpoint envelope plus `.tasks` (id->task map). */
export function useTasks() {
  var ep = UI.useEndpoint(TASKS_URL);
  return Object.assign({}, ep, { tasks: tasksFromResponse(ep.data) });
}

// Merge one live task.update WS event into the shared /tasks cache. Called
// from app.js's onEvent switch (not a hook) so every subscriber of
// useTasks() re-renders with the patched task immediately, same as the
// pre-migration store.tasks merge.
export function mergeTaskUpdate(msg) {
  var merged = null;
  UI.mutate(TASKS_URL, function (prev) {
    var map = tasksFromResponse(prev);
    map[msg.id] = merged = Object.assign({}, map[msg.id] || {}, msg, { updated_ts: Date.now() });
    return { tasks: Object.values(map) };
  });
  return merged;
}

/** POST /tasks/{id}/control {action}. Fixes the pre-migration silent
 * failure: callers get `.pending` (button loading/disabled) and `.error`
 * (toast) instead of a swallowed catch. */
export function useTaskControl() {
  return UI.useAction(
    function (id, action) {
      return UI.postJSON(taskDetailUrl(id) + "/control", { action: action }).then(function (data) {
        if (data && data.status) {
          UI.mutate(TASKS_URL, function (prev) {
            var map = tasksFromResponse(prev);
            if (map[id]) map[id] = Object.assign({}, map[id], { status: data.status, updated_ts: Date.now() });
            return { tasks: Object.values(map) };
          });
        }
        return data;
      });
    },
    {
      onError: function (err) {
        UI.toast.error("Task action failed", { detail: UI.errorMessage(err) });
      },
    }
  );
}

/** GET /tasks/{id} (event timeline + result + session), on demand only. */
export function useTaskDetail(id) {
  return UI.useEndpoint(id ? taskDetailUrl(id) : null);
}

/** GET /backends, shared+cached, mount/reconnect only (see app.js). */
export function useBackends() {
  return UI.useEndpoint(BACKENDS_URL);
}

/** POST /backends {backend}. Optimistic (same as pre-migration
 * selectBackend): the cache flips to the picked id immediately and reverts
 * on failure; the server's echoed `backend` is authoritative on success. */
export function useSelectBackend() {
  return UI.useAction(
    function (name) {
      var reverted = null;
      UI.mutate(BACKENDS_URL, function (prev) {
        reverted = prev && prev.active;
        return Object.assign({}, prev, { active: name });
      });
      return UI.postJSON(BACKENDS_URL, { backend: name }).then(
        function (data) {
          UI.mutate(BACKENDS_URL, function (prev) {
            return Object.assign({}, prev, { active: (data && data.backend) || name });
          });
          return data;
        },
        function (err) {
          UI.mutate(BACKENDS_URL, function (prev) {
            return Object.assign({}, prev, { active: reverted });
          });
          throw err;
        }
      );
    },
    {
      onError: function (err) {
        UI.toast.error("Couldn't set worker backend", { detail: UI.errorMessage(err) });
      },
    }
  );
}

/** GET /credits, shared+cached, mount/reconnect only — never polled (the
 * manual REFRESH action below is the only other trigger). */
export function useCredits() {
  return UI.useEndpoint(CREDITS_URL);
}

/** Manual credits refresh: GET /credits?refresh=true, written straight into
 * the shared cache so every gauge updates without a second round trip. */
export function useRefreshCredits() {
  return UI.useAction(
    function () {
      return UI.fetchJSON(CREDITS_URL + "?refresh=true").then(function (data) {
        UI.mutate(CREDITS_URL, data);
        return data;
      });
    },
    {
      onError: function (err) {
        UI.toast.error("Couldn't refresh credits", { detail: UI.errorMessage(err) });
      },
    }
  );
}

/** GET /memory/search?q=&k=, debounced by the caller (MemoryPanel). */
export function useMemorySearch(query, k) {
  var q = (query || "").trim();
  return UI.useEndpoint(q ? memorySearchUrl(q, k || 8) : null);
}
