/** Display helpers shared by the screens. */

export const CATEGORIES = [
  'Food', 'Groceries', 'Shopping', 'Transport', 'Bills', 'Home', 'Health', 'Entertainment', 'Insurance', 'Investments',
  'Fees', 'Cash', 'Transfer', 'Income', 'Interest', 'Dividend', 'Refund', 'Other',
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today'
  const y = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  if (date === y) return 'Yesterday'
  const [yy, mm, dd] = date.split('-').map(Number)
  return `${dd} ${MONTHS[mm - 1]}${yy === Number(today.slice(0, 4)) ? '' : ` ${yy}`}`
}

export function monthName(month: string): string {
  return MONTHS_LONG[Number(month.slice(5, 7)) - 1]
}
