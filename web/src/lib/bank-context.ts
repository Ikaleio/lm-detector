import { createContext, useContext } from 'react'
import type { Bank } from '@fingerpoint/shared/types'

export const BankContext = createContext<Bank | null>(null)

export function useLoadedBank(): Bank {
  const bank = useContext(BankContext)
  if (!bank) throw new Error('bank not loaded')
  return bank
}
