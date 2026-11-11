import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Globe, Monitor, Smartphone, Tablet, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/AuthProvider'
import { PublicFooter, PublicHeader } from '@/features/landing/LandingPage'
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { device } from '@/lib/device'

/**
 * /shkarko – Windows (.exe) and Android (APK) come from the latest GitHub Release, built by
 * .github/workflows/release.yml. Store links appear once the apps are published there.
 */
const REPO = 'jonislami/kasa'
const PLAY_STORE_URL: string | null = null // e.g. 'https://play.google.com/store/apps/details?id=app.kasa.pos'
const APP_STORE_URL: string | null = null // e.g. 'https://apps.apple.com/app/idXXXXXXXXX'

interface Asset {
  name: string
  size: number
  browser_download_url: string
}
interface Release {
  tag_name: string
  published_at: string
  assets: Asset[]
}

async function latestRelease(): Promise<Release | null> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`GitHub ${r.status}`)
  return (await r.json()) as Release
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`
const dateFmt = new Intl.DateTimeFormat('sq-AL', { day: 'numeric', month: 'long', year: 'numeric' })

export function DownloadPage() {
  const release = useQuery({ queryKey: ['latest-release'], queryFn: latestRelease, staleTime: 10 * 60_000, retry: 1 })
  const r = release.data
  const version = r?.tag_name.replace(/^v/, '') ?? null
  const { ctx, refresh } = useAuth()
  // businesses made before SEF have no can_install: an active business may install
  const allowed = Boolean(ctx?.business && (ctx.business.can_install ?? ctx.business.active))
  const signedInBusiness = Boolean(ctx?.business)
  // the admin may have just approved the till: check again instead of trusting the saved context
  useEffect(() => {
    if (signedInBusiness && !allowed) refresh()
  }, [signedInBusiness, allowed, refresh])

  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader />
      <section className="bg-brand-900 pb-24 text-white">
        <div className="mx-auto max-w-[1200px] px-5 pt-8 md:pt-12">
          <h1 className="text-[34px] font-bold tracking-tight md:text-[48px]">Shkarko Kasa</h1>
          <p className="mt-3 max-w-xl text-[17px] text-white/75">
            Zgjidh pajisjen. Hyn me të njëjtin email dhe fjalëkalim kudo, dhe të dhënat janë të njëjta në të gjitha.
          </p>
          <p className="mt-3 text-sm text-white/55">
            {release.isLoading
              ? 'Duke kontrolluar versionin e fundit…'
              : r && version
                ? `Versioni i fundit: ${version} · ${dateFmt.format(new Date(r.published_at))}`
                : `Versioni në shfletues: ${device.appVersion}`}
          </p>
        </div>
      </section>

      <main className="mx-auto -mt-16 max-w-[1200px] px-5 pb-16">
        {allowed ? (
          <DownloadCards />
        ) : (
          <div className="rounded-[20px] border border-line bg-white p-7 shadow-sm md:p-9">
            <h2 className="text-[22px] font-bold">Shkarkimi hapet pas aktivizimit</h2>
            <p className="mt-2 max-w-2xl text-muted">
              Kasa instalohet pasi të regjistrohet biznesi, të aprovohet llogaria, të konfirmohet pagesa dhe të aprovohet aplikimi për arkë. Pastaj butoni
              <b> Install SEF</b> të del te paneli yt, me programin e duhur për llojin e biznesit.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {ctx?.profile ? (
                <Link to="/llogaria">
                  <Button size="lg">Shiko statusin e llogarisë</Button>
                </Link>
              ) : (
                <>
                  <Link to="/regjistrohu">
                    <Button size="lg">Regjistro biznesin</Button>
                  </Link>
                  <Link to="/login">
                    <Button size="lg" variant="secondary">
                      Hyr
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  )
}

/** The download cards (Windows, Android, iPhone, browser) – on /shkarko and in the owner's panel (Install SEF). */
export function DownloadCards({ businessLabel }: { businessLabel?: string }) {
  const release = useQuery({ queryKey: ['latest-release'], queryFn: latestRelease, staleTime: 10 * 60_000, retry: 1 })
  const r = release.data
  const version = r?.tag_name.replace(/^v/, '') ?? null
  const exe = r?.assets.find((a) => /\.exe$/i.test(a.name) && !/blockmap/i.test(a.name))
  const apk = r?.assets.find((a) => /\.apk$/i.test(a.name))
  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const notYet = release.isSuccess && !r
  return (
    <>
      {businessLabel && (
        <p className="mb-4 rounded-ctl bg-brand-100 px-4 py-3 text-sm text-brand-600">
          Programi hapet vetë si <b>{businessLabel}</b> pasi të hysh me llogarinë e biznesit – pa module që nuk të duhen.
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <PlatformCard
          icon={Monitor}
          title="Windows"
          chips={[version && `v${version}`, exe && mb(exe.size), 'Windows 10 / 11']}
          actions={
            exe ? (
              <a href={exe.browser_download_url} className="block">
                <Button block size="lg">
                  Shkarko {exe.name}
                </Button>
              </a>
            ) : (
              <Button block size="lg" disabled>
                {notYet || release.isError ? 'Së shpejti' : 'Duke ngarkuar…'}
              </Button>
            )
          }
          steps={[
            'Hap skedarin e shkarkuar nga dosja Downloads.',
            'Nëse Windows pyet, zgjidh "Më shumë info" → "Ekzekuto gjithsesi".',
            'Hap Kasa nga Desktop-i dhe hyr me email-in tënd. Programi përditësohet vetë.',
          ]}
        />

        <PlatformCard
          icon={Smartphone}
          title="Android"
          chips={[version && `v${version}`, apk && mb(apk.size), 'Android 7 e më i ri']}
          actions={
            <div className="grid grid-cols-2 gap-2.5">
              {PLAY_STORE_URL ? (
                <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
                  <Button block size="lg">
                    Hape në Google Play
                  </Button>
                </a>
              ) : (
                <Button block size="lg" disabled>
                  Google Play – së shpejti
                </Button>
              )}
              {apk ? (
                <a href={apk.browser_download_url}>
                  <Button block size="lg" variant="secondary">
                    Shkarko APK
                  </Button>
                </a>
              ) : (
                <Button block size="lg" variant="secondary" disabled>
                  APK – së shpejti
                </Button>
              )}
            </div>
          }
          steps={[
            'Hape Google Play dhe shtyp "Instalo" (ose hap APK-në e shkarkuar).',
            'Për APK: lejo "Instalo nga burime të panjohura" kur ta kërkojë telefoni.',
            'Hap Kasa, hyr dhe lejo Bluetooth-in për printerin.',
          ]}
        />

        <PlatformCard
          icon={Tablet}
          title="iPhone / iPad"
          chips={[version && `v${version}`, 'iOS 15 e më i ri']}
          actions={
            APP_STORE_URL ? (
              <a href={APP_STORE_URL} target="_blank" rel="noreferrer">
                <Button block size="lg">
                  Hape në App Store
                </Button>
              </a>
            ) : (
              <Button block size="lg" disabled>
                App Store – së shpejti
              </Button>
            )
          }
          steps={['Hape App Store dhe kërko "Kasa", ose shtyp butonin më lart.', 'Shtyp "Merr" dhe konfirmo me Face ID.', 'Hap Kasa, hyr dhe lejo Bluetooth-in kur të pyesë.']}
          note={APP_STORE_URL ? undefined : 'Deri sa të dalë në App Store, përdore në Safari dhe "Shto në ekranin bazë". Printimi në iPhone bëhet nga Safari (AirPrint) ose me aplikacionin kur të publikohet.'}
        />

        <PlatformCard
          icon={Globe}
          title="Përdore në shfletues"
          chips={['Pa instalim', 'Chrome · Edge · Safari']}
          actions={
            <Link to="/login" className="block">
              <Button block size="lg">
                Hape Kasa në shfletues
              </Button>
            </Link>
          }
          steps={[
            <>
              Hap <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-[13px]">{appUrl.replace(/^https?:\/\//, '')}</code> në Chrome ose Edge.
            </>,
            'Hyr me email-in dhe fjalëkalimin.',
            'Opsionale: nga menuja zgjidh "Instalo aplikacionin" që të hapet si program dhe të punojë pa internet.',
          ]}
          note="Printeri me Bluetooth punon në Chrome dhe Edge. Në Safari përdor aplikacionin për iPhone."
        />
            </div>
    </>
  )
}

function PlatformCard({
  icon: Icon,
  title,
  chips,
  actions,
  steps,
  note,
}: {
  icon: LucideIcon
  title: string
  chips: (string | false | null | undefined)[]
  actions: React.ReactNode
  steps: React.ReactNode[]
  note?: string
}) {
  return (
    <div className="rounded-[20px] border border-line bg-white p-6 shadow-sm md:p-7">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-900 text-brand-400">
          <Icon className="h-7 w-7" />
        </div>
        <div>
          <h2 className="text-[22px] font-bold">{title}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {chips.filter(Boolean).map((c) => (
              <Badge key={String(c)}>{c}</Badge>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5">{actions}</div>
      <ol className="mt-5 flex flex-col gap-3 border-t border-line pt-5 text-[15px]">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-600">{i + 1}</span>
            <span className="text-muted">{s}</span>
          </li>
        ))}
      </ol>
      {note && <p className={cn('mt-4 rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700')}>{note}</p>}
    </div>
  )
}
