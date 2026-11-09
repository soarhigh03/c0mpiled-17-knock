/**
 * Light panels along the border of the call window.
 *
 * The check needs the screen to act as a lamp with a schedule, and the product
 * needs the call to stay on screen while it does. A ring around the edge is
 * the compromise: four strips, no centre, so the video tiles and the controls
 * are never covered. It costs flux — on a 16:10 window a strip width of 11vmin
 * lights about a quarter of the screen area, so roughly a quarter of what a
 * full-screen flash would deliver — and the verifier pays for that with a
 * correlation rather than a brightness threshold.
 */

/**
 * Strip width. `vmin` so a wide window does not end up with a thin ring, with
 * a floor for small windows and a ceiling so a large display does not turn the
 * whole thing into a full-screen flash after all.
 *
 * Viewport-relative even when a `host` is given, which is a deliberate
 * approximation: every host so far is the call surface, within a title bar's
 * height of the window. A much smaller host would get a ring that is chunky
 * relative to it — still functional, just ugly — and that is the point at
 * which this should become host-relative.
 */
const THICKNESS = 'clamp(56px, 11vmin, 140px)'
/** Above every app chrome; the same value the old full-screen overlay used. */
const Z_INDEX = '2147483647'

export interface LightPanels {
  /**
   * Set the panel color. Call inside an animation frame callback — the caller
   * owns the schedule, because it also owns the clock the evidence is on.
   */
  paint(color: string): void
  remove(): void
}

export interface LightPanelOptions {
  /**
   * Where to hang the ring. Defaults to the whole window, which in a desktop
   * shell is the app frame. A host that wants the ring around one call surface
   * instead can pass that element — it has to be positioned, since the strips
   * are placed against its padding box.
   */
  host?: HTMLElement
}

export function mountLightPanels(options: LightPanelOptions = {}): LightPanels {
  const host = options.host
  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  Object.assign(container.style, {
    position: host ? 'absolute' : 'fixed',
    inset: '0',
    zIndex: Z_INDEX,
    // The ring is a lamp, not UI. It must never eat a click on the call
    // controls underneath it.
    pointerEvents: 'none',
  })

  // Top and bottom run the full width and own the corners; the sides fill in
  // between them. Four solid strips rather than one bordered box: a border
  // cannot be repainted without touching layout, and these can.
  const strips = [
    { left: '0', right: '0', top: '0', height: THICKNESS },
    { left: '0', right: '0', bottom: '0', height: THICKNESS },
    { top: THICKNESS, bottom: THICKNESS, left: '0', width: THICKNESS },
    { top: THICKNESS, bottom: THICKNESS, right: '0', width: THICKNESS },
  ].map((box) => {
    const strip = document.createElement('div')
    Object.assign(strip.style, {
      position: 'absolute',
      backgroundColor: '#000000',
      // No transition and no animation anywhere near this element. A tween
      // between colors would smear every edge the verifier is looking for.
      transition: 'none',
      ...box,
    })
    container.appendChild(strip)
    return strip
  })

  ;(host ?? document.body).appendChild(container)

  return {
    paint(color) {
      for (const strip of strips) strip.style.backgroundColor = color
    },
    remove() {
      container.remove()
    },
  }
}
