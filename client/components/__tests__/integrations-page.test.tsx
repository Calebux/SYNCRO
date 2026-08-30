import { render, screen, fireEvent } from '@testing-library/react'
import IntegrationsPage from '../pages/integrations'
import { Integration, IntegrationStatus } from '@/lib/integration-types'

const integrations: Integration[] = [
  {
    id: 1,
    name: 'GitHub',
    type: 'Source Control',
    status: IntegrationStatus.Connected,
    lastSync: '5 minutes ago',
    accounts: 2,
  },
  {
    id: 2,
    name: 'Gemini',
    type: 'AI Assistant',
    status: IntegrationStatus.Disconnected,
    lastSync: 'Never',
    accounts: 0,
  },
]

describe('IntegrationsPage', () => {
  test('opens manage modal when manage button is clicked', () => {
    render(<IntegrationsPage integrations={integrations} onToggle={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))

    expect(screen.getByText('Manage GitHub')).toBeInTheDocument()
    expect(screen.getByText('Type:')).toBeInTheDocument()
    expect(screen.getByText('Source Control')).toBeInTheDocument()
  })

  test('calls onToggle when the integration toggle button is clicked', () => {
    const onToggle = jest.fn()

    render(<IntegrationsPage integrations={integrations} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Connected' }))

    expect(onToggle).toHaveBeenCalledWith(1)
  })

  test('renders configure button for disconnected integrations', () => {
    render(<IntegrationsPage integrations={integrations} onToggle={jest.fn()} />)

    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument()
  })
})
