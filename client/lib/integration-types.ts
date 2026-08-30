export enum IntegrationStatus {
  Connected = "connected",
  Disconnected = "disconnected",
}

export interface Integration {
  id: number
  name: string
  type: string
  status: IntegrationStatus
  lastSync: string
  accounts: number
}
