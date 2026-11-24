"use client";

import { useState } from "react";
import {
  BarChart,
  LineChart,
  Title,
  Card,
  Flex,
  Select,
  SelectItem,
  Text,
  Bold
} from "@tremor/react";

interface SpendData {
  month: string;
  category: string;
  amount: number;
}

interface SpendChartProps {
  data: SpendData[];
  categories?: string[];
}

export function SpendChart({ data, categories }: SpendChartProps) {
  const [chartType, setChartType] = useState<"bar" | "line">("bar");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Get unique categories from data if not provided
  const uniqueCategories = categories || [...new Set(data.map(item => item.category))];

  // Filter data based on selected category
  const filteredData = selectedCategory === "all" 
    ? data 
    : data.filter(item => item.category === selectedCategory);

  // Transform data for Tremor charts - aggregate by month and category
  const transformedData = filteredData.reduce((acc: any[], item) => {
    const existingMonth = acc.find(month => month.month === item.month);
    
    if (existingMonth) {
      existingMonth[item.category] = item.amount;
    } else {
      const newMonth: any = { month: item.month };
      uniqueCategories.forEach(cat => {
        newMonth[cat] = cat === item.category ? item.amount : 0;
      });
      acc.push(newMonth);
    }
    
    return acc;
  }, []);

  // Custom value formatter for currency
  const valueFormatter = (value: number) => {
    return `$${value.toFixed(2)}`;
  };

  const ChartComponent = chartType === "bar" ? BarChart : LineChart;

  return (
    <Card className="p-6">
      <Flex className="justify-between items-start mb-6">
        <Title>Spending Overview</Title>
        <Flex className="gap-4">
          <Select
            value={selectedCategory}
            onValueChange={setSelectedCategory}
            className="w-48"
          >
            <SelectItem value="all">All Categories</SelectItem>
            {uniqueCategories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </Select>
          <Select
            value={chartType}
            onValueChange={(value: string) => setChartType(value as "bar" | "line")}
            className="w-32"
          >
            <SelectItem value="bar">Bar Chart</SelectItem>
            <SelectItem value="line">Line Chart</SelectItem>
          </Select>
        </Flex>
      </Flex>

      <ChartComponent
        data={transformedData}
        index="month"
        categories={uniqueCategories}
        colors={["blue", "emerald", "violet", "amber", "rose", "cyan", "indigo", "pink"]}
        valueFormatter={valueFormatter}
        yAxisWidth={60}
        className="h-80"
        showAnimation={true}
        showTooltip={true}
        showLegend={true}
      />

      <Text className="mt-4 text-sm text-gray-600">
        <Bold>Tip:</Bold> Hover over the chart to see exact spending amounts per category per month.
      </Text>
    </Card>
  );
}
