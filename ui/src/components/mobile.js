// components/mobile.js — <860px single-column shell: header, intelligence
// core, active-task chip, conversation, thumb-reach composer (64px mic), and
// Tasks / Memory / Activity / Backend as library bottom sheets (drag handle,
// snap points, flick-to-close all come from window.HermesUI's Drawer/Sheet).
import { UI } from "../hui.js";
import { useStore } from "../store.js";
import { statusMeta, workerMeta, visibleTasks, countActionableTasks } from "./util.js";
import { StateCaption, ToolChip, MicButton, MicBanner, FullscreenButton, TurnRow, derivedState } from "./stage.js";
import { TaskCardMobile, ActivityRows } from "./work.js";
import { MemorySheetContent } from "./memory.js";
import { BackendChipMobile, BackendSheetContent } from "./backend.js";
import { NoticeRows, NoticeDot, noticeSummary } from "./notices.js";
import { useTasks } from "../api.js";

var html = UI.html;

function ActiveTaskChip(props) {
  var s = props.s;
  var tasks = visibleTasks(props.tasks, s.dismissedTasks);
  var t = tasks.filter(function (x) { return x.status === "running"; })[0] || tasks.filter(function (x) { return x.status === "needs_review"; })[0];
  if (!t) return null;
  var status = statusMeta(t.status);
  var worker = workerMeta(t.kind);
  return html`
    <${UI.Card} padding="sm" style=${{ margin: "2px 12px 0" }}>
      <${UI.Row} justify="between" align="center">
        <${UI.Badge} tone=${status.tone}>${status.label}<//>
        <${UI.Badge} tone=${worker.tone} variant="outline" size="sm">${worker.label}<//>
      <//>
      <div className="hui-t-body" style=${{ marginTop: 6, fontWeight: 600 }}>${t.title || t.goal || t.id}</div>
      ${t.progress_note || t.result_summary ? html`<div className="hui-t-sub" style=${{ marginTop: 5 }}>${t.progress_note || t.result_summary}<//>` : null}
    <//>`;
}

function MobileConversation(props) {
  var s = props.s;
  var refs = props.refs;
  UI.useEffect(function () {
    var el = refs.logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.turns.length, s.mediatorText, s.sttPartial]);

  var turns = s.turns.slice(-10);
  var empty = turns.length === 0 && !s.sttPartial && !s.mediatorText;

  return html`
    <div ref=${refs.logRef} role="log" aria-label="Conversation"
      style=${{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
      ${empty ? html`<${UI.EmptyState} compact icon="message" title="No turns yet" hint="Say something, or type below." />` : null}
      ${turns.map(function (t) { return html`<${TurnRow} key=${t.id} turn=${t} />`; })}
      ${s.sttPartial
        ? html`
          <div aria-live="polite">
            <span className="hui-t-micro hui-t-accent">YOU</span>
            <div className="hui-t-faint" style=${{ marginTop: 4, fontSize: 15, fontStyle: "italic" }}>${s.sttPartial}</div>
          </div>`
        : null}
      ${s.mediatorText
        ? html`
          <div aria-live="polite">
            <span className="hui-t-micro">JARVIS</span>
            <div className="hui-t-body" style=${{ marginTop: 4, fontSize: 15 }}><${UI.StreamText} text=${s.mediatorText} streaming=${s.ttsPlaying} /></div>
          </div>`
        : null}
    </div>`;
}

function SheetBody(props) {
  var s = props.s;
  var act = props.act;
  var store = props.store;
  var tasks = visibleTasks(props.tasks, s.dismissedTasks);
  if (s.sheet === "tasks") {
    return html`
      <${UI.Stack} gap="sm">
        <${NoticeRows} s=${s} act=${act} mobile />
        ${tasks.length === 0 && !noticeSummary(s).count
          ? html`<${UI.EmptyState} compact title="No tasks yet" />`
          : tasks.map(function (t) { return html`<${TaskCardMobile} key=${t.id} task=${t} act=${act} />`; })}
      <//>`;
  }
  if (s.sheet === "backend") return html`<${BackendSheetContent} act=${act} />`;
  if (s.sheet === "memory") return html`<${MemorySheetContent} store=${store} />`;
  if (s.sheet === "activity") {
    return s.timeline.length === 0
      ? html`<${UI.EmptyState} compact title="Nothing yet this session" />`
      : html`<${ActivityRows} items=${s.timeline} verbose=${false} />`;
  }
  return null;
}

