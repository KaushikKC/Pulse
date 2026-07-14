import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  EmotionalState,
  MatchEvent,
  ReactionType,
  RoomState,
  Side,
  VerifiedMoment,
} from "@pulse/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

/** One sample of the room's emotional heartbeat, for the scrubbable timeline. */
export interface TimelinePoint {
  t: number;
  i: number;
  tilt: number;
}

/** How many heartbeat samples to retain (~7.5 min at 4/sec). */
const TIMELINE_CAP = 1800;

export interface PulseState {
  connected: boolean;
  room: RoomState | null;
  emotion: EmotionalState | null;
  /** Rolling ticker of recent match events (newest first). */
  events: MatchEvent[];
  /** The single newest event, for one-shot canvas spikes. */
  lastEvent: MatchEvent | null;
  /** Collectible moments captured this session (newest first). */
  moments: VerifiedMoment[];
  /** The match's emotional intensity history (oldest → newest), for the scrub. */
  timeline: TimelinePoint[];
}

/**
 * usePulse — the client's single connection to the fan-out service. Joins a room,
 * streams match events + the fused emotional heartbeat, and sends reactions.
 */
export function usePulse(fixtureId: string | null, team: Side, name?: string) {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<PulseState>({
    connected: false,
    room: null,
    emotion: null,
    events: [],
    lastEvent: null,
    moments: [],
    timeline: [],
  });
  /** Local floaters echoed instantly on every reaction (yours + others'). */
  const [pops, setPops] = useState<
    { id: number; type: ReactionType; team: Side; name?: string }[]
  >([]);
  const popId = useRef(0);

  // Connect once.
  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setState((s) => ({ ...s, connected: true })));
    socket.on("disconnect", () => setState((s) => ({ ...s, connected: false })));

    socket.on("room_state", (room: RoomState) => setState((s) => ({ ...s, room })));
    socket.on("emotion", (emotion: EmotionalState) =>
      setState((s) => {
        const point: TimelinePoint = { t: emotion.ts, i: emotion.intensity, tilt: emotion.tilt };
        const timeline = [...s.timeline, point];
        if (timeline.length > TIMELINE_CAP) timeline.splice(0, timeline.length - TIMELINE_CAP);
        return { ...s, emotion, timeline };
      }),
    );
    socket.on("match_event", (event: MatchEvent) =>
      setState((s) => ({
        ...s,
        lastEvent: event,
        events: [event, ...s.events].slice(0, 12),
      })),
    );
    // Moments stream in as "pending" then re-arrive "verified"/"unverified";
    // upsert by id so the card updates in place rather than duplicating.
    socket.on("verified_moment", (moment: VerifiedMoment) =>
      setState((s) => {
        const rest = s.moments.filter((m) => m.id !== moment.id);
        return { ...s, moments: [moment, ...rest].slice(0, 24) };
      }),
    );
    socket.on("reaction_pop", ({ type, team, name }) => {
      const id = popId.current++;
      setPops((p) => [...p, { id, type, team, name }].slice(-40));
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
    socket.emit("join", { fixtureId, team, name: name || undefined });
    return () => {
      socket.emit("leave", { fixtureId });
    };
  }, [fixtureId, team, name]);

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
