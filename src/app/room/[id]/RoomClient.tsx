"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/types";

// One host streams their screen/browser tab to many viewers. Signaling
// (offer / answer / ICE) is relayed through a Supabase Realtime broadcast
// channel; the media itself flows peer-to-peer over WebRTC.

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

interface Presence {
  id: string;
  isHost: boolean;
}

type Signal =
  | { kind: "viewer-join"; from: string }
  | { kind: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; from: string; to: string; candidate: RTCIceCandidateInit };

export function RoomClient({
  sessionId,
  serviceType,
  isHost,
  selfId,
}: {
  sessionId: string;
  serviceType: ServiceType;
  isHost: boolean;
  selfId: string;
}) {
  const [participants, setParticipants] = useState<Presence[]>([]);
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState("Connecting…");

  const videoRef = useRef<HTMLVideoElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // Host: one peer connection per viewer. Viewer: a single connection (key "host").
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  const supabase = useMemo(() => getBrowserSupabase(), []);

  // --- Signaling helpers -----------------------------------------------------
  function send(signal: Signal) {
    channelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload: signal,
    });
  }

  function newPeer(remoteId: string, onTrack?: (s: MediaStream) => void) {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({
          kind: "ice",
          from: selfId,
          to: remoteId,
          candidate: e.candidate.toJSON(),
        });
      }
    };
    if (onTrack) {
      pc.ontrack = (e) => onTrack(e.streams[0]);
    }
    peersRef.current.set(remoteId, pc);
    return pc;
  }

  // --- Host: start / stop sharing -------------------------------------------
  async function startSharing() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      localStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setSharing(true);
      setStatus("Sharing — viewers can now connect.");

      // Stop sharing if the user ends it via the browser UI.
      stream.getVideoTracks()[0]?.addEventListener("ended", stopSharing);

      // Announce so any already-present viewers (re)connect.
      send({ kind: "viewer-join", from: selfId });
    } catch {
      setStatus("Screen share was cancelled or blocked.");
    }
  }

  function stopSharing() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    if (videoRef.current) videoRef.current.srcObject = null;
    setSharing(false);
    setStatus("Stopped sharing.");
  }

  // --- Wire up the channel ---------------------------------------------------
  useEffect(() => {
    const channel = supabase.channel(`room:${sessionId}`, {
      config: { presence: { key: selfId } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Presence>();
      const people = Object.values(state).flat() as unknown as Presence[];
      setParticipants(people);
    });

    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      handleSignal(payload as Signal);
    });

    channel.subscribe(async (state) => {
      if (state === "SUBSCRIBED") {
        await channel.track({ id: selfId, isHost });
        setStatus(isHost ? "You are the host." : "Connected. Waiting for host…");
        // A viewer asks the host to start a peer connection.
        if (!isHost) send({ kind: "viewer-join", from: selfId });
      }
    });

    return () => {
      stopSharing();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selfId, isHost]);

  // --- Signal router ---------------------------------------------------------
  async function handleSignal(sig: Signal) {
    // HOST side: a viewer announced -> create an offer for them.
    if (isHost && sig.kind === "viewer-join") {
      if (!localStreamRef.current) return; // not sharing yet
      const viewerId = sig.from;
      const existing = peersRef.current.get(viewerId);
      existing?.close();

      const pc = newPeer(viewerId);
      localStreamRef.current
        .getTracks()
        .forEach((t) => pc.addTrack(t, localStreamRef.current!));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ kind: "offer", from: selfId, to: viewerId, sdp: offer });
      return;
    }

    // Remaining signal kinds are all targeted; ignore anything not for us.
    if (sig.kind === "viewer-join" || sig.to !== selfId) return;

    // VIEWER side: received an offer from the host.
    if (!isHost && sig.kind === "offer") {
      const pc = newPeer(sig.from, (stream) => {
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStatus("Live.");
      });
      await pc.setRemoteDescription(sig.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ kind: "answer", from: selfId, to: sig.from, sdp: answer });
      return;
    }

    // HOST side: viewer answered our offer.
    if (isHost && sig.kind === "answer") {
      const pc = peersRef.current.get(sig.from);
      if (pc) await pc.setRemoteDescription(sig.sdp);
      return;
    }

    // Either side: trickled ICE candidate.
    if (sig.kind === "ice") {
      const pc = peersRef.current.get(sig.from);
      if (pc) {
        try {
          await pc.addIceCandidate(sig.candidate);
        } catch {
          /* candidate may arrive before remote description; ignore */
        }
      }
    }
  }

  const viewers = participants.filter((p) => !p.isHost);

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_260px]">
      <div className="card overflow-hidden p-0">
        <div className="aspect-video w-full bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isHost}
            className="h-full w-full object-contain"
          />
        </div>
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-neutral-400">{status}</p>
          {isHost &&
            (sharing ? (
              <button onClick={stopSharing} className="btn-ghost text-red-400">
                Stop sharing
              </button>
            ) : (
              <button onClick={startSharing} className="btn-primary">
                Share {SERVICE_TYPE_LABELS[serviceType].toLowerCase()}
              </button>
            ))}
        </div>
      </div>

      <aside className="card h-fit">
        <h3 className="text-sm font-semibold text-neutral-300">
          Participants ({participants.length})
        </h3>
        <ul className="mt-3 space-y-2 text-sm">
          {participants.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  p.isHost ? "bg-brand" : "bg-green-400"
                }`}
              />
              <span className="truncate">
                {p.id === selfId ? "You" : p.id.slice(0, 12)}
              </span>
              {p.isHost && (
                <span className="ml-auto text-xs text-brand">host</span>
              )}
            </li>
          ))}
        </ul>
        {!isHost && viewers.length >= 0 && (
          <p className="mt-4 text-xs text-neutral-500">
            You&apos;re viewing the host&apos;s shared{" "}
            {SERVICE_TYPE_LABELS[serviceType].toLowerCase()}.
          </p>
        )}
      </aside>
    </div>
  );
}
