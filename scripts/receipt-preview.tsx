// Prints the thermal receipt (ESC/POS) as plain text and writes the screen receipt as HTML, for checking
// the layout without a printer:  npx tsx scripts/receipt-preview.tsx [out.html]
import { writeFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { receiptBytes } from '../src/lib/printer/receipt'
import { Receipt } from '../src/features/pos/Receipt'
import type { Sale } from '../src/features/pos/api'
import type { Business } from '../src/app/AuthProvider'
import type { ReceiptSettings } from '../src/features/settings/api'

// tsx compiles JSX in classic mode: the components need React in scope
;(globalThis as unknown as { React: typeof React }).React = React

const DEFAULT_RECEIPT: ReceiptSettings = { receipt_header: null, receipt_footer: 'Faleminderit për blerjen!', paper_width: 80, printer_chunk: 180, printer_charset: 'replace', settings: { show_vat: true, cut: true } }

const business = {
  id: 'b', name: 'Market Shembull', type: 'market', active: true, city: 'Ferizaj', address: 'Rr. Dëshmorët 10', nui: '810000001',
  vat_number: null, phone: '+383 44 000 000', fiscal_number: '600000001',
} as Business

const item = (id: string, name: string, quantity: number, unit_price: number, vat: 'E' | 'D' | 'C') =>
  ({ id, name, unit: 'cope', quantity, unit_price, total: +(quantity * unit_price).toFixed(2), vat_code: vat, line_discount: 0, invoice_discount: 0 }) as unknown as Sale['items'][number]

const sale = {
  id: 's', kind: 'sale', ref_sale_id: null, ref_invoice_no: null, invoice_no: 40, daily_no: 11, sale_date: '2026-11-12',
  created_at: '2026-11-12T12:51:36Z', client_created_at: '2026-11-12T12:51:36Z', items_count: 3, subtotal: 6.5, invoice_discount: 0,
  discount_total: 0, total: 6.5, net_total: 5.69, vat_total: 0.81,
  vat_lines: [{ code: 'E', rate: 0.18, gross: 4.4, net: 3.73, vat: 0.67 }, { code: 'D', rate: 0.08, gross: 2.1, net: 1.94, vat: 0.16 }],
  payment_method: 'cash', cash_amount: 6.5, card_amount: 0, tendered: 10, change_amount: 3.5, reason: null, note: null,
  offline: false, offline_no: null, fiscal_status: 'sent', worker_id: 'w', worker_name: 'Arta Krasniqi', register_name: 'Arka 1',
  items: [item('1', 'Sanduiç klasik me pulë dhe djathë', 2, 2.2, 'E'), item('2', 'Ujë mineral 0.5L', 1, 1.5, 'D'), item('3', 'Bukë', 2, 0.3, 'D')],
  voided: false, has_refunds: false,
  fiscal: {
    coupon_id: '1000300000040', verification_no: 'VGDVZWNAPCGRAB7P', sef_no: '1-810000001-3', issued_at: '2026-11-12T12:51:36Z',
    status: 'sent', offline: false, env: 'test', qr: 'Q2l0aXplbkNvdXBvbg==|MEUCIQDexampleSignature',
  },
} as unknown as Sale

const visible = (bytes: Uint8Array) => {
  // drop ESC/GS commands, keep printable text and new lines
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 0x1b || b === 0x1d) {
      const c = bytes[i + 1]
      if (b === 0x1d && c === 0x76) {
        const wb = bytes[i + 4] + 256 * bytes[i + 5]
        const h = bytes[i + 6] + 256 * bytes[i + 7]
        out += `[IMAGE ${wb * 8}x${h}]`
        i += 7 + wb * h
        continue
      }
      if (b === 0x1d && c === 0x28 && bytes[i + 2] === 0x6b) {
        const len = bytes[i + 3] + 256 * bytes[i + 4]
        if (bytes[i + 5] === 0x31 && bytes[i + 6] === 0x50) out += '[QR]'
        i += 4 + len
        continue
      }
      i += c === 0x21 || c === 0x45 || c === 0x61 || c === 0x64 || c === 0x74 || c === 0x56 ? 2 : 1
      if (c === 0x56) i += 1
      continue
    }
    if (b === 0x0a) out += '\n'
    else if (b >= 0x20) out += String.fromCharCode(b)
  }
  return out
}

for (const width of [80, 58] as const) {
  const text = visible(receiptBytes(sale, business, { ...DEFAULT_RECEIPT, paper_width: width, printer_charset: 'replace' }))
  console.log(`===== ${width} mm =====`)
  console.log(text.replace(/\n{3,}/g, '\n\n'))
}

const out = process.argv[2]
if (out) writeFileSync(out, renderToStaticMarkup(<Receipt sale={sale} business={business} settings={DEFAULT_RECEIPT} />))
