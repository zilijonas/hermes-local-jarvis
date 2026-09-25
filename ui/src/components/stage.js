// components/stage.js — the center stage: per-turn latency waterfall,
// intelligence-core canvas with state caption + live meta-tool chip,
// conversation log (role gutters, live partial with caret, streamed reply
// via the library's StreamText), and the composer (mic toggle + level meter
// + text entry + interrupt + mode toggle). Every dynamic element is driven
// by real server events (see app.js onEvent) — chrome comes from
// window.HermesUI; the canvas/audio pipeline stay untouched (see
// visualizer/*, audio-in.js, audio-out.js).
import { UI } from "../hui.js";
import { useStore } from "../store.js";
import { stateMeta, stateAccent, CORE_STATES } from "../visualizer/states.js";

var html = UI.html;

export function derivedState(s) {
  return s.connection === "open" ? s.fsmState : "offline";
}

var PULSING = { listening: 1, speaking: 1, thinking: 1, tool: 1, worker_progress: 1 };

// ---- turn strip (per-turn waterfall) ---------------------------------------

var WF_STAGES = [
  ["STT", "stt"],
  ["MED", "mediator_first_token"],
  ["TTS", "tts_first_chunk"],
];

function waterfallSegments(turnLatency) {
  var segs = [];
  var sum = 0;
  WF_STAGES.forEach(function (st) {
    var ms = turnLatency[st[1]];
    if (typeof ms === "number") {
      segs.push({ label: st[0] + " " + Math.round(ms) + "ms", value: ms, tone: st[1] === "mediator_first_token" ? "accent" : "neutral" });
      sum += ms;
    }
  });
  var e2e = turnLatency.e2e_first_audio;
  if (typeof e2e === "number" && e2e - sum > 0 && segs.length) {
    segs.push({ label: "PLAY " + Math.round(e2e - sum) + "ms", value: e2e - sum, tone: "neutral" });
  }
  return segs;
}

export function TurnStrip(props) {
  var s = useStore(props.store);
  var segs = waterfallSegments(s.turnLatency || {});
  var e2e = (s.turnLatency || {}).e2e_first_audio;
  var e2eLabel = typeof e2e === "number" ? UI.format.duration(e2e)
    : s.latency.e2e_first_audio && s.latency.e2e_first_audio.p50 != null ? UI.format.duration(s.latency.e2e_first_audio.p50)
    : "—";
  var wide = s.w >= 1280; // per-segment labels vs a single e2e figure

  return html`
    <${UI.Row} align="center" gap="md" style=${{ padding: "10px 20px", borderBottom: "1px solid var(--hui-line)", flex: "none" }}>
      <span className="hui-t-micro" style=${{ whiteSpace: "nowrap" }}>${"TURN " + (s.turnId != null ? "#" + s.turnId : "—")}</span>
      <div style=${{ flex: 1, minWidth: 0 }}>
        <${UI.SegmentBar} segments=${segs.length ? segs : [{ label: "idle", value: 1, tone: "neutral" }]} legend=${wide} label="Turn latency waterfall" />
      </div>
      ${!wide ? html`<span className="hui-t-num hui-t-faint" style=${{ whiteSpace: "nowrap" }}>${"e2e " + e2eLabel}</span>` : null}
    <//>`;
}

// ---- canvas stage -----------------------------------------------------------

export function StateCaption(props) {
  var s = props.s;
  var ui = derivedState(s);
  var meta = stateMeta(ui);
  var accent = stateAccent(ui);
  var hint = s.fsmDetail && s.connection === "open" ? meta.hint + " · " + s.fsmDetail : meta.hint;
  return html`
    <div style=${{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, pointerEvents: "none" }} aria-live="polite">
      <${UI.Row} align="center" gap="sm">
        <span className=${PULSING[ui] && !s.reducedMotion ? "hui-dot hui-dot--pulse" : "hui-dot"}
          style=${{ background: accent, boxShadow: "0 0 10px 2px " + accent.replace("rgb(", "rgba(").replace(")", ",.4)") }} aria-hidden="true" />
        <span className="hui-t-title" style=${{ color: accent, textShadow: "0 0 18px " + accent.replace("rgb(", "rgba(").replace(")", ",.33)") }}>
          ${meta.label}
        </span>
      <//>
      <div className=${props.mobile ? "hui-t-sub" : "hui-t-sub"} style=${{ textAlign: props.mobile ? "center" : "left" }}>${hint}</div>
    </div>`;
}

export function ToolChip(props) {
  var s = props.s;
  if (!s.toolChip) return null;
  return html`
    <${UI.Row} align="center" gap="sm" style=${{
      marginTop: 3, padding: "5px 11px", borderRadius: 6, border: "1px solid var(--hui-line-strong)",
      background: "var(--hui-surface-2)", pointerEvents: "none",
    }}>
      <${UI.Icon} name="settings" size=${12} className="hui-t-accent" />
      <span className="hui-t-mono">${s.toolChip.name}</span>
      <span style=${{ width: 1, height: 11, background: "var(--hui-line-strong)" }} />
      <span className="hui-t-num hui-t-accent"><${UI.RelTime} at=${s.toolChip.start} granularity=${1000} /></span>
    <//>`;
}

