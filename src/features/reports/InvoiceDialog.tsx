import { useQuery } from '@tanstack/react-query'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { useBusiness } from '@/app/AuthProvider'
import { Button, Dialog } from '@/components/ui'
import { formatInvoiceNo } from '@/lib/money'
import { getSale } from '@/features/pos/api'
import { Receipt } from '@/features/pos/Receipt'

/** Shows one stored invoice (receipt view). */
export function InvoiceDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const { business } = useBusiness()
  const sale = useQuery({ queryKey: ['sale', saleId], queryFn: () => getSale(saleId!), enabled: Boolean(saleId) })
  if (!saleId) return null
  return (
    <Dialog
      open
      onClose={onClose}
      title={sale.data ? `Fatura ${formatInvoiceNo(sale.data.invoice_no)}` : 'Fatura'}
      width="md:max-w-[460px]"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Mbyll
          </Button>
        </div>
      }
    >
      {loadState(sale) === 'offline' ? (
              <OfflineEmpty />
            ) : loadState(sale) === 'loading' ? (
        <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
      ) : loadState(sale) === 'error' || !sale.data ? (
        <p className="text-sm text-warn-700">{sale.error ? (sale.error as Error).message : 'Fatura nuk u gjet'}</p>
      ) : (
        <div className="flex justify-center">
          <Receipt sale={sale.data} business={business} />
        </div>
      )}
    </Dialog>
  )
}
