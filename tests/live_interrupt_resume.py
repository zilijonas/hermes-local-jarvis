"""Two scenarios:
  A) barge-in WHILE THINKING (no reply yet) → resume answering same message.
  B) barge-in AFTER the reply was produced (during speaking) → go idle, no resume.
"""
import asyncio, json, time, sys
import websockets, httpx

WS = "ws://127.0.0.1:9140/ws"

async def run_scenario(prompt, barge_delay, watch_secs):
    httpx.post("http://127.0.0.1:9140/converse", json={"reset": True}, timeout=10)
    got = []
    async with websockets.connect(WS) as ws:
        async def reader():
            try:
                while True:
                    m = await ws.recv()
                    if not isinstance(m, (bytes, bytearray)):
                        got.append(json.loads(m))
            except Exception:
                pass
        rt = asyncio.create_task(reader())
        await ws.send(json.dumps({"t": "turn.text", "text": prompt}))
        await asyncio.sleep(barge_delay)
        await ws.send(json.dumps({"t": "barge_in"}))
        await asyncio.sleep(watch_secs)
        rt.cancel()
    return got

async def main():
    # A: interrupt at 0.6s (mid-thinking, before first token typically) → resume
    a = await run_scenario("tell me one interesting fact about octopuses", 0.6, 22)
    a_states = [e.get("value") for e in a if e.get("t") == "state"]
    a_resumed = any(e.get("detail") == "resuming your last message" for e in a)
    a_reply = [e.get("text") for e in a if e.get("t") == "mediator.done" and e.get("text")]
    a_ok = a_resumed and any(len(r) > 20 for r in a_reply)
    print("A states:", a_states)
    print("A resumed:", a_resumed, "| final reply:", (a_reply[-1][:90] if a_reply else None))
    print("A:", "PASS" if a_ok else "FAIL")

    # B: let it fully answer, then interrupt during speaking → should NOT resume, → idle
    b = await run_scenario("say the single word acknowledged", 5.0, 8)
    b_resumed = any(e.get("detail") == "resuming your last message" for e in b)
    b_states = [e.get("value") for e in b if e.get("t") == "state"]
    b_ok = (not b_resumed) and ("idle" in b_states)
    print("B states:", b_states)
    print("B resumed(should be False):", b_resumed)
    print("B:", "PASS" if b_ok else "FAIL")

    print("RESULT:", "PASS" if (a_ok and b_ok) else "FAIL")
    sys.exit(0 if (a_ok and b_ok) else 1)

asyncio.run(main())
