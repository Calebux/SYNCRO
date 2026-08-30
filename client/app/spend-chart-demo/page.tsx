import { SpendChart } from '../../components/spend-chart';

const demoData = [
  { month: 'Jan', category: 'Food', amount: 450 },
  { month: 'Jan', category: 'Transport', amount: 120 },
  { month: 'Jan', category: 'Entertainment', amount: 80 },
  { month: 'Jan', category: 'Shopping', amount: 200 },
  { month: 'Feb', category: 'Food', amount: 420 },
  { month: 'Feb', category: 'Transport', amount: 150 },
  { month: 'Feb', category: 'Entertainment', amount: 95 },
  { month: 'Feb', category: 'Shopping', amount: 180 },
  { month: 'Mar', category: 'Food', amount: 480 },
  { month: 'Mar', category: 'Transport', amount: 110 },
  { month: 'Mar', category: 'Entertainment', amount: 120 },
  { month: 'Mar', category: 'Shopping', amount: 250 },
  { month: 'Apr', category: 'Food', amount: 390 },
  { month: 'Apr', category: 'Transport', amount: 135 },
  { month: 'Apr', category: 'Entertainment', amount: 85 },
  { month: 'Apr', category: 'Shopping', amount: 220 },
  { month: 'May', category: 'Food', amount: 510 },
  { month: 'May', category: 'Transport', amount: 125 },
  { month: 'May', category: 'Entertainment', amount: 140 },
  { month: 'May', category: 'Shopping', amount: 300 },
  { month: 'Jun', category: 'Food', amount: 470 },
  { month: 'Jun', category: 'Transport', amount: 145 },
  { month: 'Jun', category: 'Entertainment', amount: 110 },
  { month: 'Jun', category: 'Shopping', amount: 280 },
];

export default function SpendChartDemo() {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">SpendChart Demo</h1>
        <p className="text-gray-600">
          Interactive spending visualization with bar/line chart modes and category filtering.
        </p>
      </div>
      
      <div className="grid gap-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Complete Overview</h2>
          <SpendChart data={demoData} />
        </div>
        
        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Food & Transport Only</h2>
          <SpendChart 
            data={demoData} 
            categories={['Food', 'Transport']} 
          />
        </div>
      </div>
      
      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Features</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-1">
          <li>Interactive bar and line chart modes</li>
          <li>Category filtering with dropdown</li>
          <li>Hover tooltips showing exact amounts</li>
          <li>Responsive design with Tremor components</li>
          <li>Animated transitions</li>
          <li>Color-coded categories</li>
        </ul>
      </div>
    </div>
  );
}