function CanvasStage(props) {
  var store = props.store;
  var refs = props.refs;
  var s = useStore(store);
  var ui = derivedState(s);
  var coreMode = (CORE_STATES[ui] || CORE_STATES.idle).mode.toUpperCase();

  return html`
    <div style=${{ flex: "1.05 1 0%", minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <canvas ref=${refs.canvasRef} aria-hidden="true" style=${{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      <div style=${{ position: "absolute", left: 0, right: 0, bottom: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 7, pointerEvents: "none" }}>
        <${StateCaption} s=${s} />
        <${ToolChip} s=${s} />
      </div>
      <div style=${{ position: "absolute", left: 20, top: 16, display: "flex", flexDirection: "column", gap: 5, pointerEvents: "none" }}>
        <div className="hui-t-micro">INTELLIGENCE CORE</div>
        <div className="hui-t-micro">${(s.reducedMotion ? "STATIC · " : "LATTICE · ") + coreMode}</div>
      </div>
    </div>`;
}

// ---- conversation log --------------------------------------------------------

function roleLabel(role) {
  return role === "user" ? "YOU" : role === "jarvis" ? "JARVIS" : "SYSTEM";
}

export function TurnRow(props) {
  var t = props.turn;
  return html`
    <div style=${{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr)", gap: 14, alignItems: "start" }}>
      <div style=${{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 2 }}>
        <span className=${"hui-t-micro" + (t.role === "user" ? " hui-t-accent" : "")}>${roleLabel(t.role)}</span>
        <span className="hui-t-mono hui-t-micro">${t.time}</span>
      </div>
      <div style=${{ minWidth: 0 }}>
        ${t.role === "system"
          ? html`<div className=${"hui-t-mono" + (t.tone === "red" ? " hui-t-danger" : " hui-t-micro")}>${t.text}</div>`
          : t.role === "jarvis"
            ? html`<div className=${t.dim ? "hui-t-faint" : "hui-t-body"} style=${{ fontSize: 16, lineHeight: 1.55 }}><${UI.Markdown}>${t.text}<//></div>`
            : html`<div className=${t.dim ? "hui-t-faint" : "hui-t-body"} style=${{ fontSize: 16, lineHeight: 1.55 }}>${t.text}</div>`}
        ${t.meta && t.meta.length
          ? html`<${UI.Row} gap="sm" style=${{ marginTop: 6 }}>${t.meta.map(function (mi, i) { return html`<${UI.Tag} key=${"m" + i} size="sm">${mi}<//>`; })}<//>`
          : null}
      </div>
    </div>`;
}

export function ConversationLog(props) {
  var store = props.store;
  var refs = props.refs;
  var s = useStore(store);

  UI.useEffect(function () {
    var el = refs.logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.turns.length, s.mediatorText, s.sttPartial]);

  var turns = s.turns.slice(-14);
  var empty = turns.length === 0 && !s.sttPartial && !s.mediatorText;

  return html`
    <div ref=${refs.logRef} role="log" aria-label="Conversation"
      style=${{ flex: 1, minHeight: 132, overflowY: "auto", padding: "4px 22px 12px", display: "flex", flexDirection: "column", gap: 14, borderTop: "1px solid var(--hui-line)" }}>
      ${empty
        ? html`<${UI.EmptyState} compact icon="message" title="No turns yet" hint="Say something, or type a message below." />`
        : null}
      <${UI.AnimatedList} items=${turns} getKey=${function (t) { return t.id; }}>
        ${function (t) { return html`<${TurnRow} turn=${t} />`; }}
      <//>
      ${s.sttPartial
        ? html`
          <div style=${{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr)", gap: 14, alignItems: "start" }} aria-live="polite">
            <span className="hui-t-micro hui-t-accent">YOU</span>
            <div className="hui-t-faint" style=${{ fontSize: 16, fontStyle: "italic" }}>${s.sttPartial}</div>
          </div>`
        : null}
      ${s.mediatorText
        ? html`
          <div style=${{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr)", gap: 14, alignItems: "start" }} aria-live="polite">
            <span className="hui-t-micro">JARVIS</span>
            <div className="hui-t-body" style=${{ fontSize: 16, lineHeight: 1.55 }}>
              <${UI.StreamText} text=${s.mediatorText} streaming=${s.ttsPlaying} speed=${40} />
            </div>
          </div>`
        : null}
    </div>`;
}

// ---- composer -----------------------------------------------------------------

export function FullscreenButton(props) {
  return html`
    <${UI.IconButton}
      icon=${props.active ? "minimize" : "maximize"}
      label="Toggle fullscreen"
      variant=${props.active ? "secondary" : "ghost"}
      size=${props.mobile ? "md" : "sm"}
      title=${props.pseudo ? "Pseudo-fullscreen (Fullscreen API unavailable on this browser)" : "Toggle fullscreen"}
      onClick=${props.onClick} />`;
}

export function MicButton(props) {
  var s = props.s;
  var act = props.act;
  var refs = props.refs;
  var mobile = props.mobile;
  var size = mobile ? 64 : 52;
  return html`
    <div style=${{ position: "relative", flex: "none", width: size, height: size }}>
      <div ref=${mobile ? refs.micRingMobileRef : refs.micRingRef} aria-hidden="true"
        style=${{ position: "absolute", inset: -6, borderRadius: "999px", border: "1px solid var(--hui-accent)", opacity: 0, transform: "scale(.9)", pointerEvents: "none" }} />
      <button type="button" onClick=${act.onMicClick} aria-label=${s.micActive ? "Stop microphone" : "Start microphone"} aria-pressed=${s.micActive}
        style=${{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "999px",
          cursor: "pointer", border: "1px solid " + (s.micActive ? "var(--hui-accent)" : "var(--hui-line-strong)"),
          background: s.micActive
            ? "radial-gradient(circle at 50% 35%, var(--hui-accent-ground-strong), var(--hui-surface))"
            : "radial-gradient(circle at 50% 35%, var(--hui-surface-2), var(--hui-surface))",
          color: s.micActive ? "var(--hui-text)" : "var(--hui-text-dim)",
        }}>
        <${UI.Icon} name="mic" size=${mobile ? 24 : 19} />
      </button>
    </div>`;
}

export function MicBanner(props) {
  var store = props.store;
  var s = props.s;
  if (!s.micError && !s.micHint) return null;
  return html`
    <${UI.Banner} tone=${s.micError ? "danger" : "warn"} variant="inline" dismissible
      onDismiss=${function () { store.set({ micError: null, micHint: null }); }}>
      ${s.micError || s.micHint}
    <//>`;
}

