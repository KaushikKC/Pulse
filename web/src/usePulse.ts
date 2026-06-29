import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  EmotionalState,
  MatchEvent,
  ReactionType,
  RoomState,
  Side,
} from "@pulse/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

export interface PulseState {
  connected: boolean;
  room: RoomState | null;
  emotion: EmotionalState | null;
  /** Rolling ticker of recent match events (newest first). */
  events: MatchEvent[];
  /** The single newest event, for one-shot canvas spikes. */
  lastEvent: MatchEvent | null;
}

/**
 * usePulse — the client's single connection to the fan-out service. Joins a room,
 * streams match events + the fused emotional heartbeat, and sends reactions.
 */
export function usePulse(fixtureId: string | null, team: Side) {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<PulseState>({
    connected: false,
    room: null,
    emotion: null,
    events: [],
    lastEvent: null,
  });
  /** Local floaters echoed instantly on every reaction (yours + others'). */
  const [pops, setPops] = useState<{ id: number; type: ReactionType; team: Side }[]>([]);
  const popId = useRef(0);

  // Connect once.
  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setState((s) => ({ ...s, connected: true })));
    socket.on("disconnect", () => setState((s) => ({ ...s, connected: false })));

    socket.on("room_state", (room: RoomState) => setState((s) => ({ ...s, room })));
    socket.on("emotion", (emotion: EmotionalState) => setState((s) => ({ ...s, emotion })));
    socket.on("match_event", (event: MatchEvent) =>
      setState((s) => ({
        ...s,
        lastEvent: event,
        events: [event, ...s.events].slice(0, 12),
      })),
    );
    socket.on("reaction_pop", ({ type, team }) => {
      const id = popId.current++;
      setPops((p) => [...p, { id, type, team }].slice(-40));
      setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1600);
    });

    return () => {
      socket.close();
    };
  }, []);

  // (Re)join when the chosen fixture or team changes.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !fixtureId) return;
    socket.emit("join", { fixtureId, team });
    return () => {
      socket.emit("leave", { fixtureId });
    };
  }, [fixtureId, team]);

  const react = useCallback(
    (type: ReactionType) => {
      const socket = socketRef.current;
      if (!socket || !fixtureId) return;
      socket.emit("react", { fixtureId, type });
    },
    [fixtureId],
  );

  return { ...state, pops, react };
}
