import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Plus, ReceiptText, ShoppingCart } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { PageHeader } from '@/app/layout/AppLayout'
import { Button, Card, CardHeader, EmptyState, StatCard } from '@/components/ui'
import { businessType, hasModule, isManagerRole } from '@/lib/business'
import { formatEUR } from '@/lib/money'
import { fetchProducts, stockLevel } from '@/features/products/api'

const dateFmt = new Intl.DateTimeFormat('sq-AL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function today(): string {
  const s = dateFmt.format(new Date())
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Phase 1: the panel frame with empty values. Real numbers arrive with sales (phase 3)
 * and reports (phase 5).
 */
export function DashboardPage() {
  const { business, profile } = useBusiness()
  const info = businessType(business.type)
  const manager = isManagerRole(profile.role)
  const stockOn = manager && hasModule(business.type, 'stock')
  const products = useQuery({ queryKey: ['products', 'admin'], queryFn: () => fetchProducts(true), enabled: stockOn })
  const lowStock = (products.data ?? []).filter((p) => p.active && ['low', 'critical'].includes(stockLevel(p))).length

  if (!manager) {
    return (
      <>
        <PageHeader eyebrow={today()} title={`Mirë se erdhe, ${profile.full_name.split(' ')[0] || ''}`} />
        <div className="grid gap-4 px-4 py-5 md:grid-cols-3 md:px-8 md:py-0">
          <StatCard label="Shitjet e mia sot" value={formatEUR(0)} />
          <StatCard label="Fatura sot" value="0" />
          {hasModule(business.type, 'commission') && <StatCard label="Komisioni im" value={formatEUR(0)} />}
        </div>
        <div className="px-4 md:px-8 md:py-5">
          <Card>
            <EmptyState
              icon={<ShoppingCart className="h-6 w-6" />}
              title="Puna e sotme shfaqet këtu"
              text="Shitjet dhe faturat e tua të sotme do të shfaqen këtu."
              action={
                <Link to="/arka">
                  <Button>Hap arkën</Button>
                </Link>
              }
            />
          </Card>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={today()}
        title="Paneli i ditës"
        actions={
          <>
            {hasModule(business.type, 'stock') && (
              <Link to="/stoku" className="hidden md:block">
                <Button variant="secondary">
                  <Plus className="h-4 w-4" /> Hyrje malli
                </Button>
              </Link>
            )}
            <Link to="/arka" className="hidden md:block">
              <Button>
                <ShoppingCart className="h-4 w-4" /> Shitje e re
              </Button>
            </Link>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 px-4 py-5 md:gap-4 md:px-8 md:py-0 lg:grid-cols-4">
        <StatCard label="Shitjet sot" value={formatEUR(0)} />
        <StatCard label="Fatura (kuponë)" value="0" />
        <StatCard label="Fitimi bruto" value={formatEUR(0)} />
        {hasModule(business.type, 'stock') ? (
          <Link to="/stoku" className="contents">
            <StatCard
              label="Stok i ulët"
              value={`${lowStock} ${info.terms.items}`}
              sub={lowStock > 0 ? 'Shiko te Stoku →' : undefined}
              tone={lowStock > 0 ? 'warn' : 'default'}
            />
          </Link>
        ) : (
          <StatCard label="Punëtorë aktivë" value="—" />
        )}
      </div>
      <div className="grid gap-4 px-4 pb-6 md:px-8 md:py-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Shitjet – 7 ditët e fundit" />
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="Ende pa shitje"
            text="Grafiku mbushet sapo të bëhen shitjet e para në arkë."
          />
        </Card>
        <Card>
          <CardHeader title="Faturat e fundit" />
          <EmptyState
            icon={<ReceiptText className="h-6 w-6" />}
            title="Ende pa fatura"
            text={`Hapi i parë: shto ${info.terms.items} te "${info.terms.catalog}", pastaj shit në arkë.`}
          />
        </Card>
      </div>
    </>
  )
}