export function Composer(props) {
  var store = props.store;
  var act = props.act;
  var refs = props.refs;
  var s = useStore(store);
  var pair = UI.useState("");
  var draft = pair[0];
  var setDraft = pair[1];
  var speaking = s.fsmState === "speaking" && s.connection === "open";

  function send() {
    var text = draft.trim();
    if (!text) return;
    act.submitText(text);
    setDraft("");
  }

  return html`
    <div style=${{ flex: "none", padding: "12px 22px 16px", borderTop: "1px solid var(--hui-line)" }}>
      <${UI.Row} align="end" gap="md" wrap=${false}>
        <${MicButton} s=${s} act=${act} refs=${refs} />
        <div style=${{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
          <${UI.Row} align="end" gap="sm" wrap=${false}>
            <div style=${{ flex: 1, minWidth: 0 }}>
              <${UI.Textarea}
                value=${draft}
                onChange=${setDraft}
                minRows=${1}
                maxRows=${4}
                placeholder="Type to Jarvis, or hold Space to talk…"
                onKeyDown=${function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            </div>
            <${UI.Button} variant="primary" onClick=${send}>Send<//>
            <${UI.Button} variant="secondary" disabled=${!speaking} onClick=${act.interrupt}>Interrupt<//>
          <//>
          <${UI.Row} align="center" gap="md" wrap=${false}>
            <${UI.Segmented}
              options=${[{ value: "ptt", label: "Push to talk" }, { value: "vad", label: "VAD (experimental)" }]}
              value=${s.micMode}
              onChange=${act.setMicMode} />
            <div style=${{ flex: 1, height: 3, borderRadius: 2, background: "var(--hui-line)", overflow: "hidden" }}>
              <div ref=${refs.levelRef} style=${{ height: "100%", width: "0%", borderRadius: 2, background: "var(--hui-accent)" }} />
            </div>
            ${s.w > 1100
              ? html`<span className="hui-t-mono hui-t-micro" style=${{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  SPACE hold · ESC interrupt · 1·2·3 panels · <${UI.Kbd} combo="mod+k" /> focus
                </span>`
              : null}
          <//>
          <${MicBanner} store=${store} s=${s} />
          <${UI.Presence} show=${!!s.noSpeechHint} variant="fade">
            <div className="hui-t-faint" style=${{ fontStyle: "italic" }} role="status" aria-live="polite">${s.noSpeechHint}</div>
          <//>
        </div>
      <//>
    </div>`;
}

// ---- stage assembly ------------------------------------------------------------

export function Stage(props) {
  return html`
    <div style=${{ minHeight: 0, display: "flex", flexDirection: "column", position: "relative", minWidth: 0 }}>
      <${TurnStrip} store=${props.store} />
      <${CanvasStage} store=${props.store} refs=${props.refs} />
      <${ConversationLog} store=${props.store} refs=${props.refs} />
      <${Composer} store=${props.store} act=${props.act} refs=${props.refs} />
    </div>`;
}
