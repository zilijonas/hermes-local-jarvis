"""The #2 scenario: delegate a task, then ask a follow-up while it's in flight.
Both questions must be answered; the task must not be re-delegated; a follow-up
must never be silently dropped."""
import asyncio, json, time, sys
import websockets, httpx

WS = "ws://127.0.0.1:9140/ws"

async def main():
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
        # 1) a delegable task
        await ws.send(json.dumps({"t": "turn.text",
                                  "text": "create a file /tmp/jarvis-concurrent.txt with the text hi"}))
        await asyncio.sleep(2.0)
        # 2) a follow-up while that's still being handled — a memory/quick question
        await ws.send(json.dumps({"t": "turn.text", "text": "what time is it right now?"}))
        await asyncio.sleep(30)
        rt.cancel()

    replies = [e.get("text") for e in got if e.get("t") == "mediator.done" and e.get("text")]
    tools = [e.get("name") for e in got if e.get("t") == "meta_tool" and e.get("phase") == "start"]
    delegations = tools.count("delegate_task")
    time_answered = any(any(w in r.lower() for w in
                        ("o'clock", "a.m", "p.m", "am", "pm", "morning", "afternoon",
                         "evening", ":", "noon")) or any(ch.isdigit() for ch in r)
                        for r in replies)
    both = len(replies) >= 2
    print("replies:", [r[:70] for r in replies])
    print("tools:", tools, "| delegations:", delegations)
    print("both_answered:", both, "| time_answered:", time_answered, "| single_delegation:", delegations == 1)
    ok = both and time_answered and delegations == 1
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)

asyncio.run(main())
