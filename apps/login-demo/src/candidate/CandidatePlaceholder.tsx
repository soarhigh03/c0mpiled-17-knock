import { ScanFace } from 'lucide-react'

// TODO(candidate): candidate join flow + running Knock challenges on their device.
export function CandidatePlaceholder() {
  return (
    <div className="placeholder-page">
      <span className="brand__logo brand__logo--lg">
        <ScanFace size={22} aria-hidden />
      </span>
      <h1>Candidate view</h1>
      <p className="muted">Coming soon. This is where the candidate joins the call and completes Knock checks.</p>
      <a className="link-button" href="?role=interviewer">
        Open interviewer view
      </a>
    </div>
  )
}
