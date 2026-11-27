// Made-up emails in the shape of the real ones (samples/ has the originals, which stay out of the repo).
export const COIN = {
  from: 'Zerodha <noreply-coin@qmailer.zerodha.net>',
  subject: 'Coin by Zerodha - Allotment report - 05-11-2026',
  receivedAt: '2026-11-05T06:34:02Z',
  text: `Hi Owner (AB1234),
Here are your latest mutual fund updates.
# Allotment success
| Fund | Amount |
|---|---|
| EXAMPLE VALUE INDEX FUND DIRECT PLAN GROWTH Folio no.: 910000000001, NAV: ₹26.48 Stamp Duty: ₹0.7 | ₹13,999.30 528.591 units |
| SAMPLE CONTRA FUND - DIRECT PLAN - GROWTH Folio no.: 19000001, NAV: ₹176.89 Stamp Duty: ₹1.05 | ₹20,998.95 118.713 units |
### Best,
Team Zerodha`,
}
export const KFIN = {
  from: 'EXAMPLE MUTUAL FUND <mfservice@kfintech.com>',
  subject: 'Example Mutual Fund – Purchase Confirmation - 910000000001',
  receivedAt: '2026-11-05T03:13:28Z',
  text: `| | Dear OWNER, | |
| | We have processed your purchase request for Rs. 13999.30 in Example Value Index Fund - Direct Growth. Accordingly 528.591 units have been allotted as per applicable NAV of 04/11/2026 for Rs. 26.4842 per unit. We would like to inform you … | |`,
}
export const CDSL = {
  from: 'services@cdslindia.co.in',
  subject: 'Transactions In Your Demat Account',
  receivedAt: '2026-11-05T14:03:05Z',
  text: `Following is/are the list of transactions for your Demat account ending with *00000000
| Sr. No. | Company Name | ISIN | Quantity | Debit / Credit | Date and Time |
|---|---|---|---|---|---|
| 1 | EXAMPLE AM PVT LTD#EXAMPLE MF-EXAMPLE VALUE INDEX FUND-DIRECT-GROWTH | INF000X01011 | 528.591 | Credit | 05/11/2026 19:14:35 |
| 2 | SAMPLE AMC#SAMPLE MF-SAMPLE LIQUID FUND | INF000Y02022 | 10.5 | Debit | 05/11/2026 19:14:35 |
| 3 | EXAMPLE INDUSTRIES LTD | INE000A01011 | 5 | Credit | 05/11/2026 19:14:35 |`,
}
