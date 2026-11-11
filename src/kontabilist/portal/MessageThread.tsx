import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui'
import { formatKosovoDateTime } from '@/lib/clock'
import { cn } from '@/lib/cn'
import type { Message } from './api'

/**
 * One conversation between the office and a client. `side` says who is looking: the bubbles of that side
 * are on the right. Polls every 20 s while open (no realtime needed for this volume).
 */
export function MessageThread({
  queryKey,
  load,
  send,
  side,
  emptyText,
  className,
}: {
  queryKey: readonly unknown[]
  load: () => Promise<Message[]>
  send: (body: string) => Promise<void>
  side: 'office' | 'client'
  emptyText: string
  className?: string
}) {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const list = useQuery({ queryKey, queryFn: load, refetchInterval: 20_000 })
  const bottom = useRef<HTMLDivElement>(null)
  const post = useMutation({
    mutationFn: () => send(body),
    onSuccess: () => {
      setBody('')
      void qc.invalidateQueries({ queryKey })
    },
  })
  const count = list.data?.length ?? 0
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [count])

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex max-h-[55vh] min-h-[200px] flex-col gap-2 overflow-y-auto rounded-card bg-[#F4F6F3] p-3">
        {list.isLoading ? (
          <p className="m-auto text-sm text-muted">Duke ngarkuar…</p>
        ) : list.error ? (
          <p className="m-auto text-sm text-warn-700">{(list.error as Error).message}</p>
        ) : count === 0 ? (
          <p className="m-auto max-w-[320px] text-center text-sm text-muted">{emptyText}</p>
        ) : (
          list.data!.map((m) => {
            const mine = side === 'client' ? m.from_client : !m.from_client
            return (
              <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[15px]', mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-white text-ink shadow-sm')}>{m.body}</div>
                <div className="mt-0.5 px-1 text-[11px] text-muted">
                  {m.sender_name ?? ''} · {formatKosovoDateTime(m.created_at)}
                  {mine && m.read_at && ' · lexuar'}
                </div>
              </div>
            )
          })
        )}
        <div ref={bottom} />
      </div>
      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) post.mutate()
          }}
          rows={2}
          placeholder="Shkruaj mesazhin…"
          className="min-h-[48px] flex-1 resize-none rounded-ctl border border-field bg-white px-3 py-2.5 text-[16px] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 md:text-[15px]"
        />
        <Button className="h-[48px]" loading={post.isPending} disabled={!body.trim()} onClick={() => post.mutate()} aria-label="Dërgo">
          <Send className="h-4 w-4" />
        </Button>
      </div>
      {post.error && <p className="mt-2 text-sm text-warn-700">{(post.error as Error).message}</p>}
    </div>
  )
}
