import type { ReportShareholding } from '@workspace/api-client-react';

function wholeNumber(value: number) {
  return Math.round(value).toLocaleString('en-US');
}

export function ShareholdingTable({
  shareholding,
  currency,
}: {
  shareholding: ReportShareholding;
  currency: string;
  compact?: boolean;
}) {
  const totalPercentage = shareholding.rows.reduce((total, row) => total + row.percentage, 0);
  const totalShares = shareholding.rows.reduce((total, row) => total + row.numberOfShares, 0);
  const totalValue = shareholding.rows.reduce((total, row) => total + row.value, 0);
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="report-shareholding" data-testid="table-shareholding">
        <thead>
          <tr>
            <th className="text-left">Name</th>
            <th className="text-right">% age</th>
            <th className="text-center">Nationality</th>
            <th className="text-right">Number of Shares</th>
            <th className="text-right">Value {currency}</th>
          </tr>
        </thead>
        <tbody>
          {shareholding.rows.map((row, index) => (
            <tr key={`${row.name}-${index}`}>
              <td>{row.name}</td>
              <td className="text-right">{`${Math.round(row.percentage)}%`}</td>
              <td className="text-center">{row.nationality ?? ''}</td>
              <td className="text-right">{wholeNumber(row.numberOfShares)}</td>
              <td className="text-right">{wholeNumber(row.value)}</td>
            </tr>
          ))}
          <tr className="report-shareholding-total">
            <td />
            <td className="text-right">{`${Math.round(totalPercentage)}%`}</td>
            <td className="text-center" />
            <td className="text-right">{wholeNumber(totalShares)}</td>
            <td className="text-right">{wholeNumber(totalValue)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
