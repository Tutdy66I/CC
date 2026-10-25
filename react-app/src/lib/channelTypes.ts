import type { Modulation } from './modulationComparison.js'

export type Complex = { i: number; q: number }
export type ChannelModel = 'awgn' | 'rayleigh-block' | 'rayleigh-iid'
export type ChannelMethod = 'raw' | 'ideal' | 'ls'
export interface ChannelPlan {
  frameSymbols: number
  modulation: Modulation
  ebN0Db: number[]
  pilotCounts: number[]
  channels: ChannelModel[]
  trials: number
  seed: number
  energyBasis: 'data-eb' | 'total-eb'
  noiseEnabled: boolean
}
export interface ChannelMetric {
  bits: number
  errors: number | null
  ber: number | null
  signalEnergy: number
  errorEnergy: number | null
  evmRms: number | null
  failure: string | null
}
export interface ChannelCell {
  model: ChannelModel
  ebN0Db: number
  pilots: number
  noisePower: number
  dataEnergy: number
  pilotEnergy: number
  totalEnergy: number
  commonDataEnergy: number
  dataSymbols: number
  commonSymbols: number
  hMeanPower: number
  hFirst: Complex
  estimate: Complex | null
  estimationSquaredError: number | null
  deepFadeSymbols: number
  methods: Record<ChannelMethod, { all: ChannelMetric; common: ChannelMetric }>
  preview: {
    index: number
    tx: Complex
    h: Complex
    received: Complex
    ideal: Complex | null
    ls: Complex | null
  }[]
}
export interface ChannelTrial {
  index: number
  cells: ChannelCell[]
}
