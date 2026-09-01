"use client";

import React, { useState } from 'react';
import Papa from 'papaparse';

interface CSVRow {
    [key: string]: any;
}

interface RowError {
    rowIndex: number;
    errors: string[];
}

export const CSVImport: React.FC<{
    onImport: (data: CSVRow[]) => void;
}> = ({ onImport }) => {
    const [data, setData] = useState<CSVRow[]>([]);
    const [errors, setErrors] = useState<RowError[]>([]);
    const [isParsing, setIsParsing] = useState(false);

    const validateRow = (row: CSVRow, rowIndex: number): string[] => {
        const rowErrors: string[] = [];
        // Basic validation: Check if any fields are completely empty
        for (const key in row) {
            if (!row[key] || row[key].toString().trim() === '') {
                rowErrors.push(`Field '${key}' is required.`);
            }
        }
        return rowErrors;
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsParsing(true);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const parsedData = results.data as CSVRow[];
                const newErrors: RowError[] = [];
                
                parsedData.forEach((row, index) => {
                    const rowErrors = validateRow(row, index);
                    if (rowErrors.length > 0) {
                        newErrors.push({ rowIndex: index, errors: rowErrors });
                    }
                });

                setData(parsedData);
                setErrors(newErrors);
                setIsParsing(false);
            },
            error: (error: any) => {
                console.error("Parse error", error);
                setIsParsing(false);
            }
        });
    };

    const handleRowEdit = (rowIndex: number, key: string, value: string) => {
        const newData = [...data];
        newData[rowIndex][key] = value;
        setData(newData);

        // Revalidate this row
        const rowErrors = validateRow(newData[rowIndex], rowIndex);
        const newErrorList = errors.filter(e => e.rowIndex !== rowIndex);
        if (rowErrors.length > 0) {
            newErrorList.push({ rowIndex, errors: rowErrors });
        }
        setErrors(newErrorList);
    };

    const handleSubmit = () => {
        if (errors.length > 0) {
            alert('Please fix all errors before importing.');
            return;
        }
        onImport(data);
    };

    return (
        <div className="p-6 border rounded-lg shadow-sm bg-white">
            <h2 className="text-lg font-semibold mb-4">Bulk CSV Import</h2>
            
            <div className="mb-4">
                <input 
                    type="file" 
                    accept=".csv" 
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
            </div>

            {isParsing && <p className="text-sm text-gray-500">Parsing file...</p>}

            {data.length > 0 && (
                <div className="mt-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-medium text-gray-700">Preview ({data.length} rows)</h3>
                        <p className="text-sm font-medium">
                            {errors.length > 0 ? (
                                <span className="text-red-600">{errors.length} rows have errors</span>
                            ) : (
                                <span className="text-green-600">All rows are valid</span>
                            )}
                        </p>
                    </div>

                    <div className="overflow-x-auto max-h-[500px]">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50 sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    {Object.keys(data[0] || {}).map((key) => (
                                        <th key={key} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            {key}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {data.map((row, rowIndex) => {
                                    const rowError = errors.find(e => e.rowIndex === rowIndex);
                                    const hasError = !!rowError;
                                    
                                    return (
                                        <tr key={rowIndex} className={hasError ? "bg-red-50" : ""}>
                                            <td className="px-4 py-2">
                                                {hasError ? (
                                                    <span className="text-red-500 font-bold" title={rowError.errors.join(", ")}>
                                                        Error
                                                    </span>
                                                ) : (
                                                    <span className="text-green-500 font-bold">Valid</span>
                                                )}
                                            </td>
                                            {Object.keys(row).map((key) => (
                                                <td key={key} className="px-4 py-2">
                                                    {hasError ? (
                                                        <input
                                                            type="text"
                                                            value={row[key]}
                                                            onChange={(e) => handleRowEdit(rowIndex, key, e.target.value)}
                                                            className="border-red-300 focus:border-red-500 focus:ring-red-500 rounded-md shadow-sm sm:text-sm p-1 border w-full bg-white"
                                                            title={rowError.errors.find(e => e.includes(key)) || ""}
                                                        />
                                                    ) : (
                                                        <span>{row[key]}</span>
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={handleSubmit}
                            disabled={errors.length > 0}
                            className={`px-4 py-2 rounded-md text-white font-medium ${
                                errors.length > 0 
                                    ? 'bg-gray-400 cursor-not-allowed' 
                                    : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                        >
                            Import Data
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
