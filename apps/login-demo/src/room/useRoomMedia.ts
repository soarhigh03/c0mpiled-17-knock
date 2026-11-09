import { useEffect, useState } from 'react'
import type { RoomLink, RoomLinkStatus } from './link.ts'

/**
 * Put this window's camera on the link and take the other side's off it.
 *
 * One consumer per link per window: the link holds a single handler for each
 * of these, so the view that renders the remote tile is the one that calls it.
 */
export function useRoomMedia(
  link: RoomLink,
  local: MediaStream | null,
): { remote: MediaStream | null; status: RoomLinkStatus } {
  const [remote, setRemote] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState<RoomLinkStatus>({ state: 'connecting' })

  useEffect(() => {
    link.onRemoteStream(setRemote)
    link.onStatus(setStatus)
  }, [link])

  useEffect(() => {
    link.publish(local)
    // Not withdrawn on unmount: the call owns the stream's lifetime, and a
    // re-render that momentarily publishes null would tear down the peer's
    // media connection for no reason.
  }, [link, local])

  return { remote, status }
}
