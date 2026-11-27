import type { ReactNode } from 'react'
import type { AccMe, Client } from './api'
import { Frame } from './Frame'

export { MENU, type MenuItem } from './nav'

/** One company in KontoSef Kontabilist: the common frame with the company's menu and page header. */
export function CompanyShell({
  me,
  client,
  linked,
  active,
  toolbar,
  children,
}: {
  me: AccMe
  client: Client | null
  linked: boolean
  active: string
  toolbar?: ReactNode
  children: ReactNode
}) {
  return (
    <Frame me={me} client={client} linked={linked} active={active} toolbar={toolbar} title={client ? undefined : '…'}>
      {children}
    </Frame>
  )
}
