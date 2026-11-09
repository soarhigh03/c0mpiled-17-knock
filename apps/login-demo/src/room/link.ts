import { roomChannelName, type RoomMessage } from './messages.ts'
import { openPeerLink } from './peerLink.ts'

/**
 * The call's transport between the interviewer's window and the candidate's.
 *
 * Two implementations, because the demo has two shapes. `broadcast` is
 * `BroadcastChannel`: two windows on one machine, no media, zero moving parts —
 * what the demo was built against. `peer` is WebRTC over a broker, which is the
 * only way two people on two machines see each other.
 */

export type RoomRole = 'interviewer' | 'candidate'

export type RoomLinkStatus =
  /** Same-machine transport. There is no "other end" to be connected to. */
  | { state: 'local' }
  | { state: 'connecting' }
  | { state: 'connected' }
  | { state: 'error'; message: string }

export interface RoomLink {
  /**
   * Whether this transport can carry camera streams. The interviewer's grid
   * reads it to decide whether a missing remote stream means "not here yet" or
   * "this transport never had one".
   */
  readonly carriesMedia: boolean
  post(message: RoomMessage): void
  /** Replaces any previous handler; messages that arrived first are replayed. */
  onMessage(handler: (message: RoomMessage) => void): void
  /** Offer this window's camera to the other side. `null` withdraws it. */
  publish(stream: MediaStream | null): void
  /** The other side's camera, or null while there isn't one. */
  onRemoteStream(handler: (stream: MediaStream | null) => void): void
  onStatus(handler: (status: RoomLinkStatus) => void): void
  close(): void
}

/**
 * `peer` needs a broker on the network, so it is opt-in: the local two-window
 * demo keeps working with no dependency on anything being reachable. Set
 * `VITE_ROOM_TRANSPORT=peer` on both machines, or append `?remote=1`.
 */
export function roomTransport(): 'broadcast' | 'peer' {
  const override = new URLSearchParams(window.location.search).get('remote')
  if (override === '1') return 'peer'
  if (override === '0') return 'broadcast'
  return import.meta.env.VITE_ROOM_TRANSPORT === 'peer' ? 'peer' : 'broadcast'
}

export function openRoomLink(code: string, role: RoomRole): RoomLink {
  return roomTransport() === 'peer' ? openPeerLink(code, role) : openBroadcastLink(code)
}

/**
 * Same-origin, same-machine. Carries no media: both windows are already
 * looking at the same camera, so there would be nothing to send.
 */
function openBroadcastLink(code: string): RoomLink {
  const channel = new BroadcastChannel(roomChannelName(code))
  return {
    carriesMedia: false,
    post: (message) => channel.postMessage(message),
    onMessage(handler) {
      channel.onmessage = (e: MessageEvent<RoomMessage>) => handler(e.data)
    },
    publish() {},
    onRemoteStream(handler) {
      handler(null)
    },
    onStatus(handler) {
      handler({ state: 'local' })
    },
    close: () => channel.close(),
  }
}
