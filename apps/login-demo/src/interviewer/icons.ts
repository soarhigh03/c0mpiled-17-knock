import type { ChallengeKind } from '@knock/shared'
import { AudioWaveform, MonitorSmartphone, Radar, SunMedium, type LucideIcon } from 'lucide-react'

export const CHECK_ICON: Record<ChallengeKind, LucideIcon> = {
  environment: MonitorSmartphone,
  light: SunMedium,
  sonar: Radar,
  voice: AudioWaveform,
}
