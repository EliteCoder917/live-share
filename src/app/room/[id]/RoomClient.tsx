"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase-browser";

// A host device runs the agent (host/agent.mjs), which serves real browser
// windows. This client lists those windows, renders the live frames of the one
// you pick, and forwards your mouse/keyboard back to the host so you actually
// drive that browser. Multiple clients can each control a different window.

interface Win {
  id: string;
  title: string;
  url: string;
}
interface Presence {
  id: string;
  role: string;
  viewing: string | null;
}

const FRAME_W = 1024; // host viewport; client maps coords against the live image
const FRAME_H = 640;

export function RoomClient({
  sessionId,
  isHost,
  selfId,
}: {
  sessionId: string;
  isHost: boolean;
  selfId: string;
}) {
  const supabase = useMemo(() => getBrowserSupabase(), []);

  const [windows, setWindows] = useState<Win[]>([]);
  const [participants, setParticipants] = useState<Presence[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [agentOnline, setAgentOnline] = useState(false);
  const [addr, setAddr] = useState("");
  const [showHostHelp, setShowHostHelp] = useState(isHost);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const selectedRef = useRef<string | null>(null);
  const lastMoveRef = useRef(0);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // --- messaging helpers -----------------------------------------------------
  function send(kind: string, extra: Record<string, unknown> = {}) {
    channelRef.current?.send({
      type: "broadcast",
      event: "msg",
      payload: { kind, ...extra },
    });
  }
  function sendInput(p: Record<string, unknown>) {
    if (!selectedRef.current) return;
    channelRef.current?.send({
      type: "broadcast",
      event: "input",
      payload: { ...p, windowId: selectedRef.current },
    });
  }
  function setViewing(windowId: string | null) {
    channelRef.current?.track({
      id: selfId,
      role: isHost ? "host" : "viewer",
      viewing: windowId,
    });
  }

  // --- channel wiring --------------------------------------------------------
  useEffect(() => {
    const channel = supabase.channel(`room:${sessionId}`, {
      config: { broadcast: { self: false }, presence: { key: selfId } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Presence>();
      const people = Object.values(state).flat() as unknown as Presence[];
      setParticipants(people);
      setAgentOnline(people.some((p) => p.role === "agent"));
    });

    channel.on("broadcast", { event: "msg" }, ({ payload }) => {
      if (payload.kind === "windows") {
        setWindows(payload.windows as Win[]);
        setAgentOnline(true);
      }
    });

    // Frames bypass React state and write straight to the <img> for smoothness.
    channel.on("broadcast", { event: "frame" }, ({ payload }) => {
      if (payload.windowId === selectedRef.current && imgRef.current) {
        imgRef.current.src = `data:image/jpeg;base64,${payload.data}`;
      }
    });

    channel.subscribe(async (state) => {
      if (state === "SUBSCRIBED") {
        await channel.track({
          id: selfId,
          role: isHost ? "host" : "viewer",
          viewing: null,
        });
        send("list");
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selfId, isHost]);

  // --- window selection ------------------------------------------------------
  function openWindow(id: string) {
    setSelected(id);
    setViewing(id);
    const w = windows.find((x) => x.id === id);
    setAddr(w?.url ?? "");
    if (imgRef.current) imgRef.current.src = "";
  }
  function backToList() {
    setSelected(null);
    setViewing(null);
    if (imgRef.current) imgRef.current.src = "";
  }

  // --- input mapping ---------------------------------------------------------
  function toPageCoords(e: React.MouseEvent) {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const w = img.naturalWidth || FRAME_W;
    const h = img.naturalHeight || FRAME_H;
    return { x: Math.round(nx * w), y: Math.round(ny * h) };
  }

  const selectedWin = windows.find((w) => w.id === selected) || null;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
      {/* --- main control surface --- */}
      <div className="card p-0">
        {selected ? (
          <>
            <div className="flex items-center gap-2 border-b border-neutral-800 p-3">
              <button
                onClick={() => sendInput({ type: "back" })}
                className="btn-ghost px-2 py-1"
                title="Back"
              >
                ←
              </button>
              <button
                onClick={() => sendInput({ type: "forward" })}
                className="btn-ghost px-2 py-1"
                title="Forward"
              >
                →
              </button>
              <button
                onClick={() => sendInput({ type: "reload" })}
                className="btn-ghost px-2 py-1"
                title="Reload"
              >
                ⟳
              </button>
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendInput({ type: "navigate", url: addr });
                }}
              >
                <input
                  className="input py-1"
                  value={addr}
                  onChange={(e) => setAddr(e.target.value)}
                  placeholder="Type a URL and press Enter"
                />
              </form>
              <button onClick={backToList} className="btn-ghost px-3 py-1">
                Windows
              </button>
            </div>

            {/* The live browser frame. Focusable so it can capture keys. */}
            <div
              className="relative aspect-[1024/640] w-full bg-black outline-none"
              tabIndex={0}
              onMouseMove={(e) => {
                const now = Date.now();
                if (now - lastMoveRef.current < 40) return; // ~25fps of moves
                lastMoveRef.current = now;
                sendInput({ type: "move", ...toPageCoords(e) });
              }}
              onMouseDown={(e) =>
                sendInput({ type: "down", button: e.button, ...toPageCoords(e) })
              }
              onMouseUp={(e) => sendInput({ type: "up", button: e.button })}
              onWheel={(e) =>
                sendInput({ type: "wheel", deltaX: e.deltaX, deltaY: e.deltaY })
              }
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                // Let browser shortcuts for the page itself through sparingly;
                // forward everything to the remote window.
                e.preventDefault();
                sendInput({
                  type: "key",
                  key: e.key,
                  text: e.key.length === 1 ? e.key : undefined,
                  ctrl: e.ctrlKey,
                  meta: e.metaKey,
                  shift: e.shiftKey,
                });
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                alt={selectedWin?.title ?? "remote window"}
                className="h-full w-full select-none object-contain"
                draggable={false}
              />
              <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-neutral-300">
                Click the frame, then type — your input drives this window.
              </p>
            </div>
          </>
        ) : (
          <div className="flex aspect-[1024/640] flex-col items-center justify-center p-8 text-center text-neutral-400">
            {agentOnline ? (
              windows.length ? (
                <p>Select a window from the right to start controlling it.</p>
              ) : (
                <p>The host server is online but has no windows open yet.</p>
              )
            ) : (
              <p>
                Waiting for the host&apos;s browser server to come online…
              </p>
            )}
          </div>
        )}
      </div>

      {/* --- sidebar --- */}
      <aside className="space-y-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-300">
              Browser windows
            </h3>
            <span
              className={`h-2 w-2 rounded-full ${
                agentOnline ? "bg-green-400" : "bg-neutral-600"
              }`}
              title={agentOnline ? "Host server online" : "Host server offline"}
            />
          </div>

          <ul className="mt-3 space-y-2">
            {windows.map((w) => (
              <li key={w.id}>
                <button
                  onClick={() => openWindow(w.id)}
                  className={`w-full truncate rounded-lg border px-3 py-2 text-left text-sm ${
                    selected === w.id
                      ? "border-brand bg-brand/10 text-white"
                      : "border-neutral-800 text-neutral-300 hover:bg-neutral-800"
                  }`}
                  title={w.url}
                >
                  <span className="block truncate font-medium">
                    {w.title || "Untitled"}
                  </span>
                  <span className="block truncate text-xs text-neutral-500">
                    {w.url}
                  </span>
                </button>
              </li>
            ))}
            {windows.length === 0 && (
              <li className="text-xs text-neutral-500">No windows yet.</li>
            )}
          </ul>

          {agentOnline && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => send("open-window", {})}
                className="btn-primary flex-1"
              >
                + New window
              </button>
              {selected && (
                <button
                  onClick={() => {
                    send("close-window", { windowId: selected });
                    backToList();
                  }}
                  className="btn-ghost text-red-400"
                >
                  Close
                </button>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-neutral-300">
            People ({participants.filter((p) => p.role !== "agent").length})
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {participants
              .filter((p) => p.role !== "agent")
              .map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-400" />
                  <span className="truncate">
                    {p.id === selfId ? "You" : p.id.slice(0, 12)}
                  </span>
                  {p.viewing && (
                    <span className="ml-auto text-xs text-neutral-500">
                      {p.viewing}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>

        {isHost && (
          <div className="card">
            <button
              onClick={() => setShowHostHelp((s) => !s)}
              className="flex w-full items-center justify-between text-sm font-semibold text-neutral-300"
            >
              Host server setup
              <span className="text-neutral-500">{showHostHelp ? "−" : "+"}</span>
            </button>
            {showHostHelp && (
              <div className="mt-3 space-y-2 text-xs text-neutral-400">
                <p>Run the agent on your device to serve the browser windows:</p>
                <pre className="overflow-x-auto rounded-lg bg-neutral-950 p-3 text-[11px] text-neutral-300">
{`cd host
npm install
SESSION_ID=${sessionId} npm start`}
                </pre>
                <p>
                  Optional: <code>WINDOWS=3</code>{" "}
                  <code>START_URL=https://example.com</code>
                </p>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
