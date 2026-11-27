import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, it, expect, vi, beforeEach } from 'vitest'
import { SpendChart } from '../spend-chart'

// Mock Tremor components
vi.mock('@tremor/react', () => ({
  BarChart: ({ data, index, categories, valueFormatter }: any) => (
    <div data-testid="bar-chart">
      <div data-testid="chart-data">{JSON.stringify(data)}</div>
      <div data-testid="chart-index">{index}</div>
      <div data-testid="chart-categories">{categories.join(',')}</div>
      <div data-testid="chart-formatter">{valueFormatter(100)}</div>
    </div>
  ),
  LineChart: ({ data, index, categories, valueFormatter }: any) => (
    <div data-testid="line-chart">
      <div data-testid="chart-data">{JSON.stringify(data)}</div>
      <div data-testid="chart-index">{index}</div>
      <div data-testid="chart-categories">{categories.join(',')}</div>
      <div data-testid="chart-formatter">{valueFormatter(100)}</div>
    </div>
  ),
  Card: ({ children, className }: any) => (
    <div data-testid="tremor-card" className={className}>
      {children}
    </div>
  ),
  Title: ({ children }: any) => <h3 data-testid="tremor-title">{children}</h3>,
  Flex: ({ children, className }: any) => (
    <div data-testid="tremor-flex" className={className}>
      {children}
    </div>
  ),
  Select: ({ value, onValueChange, children, className }: any) => (
    <select
      data-testid="tremor-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      className={className}
    >
      {children}
    </select>
  ),
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  Text: ({ children, className }: any) => (
    <p data-testid="tremor-text" className={className}>
      {children}
    </p>
  ),
  Bold: ({ children }: any) => <strong>{children}</strong>,
}))

