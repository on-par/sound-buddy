// Shared types for all @sound-buddy packages

export interface EQBand {
  type: string
  freq: number
  gain: number
  q: number
}

export interface ChannelMix {
  on: boolean
  fader: number
}

export interface ChannelPreamp {
  gain: number
}

export interface Channel {
  name: string
  mix: ChannelMix
  preamp: ChannelPreamp
  eq: { bands: EQBand[] }
}

export interface DCA {
  on: boolean
  level: number
  name: string
}

export interface Scene {
  name: string
  version: string
  channels: Channel[]
  dcas: DCA[]
}

export interface SceneChange {
  path: string
  label: string
  from: unknown
  to: unknown
}

export interface SceneDiff {
  changes: SceneChange[]
  summary: string
  bySection: {
    channels: SceneChange[]
    dcas: SceneChange[]
    main: SceneChange[]
  }
}

export interface Insight {
  type: string
  channel?: string
  message: string
  severity: 'info' | 'warning' | 'suggestion'
}

export interface AnalystInput {
  diff?: SceneDiff
  audio?: AudioAnalysisResult
}

export interface AudioAnalysisResult {
  channels: ChannelResult[]
}

export interface ChannelResult {
  name: string
  rmsDbfs: number
  peakDbfs: number
  dynamicRangeDb: number
  dominantBand: string
}
