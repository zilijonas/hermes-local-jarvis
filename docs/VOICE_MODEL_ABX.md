# Voice model bake-off — one model for mediator and worker (2026-08-30)

Jarvis ran two models: a Gemma 4 E4B mediator (fast talker, in jarvisd) and a
Granite 4.1 8B worker (Hermes sessions). The question was whether gpt-oss-20b
could replace both, and the criterion was **perceived voice UX** — the delay
between the user finishing a sentence and the first audible word — not synthetic
tokens/sec.

## Arms tested

| | mediator | worker |
|---|---|---|
| **A** (incumbent) | Gemma 4 E4B QAT (Ollama) | Granite 4.1 8B (Ollama) |
| **B** | Gemma 4 E4B QAT (Ollama) | gpt-oss-20b (router) |
| **C** (**shipped**) | gpt-oss-20b (router) | gpt-oss-20b (router) |

## Results

| measure | A — Gemma mediator | C — gpt-oss mediator |
|---|---|---|
| time to first **content** token, idle | **0.48 s** (p90 0.49) | 0.89 s (p90 1.21) |
| same, **while a worker task runs** | n/a (separate process) | **1.56 s** |
| full short reply, wall | **1.02 s** | 1.29 s |
| tool-turn latency, median | 1.26 s | **1.23 s** |
| routing contract (10 cases, 2 runs) | **5/10**, both runs | **8/10**, both runs |
| after any worker task | +6.45 s cold reload (evicted) | none — same model stays resident |
| host free memory, worker under load | 9 % (arm B) | **36–38 %** |

Time-to-first-*content*-token is the number that matters: reasoning tokens never
reach TTS, so a model that thinks for two seconds feels two seconds slower at
identical throughput.

### Gemma is the faster talker and the worse assistant

0.41 s quicker to the first spoken word, and it loses half the routing contract
in `mediator/prompt.py`. Both runs, identical failures:

- **Invented the clock time** — "It's 10:30 AM" instead of calling `time.now`.
- **Claimed a memory it never saved** — "I will remember your sister's birthday"
  with no `memory.note` call. The fact is silently lost; the user believes it was
  stored. This is the worst failure in the set because it is invisible.
- **Invented its own health** — "My system status is nominal" without calling
  `system.status`.
- Missed `delegate_task` for a coding job, and walked into the trap the prompt
  explicitly warns about: treating a `capability_search` result as started work.

gpt-oss's two misses are of a different kind — it reached for `capability_search`
where a decisive `delegate_task` was wanted. That costs a round trip. It did not
fabricate anything, and it passed the `capability_search` → `delegate_task` trap
that Gemma failed.

Verified on the shipped path afterwards: asked to remember a birthday, it wrote
`00-inbox/jarvis-note-20260830-182306.md`. Asked the time, it answered 18:22.

## Three findings that made arm C viable

**1. The JSON-line protocol silently breaks a native tool-caller.** Told to reply
with one line of JSON, gpt-oss routes the call to its own tool channel; with no
tools declared, the channel is empty and the reply comes back with **zero content
tokens** (`finish_reason: stop`, 41 completion tokens, reasoning reading "Need to
call time.now via quick_action"). Scored **3/10**. Declaring the same six
meta-tools as real function schemas: **8/10**. The prompt now ships in two
variants (`system_prompt(native=...)`) because the protocol must match the model.

**2. Tool results must come back as `role: "tool"`.** The loop fed results back as
a `system` message with the call echoed as assistant *content*. A native model
does not recognise its call as answered, so it reissues the same call until the
hop budget runs out — every tool-using turn ended in "Sorry, I lost my train of
thought there." Unit tests passed throughout; only a live turn exposed it. Fixed
by echoing `assistant.tool_calls` + a matching `role: "tool"` message.

**3. One model serving both roles serialises without more slots.** With
`--parallel 1`, a voice turn issued during a 37 s worker task waited **36.3 s** —
far worse than the eviction it replaced. `--parallel 2 --kv-unified` brings that
to **1.56 s**. `--kv-unified` is the load-bearing flag: plain `--parallel 2`
splits `--ctx-size` evenly and would cap every request at 32K, breaking the 64K
gate. Re-verified after the change: **55,902-token prompt recalled correctly in
507 s**, matching the single-slot baseline.

## Why arm B was rejected

Keeping a 3.1 GB Gemma mediator alongside the 11.7 GB worker fits, but leaves the
host at **9 % free** during a worker prefill — and 11 % free is what preceded the
2026-08-21 reboot. Arm C runs at 36–38 %. Paying 0.4 s on the first spoken word
to get ~27 points of headroom back is the right trade on a 24 GB box.

## Shipped configuration

    [ollama]                      # section name is historical; embeddings only
    mediator      = "gpt-oss-20b-mxfp4"
    mediator_url  = "http://127.0.0.1:8090"
    mediator_native = true
    worker        = "gpt-oss-20b-mxfp4"
    embed         = "nomic-embed-text"

    [worker]
    backend = "local"             # was "granite"; 81 DB rows migrated

Router: `--ctx-size 65536 --parallel 2 --kv-unified --cache-type-k/v q4_0
--flash-attn on --ubatch-size 64 --batch-size 512 --reasoning-effort low
--reasoning-format deepseek`, plus a `max_tokens` floor of 512 for reasoning
models.

**Do not set `--reasoning-budget 0`** to chase latency: it measured 8 points worse
on the tool suite (27/29 → 19/29) and was not faster. Reasoning is capability on
this model.

## Consequences

- Granite and Gemma are removed from the box (`~/.ollama/models` 11 GB → 262 MB).
  Ollama stays, serving only `nomic-embed-text` for capability search.
- No mediator/worker eviction exists any more, so the 6.5 s post-task cold reload
  and the "lost my train of thought" class it caused are gone.
- `wait_turn_clear` is kept: a worker's prefill still competes for the GPU, and
  starting one mid-utterance still makes the reply stutter.

Harnesses: `~/ai/qwen38-bench/scripts/voice_latency.py`,
`~/ai/qwen38-bench/scripts/mediator_routing.py`. Raw results in
`~/ai/qwen38-bench/raw/voice-*.json` and `raw/routing-*.json`.