describe('SpendChart', () => {
  const mockData = [
    { month: 'Jan', category: 'Streaming', amount: 45.99 },
    { month: 'Jan', category: 'Software', amount: 29.99 },
    { month: 'Feb', category: 'Streaming', amount: 45.99 },
    { month: 'Feb', category: 'Software', amount: 29.99 },
    { month: 'Mar', category: 'Streaming', amount: 50.99 },
    { month: 'Mar', category: 'Software', amount: 29.99 },
  ]

  describe('Rendering', () => {
    test('displays chart title', () => {
      render(<SpendChart data={mockData} />)

      expect(screen.getByText('Spending Overview')).toBeInTheDocument()
    })

    test('renders bar chart by default', () => {
      render(<SpendChart data={mockData} />)

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
      expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    })

    test('displays category filter dropdown', () => {
      render(<SpendChart data={mockData} />)

      const selects = screen.getAllByTestId('tremor-select')
      const categorySelect = selects[0]

      expect(categorySelect).toHaveValue('all')
      expect(screen.getByText('All Categories')).toBeInTheDocument()
      expect(screen.getByText('Streaming')).toBeInTheDocument()
      expect(screen.getByText('Software')).toBeInTheDocument()
    })

    test('displays chart type selector', () => {
      render(<SpendChart data={mockData} />)

      const selects = screen.getAllByTestId('tremor-select')
      const chartTypeSelect = selects[1]

      expect(chartTypeSelect).toHaveValue('bar')
      expect(screen.getByText('Bar Chart')).toBeInTheDocument()
      expect(screen.getByText('Line Chart')).toBeInTheDocument()
    })

    test('displays helpful tip text', () => {
      render(<SpendChart data={mockData} />)

      expect(screen.getByText(/Hover over the chart to see exact spending amounts/i)).toBeInTheDocument()
    })

    test('uses provided categories when specified', () => {
      const categories = ['Streaming', 'Software', 'Gaming']
      render(<SpendChart data={mockData} categories={categories} />)

      expect(screen.getByText('Gaming')).toBeInTheDocument()
    })

    test('derives categories from data when not provided', () => {
      render(<SpendChart data={mockData} />)

      // Should extract unique categories from data
      expect(screen.getByText('Streaming')).toBeInTheDocument()
      expect(screen.getByText('Software')).toBeInTheDocument()
    })
  })

  describe('Chart Type Switching', () => {
    test('switches to line chart when selected', async () => {
      const user = userEvent.setup()
      render(<SpendChart data={mockData} />)

      const selects = screen.getAllByTestId('tremor-select')
      const chartTypeSelect = selects[1]

      await user.selectOptions(chartTypeSelect, 'line')

      expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument()
    })

    test('switches back to bar chart when selected', async () => {
      const user = userEvent.setup()
      render(<SpendChart data={mockData} />)

      const selects = screen.getAllByTestId('tremor-select')
      const chartTypeSelect = selects[1]

      // Switch to line
      await user.selectOptions(chartTypeSelect, 'line')
      expect(screen.getByTestId('line-chart')).toBeInTheDocument()

      // Switch back to bar
      await user.selectOptions(chartTypeSelect, 'bar')
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
      expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    })
  })

  describe('Category Filtering', () => {
    test('filters data by selected category', async () => {
      const user = userEvent.setup()
      render(<SpendChart data={mockData} />)

      const selects = screen.getAllByTestId('tremor-select')
      const categorySelect = selects[0]

      await user.selectOptions(categorySelect, 'Streaming')

      // Verify chart data is filtered
      const chartData = screen.getByTestId('chart-data')
      const data = JSON.parse(chartData.textContent || '[]')

      // Should only include Streaming data
      expect(data.every((item: any) => item.Streaming !== undefined)).toBe(true)
    })

    test('shows all categories when "all" is selected', async () => {
      const user = userEvent.setup()
      render(<SpendChart data={mockData} />)

      const selects = screen.getAllByTestId('tremor-select')
      const categorySelect = selects[0]

      // First filter to a specific category
      await user.selectOptions(categorySelect, 'Streaming')

      // Then switch back to all
      await user.selectOptions(categorySelect, 'all')

      const chartData = screen.getByTestId('chart-data')
      const data = JSON.parse(chartData.textContent || '[]')

      // Should include all categories
      expect(data.length).toBeGreaterThan(0)
    })
  })

  describe('Data Transformation', () => {
    test('aggregates data by month', () => {
      render(<SpendChart data={mockData} />)

      const chartData = screen.getByTestId('chart-data')
      const data = JSON.parse(chartData.textContent || '[]')

      // Should have one entry per month
      const months = data.map((item: any) => item.month)
      expect(months).toContain('Jan')
      expect(months).toContain('Feb')
      expect(months).toContain('Mar')
    })

    test('uses month as chart index', () => {
      render(<SpendChart data={mockData} />)

      const chartIndex = screen.getByTestId('chart-index')
      expect(chartIndex).toHaveTextContent('month')
    })

    test('includes all categories in chart', () => {
      render(<SpendChart data={mockData} />)

      const chartCategories = screen.getByTestId('chart-categories')
      expect(chartCategories).toHaveTextContent('Streaming')
      expect(chartCategories).toHaveTextContent('Software')
    })

    test('formats currency values correctly', () => {
      render(<SpendChart data={mockData} />)

      const chartFormatter = screen.getByTestId('chart-formatter')
      expect(chartFormatter).toHaveTextContent('100.00')
    })
  })

  describe('Empty Data Handling', () => {
    test('renders with empty data array', () => {
      render(<SpendChart data={[]} />)

      expect(screen.getByText('Spending Overview')).toBeInTheDocument()
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
    })

    test('handles single data point', () => {
      const singleData = [{ month: 'Jan', category: 'Streaming', amount: 15.99 }]
      render(<SpendChart data={singleData} />)

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
      expect(screen.getAllByText('Streaming').length).toBeGreaterThan(0)
    })
  })

  describe('Responsive Behavior', () => {
    test('renders card container', () => {
      render(<SpendChart data={mockData} />)

      expect(screen.getByTestId('tremor-card')).toBeInTheDocument()
    })

    test('applies proper styling classes', () => {
      render(<SpendChart data={mockData} />)

      const card = screen.getByTestId('tremor-card')
      expect(card).toHaveClass('p-6')
    })
  })

  describe('Chart Configuration', () => {
    test('passes correct props to chart component', () => {
      render(<SpendChart data={mockData} />)

      // Verify chart receives proper configuration
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
      expect(screen.getByTestId('chart-index')).toHaveTextContent('month')
      expect(screen.getByTestId('chart-categories')).toBeTruthy()
    })

    test('maintains chart type selection across re-renders', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<SpendChart data={mockData} />)

      const selects = screen.getAllByTestId('tremor-select')
      const chartTypeSelect = selects[1]

      await user.selectOptions(chartTypeSelect, 'line')
      expect(screen.getByTestId('line-chart')).toBeInTheDocument()

      // Re-render with same data
      rerender(<SpendChart data={mockData} />)

      // Chart type should persist
      expect(screen.getByTestId('line-chart')).toBeInTheDocument()
    })
  })
})

