import { Hammer } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Card, EmptyState } from '@/components/ui'

/** Placeholder for screens built in a later phase. */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="px-4 py-5 md:px-8 md:py-0">
        <Card>
          <EmptyState icon={<Hammer className="h-6 w-6" />} title="Ky ekran po ndërtohet" text={`Vjen në ${phase}.`} />
        </Card>
      </div>
    </>
  )
}
