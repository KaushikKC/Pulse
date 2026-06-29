import type { Side } from "@pulse/shared";

/**
 * Tracks live presence per room (keyed by fixtureId) and which side each socket
 * supports — used to tint/split the visualization and to compute crowd tilt.
 */
interface Member {
  team: Side;
  name?: string;
}

export class RoomManager {
  /** fixtureId -> (socketId -> member) */
  private rooms = new Map<string, Map<string, Member>>();

  join(fixtureId: string, socketId: string, team: Side, name?: string): void {
    let room = this.rooms.get(fixtureId);
    if (!room) {
      room = new Map();
      this.rooms.set(fixtureId, room);
    }
    room.set(socketId, { team, name });
  }

  leave(fixtureId: string, socketId: string): void {
    this.rooms.get(fixtureId)?.delete(socketId);
  }

  /** Remove a socket from every room (on disconnect). Returns affected fixtures. */
  leaveAll(socketId: string): string[] {
    const affected: string[] = [];
    for (const [fixtureId, room] of this.rooms) {
      if (room.delete(socketId)) affected.push(fixtureId);
    }
    return affected;
  }

  teamOf(fixtureId: string, socketId: string): Side {
    return this.rooms.get(fixtureId)?.get(socketId)?.team ?? 0;
  }

  presence(fixtureId: string): number {
    return this.rooms.get(fixtureId)?.size ?? 0;
  }
}

export const roomManager = new RoomManager();
