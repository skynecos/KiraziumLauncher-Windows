import type { KiraziumApi } from '../shared/contracts'

declare global {
  interface Window {
    kirazium: KiraziumApi
  }
}

export {}
