import Peer, { type DataConnection, type MediaConnection } from 'peerjs'
import type { RoomLink, RoomLinkStatus, RoomRole } from './link.ts'
import type { RoomMessage } from './messages.ts'

/**
 * Room transport over WebRTC, brokered by PeerJS.
 *
 * Only the handshake goes through the broker; the call itself is peer to peer.
 * That matters for this product: the sonar and light checks run on the
 * candidate's own machine against their own camera, and nothing about them
 * needs a server in the media path.
 *
 * **The public broker is a demo convenience, not a design.** Peer ids are
 * derived from the room code, so they are globally guessable on a shared
 * broker — set `VITE_ROOM_NAMESPACE` to something of your own if an id comes
 * back taken. There is also no TURN server here: a strict NAT on either side
 * will connect to the broker, exchange candidates, and still fail to carry
 * media. Both are fine for a demo between two laptops and neither is fine for
 * production.
 */

const NAMESPACE = import.meta.env.VITE_ROOM_NAMESPACE ?? 'presense'
/** Retry cadence while the other side has not opened its peer yet. */
const DIAL_RETRY_MS = 2_000

/** PeerJS ids allow alphanumerics, `-` and `_`; room codes are already a subset. */
function peerIdFor(code: string, role: RoomRole): string {
  return `${NAMESPACE}-${code}-${role}`.toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

export function openPeerLink(code: string, role: RoomRole): RoomLink {
  const selfId = peerIdFor(code, role)
  const otherId = peerIdFor(code, role === 'interviewer' ? 'candidate' : 'interviewer')
  // The candidate joins a room the interviewer is hosting, so the candidate
  // dials and the interviewer answers. If both dialled they would race into
  // two half-open connections and each ignore the other's.
  const dials = role === 'candidate'

  const peer = new Peer(selfId)
  let data: DataConnection | null = null
  let media: MediaConnection | null = null
  let local: MediaStream | null = null
  let remote: MediaStream | null = null
  /** An incoming call that arrived before this window's camera was ready. */
  let unanswered: MediaConnection | null = null
  let dialTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  // Handlers are registered by the UI a tick or two after the link opens, so
  // anything that arrives first is held rather than dropped.
  let onMessage: ((message: RoomMessage) => void) | null = null
  let onRemote: ((stream: MediaStream | null) => void) | null = null
  let onStatus: ((status: RoomLinkStatus) => void) | null = null
  const inbox: RoomMessage[] = []
  /** Posted before the data channel opened. Presence is sent immediately on
   *  connect, which is well before the channel is ready. */
  const outbox: RoomMessage[] = []
  let status: RoomLinkStatus = { state: 'connecting' }

  const setStatus = (next: RoomLinkStatus) => {
    status = next
    onStatus?.(next)
  }

  const setRemote = (stream: MediaStream | null) => {
    remote = stream
    onRemote?.(stream)
  }

  const bindCall = (call: MediaConnection) => {
    media = call
    call.on('stream', setRemote)
    call.on('close', () => {
      if (media === call) {
        media = null
        setRemote(null)
      }
    })
    call.on('error', (err) => console.warn('[preSense] media connection', err))
  }

  const bindData = (connection: DataConnection) => {
    data = connection
    connection.on('open', () => {
      setStatus({ state: 'connected' })
      for (const message of outbox.splice(0)) connection.send(message)
      offerMedia()
    })
    connection.on('data', (raw) => {
      const message = raw as RoomMessage
      if (onMessage) onMessage(message)
      else inbox.push(message)
    })
    connection.on('close', () => {
      if (data !== connection) return
      data = null
      setRemote(null)
      setStatus({ state: 'connecting' })
      scheduleDial()
    })
    connection.on('error', (err) => console.warn('[preSense] data connection', err))
  }

  /** Send this window's camera, once there is one and somewhere to send it. */
  const offerMedia = () => {
    if (!dials || closed || !local || !data?.open) return
    media?.close()
    bindCall(peer.call(otherId, local))
  }

  const dial = () => {
    if (closed || data || !dials) return
    bindData(peer.connect(otherId, { reliable: true }))
  }

  const scheduleDial = () => {
    if (closed || !dials) return
    clearTimeout(dialTimer)
    dialTimer = setTimeout(dial, DIAL_RETRY_MS)
  }

  peer.on('open', () => {
    if (dials) dial()
    else setStatus({ state: 'connecting' })
  })
  peer.on('connection', bindData)
  peer.on('call', (call) => {
    if (local) {
      call.answer(local)
      bindCall(call)
    } else {
      unanswered = call
    }
  })
  peer.on('disconnected', () => {
    if (!closed) peer.reconnect()
  })
  peer.on('error', (err) => {
    // The other side simply is not in the room yet — keep dialling rather than
    // reporting a failure the user cannot act on.
    if (err.type === 'peer-unavailable') return scheduleDial()
    if (err.type === 'unavailable-id') {
      return setStatus({
        state: 'error',
        message: `Room id "${selfId}" is already taken on the broker. Set VITE_ROOM_NAMESPACE to something of your own.`,
      })
    }
    setStatus({ state: 'error', message: `${err.type}: ${err.message}` })
  })

  return {
    carriesMedia: true,

    post(message) {
      if (data?.open) data.send(message)
      else outbox.push(message)
    },

    onMessage(handler) {
      onMessage = handler
      for (const message of inbox.splice(0)) handler(message)
    },

    publish(stream) {
      local = stream
      if (stream && unanswered) {
        unanswered.answer(stream)
        bindCall(unanswered)
        unanswered = null
      }
      offerMedia()
    },

    onRemoteStream(handler) {
      onRemote = handler
      handler(remote)
    },

    onStatus(handler) {
      onStatus = handler
      handler(status)
    },

    close() {
      closed = true
      clearTimeout(dialTimer)
      media?.close()
      data?.close()
      peer.destroy()
    },
  }
}
