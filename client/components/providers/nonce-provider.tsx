"use client"

import { createContext, useContext, ReactNode } from "react"

const NonceContext = createContext<string | null>(null)

interface NonceProviderProps {
  children: ReactNode
  nonce: string
}

export function NonceProvider({ children, nonce }: NonceProviderProps) {
  return (
    <NonceContext.Provider value={nonce}>
      {children}
    </NonceContext.Provider>
  )
}

export function useNonce() {
  const nonce = useContext(NonceContext)
  return nonce
}
