import { Link } from 'react-router-dom'
import { Eyebrow, H2, Lead, PrimaryLink, Section, SecondaryLink, SitePage } from './SiteLayout'

const STEPS = [
  {
    title: 'Regjistro biznesin',
    text: 'Plotëso emrin e biznesit, NUI-në, adresën dhe llojin (market, gastronomi, barnatore, butik ose shërbime) dhe krijo llogarinë e pronarit me email dhe fjalëkalim. Lloji nuk ndryshohet më pas.',
    when: 'Sot, në pak minuta',
  },
  {
    title: 'Miratimi i biznesit',
    text: 'Aplikimi shqyrtohet nga KontoSef.app. Deri atëherë, kur hyn në llogari, sheh statusin “në shqyrtim”.',
    when: 'Pas shqyrtimit',
  },
  {
    title: 'Merr çelësin e arkës',
    text: 'Pas miratimit, te llogaria jote hapet shkarkimi i programit dhe del çelësi i aktivizimit për çdo arkë, në formën KASA-XXXX-XXXX-XXXX. Një çelës vlen për një pajisje.',
    when: 'Hapet shkarkimi',
  },
  {
    title: 'Aktivizo arkën',
    text: 'Instalo programin në Windows ose Android, fut çelësin një herë dhe hyr me PIN-in e punëtorit. Pastaj shto produktet (edhe nga Excel), lidh printerin dhe nis kuponin e parë.',
    when: 'Arka gati për shitje',
  },
]

/** /fillo – registration, approval, the key, activating the till; when the download opens; sign-in for clients. */
export function StartPage() {
  return (
    <SitePage>
      <Section tone="gray" className="pb-12 md:pb-16">
        <Eyebrow>Si të fillosh</Eyebrow>
        <h1 className="mt-2 max-w-3xl text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[46px]">Nga regjistrimi te arka e aktivizuar</h1>
        <Lead className="mt-4 max-w-2xl">Katër hapa. Shkarkimi i programit hapet vetëm pasi të miratohet biznesi, sepse çdo arkë lidhet me biznesin dhe me ATK-në.</Lead>
      </Section>

      <Section>
        <ol className="relative grid gap-0">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid gap-4 border-t border-line py-8 md:grid-cols-[80px_1fr_220px] md:gap-8">
              <span className="text-[40px] font-semibold leading-none tracking-[-0.03em] text-brand-600 tabular-nums">{i + 1}</span>
              <div>
                <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{s.title}</h2>
                <p className="mt-2 max-w-2xl text-[16px] leading-relaxed text-muted">{s.text}</p>
              </div>
              <div className="self-start rounded-ctl bg-[#F5F7FA] px-4 py-2 text-[14px] font-semibold text-[#344054] md:text-right">{s.when}</div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-3">
          <PrimaryLink to="/regjistrohu">Regjistro biznesin</PrimaryLink>
          <SecondaryLink to="/pajisjet">Pajisjet që duhen</SecondaryLink>
        </div>
      </Section>

      <Section tone="gray">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <H2>Ke llogari?</H2>
            <Lead className="mt-3">Pronari dhe menaxheri hyjnë me email dhe fjalëkalim për produktet, stokun, punëtorët dhe raportet. Punëtorët hyjnë në arkë me PIN.</Lead>
            <div className="mt-6">
              <PrimaryLink to="/login">Hyr</PrimaryLink>
            </div>
          </div>
          <div>
            <H2>Je kontabilist?</H2>
            <Lead className="mt-3">Llogarinë e kontabilistit e krijon administratori i KontoSef.app. Programi KontoSef Kontabilist punon në Windows dhe në shfletues.</Lead>
            <Link to="/kontabilisti" className="mt-6 inline-flex h-12 items-center rounded-ctl border border-field bg-white px-6 text-[15px] font-semibold text-ink hover:bg-[#F7F8FA]">
              KontoSef Kontabilist
            </Link>
          </div>
        </div>
      </Section>
    </SitePage>
  )
}
