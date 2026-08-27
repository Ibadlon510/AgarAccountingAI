// Mirrors artifacts/agaraccounting/src/App.tsx's money()/shortDate() so
// figures read identically between the web app and this one.
export const money = (value: number, currency = 'AED') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);

export const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
