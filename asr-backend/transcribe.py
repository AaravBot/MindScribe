# transcribe.py
import asyncio
import websockets
import numpy as np
import soundfile as sf
import json
import os
import time
import openai
import traceback

print("DEBUG: transcribe.py starting...")

openai.api_key = os.getenv("OPENAI_API_KEY")
if not openai.api_key:
    print("ERROR: OPENAI_API_KEY not set in environment.")
    raise SystemExit(1)

SAMPLE_RATE = 48000
CHUNK_SECONDS = 8
BYTES_PER_SAMPLE = 2
CHUNK_SIZE_BYTES = SAMPLE_RATE * CHUNK_SECONDS * BYTES_PER_SAMPLE

PORT = 8766

buffer = bytearray()
transcript_history = []

async def transcribe_with_openai(wavpath):
    print("Transcribing", wavpath)
    try:
        with open(wavpath, "rb") as f:
            # transcription
            res = openai.Audio.transcriptions.create(file=f, model="whisper-1")
            text = res.get("text", "").strip()
            if not text:
                return "[empty transcription]"
            return text
    except Exception as e:
        print("Transcription error:", e)
        traceback.print_exc()
        return f"[ASR error: {e}]"

async def summarize_text(text):
    print("Summarizing...")
    try:
        prompt = f"Summarize the following meeting notes into (1) a 2-line summary and (2) action items as bullets:\n\n{text}"
        # Prefer gpt-4o-mini, fallback to gpt-3.5-turbo
        try:
            resp = openai.ChatCompletion.create(
                model="gpt-4o-mini",
                messages=[{"role":"user","content":prompt}],
                max_tokens=300,
                temperature=0.2
            )
            out = resp['choices'][0]['message']['content'].strip()
            return out
        except Exception as e:
            print("gpt-4o-mini failed, falling back to gpt-3.5-turbo:", e)
            resp = openai.ChatCompletion.create(
                model="gpt-3.5-turbo",
                messages=[{"role":"user","content":prompt}],
                max_tokens=300,
                temperature=0.2
            )
            out = resp['choices'][0]['message']['content'].strip()
            return out
    except Exception as e:
        print("Summarization error:", e)
        traceback.print_exc()
        return f"[Summary error: {e}]"

async def handle(websocket, path):
    """
    websocket: connected websocket object from the forwarder
    path: unused (websockets server provides it)
    This handler:
      - receives binary Int16 PCM frames from forwarder
      - buffers into fixed-size chunks (CHUNK_SECONDS)
      - writes WAV, calls OpenAI to transcribe, sends JSON back
    """
    global buffer, transcript_history
    client_addr = websocket.remote_address if hasattr(websocket, "remote_address") else "local"
    print(f"[DEBUG] New client connected: {client_addr} path={path}")
    try:
        async for message in websocket:
            # message may be bytes (binary PCM) or text (control JSON)
            try:
                if isinstance(message, bytes):
                    # Append binary PCM bytes to buffer
                    buffer.extend(message)
                    print(f"[DEBUG] Received binary frame len={len(message)} buffer_len={len(buffer)}")
                    # Create WAVs for full chunks and process
                    while len(buffer) >= CHUNK_SIZE_BYTES:
                        chunk = buffer[:CHUNK_SIZE_BYTES]
                        buffer = buffer[CHUNK_SIZE_BYTES:]
                        fname = f"chunk_{int(time.time())}.wav"
                        try:
                            arr = np.frombuffer(chunk, dtype=np.int16)
                            sf.write(fname, arr.astype('int16'), SAMPLE_RATE, subtype='PCM_16')
                            print("[DEBUG] Saved", fname)
                        except Exception as e:
                            print("[ERROR] writing WAV:", e)
                            traceback.print_exc()
                            continue

                        # Transcribe (await)
                        text = await transcribe_with_openai(fname)
                        ts = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())
                        transcript_history.append({"t": ts, "text": text})

                        # send transcript back as JSON string
                        payload = json.dumps({"type":"transcript", "text": f"[{ts}] {text}"})
                        try:
                            await websocket.send(payload)
                            print("[DEBUG] Sent transcript payload (len {})".format(len(payload)))
                        except Exception as e:
                            print("[ERROR] sending transcript to client:", e)
                            traceback.print_exc()

                        # every 3 chunks generate a summary from last 6 entries (if available)
                        if len(transcript_history) % 3 == 0:
                            try:
                                last_texts = "\n".join([x["text"] for x in transcript_history[-6:]])
                                summary = await summarize_text(last_texts)
                                summary_payload = json.dumps({"type":"summary", "summary": summary})
                                await websocket.send(summary_payload)
                                print("[DEBUG] Sent summary payload")
                            except Exception as e:
                                print("[ERROR] summarization/send failed:", e)
                                traceback.print_exc()

                        # cleanup wav
                        try:
                            os.remove(fname)
                        except Exception:
                            pass

                else:
                    # If it's a text message, print it (we don't expect control messages currently)
                    try:
                        txt = message.decode() if isinstance(message, (bytes, bytearray)) else str(message)
                    except:
                        txt = str(message)
                    print("[DEBUG] Received text message from client:", txt)
            except Exception as inner:
                print("[ERROR] inner handler loop error:", inner)
                traceback.print_exc()
    except websockets.exceptions.ConnectionClosed as e:
        print(f"[DEBUG] ConnectionClosed: {e.code} - {e.reason}")
    except Exception as e:
        print("[ERROR] handler crashed:", e)
        traceback.print_exc()
    finally:
        print("[DEBUG] Client disconnected")

async def _handler_compat(*args):
    """
    Compatibility wrapper for different websockets versions.
    Some websockets versions call handler(websocket, path)
    and some call handler(connection) — accept both.
    """
    try:
        if len(args) == 1:
            websocket = args[0]
            path = None
        else:
            websocket, path = args[0], args[1]
        await handle(websocket, path)
    except Exception as e:
        print("[ERROR] in _handler_compat:", e)
        import traceback; traceback.print_exc()

async def main():
    print(f"Starting websockets server on 0.0.0.0:{PORT}")
    # Use the compatibility wrapper when starting the server
    async with websockets.serve(_handler_compat, "0.0.0.0", PORT):
        print(f"Python ASR server listening on ws://0.0.0.0:{PORT}")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print("Fatal error in main:", e)
        traceback.print_exc()