var SHEET_TITLE = { tasks: "Tasks & notifications", memory: "Memory", backend: "Worker backend", activity: "Activity" };

export function MobileShell(props) {
  var store = props.store;
  var act = props.act;
  var refs = props.refs;
  var s = useStore(store);
  var tasksEp = useTasks();
  var pair = UI.useState("");
  var draft = pair[0];
  var setDraft = pair[1];
  var speaking = s.fsmState === "speaking" && s.connection === "open";
  var notices = noticeSummary(s);

  function send() {
    var text = draft.trim();
    if (!text) return;
    act.submitText(text);
    setDraft("");
  }
  function closeSheet() {
    store.set({ sheet: null });
  }

  var sheetTabs = [
    { id: "tasks", label: "Tasks", count: countActionableTasks(tasksEp.tasks, s.dismissedTasks), tone: notices.tone },
    { id: "memory", label: "Memory", count: (s.memoryHits || []).length },
    { id: "activity", label: "Activity", count: s.timeline.length },
  ];

  return html`
    <div style=${{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", paddingTop: "var(--jv-fs-top-clear, 0px)" }}>
      <${UI.Row} align="center" gap="sm" style=${{ padding: "14px 16px 10px", flex: "none" }}>
        <span className="hui-dot hui-dot--accent" aria-hidden="true" />
        <span className="hui-t-title">JARVIS</span>
        <div style=${{ flex: 1 }} />
        <${BackendChipMobile} act=${act} attention=${!!notices.tone} onClick=${function () { store.set({ sheet: "backend" }); }} />
        <${FullscreenButton} active=${s.fullscreen || s.pseudoFullscreen} pseudo=${s.pseudoFullscreen} onClick=${act.toggleFullscreen} mobile />
        <${UI.StatusDot} tone=${s.connection === "open" ? "accent" : s.connection === "closed" ? "danger" : "warn"} pulse=${s.connection !== "open"} label=${"Connection: " + s.connection} />
      <//>
      <div style=${{ flex: "0 1 214px", minHeight: 118, position: "relative" }}>
        <canvas ref=${refs.canvasRef} aria-hidden="true" style=${{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      </div>
      <div style=${{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "2px 16px 8px", pointerEvents: "none" }}>
        <${StateCaption} s=${s} mobile />
        <${ToolChip} s=${s} />
      <//>
      <${ActiveTaskChip} s=${s} tasks=${tasksEp.tasks} />
      <${MobileConversation} s=${s} refs=${refs} />
      <div style=${{ flex: "none", padding: "8px 12px calc(12px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--hui-line)" }}>
        <${UI.Row} gap="sm" wrap=${false}>
          ${sheetTabs.map(function (t) {
            return html`
              <${UI.Button} key=${t.id} variant="secondary" size="md" block onClick=${function () { store.set({ sheet: t.id }); }}>
                ${t.tone ? html`<${NoticeDot} tone=${t.tone} />` : null} ${t.label}${t.count ? " " + t.count : ""}
              <//>`;
          })}
        <//>
        <${UI.Row} align="end" gap="sm" style=${{ marginTop: 10 }} wrap=${false}>
          <div style=${{ flex: 1, minWidth: 0 }}>
            <${UI.Textarea} value=${draft} onChange=${setDraft} minRows=${1} maxRows=${3} placeholder="Message Jarvis…"
              onKeyDown=${function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          </div>
          <${UI.Button} variant="secondary" disabled=${!speaking} onClick=${act.interrupt}>Stop<//>
          <${MicButton} s=${s} act=${act} refs=${refs} mobile />
        <//>
        <${MicBanner} store=${store} s=${s} />
        <${UI.Presence} show=${!!s.noSpeechHint} variant="fade">
          <div className="hui-t-faint" style=${{ fontStyle: "italic", marginTop: 6 }} role="status" aria-live="polite">${s.noSpeechHint}</div>
        <//>
      </div>
      <${UI.Sheet} open=${!!s.sheet} onClose=${closeSheet} title=${SHEET_TITLE[s.sheet] || ""} snapPoints=${[0.62, 0.92]}>
        <${SheetBody} s=${s} act=${act} store=${store} tasks=${tasksEp.tasks} />
      <//>
    </div>`;
}

export { derivedState };
